import {
	type CanvasIR,
	type CanvasNodeDeleteCommand,
	type CanvasNodeGroupCommand,
	type CanvasNodeKind,
	type CanvasNodeUngroupCommand,
	type CanvasNodeUpdateCommand,
	createCanvasIR,
	createFrame,
	createGroup,
	createPage,
	createRect,
	createText,
} from "@anvilkit/canvas-core";
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
	CanvasStudioContext,
	type CanvasStudioContextValue,
} from "@/context/canvas-studio-context.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import { LayerPanel } from "../LayerPanel.js";

const FIXED_TS = "2026-05-20T00:00:00.000Z";

function withNodesIR(): CanvasIR {
	const ir = createCanvasIR({
		id: "ir-1",
		pages: [createPage({ id: "p1" })],
		now: () => FIXED_TS,
	});
	const rect = createRect({
		id: "rect-a",
		bounds: { width: 50, height: 50 },
		now: () => FIXED_TS,
	});
	const text = createText({
		id: "text-b",
		text: "Hello",
		bounds: { width: 100, height: 20 },
		now: () => FIXED_TS,
	});
	const firstPage = ir.pages[0];
	if (!firstPage) throw new Error("expected at least one page");
	firstPage.root.children = [rect, text];
	return ir;
}

function mount(ctx: CanvasStudioContextValue) {
	return render(
		<CanvasStudioContext.Provider value={ctx}>
			<LayerPanel />
		</CanvasStudioContext.Provider>,
	);
}

describe("LayerPanel — render", () => {
	it("renders one row per layer with top-most layer first", () => {
		const h = makeHarness({ ir: withNodesIR() });
		const { container } = mount(h.studioCtx);
		const rows = container.querySelectorAll("[data-testid^='layer-row-']");
		// Two layer rows: rect-a and text-b. (Buttons inside rows match the same
		// prefix, so filter to the row containers themselves.)
		const rowIds = Array.from(rows)
			.map((el) => el.getAttribute("data-testid") ?? "")
			.filter((id) => id === "layer-row-rect-a" || id === "layer-row-text-b");
		expect(rowIds).toEqual(["layer-row-text-b", "layer-row-rect-a"]);
	});

	it("renders an empty state when the active page has no children", () => {
		const h = makeHarness();
		const { container } = mount(h.studioCtx);
		expect(
			container.querySelector("[data-testid='layer-panel-empty']"),
		).not.toBeNull();
	});

	// A frame is a container: it must list its children as indented rows, exactly
	// as a group does. Before this, a frame rendered a single childless row.
	it("lists frame children as indented rows", () => {
		const ir = createCanvasIR({
			id: "ir-1",
			pages: [createPage({ id: "p1" })],
			now: () => FIXED_TS,
		});
		const firstPage = ir.pages[0];
		if (!firstPage) throw new Error("expected at least one page");
		firstPage.root.children = [
			createFrame({
				id: "frame-a",
				bounds: { width: 100, height: 100 },
				clip: true,
				children: [
					createRect({
						id: "rect-in-frame",
						bounds: { width: 10, height: 10 },
						now: () => FIXED_TS,
					}),
				],
			}),
		];
		const h = makeHarness({ ir });
		const { container } = mount(h.studioCtx);
		expect(
			container.querySelector("[data-testid='layer-row-frame-a']"),
		).not.toBeNull();
		const childRow = container.querySelector(
			"[data-testid='layer-row-rect-in-frame']",
		);
		expect(childRow).not.toBeNull();
		// depth 1 → indented one level past the frame row.
		expect(childRow?.getAttribute("style")).toContain("padding-left");
	});
});

describe("LayerPanel — a11y", () => {
	it("exposes the layer list as a labeled tree of treeitems", () => {
		const h = makeHarness({ ir: withNodesIR() });
		const { container } = mount(h.studioCtx);
		const tree = container.querySelector("[role='tree']") as HTMLElement;
		expect(tree).not.toBeNull();
		expect(tree.getAttribute("aria-label")).toBe("Layers");
		// Rows inside the tree are treeitems with aria-selected.
		const items = tree.querySelectorAll("[role='treeitem']");
		expect(items.length).toBe(2);
		for (const item of items) {
			expect(item.getAttribute("aria-selected")).not.toBeNull();
		}
	});

	it("does not suppress the keyboard focus ring on the focusable root", () => {
		const h = makeHarness({ ir: withNodesIR() });
		const { container } = mount(h.studioCtx);
		const panel = container.querySelector(
			"[data-testid='layer-panel']",
		) as HTMLElement;
		// Root is keyboard-focusable; it must not hide its focus outline (2.4.7).
		expect(panel.tabIndex).toBe(0);
		expect(panel.style.outline).not.toBe("none");
	});
});

describe("LayerPanel — selection", () => {
	it("clicking a row sets selection to that node", () => {
		const h = makeHarness({ ir: withNodesIR() });
		const { container } = mount(h.studioCtx);
		const row = container.querySelector(
			"[data-testid='layer-row-rect-a']",
		) as HTMLElement;
		fireEvent.click(row);
		expect(h.studioCtx.selectionStore.getState().selectedIds).toEqual([
			"rect-a",
		]);
	});

	it("shift-click RANGE-selects from the selection head (FR-051, A-08)", () => {
		const h = makeHarness({ ir: withNodesIR() });
		h.studioCtx.selectionStore.getState().setSelection(["rect-a"]);
		const { container } = mount(h.studioCtx);
		const row = container.querySelector(
			"[data-testid='layer-row-text-b']",
		) as HTMLElement;
		fireEvent.click(row, { shiftKey: true });
		// Range is reported in panel order (top-most first).
		expect(h.studioCtx.selectionStore.getState().selectedIds).toEqual([
			"text-b",
			"rect-a",
		]);
	});
});

describe("LayerPanel — visibility / lock toggles", () => {
	it("visibility toggle fires node.update with visible patch", () => {
		const h = makeHarness({ ir: withNodesIR() });
		const { container } = mount(h.studioCtx);
		const btn = container.querySelector(
			"[data-testid='layer-row-rect-a-visibility']",
		) as HTMLElement;
		fireEvent.click(btn);
		expect(h.commits).toHaveLength(1);
		const cmd = h.commits[0] as CanvasNodeUpdateCommand<CanvasNodeKind>;
		expect(cmd.type).toBe("node.update");
		expect(cmd.nodeId).toBe("rect-a");
		expect((cmd.patch as { visible?: boolean }).visible).toBe(false);
	});

	it("lock toggle fires node.update with locked patch", () => {
		const h = makeHarness({ ir: withNodesIR() });
		const { container } = mount(h.studioCtx);
		const btn = container.querySelector(
			"[data-testid='layer-row-text-b-lock']",
		) as HTMLElement;
		fireEvent.click(btn);
		expect(h.commits).toHaveLength(1);
		const cmd = h.commits[0] as CanvasNodeUpdateCommand<CanvasNodeKind>;
		expect(cmd.type).toBe("node.update");
		expect(cmd.nodeId).toBe("text-b");
		expect((cmd.patch as { locked?: boolean }).locked).toBe(true);
	});
});

describe("LayerPanel — keyboard", () => {
	it("Delete key fires node.delete for each selected layer", () => {
		const h = makeHarness({ ir: withNodesIR() });
		h.studioCtx.selectionStore.getState().setSelection(["rect-a"]);
		const { container } = mount(h.studioCtx);
		const panel = container.querySelector(
			"[data-testid='layer-panel']",
		) as HTMLElement;
		fireEvent.keyDown(panel, { key: "Delete" });
		expect(h.commits).toHaveLength(1);
		const cmd = h.commits[0] as CanvasNodeDeleteCommand;
		expect(cmd.type).toBe("node.delete");
		expect(cmd.nodeId).toBe("rect-a");
		expect(h.studioCtx.selectionStore.getState().selectedIds).toEqual([]);
	});

	it("ArrowDown moves selection to next row", () => {
		const h = makeHarness({ ir: withNodesIR() });
		h.studioCtx.selectionStore.getState().setSelection(["text-b"]);
		const { container } = mount(h.studioCtx);
		const panel = container.querySelector(
			"[data-testid='layer-panel']",
		) as HTMLElement;
		fireEvent.keyDown(panel, { key: "ArrowDown" });
		// text-b is first (top-most); ArrowDown moves to rect-a.
		expect(h.studioCtx.selectionStore.getState().selectedIds).toEqual([
			"rect-a",
		]);
	});
});

/** root: [rect-a, text-b, g(=[gx, gy])] on page "p1". */
function withGroupIR(): CanvasIR {
	const ir = createCanvasIR({
		id: "ir-1",
		pages: [createPage({ id: "p1" })],
		now: () => FIXED_TS,
	});
	const firstPage = ir.pages[0];
	if (!firstPage) throw new Error("expected at least one page");
	firstPage.root.children = [
		createRect({ id: "rect-a", bounds: { width: 50, height: 50 } }),
		createText({
			id: "text-b",
			text: "Hello",
			bounds: { width: 100, height: 20 },
		}),
		createGroup({
			id: "g",
			bounds: { width: 60, height: 60 },
			children: [
				createRect({ id: "gx", bounds: { width: 10, height: 10 } }),
				createRect({ id: "gy", bounds: { width: 10, height: 10 } }),
			],
		}),
	];
	return ir;
}

describe("LayerPanel — group / ungroup", () => {
	it("group button is disabled with no multi-selection and enabled with one", () => {
		const h = makeHarness({ ir: withNodesIR() });
		const { container, rerender } = mount(h.studioCtx);
		const groupBtn = () =>
			container.querySelector(
				"[data-testid='layer-group-btn']",
			) as HTMLButtonElement;
		expect(groupBtn().disabled).toBe(true);
		h.studioCtx.selectionStore.getState().setSelection(["rect-a", "text-b"]);
		rerender(
			<CanvasStudioContext.Provider value={h.studioCtx}>
				<LayerPanel />
			</CanvasStudioContext.Provider>,
		);
		expect(groupBtn().disabled).toBe(false);
	});

	it("group button dispatches node.group for the selection", () => {
		const h = makeHarness({ ir: withNodesIR() });
		h.studioCtx.selectionStore.getState().setSelection(["rect-a", "text-b"]);
		const { container } = mount(h.studioCtx);
		const btn = container.querySelector(
			"[data-testid='layer-group-btn']",
		) as HTMLButtonElement;
		fireEvent.click(btn);
		expect(h.commits).toHaveLength(1);
		const cmd = h.commits[0] as CanvasNodeGroupCommand;
		expect(cmd.type).toBe("node.group");
		expect(cmd.childIds).toEqual(["rect-a", "text-b"]);
	});

	it("ungroup button dispatches node.ungroup for a selected group", () => {
		const h = makeHarness({ ir: withGroupIR() });
		h.studioCtx.selectionStore.getState().setSelection(["g"]);
		const { container } = mount(h.studioCtx);
		const btn = container.querySelector(
			"[data-testid='layer-ungroup-btn']",
		) as HTMLButtonElement;
		expect(btn.disabled).toBe(false);
		fireEvent.click(btn);
		expect(h.commits).toHaveLength(1);
		const cmd = h.commits[0] as CanvasNodeUngroupCommand;
		expect(cmd.type).toBe("node.ungroup");
		expect(cmd.groupId).toBe("g");
	});

	it("Cmd/Ctrl+G fires node.group", () => {
		const h = makeHarness({ ir: withNodesIR() });
		h.studioCtx.selectionStore.getState().setSelection(["rect-a", "text-b"]);
		const { container } = mount(h.studioCtx);
		const panel = container.querySelector(
			"[data-testid='layer-panel']",
		) as HTMLElement;
		fireEvent.keyDown(panel, { key: "g", ctrlKey: true });
		expect(h.commits).toHaveLength(1);
		expect((h.commits[0] as CanvasNodeGroupCommand).type).toBe("node.group");
	});

	it("Cmd/Ctrl+Shift+G fires node.ungroup", () => {
		const h = makeHarness({ ir: withGroupIR() });
		h.studioCtx.selectionStore.getState().setSelection(["g"]);
		const { container } = mount(h.studioCtx);
		const panel = container.querySelector(
			"[data-testid='layer-panel']",
		) as HTMLElement;
		fireEvent.keyDown(panel, { key: "G", ctrlKey: true, shiftKey: true });
		expect(h.commits).toHaveLength(1);
		expect((h.commits[0] as CanvasNodeUngroupCommand).type).toBe(
			"node.ungroup",
		);
	});
});

describe("LayerPanel — delete routes through the action layer (FR-024/AC-005)", () => {
	it("multi-select Delete commits ONE batch (one undo entry), not N commits", () => {
		const h = makeHarness({ ir: withNodesIR() });
		h.studioCtx.selectionStore.getState().setSelection(["rect-a", "text-b"]);
		const { container } = mount(h.studioCtx);
		const panel = container.querySelector(
			'[data-testid="layer-panel"]',
		) as HTMLElement;
		fireEvent.keyDown(panel, { key: "Delete" });
		// One undo entry: a single commitBatch, no per-node commits.
		expect(h.studioCtx.commitBatch).toHaveBeenCalledTimes(1);
		expect(h.commits.map((c) => c.type)).toEqual([
			"node.delete",
			"node.delete",
		]);
		expect(h.studioCtx.selectionStore.getState().selectedIds).toHaveLength(0);
	});

	it("does not delete a locked node from the panel", () => {
		const ir = withNodesIR();
		const rect = ir.pages[0]?.root.children.find((n) => n.id === "rect-a");
		if (rect) (rect as { locked?: boolean }).locked = true;
		const h = makeHarness({ ir });
		h.studioCtx.selectionStore.getState().setSelection(["rect-a"]);
		const { container } = mount(h.studioCtx);
		const panel = container.querySelector(
			'[data-testid="layer-panel"]',
		) as HTMLElement;
		fireEvent.keyDown(panel, { key: "Backspace" });
		// The locked node is skipped by the action layer → no delete commit.
		expect(h.commits.some((c) => c.type === "node.delete")).toBe(false);
	});
});
