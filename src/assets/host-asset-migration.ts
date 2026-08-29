import {
	type CanvasAssetRef,
	type CanvasCommand,
	type CanvasIR,
	isLocalObjectUri,
} from "@anvilkit/canvas-core";
import type { CanvasAssetUploader } from "./adapter-types.js";
import { ASSET_MIGRATION_HISTORY_LABEL } from "./asset-migration-contract.js";
import {
	assessCanvasDocumentPortability,
	type CanvasAssetPortabilityIssue,
} from "./asset-portability.js";
import type { CanvasEffectiveAssetEntry } from "./effective-asset-resolver.js";
import type { LocalAssetMeta, LocalAssetStore } from "./local-asset-store.js";

export type CanvasAssetMigrationIssueReason =
	| "asset-not-ready"
	| "unsupported-reference"
	| "no-uploader"
	| "storage-unavailable"
	| "missing-local-bytes"
	| "upload-failed"
	| "invalid-host-reference"
	| "asset-id-conflict"
	| "document-changed"
	| "commit-rejected";

export interface CanvasAssetMigrationIssue {
	readonly assetId: string;
	readonly uri: string;
	readonly reason: CanvasAssetMigrationIssueReason;
	readonly message: string;
	readonly retryable: boolean;
	readonly replaceable: boolean;
}

export interface CanvasAssetMigrationRetryState {
	/** Successful host uploads keyed by their original document asset id. */
	readonly uploadedAssets: Readonly<Record<string, CanvasAssetRef>>;
}

export type CanvasAssetMigrationResult =
	| {
			readonly status: "ready";
			readonly migratedAssetIds: readonly [];
			readonly unresolvedAssets: readonly [];
	  }
	| {
			readonly status: "migrated";
			readonly migratedAssetIds: readonly string[];
			readonly unresolvedAssets: readonly [];
	  }
	| {
			readonly status: "blocked";
			readonly migratedAssetIds: readonly [];
			readonly unresolvedAssets: readonly CanvasAssetMigrationIssue[];
			/** Pass this back to retry without uploading successful assets twice. */
			readonly retryState?: CanvasAssetMigrationRetryState;
	  };

export interface CanvasAssetMigrationDocumentPort {
	getIR(): CanvasIR;
	commitBatch(commands: readonly CanvasCommand[], label?: string): CanvasIR;
}

export interface CanvasAssetMigrationProgress {
	readonly assetId: string;
	readonly fraction?: number;
}

export interface CanvasAssetMigrationRunOptions {
	readonly signal?: AbortSignal;
	readonly retryState?: CanvasAssetMigrationRetryState;
	readonly onProgress?: (progress: CanvasAssetMigrationProgress) => void;
	/** Test/host seam. Defaults to the shared browser-local asset store. */
	readonly store?: LocalAssetStore;
}

export interface MigrateCanvasAssetsForSharingOptions
	extends CanvasAssetMigrationRunOptions {
	readonly document: CanvasAssetMigrationDocumentPort;
	readonly entries: Readonly<Record<string, CanvasEffectiveAssetEntry>>;
	readonly uploader?: CanvasAssetUploader;
}

function hostedUri(uri: string): boolean {
	try {
		const protocol = new URL(uri).protocol;
		return protocol === "http:" || protocol === "https:";
	} catch {
		return false;
	}
}

async function resolveStore(store?: LocalAssetStore): Promise<LocalAssetStore> {
	if (store) return store;
	const { getSharedLocalAssetStore } = await import("./local-asset-store.js");
	return getSharedLocalAssetStore();
}

function blocked(
	unresolvedAssets: readonly CanvasAssetMigrationIssue[],
	uploadedAssets?: Readonly<Record<string, CanvasAssetRef>>,
): CanvasAssetMigrationResult {
	return {
		status: "blocked",
		migratedAssetIds: [],
		unresolvedAssets,
		...(uploadedAssets && Object.keys(uploadedAssets).length > 0
			? { retryState: { uploadedAssets } }
			: {}),
	};
}

function portabilityBlocker(
	issue: CanvasAssetPortabilityIssue,
): CanvasAssetMigrationIssue {
	return {
		assetId: issue.assetId,
		uri: issue.uri,
		reason:
			issue.action === "upload" ? "unsupported-reference" : "asset-not-ready",
		message: issue.message,
		retryable: issue.action === "wait" || issue.action === "retry",
		replaceable: true,
	};
}

function localIssue(
	entry: CanvasEffectiveAssetEntry,
	reason: CanvasAssetMigrationIssueReason,
	message: string,
	retryable: boolean,
): CanvasAssetMigrationIssue {
	return {
		assetId: entry.id,
		uri: entry.documentAsset.uri,
		reason,
		message,
		retryable,
		replaceable: true,
	};
}

function migrationFile(
	entry: CanvasEffectiveAssetEntry,
	blob: Blob,
	meta: LocalAssetMeta | undefined,
): File {
	const mimeType = meta?.mimeType || entry.documentAsset.mimeType || blob.type;
	return new File([blob], meta?.name || entry.id, {
		...(mimeType ? { type: mimeType } : {}),
	});
}

/**
 * Upload every healthy browser-local asset, then commit all reference moves in
 * one batch. No command is applied until every upload is valid, so any failure
 * leaves the local design byte-for-byte unchanged and returns resumable state.
 */
export async function migrateCanvasAssetsForSharing({
	document,
	entries,
	uploader,
	signal,
	retryState,
	onProgress,
	store,
}: MigrateCanvasAssetsForSharingOptions): Promise<CanvasAssetMigrationResult> {
	const ir = document.getIR();
	const assessment = assessCanvasDocumentPortability(
		entries,
		"hosted-reference",
	);
	if (assessment.ready) {
		return { status: "ready", migratedAssetIds: [], unresolvedAssets: [] };
	}

	const candidates: CanvasEffectiveAssetEntry[] = [];
	const blockers: CanvasAssetMigrationIssue[] = [];
	for (const issue of assessment.unresolvedAssets) {
		const entry = entries[issue.assetId];
		if (
			entry &&
			entry.status === "ready" &&
			issue.reason === "browser-local-reference" &&
			isLocalObjectUri(entry.documentAsset.uri)
		) {
			candidates.push(entry);
		} else {
			blockers.push(portabilityBlocker(issue));
		}
	}
	if (blockers.length > 0) return blocked(blockers);
	if (!uploader) {
		return blocked(
			candidates.map((entry) =>
				localIssue(
					entry,
					"no-uploader",
					`Asset "${entry.id}" is local, but no host migration uploader is configured.`,
					false,
				),
			),
		);
	}

	let localStore: LocalAssetStore;
	let metaById: Map<string, LocalAssetMeta>;
	try {
		localStore = await resolveStore(store);
		metaById = new Map(
			(await localStore.list()).map((meta) => [meta.id, meta]),
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return blocked(
			candidates.map((entry) =>
				localIssue(
					entry,
					"storage-unavailable",
					`Asset "${entry.id}" could not be read from local storage: ${message}`,
					true,
				),
			),
		);
	}

	const uploadedAssets: Record<string, CanvasAssetRef> = {
		...(retryState?.uploadedAssets ?? {}),
	};
	const issues: CanvasAssetMigrationIssue[] = [];
	for (const entry of candidates) {
		if (uploadedAssets[entry.id]) continue;
		if (signal?.aborted) {
			issues.push(
				localIssue(
					entry,
					"upload-failed",
					`Upload of asset "${entry.id}" was cancelled.`,
					true,
				),
			);
			continue;
		}
		const blob = await localStore.get(entry.id);
		if (!blob) {
			issues.push(
				localIssue(
					entry,
					"missing-local-bytes",
					`Asset "${entry.id}" is no longer present in this browser. Replace it before sharing.`,
					false,
				),
			);
			continue;
		}
		try {
			const uploaded = await uploader.upload(
				[migrationFile(entry, blob, metaById.get(entry.id))],
				{
					documentId: ir.id,
					...(signal ? { signal } : {}),
					onProgress: (progress) => {
						if (progress.fileIndex !== 0) return;
						onProgress?.({
							assetId: entry.id,
							...(progress.fraction !== undefined
								? { fraction: progress.fraction }
								: {}),
						});
					},
				},
			);
			const asset = uploaded[0];
			if (!asset || !hostedUri(asset.uri)) {
				issues.push(
					localIssue(
						entry,
						"invalid-host-reference",
						`Host upload for asset "${entry.id}" did not return an absolute HTTP(S) reference.`,
						true,
					),
				);
				continue;
			}
			uploadedAssets[entry.id] = asset;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			issues.push(
				localIssue(
					entry,
					"upload-failed",
					`Upload of asset "${entry.id}" failed: ${message}`,
					true,
				),
			);
		}
	}

	const targetOwners = new Map<string, string>();
	for (const entry of candidates) {
		const asset = uploadedAssets[entry.id];
		if (!asset) continue;
		const owner = targetOwners.get(asset.id);
		const conflictsWithDocument =
			asset.id !== entry.id && ir.assets[asset.id] !== undefined;
		if ((owner && owner !== entry.id) || conflictsWithDocument) {
			issues.push(
				localIssue(
					entry,
					"asset-id-conflict",
					`Host upload for asset "${entry.id}" returned conflicting id "${asset.id}".`,
					true,
				),
			);
			delete uploadedAssets[entry.id];
			continue;
		}
		targetOwners.set(asset.id, entry.id);
	}
	if (issues.length > 0) return blocked(issues, uploadedAssets);

	const current = document.getIR();
	if (
		current.id !== ir.id ||
		candidates.some(
			(entry) => current.assets[entry.id]?.uri !== entry.documentAsset.uri,
		)
	) {
		return blocked(
			candidates.map((entry) =>
				localIssue(
					entry,
					"document-changed",
					`Document assets changed while "${entry.id}" was uploading. Review and retry sharing.`,
					true,
				),
			),
			uploadedAssets,
		);
	}

	const commands: CanvasCommand[] = candidates.map((entry) => ({
		type: "asset.migrate",
		fromAssetId: entry.id,
		asset: uploadedAssets[entry.id]!,
	}));
	const migrated = document.commitBatch(
		commands,
		ASSET_MIGRATION_HISTORY_LABEL,
	);
	const rejected = candidates.some((entry) => {
		const asset = uploadedAssets[entry.id]!;
		return (
			migrated.assets[asset.id]?.uri !== asset.uri ||
			(asset.id !== entry.id && migrated.assets[entry.id] !== undefined)
		);
	});
	if (rejected) {
		return blocked(
			candidates.map((entry) =>
				localIssue(
					entry,
					"commit-rejected",
					`Asset "${entry.id}" was uploaded, but the document rejected the migration transaction.`,
					true,
				),
			),
			uploadedAssets,
		);
	}
	return {
		status: "migrated",
		migratedAssetIds: candidates.map((entry) => entry.id),
		unresolvedAssets: [],
	};
}
