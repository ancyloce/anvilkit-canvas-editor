/**
 * @file cp1-005 (PLAN-0035 §5 P1) — object-URL rehydration and lifecycle.
 *
 * ## The failure this removes
 *
 * `cp1-002`'s uploader persists the bytes in IndexedDB and hands the document a
 * `blob:` URI. The bytes survive a reload; the URI does not — an object URL is
 * scoped to the page that minted it, so a saved document reopens with every
 * locally-uploaded image pointing at a URI nothing can resolve. That is the
 * exact failure the IndexedDB choice exists to prevent, and it is only actually
 * prevented here: on load, every asset whose bytes are in the local store is
 * re-minted onto a fresh object URL and the assets CONTEXT is patched with it.
 *
 * The document is never rewritten. The fresh URI lives in
 * {@link CanvasAssetsContext} only, so it cannot reach `onChange`, the save
 * pipeline, or an export — a rehydrated URI is as unportable as the one it
 * replaced, and persisting it would only move the same breakage one save later.
 *
 * ## The mirror obligation: revocation
 *
 * Every mint must be matched by exactly one revoke, or each document swap leaks
 * a URL *and pins its blob in memory*. The accounting lives in one place — a
 * per-run {@link MintLedger} created inside the effect and drained by that same
 * effect's cleanup — and holds under all four interleavings:
 *
 * 1. **A swap while a previous rehydration is in flight.** The ledger doubles
 *    as the cancellation token. Nothing awaits between the post-`get()`
 *    cancellation check and `mint()`, so a cancel can never interleave there;
 *    and `mint()` itself revokes immediately when the ledger is already
 *    cancelled, so even a mint that somehow lands late cannot be orphaned.
 * 2. **React StrictMode's setup → cleanup → setup.** The ledger is created
 *    INSIDE the effect, never cached across runs, so the second setup mints
 *    genuinely fresh URLs rather than republishing ones the first cleanup has
 *    already revoked. The cleanup also drops the published result, so no render
 *    can be left pointing at a revoked URL.
 * 3. **Revoking a URL a render still needs** (a broken image — the opposite
 *    failure to a leak). Cleanup runs *after* React has committed the render
 *    that stopped using the old table, and the published result is cleared in
 *    the same cleanup, so the frame that could have shown a revoked URI shows
 *    {@link PENDING_ASSET_URI} (the loading placeholder) instead.
 * 4. **Asset delete.** Releases are keyed by asset id and delete the entry as
 *    they revoke, so an id is revoked exactly once — and an asset that was
 *    never rehydrated has no entry, so its "release" is a no-op rather than a
 *    revoke of a URL this module does not own.
 *
 * ## What is deliberately NOT rehydrated
 *
 * - **Assets that appear after the document loaded** (an upload in this
 *   session). Their URI is a *live* object URL the uploader just minted;
 *   re-minting would swap the `<img>` src for no reason and flash the loading
 *   placeholder right after every upload. The candidate set is therefore taken
 *   from `ir.assets` **as of the load**, not from the live table.
 * - **Anything at all when the host owns asset ingress.** Rehydration is part
 *   of the local-asset fallback, and follows the same all-or-nothing precedence
 *   rule `cp1-004` established: with a host `assetPicker`/`assetUploader`/
 *   `onPickAsset` there is no local store in play, so this module must not
 *   construct one, scan one, or touch the host's URIs. `enabled: false` short-
 *   circuits before the candidate scan, so the store module is never imported.
 * - **Non-`blob:` URIs.** An `https:`/`data:` asset is resolvable as written.
 *   The `blob:` prefix is only the candidate FILTER — `store.get(id)` is the
 *   authority on whether a candidate is actually stored locally.
 *
 * No new dependency: `URL.createObjectURL`, `Map`, `Set`, `Promise` and dynamic
 * `import()` are platform built-ins.
 */

import type { CanvasAssetRef } from "@anvilkit/canvas-core";
import { useEffect, useMemo, useRef, useState } from "react";
import { PENDING_ASSET_URI } from "../stage/CanvasAssetsContext.js";
import type { LocalAssetStore } from "./local-asset-store.js";

/** Scheme of a URI that cannot outlive the page that minted it. */
const OBJECT_URL_PREFIX = "blob:";

const EMPTY_CANDIDATES: ReadonlySet<string> = new Set();
const EMPTY_OVERRIDES: ReadonlyMap<string, string | null> = new Map();

/**
 * What rehydration decided about one candidate id: a freshly minted object URL,
 * or `null` for "the bytes are not in the local store" — the dangling-asset
 * case, which drops the entry so the renderer's existing missing-asset chrome
 * (and the FR-170 batched toast) takes over.
 */
type AssetOverride = string | null;

/** A published rehydration result, tagged with the epoch it belongs to. */
interface ResolvedEpoch {
	/** Identity guard: a result from a superseded epoch is ignored, not applied. */
	readonly candidates: ReadonlySet<string>;
	readonly overrides: ReadonlyMap<string, AssetOverride>;
}

/**
 * The mint/revoke ledger for ONE rehydration run, and that run's cancellation
 * token. Every object URL this module creates is recorded here the instant it
 * exists, and leaves only by being revoked — which is what makes "revokes ===
 * mints" a structural property rather than a hopeful one.
 */
interface MintLedger {
	/** Set by {@link MintLedger.cancel}; checked after every `await`. */
	readonly cancelled: boolean;
	/** Live mints, by asset id. */
	readonly minted: ReadonlyMap<string, string>;
	/** Record `url` for `id`, or revoke it at once if the run is already over. */
	mint(id: string, url: string): string;
	/** Revoke `id`'s URL exactly once. A no-op for an id that has none. */
	release(id: string): void;
	/** End the run and revoke everything still outstanding. */
	cancel(): void;
}

function createMintLedger(revokeObjectURL: (url: string) => void): MintLedger {
	const minted = new Map<string, string>();
	let cancelled = false;
	return {
		get cancelled() {
			return cancelled;
		},
		minted,
		mint(id, url) {
			// The one interleaving the caller's cancellation check cannot cover:
			// if this run ended between `createObjectURL` and here, the ledger has
			// already been drained and nobody else will ever see this URL.
			if (cancelled) {
				revokeObjectURL(url);
				return url;
			}
			const previous = minted.get(id);
			if (previous !== undefined && previous !== url) revokeObjectURL(previous);
			minted.set(id, url);
			return url;
		},
		release(id) {
			const url = minted.get(id);
			// No entry = never rehydrated. Nothing to revoke, and nothing this
			// module owns to revoke by mistake.
			if (url === undefined) return;
			// Deleted BEFORE the revoke, so a later `cancel()` cannot revoke it a
			// second time.
			minted.delete(id);
			revokeObjectURL(url);
		},
		cancel() {
			cancelled = true;
			for (const url of minted.values()) revokeObjectURL(url);
			minted.clear();
		},
	};
}

/**
 * The ids worth probing the local store for: assets whose recorded URI is an
 * object URL. Everything else is resolvable as written and is left untouched.
 */
function collectCandidates(
	assets: Record<string, CanvasAssetRef>,
): ReadonlySet<string> {
	const ids = new Set<string>();
	for (const [id, ref] of Object.entries(assets)) {
		if (ref.uri.startsWith(OBJECT_URL_PREFIX)) ids.add(id);
	}
	return ids.size === 0 ? EMPTY_CANDIDATES : ids;
}

const defaultCreateObjectURL = (blob: Blob): string =>
	URL.createObjectURL(blob);
const defaultRevokeObjectURL = (url: string): void => URL.revokeObjectURL(url);

export interface UseRehydratedLocalAssetsOptions {
	/** The LIVE asset table — a new identity on every commit that edits assets. */
	readonly assets: Record<string, CanvasAssetRef>;
	/**
	 * The asset table **as of the last document load or replacement**. Its
	 * object identity IS the epoch: a new identity restarts rehydration, the
	 * same identity does not. Passing the same object back (as
	 * `replaceDocument(getIR(), "recovery")` does) therefore correctly keeps the
	 * URLs already minted rather than churning them.
	 */
	readonly loadedAssets: Record<string, CanvasAssetRef>;
	/**
	 * False when the host owns asset ingress, or when the local fallback is
	 * explicitly disabled. Short-circuits everything: no candidate scan, no
	 * store import, no mint.
	 */
	readonly enabled: boolean;
	/** Injected store (tests). Defaults to the shared singleton, loaded lazily. */
	readonly store?: LocalAssetStore;
	/** Injected minting (tests). Identity must be stable across renders. */
	readonly createObjectURL?: (blob: Blob) => string;
	/** Injected revoking (tests). Identity must be stable across renders. */
	readonly revokeObjectURL?: (url: string) => void;
}

/**
 * The asset table to render against: `assets`, with every locally-stored entry
 * remapped onto a fresh object URL.
 *
 * Returns `assets` **by identity** when there is nothing to rehydrate (no
 * candidates, or `enabled: false`), so the overwhelmingly common case adds no
 * allocation and no re-render.
 */
export function useRehydratedLocalAssets({
	assets,
	loadedAssets,
	enabled,
	store,
	createObjectURL = defaultCreateObjectURL,
	revokeObjectURL = defaultRevokeObjectURL,
}: UseRehydratedLocalAssetsOptions): Record<string, CanvasAssetRef> {
	const candidates = useMemo(
		() => (enabled ? collectCandidates(loadedAssets) : EMPTY_CANDIDATES),
		[enabled, loadedAssets],
	);
	const [resolved, setResolved] = useState<ResolvedEpoch | null>(null);
	const ledgerRef = useRef<MintLedger | null>(null);

	useEffect(() => {
		if (candidates.size === 0) return;
		const ledger = createMintLedger(revokeObjectURL);
		ledgerRef.current = ledger;
		void (async () => {
			try {
				// Reached over a DYNAMIC-import edge, exactly as `cp1-004`'s shim
				// does: `local-asset-store.js` is an async-only chunk today and must
				// stay one. This is also what makes the module SSR-safe — nothing
				// touches `indexedDB` until an effect runs in a browser.
				let resolvedStore = store;
				if (!resolvedStore) {
					const loaded = await import("./local-asset-store.js");
					// An editor that unmounted while its chunk was loading must not
					// go on to OPEN a database it will never read.
					if (ledger.cancelled) return;
					resolvedStore = loaded.getSharedLocalAssetStore();
				}
				// `const` so the closures below keep the narrowing.
				const target = resolvedStore;
				const entries = await Promise.all(
					[...candidates].map(async (id) => {
						const blob = await target.get(id);
						// NOTHING awaits between this check and the mint below, so a
						// cancel cannot interleave and orphan a URL.
						if (ledger.cancelled) return undefined;
						const override: AssetOverride = blob
							? ledger.mint(id, createObjectURL(blob))
							: null;
						return [id, override] as const;
					}),
				);
				if (ledger.cancelled) return;
				setResolved({
					candidates,
					overrides: new Map(
						entries.filter(
							(entry): entry is readonly [string, AssetOverride] =>
								entry !== undefined,
						),
					),
				});
			} catch {
				// `cp1-001`'s store degrades rather than throwing, so in practice
				// this is the chunk-load path. Publishing an EMPTY override map
				// leaves every candidate on the URI the document recorded, which is
				// the honest answer to "we could not check" — the renderer's
				// existing load-error chrome takes it from there. Degrading is the
				// point: a storage failure must never take the editor down.
				if (ledger.cancelled) return;
				setResolved({ candidates, overrides: EMPTY_OVERRIDES });
			}
		})();
		return () => {
			ledgerRef.current = null;
			ledger.cancel();
			// Nothing may keep rendering against URLs this cleanup just revoked.
			// Dropping the result falls the table back to PENDING_ASSET_URI, i.e.
			// the loading placeholder, until the next run publishes.
			setResolved(null);
		};
	}, [candidates, store, createObjectURL, revokeObjectURL]);

	// Deliverable: revoke on asset delete. An id that leaves the live table
	// (`asset.remove` — which is also what undoing an upload applies) is gone
	// from the document, so its object URL has no reader left. `resolved` is a
	// real dependency, not padding: mints land in the ledger before the result
	// is published, so a delete that races the mint would otherwise not be
	// released until the epoch ended.
	useEffect(() => {
		const ledger = ledgerRef.current;
		if (!ledger || !resolved) return;
		for (const id of [...ledger.minted.keys()]) {
			if (!(id in assets)) ledger.release(id);
		}
	}, [assets, resolved]);

	// Only a result published for THIS epoch may be applied. During the single
	// render between a document swap and the effect that services it, the
	// previous epoch's result is deliberately ignored.
	const overrides =
		resolved && resolved.candidates === candidates ? resolved.overrides : null;

	return useMemo(() => {
		if (candidates.size === 0) return assets;
		const table: Record<string, CanvasAssetRef> = {};
		for (const [id, ref] of Object.entries(assets)) {
			if (!candidates.has(id)) {
				// Not a local candidate (an https:/data: asset, or one uploaded
				// after this document loaded) — passes through untouched.
				table[id] = ref;
				continue;
			}
			if (!overrides) {
				// Still resolving. The loading placeholder, not the load-error one
				// the dead `blob:` URI would produce.
				table[id] = { ...ref, uri: PENDING_ASSET_URI };
				continue;
			}
			const override = overrides.get(id);
			// `undefined` = this epoch could not be checked at all (see the catch
			// above): leave the document's own URI in place.
			if (override === undefined) table[id] = ref;
			// `null` = a candidate the store does not have. Dropping the entry is
			// what routes it to the EXISTING missing-asset rendering; inventing a
			// second missing state here would be a second source of truth.
			else if (override !== null) table[id] = { ...ref, uri: override };
		}
		return table;
	}, [assets, candidates, overrides]);
}
