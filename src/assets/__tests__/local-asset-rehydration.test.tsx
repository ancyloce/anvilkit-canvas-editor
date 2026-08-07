/**
 * cp1-005 — object-URL rehydration and lifecycle.
 *
 * The load-bearing assertions in here are the ACCOUNTING ones. "The image comes
 * back after a reload" is the visible deliverable, but the failure that
 * actually costs users memory is the invisible one: a document swap that mints
 * a fresh URL per asset and never revokes the previous one pins its blob for
 * the life of the tab. Every lifecycle test below therefore ends on the same
 * invariant — `revoked` is a permutation of `minted` minus whatever is still on
 * screen — rather than on a spot check of one URL.
 *
 * `fake-indexeddb` is NOT used and NOT installed. The `LocalAssetStore`
 * INTERFACE is mocked, exactly as `cp1-002`/`cp1-003`/`cp1-004` did: `cp1-001`
 * already covers the backend, its three degradation modes and its caps against
 * its own hand-rolled IDB double, and nothing was extracted from that file.
 *
 * jsdom has no `URL.createObjectURL`/`revokeObjectURL`. The unit tests inject
 * both seams; the `<CanvasStudio>` integration tests add the two methods ONTO
 * the real `URL` and delete them again — replacing the global with a spread
 * copy breaks `new URL(…)` elsewhere in the commit path.
 */

import {
	type CanvasAssetRef,
	type CanvasIR,
	createCanvasIR,
	createGroup,
	createImage,
	createPage,
} from "@anvilkit/canvas-core";
import {
	act,
	cleanup,
	render,
	renderHook,
	waitFor,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalAssetStore } from "../local-asset-store.js";

const hoisted = vi.hoisted(() => ({
	/** Every `src` `use-image` was asked to load, in order. */
	imageUrls: [] as string[],
	/** How many times the wiring reached for the shared (singleton) store. */
	sharedStoreReads: 0,
	sharedStore: { current: null as LocalAssetStore | null },
}));

vi.mock("use-image", () => ({
	default: (url: string) => {
		hoisted.imageUrls.push(url);
		return [null, "loading"];
	},
}));

vi.mock("../local-asset-store.js", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../local-asset-store.js")>();
	return {
		...actual,
		getSharedLocalAssetStore: () => {
			hoisted.sharedStoreReads += 1;
			const stub = hoisted.sharedStore.current;
			if (!stub) throw new Error("no shared store stubbed for this test");
			return stub;
		},
	};
});

function konvaMock(type: string) {
	return (props: Record<string, unknown>) => {
		const { children } = props as { children?: React.ReactNode };
		return <div data-testid={type.toLowerCase()}>{children}</div>;
	};
}

vi.mock("react-konva", () => {
	type StageProps = {
		children?: React.ReactNode;
		ref?: { current: object | null };
	};
	const Stage = (props: StageProps) => {
		if (props.ref && "current" in props.ref) {
			props.ref.current = {
				destroy: vi.fn(),
				on: vi.fn(),
				off: vi.fn(),
				container: () => document.createElement("div"),
				getPointerPosition: () => null,
			};
		}
		return <div data-testid="stage">{props.children}</div>;
	};
	return {
		Stage,
		Layer: konvaMock("Layer"),
		Group: konvaMock("Group"),
		Rect: konvaMock("Rect"),
		Ellipse: konvaMock("Ellipse"),
		Line: konvaMock("Line"),
		Path: konvaMock("Path"),
		Text: konvaMock("Text"),
		Image: konvaMock("Image"),
		Label: konvaMock("Label"),
		Tag: konvaMock("Tag"),
		Transformer: konvaMock("Transformer"),
	};
});

vi.mock("../../render/rasterize-page.js", () => ({
	rasterizePage: vi.fn(async ({ page }: { page: { id: string } }) => ({
		url: `data:thumb/${page.id}`,
		mimeType: "image/png",
	})),
}));

import { CanvasStudio } from "../../index.js";
import { useRehydratedLocalAssets } from "../local-asset-rehydration.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const blobFor = (id: string): Blob =>
	new Blob([`bytes-of-${id}`], { type: "image/png" });

function assetTable(
	...refs: readonly CanvasAssetRef[]
): Record<string, CanvasAssetRef> {
	const table: Record<string, CanvasAssetRef> = {};
	for (const ref of refs) table[ref.id] = ref;
	return table;
}

/** An asset as a reloaded document records it: a `blob:` URI nothing resolves. */
const deadLocal = (id: string): CanvasAssetRef => ({
	id,
	uri: `blob:http://localhost/${id}-from-a-previous-page`,
	mimeType: "image/png",
	width: 4,
	height: 3,
});

const remote = (id: string): CanvasAssetRef => ({
	id,
	uri: `https://cdn.example.com/${id}.png`,
	mimeType: "image/png",
});

/**
 * A `LocalAssetStore` whose `get` is the only method under test. The rest are
 * present so the object satisfies the interface rather than a cast — a cast
 * would let the hook start using another method without the double noticing.
 */
function stubStore(
	get: (id: string) => Promise<Blob | undefined>,
): LocalAssetStore & { calls: string[] } {
	const calls: string[] = [];
	const unused = (name: string) => () => {
		throw new Error(`cp1-005 must not call LocalAssetStore.${name}`);
	};
	return {
		calls,
		get: (id) => {
			calls.push(id);
			return get(id);
		},
		put: unused("put"),
		delete: unused("delete"),
		list: unused("list"),
		has: unused("has"),
		usage: unused("usage"),
		clear: unused("clear"),
		backend: unused("backend"),
		close: unused("close"),
	} as LocalAssetStore & { calls: string[] };
}

/** A store holding exactly `ids`; anything else resolves `undefined`. */
function storeHolding(...ids: readonly string[]) {
	const held = new Set(ids);
	return stubStore(async (id) => (held.has(id) ? blobFor(id) : undefined));
}

/** A store whose reads are settled by the test, one id at a time. */
function deferredStore() {
	const waiting = new Map<string, ((blob: Blob | undefined) => void)[]>();
	const store = stubStore(
		(id) =>
			new Promise<Blob | undefined>((resolve) => {
				const queue = waiting.get(id) ?? [];
				queue.push(resolve);
				waiting.set(id, queue);
			}),
	);
	return {
		store,
		settle(id: string, blob: Blob | undefined = blobFor(id)) {
			for (const resolve of waiting.get(id) ?? []) resolve(blob);
			waiting.delete(id);
		},
	};
}

// ---------------------------------------------------------------------------
// The mint/revoke ledger the assertions are built on
// ---------------------------------------------------------------------------

interface UrlMinter {
	createObjectURL: (blob: Blob) => string;
	revokeObjectURL: (url: string) => void;
	readonly minted: string[];
	readonly revoked: string[];
	readonly blobOf: Map<string, Blob>;
	/** Minted and not yet revoked. */
	live(): string[];
}

function createUrlMinter(
	onMint: (url: string) => void = () => undefined,
): UrlMinter {
	let n = 0;
	const minted: string[] = [];
	const revoked: string[] = [];
	const blobOf = new Map<string, Blob>();
	return {
		minted,
		revoked,
		blobOf,
		createObjectURL(blob) {
			n += 1;
			const url = `blob:test/${n}`;
			minted.push(url);
			blobOf.set(url, blob);
			onMint(url);
			return url;
		},
		revokeObjectURL(url) {
			revoked.push(url);
		},
		live() {
			const dead = new Set(revoked);
			return minted.filter((url) => !dead.has(url));
		},
	};
}

/**
 * Drain microtasks AND the timer queue so every `await` in the hook settles.
 * Three rounds because the un-injected path adds a dynamic `import()` of the
 * store module between the effect and the first `get()`.
 */
async function flush(): Promise<void> {
	for (let round = 0; round < 3; round += 1) {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
	}
}

interface HookProps {
	assets: Record<string, CanvasAssetRef>;
	loadedAssets: Record<string, CanvasAssetRef>;
	enabled?: boolean;
}

function mountHook(
	store: LocalAssetStore,
	minter: UrlMinter,
	initialProps: HookProps,
) {
	return renderHook(
		(props: HookProps) =>
			useRehydratedLocalAssets({
				assets: props.assets,
				loadedAssets: props.loadedAssets,
				enabled: props.enabled ?? true,
				store,
				createObjectURL: minter.createObjectURL,
				revokeObjectURL: minter.revokeObjectURL,
			}),
		{ initialProps },
	);
}

beforeEach(() => {
	hoisted.imageUrls.length = 0;
	hoisted.sharedStoreReads = 0;
	hoisted.sharedStore.current = null;
});

// The react-library preset runs `globals: false`, so RTL auto-cleanup is OFF.
afterEach(cleanup);

// ---------------------------------------------------------------------------

describe("cp1-005 — nothing to rehydrate is a zero-cost path", () => {
	it("returns the SAME table by identity when the host owns assets", async () => {
		const store = storeHolding("a1");
		const minter = createUrlMinter();
		const assets = assetTable(deadLocal("a1"));
		const { result } = mountHook(store, minter, {
			assets,
			loadedAssets: assets,
			enabled: false,
		});
		await flush();
		// Not merely "the host's URI won" — the store was never scanned at all,
		// which is the precedence rule cp1-004 established: with a host adapter
		// there is no local store in play.
		expect(result.current).toBe(assets);
		expect(store.calls).toEqual([]);
		expect(minter.minted).toEqual([]);
	});

	it("returns the SAME table by identity when no asset carries a blob: URI", async () => {
		const store = storeHolding("a1");
		const minter = createUrlMinter();
		const assets = assetTable(remote("a1"), remote("a2"));
		const { result } = mountHook(store, minter, {
			assets,
			loadedAssets: assets,
		});
		await flush();
		expect(result.current).toBe(assets);
		expect(store.calls).toEqual([]);
	});

	it("leaves non-blob entries untouched while rehydrating a blob: one", async () => {
		const store = storeHolding("local");
		const minter = createUrlMinter();
		const assets = assetTable(remote("cdn"), deadLocal("local"));
		const { result } = mountHook(store, minter, {
			assets,
			loadedAssets: assets,
		});
		await flush();
		expect(store.calls).toEqual(["local"]);
		expect(result.current.cdn).toBe(assets.cdn);
		expect(result.current.local?.uri).toBe(minter.minted[0]);
	});
});

describe("cp1-005 — the reload path", () => {
	it("re-mints a fresh object URL from the stored blob and keeps the rest of the ref", async () => {
		const store = storeHolding("a1");
		const minter = createUrlMinter();
		const assets = assetTable(deadLocal("a1"));
		const { result } = mountHook(store, minter, {
			assets,
			loadedAssets: assets,
		});

		// Deliverable 4: rehydration is async and must not block first paint. The
		// FIRST render already returns a table — carrying the loading sentinel,
		// not the dead blob: URI, so the editor shows "Loading image…" rather
		// than flashing "Image failed to load".
		expect(result.current.a1?.uri).toBe("");
		expect(result.current.a1?.width).toBe(4);

		await flush();
		const url = minter.minted[0];
		expect(minter.minted).toHaveLength(1);
		expect(result.current.a1?.uri).toBe(url);
		// Minted from the bytes the store actually returned.
		expect(await minter.blobOf.get(url ?? "")?.text()).toBe("bytes-of-a1");
		// The document itself is never rewritten — only the context is patched.
		expect(assets.a1?.uri).toMatch(/^blob:http:\/\/localhost\//);
	});

	it("degrades a candidate the store does not hold to the existing missing-asset state", async () => {
		const store = storeHolding("kept");
		const minter = createUrlMinter();
		const assets = assetTable(deadLocal("kept"), deadLocal("gone"));
		const { result } = mountHook(store, minter, {
			assets,
			loadedAssets: assets,
		});
		await flush();

		// Dropping the entry is what routes it to `AssetPlaceholder state="missing"`
		// (and the FR-170 batched toast) — the SAME chrome a dangling assetId has
		// always produced. No second missing state, and no throw.
		expect(result.current.gone).toBeUndefined();
		expect(result.current.kept?.uri).toBe(minter.minted[0]);
		expect(minter.minted).toHaveLength(1);
	});

	it("survives a store that rejects, leaving the document's own URI in place", async () => {
		const store = stubStore(async () => {
			throw new Error("chunk load failed");
		});
		const minter = createUrlMinter();
		const assets = assetTable(deadLocal("a1"));
		const { result } = mountHook(store, minter, {
			assets,
			loadedAssets: assets,
		});
		await flush();
		expect(result.current.a1?.uri).toBe(assets.a1?.uri);
		expect(minter.minted).toEqual([]);
	});
});

describe("cp1-005 — mint/revoke accounting", () => {
	it("balances mints and revokes across mount → swap → unmount", async () => {
		const store = storeHolding("a1", "b1");
		const minter = createUrlMinter();
		const docA = assetTable(deadLocal("a1"));
		const docB = assetTable(deadLocal("b1"));

		const { result, rerender, unmount } = mountHook(store, minter, {
			assets: docA,
			loadedAssets: docA,
		});
		await flush();
		const urlA = minter.minted[0];
		expect(result.current.a1?.uri).toBe(urlA);

		rerender({ assets: docB, loadedAssets: docB });
		await flush();
		const urlB = minter.minted[1];
		expect(result.current.b1?.uri).toBe(urlB);
		// The swap revoked exactly the URL the previous document was using.
		expect(minter.revoked).toEqual([urlA]);
		expect(minter.live()).toEqual([urlB]);

		unmount();
		expect(minter.revoked).toEqual([urlA, urlB]);
		expect(minter.live()).toEqual([]);
		expect(minter.revoked).toHaveLength(minter.minted.length);
	});

	it("leaks nothing across N document swaps", async () => {
		const swaps = 5;
		const store = stubStore(async (id) => blobFor(id));
		const minter = createUrlMinter();
		const docs = Array.from({ length: swaps }, (_, i) =>
			assetTable(deadLocal(`doc${i}-a`), deadLocal(`doc${i}-b`)),
		);

		const first = docs[0];
		if (!first) throw new Error("no fixture");
		const { rerender, unmount } = mountHook(store, minter, {
			assets: first,
			loadedAssets: first,
		});
		await flush();
		for (const doc of docs.slice(1)) {
			rerender({ assets: doc, loadedAssets: doc });
			await flush();
			// Only ever the CURRENT document's two URLs are alive.
			expect(minter.live()).toHaveLength(2);
		}
		unmount();

		expect(minter.minted).toHaveLength(swaps * 2);
		// The acceptance criterion, stated literally.
		expect(minter.revoked).toHaveLength(minter.minted.length);
		expect(new Set(minter.revoked)).toEqual(new Set(minter.minted));
	});

	it("revokes the mints of a rehydration the swap interrupted", async () => {
		const { store, settle } = deferredStore();
		const minter = createUrlMinter();
		const docA = assetTable(deadLocal("a1"));
		const docB = assetTable(deadLocal("b1"));

		const { result, rerender, unmount } = mountHook(store, minter, {
			assets: docA,
			loadedAssets: docA,
		});
		// docA's read is still in flight when the document is replaced.
		rerender({ assets: docB, loadedAssets: docB });
		settle("a1");
		settle("b1");
		await flush();

		// Whatever the interleaving produced, nothing minted for the abandoned
		// document may still be alive, and the new document must be resolved.
		expect(result.current.b1?.uri).toBe(minter.live()[0]);
		expect(minter.live()).toHaveLength(1);
		unmount();
		expect(minter.revoked).toHaveLength(minter.minted.length);
	});

	it("revokes a URL minted after its own run was already cancelled", async () => {
		// The one interleaving a cancellation check cannot cover: teardown lands
		// BETWEEN `createObjectURL` and the ledger recording it. Forced here by
		// unmounting from inside the minting seam, which is the only way to hit
		// it deterministically.
		const { store, settle } = deferredStore();
		let unmountNow: (() => void) | null = null;
		const minter = createUrlMinter(() => {
			const teardown = unmountNow;
			unmountNow = null;
			teardown?.();
		});
		const assets = assetTable(deadLocal("a1"));
		const { unmount } = mountHook(store, minter, {
			assets,
			loadedAssets: assets,
		});
		unmountNow = unmount;
		settle("a1");
		await flush();

		expect(minter.minted).toHaveLength(1);
		// Orphaned without the ledger's own re-check: the cleanup had already
		// drained an empty ledger, so nobody else would ever revoke this URL.
		expect(minter.revoked).toEqual(minter.minted);
	});

	it("does not re-mint when the same document object is loaded again", async () => {
		const store = storeHolding("a1");
		const minter = createUrlMinter();
		const assets = assetTable(deadLocal("a1"));
		const { rerender } = mountHook(store, minter, {
			assets,
			loadedAssets: assets,
		});
		await flush();
		// `reloadDocument()` replaces the document with the SAME IR object, so the
		// already-minted URLs are still correct and must survive untouched.
		rerender({ assets, loadedAssets: assets });
		await flush();
		expect(minter.minted).toHaveLength(1);
		expect(minter.revoked).toEqual([]);
	});

	it("never re-mints an asset that appeared AFTER the document loaded", async () => {
		const store = stubStore(async (id) => blobFor(id));
		const minter = createUrlMinter();
		const loaded = assetTable(deadLocal("a1"));
		const { result, rerender } = mountHook(store, minter, {
			assets: loaded,
			loadedAssets: loaded,
		});
		await flush();
		expect(minter.minted).toHaveLength(1);

		// An upload in this session: its `blob:` URI is LIVE, minted moments ago
		// by cp1-002's uploader. Re-minting it would swap the <img> src and flash
		// the loading placeholder right after every upload.
		const uploaded: CanvasAssetRef = {
			id: "fresh",
			uri: "blob:test/uploader-just-minted-this",
			mimeType: "image/png",
		};
		const withUpload = { ...loaded, fresh: uploaded };
		rerender({ assets: withUpload, loadedAssets: loaded });
		await flush();

		expect(minter.minted).toHaveLength(1);
		expect(result.current.fresh).toBe(uploaded);
		expect(store.calls).toEqual(["a1"]);
	});
});

describe("cp1-005 — StrictMode", () => {
	it("does not leave a live URL revoked, and still balances at unmount", async () => {
		const store = storeHolding("a1");
		const minter = createUrlMinter();
		const assets = assetTable(deadLocal("a1"));
		const { result, unmount } = renderHook(
			(props: HookProps) =>
				useRehydratedLocalAssets({
					assets: props.assets,
					loadedAssets: props.loadedAssets,
					enabled: true,
					store,
					createObjectURL: minter.createObjectURL,
					revokeObjectURL: minter.revokeObjectURL,
				}),
			{
				initialProps: { assets, loadedAssets: assets },
				wrapper: React.StrictMode,
			},
		);
		await flush();

		const shown = result.current.a1?.uri;
		expect(shown).toBeTruthy();
		// The double-invoke trap: a mint cached OUTSIDE the effect would be
		// revoked by the first cleanup and then re-published by the second setup,
		// leaving the editor rendering a dead URL. The ledger lives inside the
		// effect closure precisely so this cannot happen.
		expect(minter.revoked).not.toContain(shown);
		expect(minter.live()).toEqual([shown]);

		unmount();
		expect(minter.revoked).toHaveLength(minter.minted.length);
		expect(minter.live()).toEqual([]);
	});
});

describe("cp1-005 — the asset-delete path", () => {
	it("revokes a deleted asset's URL exactly once", async () => {
		const store = storeHolding("keep", "drop");
		const minter = createUrlMinter();
		const loaded = assetTable(deadLocal("keep"), deadLocal("drop"));
		const { result, rerender, unmount } = mountHook(store, minter, {
			assets: loaded,
			loadedAssets: loaded,
		});
		await flush();
		expect(minter.minted).toHaveLength(2);
		const dropped = result.current.drop?.uri;
		const kept = result.current.keep?.uri;

		// `asset.remove` — which is also the inverse an undo of an upload applies.
		const afterDelete = assetTable(deadLocal("keep"));
		rerender({ assets: afterDelete, loadedAssets: loaded });
		await flush();
		// Only the deleted one, and immediately — not deferred to the next swap.
		expect(minter.revoked).toEqual([dropped]);
		expect(minter.live()).toEqual([kept]);

		// Exactly once: the unmount that follows must not revoke it again.
		unmount();
		expect(minter.revoked).toEqual([dropped, kept]);
		expect(new Set(minter.revoked)).toEqual(new Set(minter.minted));
	});

	it("revokes nothing for an asset that was never rehydrated", async () => {
		const store = storeHolding("a1");
		const minter = createUrlMinter();
		const loaded = assetTable(deadLocal("a1"));
		const { rerender } = mountHook(store, minter, {
			assets: loaded,
			loadedAssets: loaded,
		});
		await flush();
		expect(minter.minted).toHaveLength(1);

		// An asset uploaded in this session, then undone. This module never
		// minted its URL, so it has nothing to revoke — and must not reach for
		// one it does not own.
		const withUpload = {
			...loaded,
			fresh: { id: "fresh", uri: "blob:test/not-ours", mimeType: "image/png" },
		};
		rerender({ assets: withUpload, loadedAssets: loaded });
		await flush();
		rerender({ assets: loaded, loadedAssets: loaded });
		await flush();

		expect(minter.revoked).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Integration: the real <CanvasStudio> provider chain
// ---------------------------------------------------------------------------

function irWithLocalImage(): CanvasIR {
	const node = createImage({
		id: "n1",
		assetId: "a1",
		bounds: { width: 4, height: 3 },
	});
	const base = createCanvasIR({
		id: "doc-1",
		pages: [
			createPage({
				id: "p1",
				size: { width: 80, height: 60 },
				root: createGroup({
					id: "p1-root",
					bounds: { width: 80, height: 60 },
					children: [node],
				}),
			}),
		],
		now: () => "2026-08-07T00:00:00.000Z",
	});
	return { ...base, assets: assetTable(deadLocal("a1")) };
}

describe("cp1-005 — through <CanvasStudio>", () => {
	const realURL = URL as unknown as Record<string, unknown>;
	let minted = 0;

	beforeEach(() => {
		minted = 0;
		// Added ONTO the real URL, never replacing it: a spread copy breaks
		// `new URL(…)` elsewhere in the commit path (cp1-004 lost a cycle to it).
		realURL.createObjectURL = () => `blob:studio/${++minted}`;
		realURL.revokeObjectURL = () => undefined;
	});

	afterEach(() => {
		delete realURL.createObjectURL;
		delete realURL.revokeObjectURL;
	});

	it("renders a reloaded local image against a freshly minted URL", async () => {
		hoisted.sharedStore.current = storeHolding("a1");
		render(
			<CanvasStudio initialIR={irWithLocalImage()} initialActivePageId="p1" />,
		);
		// `waitFor`, not a fixed number of ticks: this path really does load the
		// store over a dynamic `import()`, which is the whole point of it.
		await waitFor(() => {
			expect(hoisted.imageUrls.at(-1)).toBe("blob:studio/1");
		});

		// The dead URI the document recorded never reaches the renderer: it sees
		// the loading sentinel first, then the fresh URL.
		expect(hoisted.imageUrls).not.toContain(
			"blob:http://localhost/a1-from-a-previous-page",
		);
		expect(hoisted.sharedStoreReads).toBe(1);
	});

	it("never touches the local store when the host owns assets", async () => {
		render(
			<CanvasStudio
				initialIR={irWithLocalImage()}
				initialActivePageId="p1"
				assetUploader={{ upload: async () => [] }}
			/>,
		);
		await flush();

		// No store constructed, no scan, and the host's URI passed through
		// exactly as the document recorded it.
		expect(hoisted.sharedStoreReads).toBe(0);
		expect(minted).toBe(0);
		expect(hoisted.imageUrls.at(-1)).toBe(
			"blob:http://localhost/a1-from-a-previous-page",
		);
	});
});
