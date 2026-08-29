import type { CanvasIR, CanvasNode } from "@anvilkit/canvas-core";
import {
	createCanvasIR,
	createFrame,
	createGroup,
	createPage,
	createRect,
	encodeResolvedNodeId,
	insertNode,
	updateNode,
} from "@anvilkit/canvas-core";
import { afterEach, describe, expect, it } from "vitest";
import { createFieldPreviewStore } from "../field-preview-store.js";
import { createResolvedDocumentStore } from "../resolved-document-store.js";
import { createSceneStore } from "../scene-store.js";

/**
 * @file T-M3-05 (TS-41) — one resolved document per render context, derived
 * from scene + previews, warm-path threaded, preview-overlaid without ever
 * writing the IR.
 */

/** Horizontal auto-layout frame, gap 10, two 40×20 children stored stale at x=0. */
function layoutDoc(): CanvasIR {
	const frame: CanvasNode = {
		...createFrame({ id: "f1", bounds: { width: 200, height: 100 } }),
		autoLayout: {
			version: 1,
			direction: "horizontal",
			padding: { top: 0, right: 0, bottom: 0, left: 0 },
			gap: 10,
			primaryAlign: "start",
			crossAlign: "start",
		},
		children: [
			createRect({ id: "r1", bounds: { width: 40, height: 20 } }),
			createRect({ id: "r2", bounds: { width: 40, height: 20 } }),
		],
	} as CanvasNode;
	const page = createPage({ id: "p1" });
	let ir = createCanvasIR({ id: "doc", title: "t", pages: [page] });
	ir = insertNode(ir, { parentId: page.root.id, node: frame });
	// A sibling subtree the layout edits never touch — the structural-sharing witness.
	ir = insertNode(ir, {
		parentId: page.root.id,
		node: createRect({
			id: "bystander",
			transform: { x: 500, y: 500 },
			bounds: { width: 10, height: 10 },
		}),
	});
	return ir;
}

function makeStores() {
	const sceneStore = createSceneStore({ initialIR: layoutDoc() });
	const fieldPreviewStore = createFieldPreviewStore();
	const store = createResolvedDocumentStore({
		sceneStore,
		fieldPreviewStore,
		// Most legacy assertions in this file exercise merge semantics, not frame
		// scheduling. Keep those focused assertions synchronous; the dedicated E4
		// tests below drive a controllable animation-frame scheduler.
		schedulePreviewResolution(callback) {
			callback();
			return () => {
				// The injected frame has already completed synchronously.
			};
		},
	});
	const disconnect = store.connect();
	return { sceneStore, fieldPreviewStore, store, disconnect };
}

function createManualFrameScheduler() {
	let scheduled: (() => void) | undefined;
	return {
		schedule(callback: () => void): () => void {
			scheduled = callback;
			return () => {
				if (scheduled === callback) scheduled = undefined;
			};
		},
		flush(): boolean {
			const callback = scheduled;
			scheduled = undefined;
			callback?.();
			return callback !== undefined;
		},
		get pending(): boolean {
			return scheduled !== undefined;
		},
	};
}

let cleanup: (() => void) | undefined;
afterEach(() => {
	cleanup?.();
	cleanup = undefined;
});

describe("createResolvedDocumentStore", () => {
	it("resolves the initial document, flowing r2 to x=50", () => {
		const { store, disconnect } = makeStores();
		cleanup = disconnect;
		const record = store.getState().view.getRecord("r2");
		expect(record?.geometry.localTransform.x).toBe(50);
	});

	it("re-resolves synchronously inside a commit, sharing untouched records", () => {
		const { sceneStore, store, disconnect } = makeStores();
		cleanup = disconnect;
		const before = store.getState().resolved;
		const bystanderBefore = store.getState().view.getRecord("bystander");

		let observedDuringSet: unknown;
		const unsubscribe = sceneStore.subscribe(() => {
			observedDuringSet = store.getState().resolved;
		});
		sceneStore.getState().setIR(
			updateNode(sceneStore.getState().ir, {
				id: "r1",
				patch: { bounds: { width: 60, height: 20 } },
			}),
		);
		unsubscribe();

		const after = store.getState().resolved;
		expect(after).not.toBe(before);
		// Synchronous: by the time any scene subscriber ran, resolution was done.
		// (Zustand notifies in subscription order; the resolved store subscribed
		// first, in connect().)
		expect(observedDuringSet).toBe(after);
		// The widened r1 pushed r2 to x = 60 + 10.
		expect(
			store.getState().view.getRecord("r2")?.geometry.localTransform.x,
		).toBe(70);
		// Untouched sibling record is reference-identical — the warm path ran.
		expect(store.getState().view.getRecord("bystander")).toBe(bystanderBefore);
	});

	it("retains an untouched page while resolving a dirty Auto Layout closure", () => {
		const base = layoutDoc();
		const untouchedPage = createPage({
			id: "p2",
			root: createGroup({
				id: "root-p2",
				children: [
					createRect({
						id: "untouched",
						fill: "#00ff00",
						bounds: { width: 10, height: 10 },
					}),
				],
			}),
		});
		const initialIR = { ...base, pages: [...base.pages, untouchedPage] };
		const sceneStore = createSceneStore({ initialIR });
		const fieldPreviewStore = createFieldPreviewStore();
		const store = createResolvedDocumentStore({
			sceneStore,
			fieldPreviewStore,
		});
		const disconnect = store.connect();
		cleanup = disconnect;
		const untouchedRecord = store.getState().view.getRecord("untouched");
		const untouchedRoots = store.getState().resolved.pageRoots.get("p2");

		sceneStore.getState().setIR(
			updateNode(initialIR, {
				id: "r1",
				patch: {
					bounds: { width: 60, height: 20 },
					fill: "#0000ff",
				},
			}),
		);

		// r1 dirties its Auto Layout frame, so sibling r2 is in the dependency
		// closure and moves from x=50 to x=70.
		expect(
			store.getState().view.getRecord("r2")?.geometry.localTransform.x,
		).toBe(70);
		// Paint-only source data also updates even though it is excluded from the
		// geometry signature: explicit dirtiness bypasses the warm cache hit.
		expect(store.getState().view.getRecord("r1")?.node).toMatchObject({
			fill: "#0000ff",
		});
		expect(store.getState().view.getRecord("untouched")).toBe(untouchedRecord);
		expect(store.getState().resolved.pageRoots.get("p2")).toBe(untouchedRoots);
	});

	it("overlays preview patches without writing the IR", () => {
		const { sceneStore, fieldPreviewStore, store, disconnect } = makeStores();
		cleanup = disconnect;
		const committedIR = sceneStore.getState().ir;

		fieldPreviewStore
			.getState()
			.setPreviews({ r1: { bounds: { width: 100, height: 20 } } });
		expect(
			store.getState().view.getRecord("r2")?.geometry.localTransform.x,
		).toBe(110);
		// The committed document was never touched — previews resolve a copy.
		expect(sceneStore.getState().ir).toBe(committedIR);

		fieldPreviewStore.getState().clearPreviews();
		expect(
			store.getState().view.getRecord("r2")?.geometry.localTransform.x,
		).toBe(50);
	});

	it("resolves a paint-only preview while preserving a bystander", () => {
		const { sceneStore, fieldPreviewStore, store, disconnect } = makeStores();
		cleanup = disconnect;
		const committedIR = sceneStore.getState().ir;
		const bystanderBefore = store.getState().view.getRecord("bystander");

		fieldPreviewStore
			.getState()
			.setPreviews({ r1: { fill: "#123456" } });

		expect(store.getState().view.getRecord("r1")?.node).toMatchObject({
			fill: "#123456",
		});
		expect(store.getState().view.getRecord("bystander")).toBe(
			bystanderBefore,
		);
		expect(sceneStore.getState().ir).toBe(committedIR);
	});

	it("exposes the view adapter over records, children, and page roots", () => {
		const { store, disconnect } = makeStores();
		cleanup = disconnect;
		const { view } = store.getState();
		const roots = view.getPageRoots("p1");
		expect(roots.length).toBeGreaterThan(0);
		const frame = view.getRecord("f1");
		expect(frame).toBeDefined();
		expect(view.getChildren("f1").map((r) => r.sourceNodeId)).toEqual([
			"r1",
			"r2",
		]);
	});

	it("stops recomputing after disconnect", () => {
		const { sceneStore, store, disconnect } = makeStores();
		const before = store.getState().resolved;
		disconnect();
		sceneStore.getState().setIR(
			updateNode(sceneStore.getState().ir, {
				id: "r1",
				patch: { bounds: { width: 99, height: 20 } },
			}),
		);
		expect(store.getState().resolved).toBe(before);
	});

	it("coalesces rapid preview writes into one latest-value frame", () => {
		const sceneStore = createSceneStore({ initialIR: layoutDoc() });
		const fieldPreviewStore = createFieldPreviewStore();
		const frame = createManualFrameScheduler();
		const store = createResolvedDocumentStore({
			sceneStore,
			fieldPreviewStore,
			schedulePreviewResolution: frame.schedule,
		});
		const disconnect = store.connect();
		cleanup = disconnect;
		let resolutions = 0;
		const unsubscribe = store.subscribe(() => {
			resolutions += 1;
		});

		for (const width of [60, 80, 100]) {
			fieldPreviewStore
				.getState()
				.setPreviews({ r1: { bounds: { width, height: 20 } } });
		}

		expect(frame.pending).toBe(true);
		expect(resolutions).toBe(0);
		expect(frame.flush()).toBe(true);
		expect(resolutions).toBe(1);
		expect(
			store.getState().view.getRecord("r2")?.geometry.localTransform.x,
		).toBe(110);
		unsubscribe();
	});

	it("cancels a pending preview when commit resolves the exact final IR", () => {
		const initialIR = layoutDoc();
		const sceneStore = createSceneStore({ initialIR });
		const fieldPreviewStore = createFieldPreviewStore();
		const frame = createManualFrameScheduler();
		const store = createResolvedDocumentStore({
			sceneStore,
			fieldPreviewStore,
			schedulePreviewResolution: frame.schedule,
		});
		const disconnect = store.connect();
		cleanup = disconnect;

		fieldPreviewStore
			.getState()
			.setPreviews({ r1: { bounds: { width: 100, height: 20 } } });
		expect(frame.pending).toBe(true);

		// This is the field-contract ordering: clear transient state, then commit.
		fieldPreviewStore.getState().clearPreviews();
		const committedIR = updateNode(initialIR, {
			id: "r1",
			patch: { bounds: { width: 120, height: 20 } },
		});
		sceneStore.getState().setIR(committedIR);

		expect(frame.pending).toBe(false);
		expect(store.getState().resolved.source).toBe(committedIR);
		expect(
			store.getState().view.getRecord("r2")?.geometry.localTransform.x,
		).toBe(130);
		expect(frame.flush()).toBe(false);

		// Undo is another committed scene write and therefore remains synchronous.
		sceneStore.getState().setIR(initialIR);
		expect(store.getState().resolved.source).toBe(initialIR);
		expect(
			store.getState().view.getRecord("r2")?.geometry.localTransform.x,
		).toBe(50);
	});
});

/**
 * Plan 0024 Phase 2 — the PAGE half of the preview merge. Node patches cannot
 * express page size/background, so these properties previously had no preview
 * path at all and the artboard only updated on commit.
 */
describe("createResolvedDocumentStore — page previews (plan 0024 Phase 2)", () => {
	it("merges a page preview into the resolved document without writing the IR", () => {
		const { sceneStore, fieldPreviewStore, store, disconnect } = makeStores();
		cleanup = disconnect;
		const committedIR = sceneStore.getState().ir;
		expect(store.getState().resolved.source.pages[0]?.size.width).toBe(
			committedIR.pages[0]?.size.width,
		);

		fieldPreviewStore.getState().setPagePreviews({
			p1: {
				size: {
					...(committedIR.pages[0]?.size ?? { unit: "px" }),
					width: 1234,
				},
			},
		});

		expect(store.getState().resolved.source.pages[0]?.size.width).toBe(1234);
		// The committed document is untouched — previews are transient.
		expect(sceneStore.getState().ir).toBe(committedIR);

		fieldPreviewStore.getState().clearPreviews();
		expect(store.getState().resolved.source.pages[0]?.size.width).toBe(
			committedIR.pages[0]?.size.width,
		);
	});

	it("previews a page background and preserves the page's node subtree", () => {
		const { sceneStore, fieldPreviewStore, store, disconnect } = makeStores();
		cleanup = disconnect;
		const committedRoot = sceneStore.getState().ir.pages[0]?.root;

		fieldPreviewStore.getState().setPagePreviews({
			p1: { background: { kind: "solid", value: "#ff0000" } },
		});

		const page = store.getState().resolved.source.pages[0];
		expect(page?.background).toEqual({ kind: "solid", value: "#ff0000" });
		// A page-only patch must not disturb the node walk: the untouched subtree
		// stays reference-identical, which is what lets consumers memoise on it.
		expect(page?.root).toBe(committedRoot);
		expect(page?.id).toBe("p1");
	});

	it("applies node and page previews together in one resolution", () => {
		const { fieldPreviewStore, store, disconnect } = makeStores();
		cleanup = disconnect;
		fieldPreviewStore.getState().setPagePreviews({
			p1: { background: { kind: "solid", value: "#00ff00" } },
		});
		fieldPreviewStore
			.getState()
			.setPreviews({ r1: { bounds: { width: 80, height: 20 } } });

		const page = store.getState().resolved.source.pages[0];
		expect(page?.background).toEqual({ kind: "solid", value: "#00ff00" });
		// r2 flows to x=80+gap once r1 is 80 wide — the node preview still applies.
		expect(
			store.getState().view.getRecord("r2")?.geometry.localTransform.x,
		).toBe(90);
	});

	it("clearPreviews drops the page map too", () => {
		const { fieldPreviewStore, store, disconnect } = makeStores();
		cleanup = disconnect;
		fieldPreviewStore.getState().setPagePreviews({
			p1: { background: { kind: "solid", value: "#0000ff" } },
		});
		const previewed = store.getState().resolved;
		fieldPreviewStore.getState().clearPreviews();
		expect(store.getState().resolved).not.toBe(previewed);
		expect(fieldPreviewStore.getState().pagePreviews).toEqual({});
	});

	/**
	 * `PagePreviewPatch` excludes `id` at the TYPE level only — nothing checks at
	 * runtime, and a `buildPatch` that returns a widened or spread page object
	 * carries `id` straight through. A resolved page whose id no longer matches
	 * `activePageId` makes `useActivePage` return undefined, blanking the
	 * background, grid and guide overlays mid-drag.
	 */
	it("a patch cannot clobber the page id, even carrying one at runtime", () => {
		const { fieldPreviewStore, store, disconnect } = makeStores();
		cleanup = disconnect;
		fieldPreviewStore.getState().setPagePreviews({
			p1: {
				id: "hijacked",
				background: { kind: "solid", value: "#123456" },
			} as never,
		});
		const page = store.getState().resolved.source.pages[0];
		expect(page?.id).toBe("p1");
		expect(page?.background).toEqual({ kind: "solid", value: "#123456" });
	});

	/**
	 * The preview maps are plain object literals, so a bare `map[id]` lookup
	 * resolves an inherited `Object.prototype` member for an id like `constructor`
	 * or `toString` — truthy, so a page with no preview pending is treated as
	 * patched and rebuilt on every single resolution, defeating the structural
	 * sharing consumers memoise on.
	 */
	it("does not treat a prototype-named page id as having a pending patch", () => {
		const hostile = createPage({ id: "constructor" });
		const target = createPage({ id: "p1" });
		let ir = createCanvasIR({
			id: "doc",
			title: "t",
			pages: [hostile, target],
		});
		ir = insertNode(ir, {
			parentId: target.root.id,
			node: createRect({ id: "r1", bounds: { width: 40, height: 20 } }),
		});
		const sceneStore = createSceneStore({ initialIR: ir });
		const fieldPreviewStore = createFieldPreviewStore();
		const store = createResolvedDocumentStore({
			sceneStore,
			fieldPreviewStore,
		});
		cleanup = store.connect();

		const hostileBefore = store.getState().resolved.source.pages[0];
		// A preview on a node in the OTHER page: enough to get past the
		// "no previews at all" short-circuit, but nothing targets `constructor`.
		fieldPreviewStore
			.getState()
			.setPreviews({ r1: { bounds: { width: 80, height: 20 } } });

		const hostileAfter = store.getState().resolved.source.pages[0];
		expect(hostileAfter?.id).toBe("constructor");
		expect(hostileAfter).toBe(hostileBefore);
	});
});

/**
 * Plan 0023 M4-03 — the store's entry point is the COMPOSED resolver, so
 * component instances expand in the ONE resolution every consumer reads.
 */
function cardDefinition(revision = 1, badgeFill = "#ff0000") {
	return {
		id: "cmp-card",
		name: "Card",
		revision,
		properties: [],
		root: {
			...createFrame({ id: "src-root", bounds: { width: 100, height: 40 } }),
			children: [
				createRect({
					id: "src-badge",
					bounds: { width: 20, height: 20 },
					fill: badgeFill,
				}),
			],
		} as CanvasNode,
	};
}

function componentDoc(): CanvasIR {
	const page = createPage({ id: "p1" });
	let ir = createCanvasIR({ id: "doc", title: "t", pages: [page] });
	ir = insertNode(ir, {
		parentId: page.root.id,
		node: {
			type: "component-instance",
			id: "inst-1",
			source: { kind: "local", componentId: "cmp-card" },
			transform: { x: 10, y: 20, rotation: 0, scaleX: 1, scaleY: 1 },
			bounds: { width: 100, height: 40 },
		} as CanvasNode,
	});
	// A plain sibling the component edits must never invalidate.
	ir = insertNode(ir, {
		parentId: page.root.id,
		node: createRect({
			id: "bystander",
			transform: { x: 400, y: 400 },
			bounds: { width: 10, height: 10 },
		}),
	});
	return { ...ir, components: { "cmp-card": cardDefinition() } };
}

function makeComponentStores() {
	const sceneStore = createSceneStore({ initialIR: componentDoc() });
	const fieldPreviewStore = createFieldPreviewStore();
	const store = createResolvedDocumentStore({ sceneStore, fieldPreviewStore });
	const disconnect = store.connect();
	return { sceneStore, fieldPreviewStore, store, disconnect };
}

/** The instance's expanded child, addressed by its codec id. */
const BADGE_ID = encodeResolvedNodeId({ segments: ["inst-1", "src-badge"] });

describe("createResolvedDocumentStore — component resolution (M4-03)", () => {
	it("expands instances in the one resolution, with provenance", () => {
		const { store, disconnect } = makeComponentStores();
		cleanup = disconnect;
		const { view, resolved } = store.getState();

		// The persistent instance node has no children at all; the expansion only
		// exists because the store now routes through resolveCanvasDocument.
		const badge = view.getRecord(BADGE_ID);
		expect(badge).toBeDefined();
		expect(badge?.component?.componentId).toBe("cmp-card");
		expect(badge?.component?.definitionNodeId).toBe("src-badge");
		expect(resolved.componentIssues).toEqual([]);
		// Instance root keeps its persistent id AND its placement.
		expect(view.getRecord("inst-1")?.geometry.localTransform.x).toBe(10);
	});

	it("re-resolves a Source edit into the dependent instance, sparing bystanders", () => {
		const { sceneStore, store, disconnect } = makeComponentStores();
		cleanup = disconnect;
		const badgeBefore = store.getState().view.getRecord(BADGE_ID);
		const bystanderBefore = store.getState().view.getRecord("bystander");

		// A Source edit is a Registry write + revision bump — no instance node is
		// touched anywhere in the document (LC-PROPAGATE).
		const ir = sceneStore.getState().ir;
		sceneStore.getState().setIR({
			...ir,
			components: { "cmp-card": cardDefinition(2, "#00ff00") },
		});

		const badgeAfter = store.getState().view.getRecord(BADGE_ID);
		expect(badgeAfter).not.toBe(badgeBefore);
		expect(badgeAfter).toBeDefined();
		expect((badgeAfter?.node as { fill?: string } | undefined)?.fill).toBe(
			"#00ff00",
		);
		// The unrelated plain node keeps record identity: the component
		// invalidation did not force a document-wide cold pass.
		expect(store.getState().view.getRecord("bystander")).toBe(bystanderBefore);
	});

	it("keeps virtual record identity stable across an unrelated commit", () => {
		const { sceneStore, store, disconnect } = makeComponentStores();
		cleanup = disconnect;
		const badgeBefore = store.getState().view.getRecord(BADGE_ID);

		sceneStore.getState().setIR(
			updateNode(sceneStore.getState().ir, {
				id: "bystander",
				patch: { bounds: { width: 33, height: 10 } },
			}),
		);

		// Nothing about the instance changed, so its virtual record must be
		// reference-identical — this is what stops every instance in the document
		// from re-rendering on every edit (TD §5.4).
		expect(store.getState().view.getRecord(BADGE_ID)).toBe(badgeBefore);
	});

	it("resolves exactly once per commit", () => {
		const { sceneStore, store, disconnect } = makeComponentStores();
		cleanup = disconnect;
		let resolutions = 0;
		const unsubscribe = store.subscribe(() => {
			resolutions += 1;
		});
		sceneStore.getState().setIR(
			updateNode(sceneStore.getState().ir, {
				id: "bystander",
				patch: { bounds: { width: 12, height: 10 } },
			}),
		);
		unsubscribe();
		expect(resolutions).toBe(1);
	});

	it("degrades a dangling reference to a placeholder record plus a diagnostic", () => {
		const { sceneStore, store, disconnect } = makeComponentStores();
		cleanup = disconnect;
		const ir = sceneStore.getState().ir;
		sceneStore.getState().setIR({ ...ir, components: {} });

		const { view, resolved } = store.getState();
		expect(
			resolved.componentIssues.some(
				(i) => i.code === "component-source-missing",
			),
		).toBe(true);
		// Still a record, still the instance node — selectable, overrides intact.
		expect(view.getRecord("inst-1")?.node.type).toBe("component-instance");
		expect(view.getRecord(BADGE_ID)).toBeUndefined();
	});
});
