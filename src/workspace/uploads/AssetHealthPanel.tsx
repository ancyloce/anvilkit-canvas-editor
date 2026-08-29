"use client";

import type { CanvasAssetRef } from "@anvilkit/canvas-core";
import { Button } from "@anvilkit/ui/button";
import * as React from "react";
import { useState } from "react";
import {
	assessCanvasDocumentPortability,
	type CanvasAssetPortabilityIssue,
} from "../../assets/asset-portability.js";
import type { CanvasEffectiveAssetEntry } from "../../assets/effective-asset-resolver.js";
import type {
	CanvasAssetMigrationIssue,
	CanvasAssetMigrationResult,
	CanvasAssetMigrationRetryState,
} from "../../assets/host-asset-migration.js";
import {
	useCanvasStudio,
	useCanvasT,
} from "../../context/canvas-studio-context.js";

type BlockedMigrationResult = Extract<
	CanvasAssetMigrationResult,
	{ status: "blocked" }
>;

type AssetActivity =
	| { readonly kind: "retrying"; readonly entry: CanvasEffectiveAssetEntry }
	| { readonly kind: "replacing" }
	| { readonly kind: "replaced" }
	| { readonly kind: "replacement-failed"; readonly message: string };

type MigrationUiState =
	| { readonly phase: "idle" }
	| {
			readonly phase: "uploading" | "retrying";
			readonly retryState?: CanvasAssetMigrationRetryState;
			readonly activeAssetId?: string;
			readonly fraction?: number;
	  }
	| { readonly phase: "blocked"; readonly result: BlockedMigrationResult }
	| { readonly phase: "complete" }
	| {
			readonly phase: "failed";
			readonly message: string;
			readonly retryState?: CanvasAssetMigrationRetryState;
	  };

function pickedAssetRef(asset: {
	id: string;
	uri: string;
	mimeType?: string;
	width?: number;
	height?: number;
}): CanvasAssetRef {
	return {
		id: asset.id,
		uri: asset.uri,
		...(asset.mimeType !== undefined ? { mimeType: asset.mimeType } : {}),
		...(asset.width !== undefined ? { width: asset.width } : {}),
		...(asset.height !== undefined ? { height: asset.height } : {}),
	};
}

function issueMap<T extends { readonly assetId: string }>(
	issues: readonly T[],
): ReadonlyMap<string, T> {
	return new Map(issues.map((issue) => [issue.assetId, issue]));
}

/** Health and recovery controls for every asset in the shared effective table. */
export function AssetHealthPanel(): React.JSX.Element | null {
	const ctx = useCanvasStudio();
	const t = useCanvasT();
	const entries = ctx.assetResolutions ?? {};
	const [activities, setActivities] = useState<
		Readonly<Record<string, AssetActivity>>
	>({});
	const [migration, setMigration] = useState<MigrationUiState>({
		phase: "idle",
	});
	const mode = ctx.assetPortabilityMode ?? "local-only";
	const assessment = assessCanvasDocumentPortability(entries, mode);
	const portabilityById = issueMap(assessment.unresolvedAssets);
	const blockedResult = migration.phase === "blocked" ? migration.result : null;
	const migrationById = issueMap(blockedResult?.unresolvedAssets ?? []);
	const problemIds = new Set<string>();
	for (const entry of Object.values(entries)) {
		if (entry.status !== "ready") problemIds.add(entry.id);
	}
	for (const issue of assessment.unresolvedAssets)
		problemIds.add(issue.assetId);
	for (const issue of blockedResult?.unresolvedAssets ?? []) {
		problemIds.add(issue.assetId);
	}

	const runMigration = async (
		retryState?: CanvasAssetMigrationRetryState,
		retrying = false,
	): Promise<void> => {
		const migrate = ctx.migrateAssetsForSharing;
		if (!migrate) return;
		setMigration({
			phase: retrying ? "retrying" : "uploading",
			...(retryState ? { retryState } : {}),
		});
		try {
			const result = await migrate({
				...(retryState ? { retryState } : {}),
				onProgress: ({ assetId, fraction }) => {
					setMigration((current) =>
						current.phase === "uploading" || current.phase === "retrying"
							? {
									...current,
									activeAssetId: assetId,
									...(fraction !== undefined ? { fraction } : {}),
								}
							: current,
					);
				},
			});
			setMigration(
				result.status === "blocked"
					? { phase: "blocked", result }
					: { phase: "complete" },
			);
		} catch (error) {
			setMigration({
				phase: "failed",
				message: error instanceof Error ? error.message : String(error),
				...(retryState ? { retryState } : {}),
			});
		}
	};

	const retry = (entry: CanvasEffectiveAssetEntry): void => {
		const migrationIssue = migrationById.get(entry.id);
		if (migrationIssue?.retryable && blockedResult) {
			void runMigration(blockedResult.retryState, true);
			return;
		}
		if (!ctx.retryAssetResolution) return;
		setActivities((current) => ({
			...current,
			[entry.id]: { kind: "retrying", entry },
		}));
		ctx.retryAssetResolution(entry.id);
	};

	const replace = async (entry: CanvasEffectiveAssetEntry): Promise<void> => {
		const picker = ctx.assetPicker;
		if (!picker) return;
		setActivities((current) => ({
			...current,
			[entry.id]: { kind: "replacing" },
		}));
		try {
			const picked = await picker.pick({ multiple: false, kind: "image" });
			const first = picked[0];
			if (!first) {
				setActivities((current) => {
					const next = { ...current };
					delete next[entry.id];
					return next;
				});
				return;
			}
			if (!ctx.getIR().assets[entry.id]) {
				throw new Error(
					t(
						"canvas.assetHealth.assetChanged",
						"The asset changed before replacement could finish.",
					),
				);
			}
			const asset = pickedAssetRef(first);
			const next = ctx.commit({
				type: "asset.migrate",
				fromAssetId: entry.id,
				asset,
			});
			const applied =
				next.assets[asset.id]?.uri === asset.uri &&
				(asset.id === entry.id || next.assets[entry.id] === undefined);
			if (!applied) {
				throw new Error(
					t(
						"canvas.assetHealth.replacementRejected",
						"The replacement conflicted with another document asset.",
					),
				);
			}
			setActivities((current) => ({
				...current,
				[entry.id]: { kind: "replaced" },
			}));
		} catch (error) {
			setActivities((current) => ({
				...current,
				[entry.id]: {
					kind: "replacement-failed",
					message: error instanceof Error ? error.message : String(error),
				},
			}));
		}
	};

	const allEntries = Object.values(entries);
	if (allEntries.length === 0 && migration.phase === "idle") return null;

	const migrationRunning =
		migration.phase === "uploading" || migration.phase === "retrying";
	const uploadIssues = assessment.unresolvedAssets.filter(
		(issue) => issue.action === "upload",
	);
	const showMigrationAction =
		mode === "hosted-reference" &&
		uploadIssues.length > 0 &&
		ctx.migrateAssetsForSharing !== undefined;
	const retryState =
		migration.phase === "blocked"
			? migration.result.retryState
			: migration.phase === "failed"
				? migration.retryState
				: undefined;

	return (
		<section
			aria-labelledby="asset-health-title"
			className="flex flex-col gap-2 border-t border-border pt-3"
			data-testid="asset-health"
		>
			<div className="flex items-center justify-between gap-2">
				<h3 id="asset-health-title" className="text-xs font-medium">
					{t("canvas.assetHealth.title", "Asset health")}
				</h3>
				{showMigrationAction ? (
					<Button
						type="button"
						variant="outline"
						size="xs"
						disabled={migrationRunning}
						data-testid="asset-health-migrate"
						onClick={() =>
							void runMigration(retryState, retryState !== undefined)
						}
					>
						{migrationRunning
							? migration.phase === "retrying"
								? t("canvas.assetHealth.retrying", "Retrying…")
								: t("canvas.assetHealth.uploading", "Uploading…")
							: retryState
								? t("canvas.assetHealth.retryPortability", "Retry portability")
								: t("canvas.assetHealth.makePortable", "Make portable")}
					</Button>
				) : null}
			</div>
			{migrationRunning ? (
				<div
					role="progressbar"
					aria-label={t(
						"canvas.assetHealth.portabilityProgress",
						"Asset portability progress",
					)}
					aria-valuemin={0}
					aria-valuemax={100}
					{...(migration.fraction !== undefined
						? { "aria-valuenow": Math.round(migration.fraction * 100) }
						: {})}
					className="h-1 overflow-hidden rounded-full bg-border"
					data-testid="asset-health-migration-progress"
				>
					<div
						className={
							migration.fraction === undefined
								? "h-full w-1/3 animate-pulse rounded-full bg-primary"
								: "h-full rounded-full bg-primary transition-[width]"
						}
						style={
							migration.fraction === undefined
								? undefined
								: { width: `${Math.round(migration.fraction * 100)}%` }
						}
					/>
				</div>
			) : null}
			{migration.phase === "failed" ? (
				<p className="text-xs text-destructive" role="alert">
					{migration.message}
				</p>
			) : null}
			{migration.phase === "complete" ? (
				<p className="text-xs text-muted-foreground" role="status">
					{t(
						"canvas.assetHealth.migrationComplete",
						"Assets are ready to share.",
					)}
				</p>
			) : null}
			{problemIds.size === 0 ? (
				<p className="text-xs text-muted-foreground" role="status">
					{t(
						"canvas.assetHealth.allAvailable",
						"All document assets are available.",
					)}
				</p>
			) : (
				<ul className="flex flex-col gap-1" data-testid="asset-health-list">
					{Array.from(problemIds).map((assetId) => {
						const entry = entries[assetId];
						if (!entry) return null;
						return (
							<AssetHealthRow
								key={assetId}
								entry={entry}
								activity={activities[assetId]}
								portabilityIssue={portabilityById.get(assetId)}
								migrationIssue={migrationById.get(assetId)}
								migration={migration}
								canRetry={
									(Boolean(migrationById.get(assetId)?.retryable) &&
										blockedResult !== null) ||
									(entry.status !== "ready" &&
										ctx.retryAssetResolution !== undefined)
								}
								canReplace={ctx.assetPicker !== undefined}
								onRetry={() => retry(entry)}
								onReplace={() => void replace(entry)}
							/>
						);
					})}
				</ul>
			)}
		</section>
	);
}

interface AssetHealthRowProps {
	readonly entry: CanvasEffectiveAssetEntry;
	readonly activity?: AssetActivity;
	readonly portabilityIssue?: CanvasAssetPortabilityIssue;
	readonly migrationIssue?: CanvasAssetMigrationIssue;
	readonly migration: MigrationUiState;
	readonly canRetry: boolean;
	readonly canReplace: boolean;
	readonly onRetry: () => void;
	readonly onReplace: () => void;
}

function AssetHealthRow({
	entry,
	activity,
	portabilityIssue,
	migrationIssue,
	migration,
	canRetry,
	canReplace,
	onRetry,
	onReplace,
}: AssetHealthRowProps): React.JSX.Element {
	const t = useCanvasT();
	const activeActivity =
		activity?.kind === "retrying" && activity.entry !== entry
			? undefined
			: activity;
	const migrationStatus =
		portabilityIssue?.action === "upload" &&
		(migration.phase === "uploading" || migration.phase === "retrying")
			? migration.phase
			: undefined;
	const status = activeActivity?.kind ?? migrationStatus ?? entry.status;
	const labels: Record<string, string> = {
		ready: t("canvas.assetHealth.available", "Available"),
		loading: t("canvas.assetHealth.checking", "Checking…"),
		uploading: t("canvas.assetHealth.uploading", "Uploading…"),
		retrying: t("canvas.assetHealth.retrying", "Retrying…"),
		missing: t("canvas.assetHealth.missing", "Missing"),
		unavailable: t("canvas.assetHealth.unavailable", "Unavailable"),
		stale: t("canvas.assetHealth.stale", "Stale link"),
		unauthorized: t("canvas.assetHealth.unauthorized", "Unauthorized"),
		replacing: t("canvas.assetHealth.replacing", "Replacing…"),
		replaced: t("canvas.assetHealth.replaced", "Replaced"),
		"replacement-failed": t(
			"canvas.assetHealth.replacementFailed",
			"Replacement failed",
		),
	};
	const fallbackStatus =
		entry.status === "ready" && portabilityIssue && !migrationStatus
			? t("canvas.assetHealth.localOnly", "Local only")
			: labels[status];
	const message =
		activeActivity?.kind === "replacement-failed"
			? activeActivity.message
			: (migrationIssue?.message ?? portabilityIssue?.message ?? entry.message);
	const busy =
		status === "uploading" || status === "retrying" || status === "replacing";
	const progressText =
		(migration.phase === "uploading" || migration.phase === "retrying") &&
		migration.activeAssetId === entry.id &&
		migration.fraction !== undefined
			? ` ${Math.round(migration.fraction * 100)}%`
			: "";

	return (
		<li
			className="flex flex-col gap-1 rounded-md bg-muted px-2 py-1.5 text-xs"
			data-testid={`asset-health-${entry.id}`}
			data-status={
				entry.status === "ready" &&
				portabilityIssue &&
				!activeActivity &&
				!migrationStatus
					? "local-only"
					: status
			}
		>
			<div className="flex items-start justify-between gap-2">
				<span className="min-w-0 truncate font-medium" title={entry.id}>
					{entry.id}
				</span>
				<span className="shrink-0 text-muted-foreground" role="status">
					{fallbackStatus}
					{progressText}
				</span>
			</div>
			{message ? <p className="text-muted-foreground">{message}</p> : null}
			{!busy && (canRetry || canReplace) ? (
				<div className="flex gap-1">
					{canRetry ? (
						<Button
							type="button"
							variant="ghost"
							size="xs"
							data-testid={`asset-health-retry-${entry.id}`}
							onClick={onRetry}
						>
							{t("canvas.assetHealth.retry", "Retry")}
						</Button>
					) : null}
					{canReplace ? (
						<Button
							type="button"
							variant="ghost"
							size="xs"
							data-testid={`asset-health-replace-${entry.id}`}
							onClick={onReplace}
						>
							{t("canvas.assetHealth.replace", "Replace")}
						</Button>
					) : null}
				</div>
			) : null}
		</li>
	);
}
