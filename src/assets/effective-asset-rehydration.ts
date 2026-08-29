"use client";

import { type CanvasAssetRef, isLocalObjectUri } from "@anvilkit/canvas-core";
import { useEffect, useMemo, useState } from "react";
import { PENDING_ASSET_URI } from "../stage/CanvasAssetsContext.js";
import {
	type CanvasAssetResolver,
	type CanvasEffectiveAssetEntry,
	type CanvasEffectiveAssetSource,
	type CanvasEffectiveAssetTable,
	resolveEffectiveAssetTable,
} from "./effective-asset-resolver-api.js";
import { useRehydratedLocalAssets } from "./local-asset-rehydration.js";
import type { LocalAssetStore } from "./local-asset-store.js";

export interface UseEffectiveAssetTableOptions {
	readonly documentId: string;
	readonly assets: Record<string, CanvasAssetRef>;
	readonly loadedAssets: Record<string, CanvasAssetRef>;
	readonly localEnabled: boolean;
	readonly hostResolver?: CanvasAssetResolver;
	/** Increment to re-run the complete resolver chain without changing metadata. */
	readonly refreshEpoch?: number;
	/** Local-store/object-URL injection for deterministic tests. */
	readonly store?: LocalAssetStore;
	readonly createObjectURL?: (blob: Blob) => string;
	readonly revokeObjectURL?: (url: string) => void;
}

interface ResolvedEpoch {
	readonly assets: Record<string, CanvasAssetRef>;
	readonly localAssets: Record<string, CanvasAssetRef>;
	readonly refreshEpoch: number;
	readonly table: CanvasEffectiveAssetTable;
}

const noop = (): void => undefined;

function sameAsset(a: CanvasAssetRef | undefined, b: CanvasAssetRef): boolean {
	return (
		a === b ||
		(a?.id === b.id &&
			a.uri === b.uri &&
			a.mimeType === b.mimeType &&
			a.width === b.width &&
			a.height === b.height &&
			a.byteSize === b.byteSize)
	);
}

function memoryAssets(
	assets: Record<string, CanvasAssetRef>,
	loadedAssets: Record<string, CanvasAssetRef>,
): Record<string, CanvasAssetRef> | undefined {
	const memory: Record<string, CanvasAssetRef> = {};
	for (const [id, asset] of Object.entries(assets)) {
		if (!sameAsset(loadedAssets[id], asset)) memory[id] = asset;
	}
	return Object.keys(memory).length > 0 ? memory : undefined;
}

function sourceOf(asset: CanvasAssetRef): CanvasEffectiveAssetSource {
	if (asset.uri.startsWith("data:")) return "embedded";
	if (isLocalObjectUri(asset.uri)) return "document";
	try {
		const protocol = new URL(asset.uri, "https://canvas.invalid").protocol;
		if (protocol === "http:" || protocol === "https:") return "remote";
	} catch {
		// Preserve the generic document classification below.
	}
	return "document";
}

function immediateTable(
	assets: Record<string, CanvasAssetRef>,
	loadedAssets: Record<string, CanvasAssetRef>,
	localEnabled: boolean,
	hostResolver: CanvasAssetResolver | undefined,
): CanvasEffectiveAssetTable {
	const entries: Record<string, CanvasEffectiveAssetEntry> = {};
	const effective: Record<string, CanvasAssetRef> = {};
	for (const [id, asset] of Object.entries(assets)) {
		const inMemory = !sameAsset(loadedAssets[id], asset);
		const local = !inMemory && isLocalObjectUri(asset.uri);
		const waiting =
			!inMemory && (hostResolver !== undefined || (localEnabled && local));
		const effectiveAsset =
			local && waiting ? { ...asset, uri: PENDING_ASSET_URI } : asset;
		effective[id] = effectiveAsset;
		entries[id] = {
			id,
			source: inMemory
				? "memory"
				: local && localEnabled
					? "indexeddb"
					: hostResolver
						? "host"
						: sourceOf(asset),
			status: waiting ? "loading" : "ready",
			documentAsset: asset,
			asset: effectiveAsset,
		};
	}
	return { assets: effective, entries, release: noop, dispose: noop };
}

/**
 * React lifecycle adapter around {@link resolveEffectiveAssetTable}. The same
 * table instance feeds stage, thumbnails, preflight, and every exporter.
 */
export function useEffectiveAssetTable({
	documentId,
	assets,
	loadedAssets,
	localEnabled,
	hostResolver,
	refreshEpoch = 0,
	store,
	createObjectURL,
	revokeObjectURL,
}: UseEffectiveAssetTableOptions): CanvasEffectiveAssetTable {
	const localAssets = useRehydratedLocalAssets({
		assets,
		loadedAssets,
		enabled: localEnabled,
		...(store ? { store } : {}),
		...(createObjectURL ? { createObjectURL } : {}),
		...(revokeObjectURL ? { revokeObjectURL } : {}),
	});
	const liveMemoryAssets = useMemo(
		() => memoryAssets(assets, loadedAssets),
		[assets, loadedAssets],
	);
	const localCandidates = useMemo(
		() =>
			localEnabled &&
			Object.values(loadedAssets).some((asset) => isLocalObjectUri(asset.uri)),
		[localEnabled, loadedAssets],
	);
	const indexedDbResolver = useMemo<CanvasAssetResolver | undefined>(() => {
		if (!localCandidates) return undefined;
		return {
			async resolve(asset) {
				if (!isLocalObjectUri(asset.uri)) return undefined;
				const local = localAssets[asset.id];
				if (!local) return { status: "missing" };
				if (local.uri === PENDING_ASSET_URI) {
					return { status: "loading", asset: local };
				}
				if (local.uri === asset.uri) {
					return {
						status: "unavailable",
						message: "The browser-local asset could not be rehydrated.",
					};
				}
				return { status: "ready", asset: local };
			},
		};
	}, [localCandidates, localAssets]);
	const needsResolution = Boolean(indexedDbResolver || hostResolver);
	const [resolved, setResolved] = useState<ResolvedEpoch | null>(null);

	useEffect(() => {
		if (!needsResolution) return;
		const controller = new AbortController();
		let table: CanvasEffectiveAssetTable | undefined;
		void resolveEffectiveAssetTable({
			documentId,
			documentAssets: assets,
			...(liveMemoryAssets ? { memoryAssets: liveMemoryAssets } : {}),
			...(indexedDbResolver ? { indexedDbResolver } : {}),
			...(hostResolver ? { hostResolver } : {}),
			signal: controller.signal,
		})
			.then((next) => {
				if (controller.signal.aborted) {
					next.dispose();
					return;
				}
				table = next;
				setResolved({ assets, localAssets, refreshEpoch, table: next });
			})
			.catch((error: unknown) => {
				if (controller.signal.aborted) return;
				console.error("canvas effective asset resolution failed", error);
			});
		return () => {
			controller.abort();
			table?.dispose();
			setResolved(null);
		};
	}, [
		assets,
		documentId,
		refreshEpoch,
		hostResolver,
		indexedDbResolver,
		liveMemoryAssets,
		localAssets,
		needsResolution,
	]);

	useEffect(() => {
		if (!resolved) return;
		for (const id of Object.keys(resolved.table.entries)) {
			if (!(id in assets)) resolved.table.release(id);
		}
	}, [assets, resolved]);

	return useMemo(() => {
		if (!needsResolution) {
			return immediateTable(assets, loadedAssets, localEnabled, hostResolver);
		}
		if (
			resolved?.assets === assets &&
			resolved.localAssets === localAssets &&
			resolved.refreshEpoch === refreshEpoch
		) {
			return resolved.table;
		}
		return immediateTable(assets, loadedAssets, localEnabled, hostResolver);
	}, [
		assets,
		hostResolver,
		loadedAssets,
		localAssets,
		localEnabled,
		needsResolution,
		refreshEpoch,
		resolved,
	]);
}
