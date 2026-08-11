import type { CanvasIR, CanvasNode } from "@anvilkit/canvas-core";
import {
	createCanvasIR,
	createFrame,
	createPage,
	createRect,
	findNode,
	insertNode,
	parentOf,
} from "@anvilkit/canvas-core";
import {
	cleanup,
	createEvent,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import type Konva from "konva";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	beginElementDrag,
	ELEMENT_DRAG_MIME,
	endElementDrag,
} from "@/actions/element-insert-actions.js";
import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import type { CanvasElementEntry } from "@/elements/element-entry.js";
import { createResolvedDocumentStore } from "@/stores/resolved-document-store.js";
import { createSceneStore } from "@/stores/scene-store.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import { ASSET_DRAG_MIME, CanvasDropZone } from "../CanvasDropZone.js";

/**
 * @file `cp3-004` — dragging a catalog element onto the canvas.
 *
 * The point of these tests is that the element drop rides the EXISTING drop
 * surface. There is one `<CanvasDropZone>`, one `dragover`/`drop` pair, one
 * screen→page mapping; the element path only adds a MIME and a branch. So the
 * asset paths are re-asserted here too — an element drag must not light the
 * "Drop to replace" affordance, and an asset drag must keep working unchanged.
 */

// react-library vitest preset has globals:false — RTL auto-cleanup is OFF.
afterEach(() => {
	endElementDrag();
	cleanup();
});

function entry(over: Partial<CanvasElementEntry> = {}): CanvasElementEntry {
	return {
		id: "square",
		name: "Square",
		category: "shape",
		tags: [],
		preview: { kind: "path", d: "M0 0H24V24H0Z", viewBox: "0 0 24 24" },
		defaultSize: { width: 60, height: 40 },
		license: "MIT",
		recolor: "fill",
		build: (context) =>
			createRect({
				bounds: { width: 60, height: 40 },
				transform: { x: context?.at?.x ?? 0, y: context?.at?.y ?? 0 },
			}),
		...over,
	};
}

function fixtureIR(): CanvasIR {
	const page = createPage({ id: "p1", size: { width: 800, height: 600 } });
	let ir = createCanvasIR({ id: "doc-1", pages: [page] });
	ir = insertNode(ir, {
		parentId: page.root.id,
		node: createFrame({
			id: "f1",
			bounds: { width: 200, height: 200 },
			transform: { x: 400, y: 300 },
			children: [],
		}) as CanvasNode,
	});
	ir = insertNode(ir, {
		parentId: page.root.id,
		node: createRect({
			id: "img-ish",
			bounds: { width: 100, height: 100 },
			transform: { x: 20, y: 20 },
		}),
	});
	return ir;
}

/** Stage stub with the container origin at (0,0) so client == page coords. */
function makeStage(): Konva.Stage {
	const container = document.createElement("div");
	container.getBoundingClientRect = () =>
		({
			left: 0,
			top: 0,
			width: 800,
			height: 600,
			right: 800,
			bottom: 600,
			x: 0,
			y: 0,
			toJSON() {
				return this;
			},
		}) as DOMRect;
	return { container: () => container } as unknown as Konva.Stage;
}

function setup(ir: CanvasIR = fixtureIR()) {
	const h = makeHarness({ ir, pageId: "p1" });
	const ctx = h.studioCtx;
	ctx.stage = makeStage();
	const history = ctx.historyStore;
	const fieldPreviewStore = ctx.fieldPreviewStore;
	if (!fieldPreviewStore) throw new Error("harness lacks fieldPreviewStore");
	const sceneStore = createSceneStore({ initialIR: ir });
	const resolvedDocumentStore = createResolvedDocumentStore({
		sceneStore,
		fieldPreviewStore,
	});
	resolvedDocumentStore.connect();
	ctx.resolvedDocumentStore = resolvedDocumentStore;
	const sync = (next: CanvasIR): CanvasIR => {
		h.setIR(next);
		sceneStore.getState().setIR(next);
		return next;
	};
	ctx.commit = vi.fn((cmd) => {
		h.commits.push(cmd);
		return sync(history.getState().commit(ctx.getIR(), cmd));
	});
	render(
		<CanvasStudioContext.Provider value={ctx}>
			<CanvasDropZone>
				<div>content</div>
			</CanvasDropZone>
		</CanvasStudioContext.Provider>,
	);
	return {
		...h,
		ctx,
		current: () => ctx.getIR(),
		undo: () => void sync(history.getState().undo(ctx.getIR())),
		redo: () => void sync(history.getState().redo(ctx.getIR())),
		undoDepth: () => history.getState().past.length,
	};
}

/** jsdom cannot drive a real drag, so the DOM events are dispatched directly. */
function elementTransfer(entryId: string) {
	return {
		files: [] as File[],
		types: [ELEMENT_DRAG_MIME],
		getData: (type: string) => (type === ELEMENT_DRAG_MIME ? entryId : ""),
	};
}

function fire(
	kind: "dragOver" | "drop",
	point: { clientX: number; clientY: number },
	dataTransfer: unknown,
): void {
	const zone = screen.getByTestId("canvas-drop-zone");
	const event =
		kind === "drop"
			? createEvent.drop(zone, { dataTransfer })
			: createEvent.dragOver(zone, { dataTransfer });
	Object.defineProperty(event, "clientX", {
		value: point.clientX,
		configurable: true,
	});
	Object.defineProperty(event, "clientY", {
		value: point.clientY,
		configurable: true,
	});
	fireEvent(zone, event);
}

describe("CanvasDropZone — element drops (cp3-004)", () => {
	it("drops the element at the cursor, as ONE node.create, selected", () => {
		const h = setup();
		beginElementDrag(entry());
		fire("drop", { clientX: 200, clientY: 150 }, elementTransfer("square"));

		expect(h.commits).toHaveLength(1);
		expect(h.commits[0]).toMatchObject({
			type: "node.create",
			pageId: "p1",
			node: { type: "rect", transform: { x: 200, y: 150 } },
		});
		const id = (h.commits[0] as { node: { id: string } }).node.id;
		expect(h.ctx.selectionStore.getState().selectedIds).toEqual([id]);

		h.undo();
		expect(findNode(h.current(), id)).toBeNull();
		expect(h.undoDepth()).toBe(0);
		h.redo();
		expect(findNode(h.current(), id)).not.toBeNull();
	});

	it("a drop OVER A FRAME lands inside the frame", () => {
		const h = setup();
		beginElementDrag(entry());
		// The frame is at (400,300), 200×200.
		fire("drop", { clientX: 450, clientY: 340 }, elementTransfer("square"));

		expect(h.commits[0]).toMatchObject({ parentId: "f1" });
		const id = (h.commits[0] as { node: { id: string } }).node.id;
		expect(parentOf(h.current(), id)?.parent.id).toBe("f1");
	});

	it("clears the payload, so a second drop with no drag inserts nothing", () => {
		const h = setup();
		beginElementDrag(entry());
		fire("drop", { clientX: 200, clientY: 150 }, elementTransfer("square"));
		fire("drop", { clientX: 300, clientY: 150 }, elementTransfer("square"));
		expect(h.commits).toHaveLength(1);
	});

	it("a drop whose payload never arrived (a drag from another window) inserts nothing", () => {
		const h = setup();
		fire("drop", { clientX: 200, clientY: 150 }, elementTransfer("square"));
		expect(h.commits).toHaveLength(0);
	});

	it("an element dragover is ACCEPTED but shows no replace affordance", () => {
		setup();
		beginElementDrag(entry());
		// Straight over the rect, where an asset drag WOULD offer to replace.
		fire("dragOver", { clientX: 60, clientY: 60 }, elementTransfer("square"));

		const zone = screen.getByTestId("canvas-drop-zone");
		expect(zone.getAttribute("data-dragging")).toBe("true");
		expect(zone.getAttribute("data-drop-target")).toBe("none");
		expect(screen.queryByTestId("drop-target-highlight")).toBeNull();
	});

	it("leaves the asset drop path alone", () => {
		const h = setup();
		h.ctx.commit = vi.fn(h.ctx.commit);
		const assetTransfer = {
			files: [] as File[],
			types: [ASSET_DRAG_MIME],
			getData: (type: string) => (type === ASSET_DRAG_MIME ? "a1" : ""),
		};
		// No such asset in `ir.assets` → the asset path bails, as it always has.
		fire("drop", { clientX: 200, clientY: 150 }, assetTransfer);
		expect(h.commits).toHaveLength(0);
	});
});
