import type {
	CanvasAutoLayout,
	CanvasIR,
	CanvasNode,
} from "@anvilkit/canvas-core";
import {
	createCanvasIR,
	createFrame,
	createPage,
	createRect,
	findNode,
	insertNode,
} from "@anvilkit/canvas-core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import {
	optionLabels,
	selectOption,
} from "@/panels/__tests__/_select-test-helpers.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import { AutoLayoutSection } from "../auto-layout-section.js";

afterEach(cleanup);

/**
 * T-M4-03 (TS-31, TS-32) + T-M4-04 (TS-33) — Inspector Auto Layout section:
 * preview/commit through the field contract, TD-004 primary-axis disable,
 * mixed multi-selection reads/writes, and group eligibility rules.
 */

const baseLayout: CanvasAutoLayout = {
	version: 1,
	direction: "horizontal",
	padding: { top: 0, right: 0, bottom: 0, left: 0 },
	gap: 10,
	primaryAlign: "start",
	crossAlign: "start",
};

function layoutIr(opts?: {
	fillChild?: boolean;
	secondFrameGap?: number;
}): CanvasIR {
	const frame: CanvasNode = {
		...createFrame({ id: "f1", bounds: { width: 200, height: 100 } }),
		autoLayout: baseLayout,
		children: [
			{
				...createRect({ id: "r1", bounds: { width: 40, height: 20 } }),
				...(opts?.fillChild
					? { layoutItem: { widthSizing: "fill" as const } }
					: {}),
			},
			createRect({ id: "r2", bounds: { width: 40, height: 20 } }),
		],
	} as CanvasNode;
	const page = createPage({ id: "p1" });
	let ir = createCanvasIR({ id: "doc", title: "t", pages: [page] });
	ir = insertNode(ir, { parentId: page.root.id, node: frame });
	ir = insertNode(ir, {
		parentId: page.root.id,
		node: createRect({ id: "loose", bounds: { width: 10, height: 10 } }),
	});
	if (opts?.secondFrameGap !== undefined) {
		ir = insertNode(ir, {
			parentId: page.root.id,
			node: {
				...createFrame({ id: "f2", bounds: { width: 200, height: 100 } }),
				autoLayout: { ...baseLayout, gap: opts.secondFrameGap },
			} as CanvasNode,
		});
	}
	return ir;
}

function setup(ir: CanvasIR, ids: readonly string[]) {
	const h = makeHarness({ ir, pageId: "p1" });
	const nodes = ids.map((id) => {
		const found = findNode(ir, id);
		if (!found) throw new Error(`missing ${id}`);
		return found.node;
	});
	render(
		<CanvasStudioContext.Provider value={h.studioCtx}>
			<AutoLayoutSection nodes={nodes} />
		</CanvasStudioContext.Provider>,
	);
	return h;
}

function previews(h: ReturnType<typeof makeHarness>) {
	return h.studioCtx.fieldPreviewStore?.getState().previews ?? {};
}

describe("AutoLayoutSection", () => {
	it("renders nothing when neither group applies", () => {
		setup(layoutIr(), ["loose"]);
		expect(screen.queryByText("Auto layout")).toBeNull();
	});

	it("renders nothing for a mixed frame + non-child selection (frame fields hidden, not disabled)", () => {
		setup(layoutIr(), ["f1", "loose"]);
		expect(screen.queryByText("Auto layout")).toBeNull();
		expect(screen.queryByTestId("prop-layout-direction-horizontal")).toBeNull();
	});

	it("gap previews through buildPatch and commits ONE coalesced frame.set-layout (TS-31)", () => {
		const h = setup(layoutIr(), ["f1"]);
		const input = screen.getByTestId("prop-layout-gap");
		fireEvent.change(input, { target: { value: "24" } });
		expect(previews(h)).toEqual({
			f1: { autoLayout: { ...baseLayout, gap: 24 } },
		});
		expect(h.studioCtx.commitCoalesced).not.toHaveBeenCalled();
		fireEvent.blur(input);
		expect(h.studioCtx.commitCoalesced).toHaveBeenCalledTimes(1);
		expect(h.studioCtx.commitCoalesced).toHaveBeenCalledWith(
			{
				type: "frame.set-layout",
				nodeId: "f1",
				layout: { ...baseLayout, gap: 24 },
			},
			"field:prop-layout-gap:f1",
		);
		expect(previews(h)).toEqual({});
	});

	it("direction toggle commits frame.set-layout preserving other intent", () => {
		const h = setup(layoutIr(), ["f1"]);
		fireEvent.click(screen.getByTestId("prop-layout-direction-vertical"));
		expect(h.commits).toEqual([
			{
				type: "frame.set-layout",
				nodeId: "f1",
				layout: { ...baseLayout, direction: "vertical" },
			},
		]);
	});

	it("disables the primary-axis third under a main-axis Fill child, cross stays live (TS-32)", () => {
		const h = setup(layoutIr({ fillChild: true }), ["f1"]);
		const offPrimary = screen.getByTestId("prop-layout-align-center-start");
		expect(offPrimary).toHaveProperty("disabled", true);
		expect(offPrimary.getAttribute("title")).toBe(
			"Main-axis alignment has no effect while a child fills the main axis",
		);
		// Same primary column, different cross — still live, commits cross only.
		const crossCell = screen.getByTestId("prop-layout-align-start-center");
		expect(crossCell).toHaveProperty("disabled", false);
		fireEvent.click(crossCell);
		expect(h.commits).toEqual([
			{
				type: "frame.set-layout",
				nodeId: "f1",
				layout: { ...baseLayout, crossAlign: "center" },
			},
		]);
	});

	it("mixed gap shows the Mixed placeholder and commits one batch across all frames (TS-33)", () => {
		const h = setup(layoutIr({ secondFrameGap: 20 }), ["f1", "f2"]);
		const input = screen.getByTestId("prop-layout-gap") as HTMLInputElement;
		expect(input.placeholder).toBe("Mixed");
		fireEvent.change(input, { target: { value: "12" } });
		fireEvent.blur(input);
		expect(h.studioCtx.commitCoalesced).toHaveBeenCalledWith(
			{
				type: "batch",
				commands: [
					{
						type: "frame.set-layout",
						nodeId: "f1",
						layout: { ...baseLayout, gap: 12 },
					},
					{
						type: "frame.set-layout",
						nodeId: "f2",
						layout: { ...baseLayout, gap: 12 },
					},
				],
			},
			"field:prop-layout-gap:f1,f2",
		);
	});

	it("item group: sizing select offers fill and patches layoutItem via node.update", async () => {
		const h = setup(layoutIr(), ["r1"]);
		// Frame-level controls hidden for a child selection.
		expect(screen.queryByTestId("prop-layout-direction-horizontal")).toBeNull();
		expect(await optionLabels("prop-layout-width-sizing")).toEqual([
			"Fixed",
			"Hug contents",
			"Fill container",
		]);
		await selectOption("prop-layout-width-sizing", "Fill container");
		// Plain `commit`, not `commitCoalesced` — a select is discrete, so
		// consecutive picks must not fold into one undo entry.
		expect(h.studioCtx.commit).toHaveBeenCalledWith({
			type: "node.update",
			nodeId: "r1",
			kind: "rect",
			patch: { layoutItem: { widthSizing: "fill" } },
		});
	});

	it("item group: Flow/Absolute toggle requires one shared parent and commits a layoutItem patch", () => {
		const h = setup(layoutIr(), ["r1", "r2"]);
		fireEvent.click(screen.getByTestId("prop-layout-positioning-absolute"));
		expect(h.commits).toEqual([
			{
				type: "node.update",
				nodeId: "r1",
				kind: "rect",
				patch: { layoutItem: { positioning: "absolute" } },
			},
			{
				type: "node.update",
				nodeId: "r2",
				kind: "rect",
				patch: { layoutItem: { positioning: "absolute" } },
			},
		]);
	});

	it("frame-only selection offers fixed/hug sizing without fill", async () => {
		setup(layoutIr(), ["f1"]);
		expect(await optionLabels("prop-layout-width-sizing")).toEqual([
			"Fixed",
			"Hug contents",
		]);
	});
});

describe("AutoLayoutSection — creation flag (T-M4-10, TS-28)", () => {
	function plainFrameIr(): CanvasIR {
		const frame: CanvasNode = {
			...createFrame({ id: "pf", bounds: { width: 200, height: 100 } }),
			children: [createRect({ id: "c1", bounds: { width: 40, height: 20 } })],
		} as CanvasNode;
		const page = createPage({ id: "p1" });
		let ir = createCanvasIR({ id: "doc", title: "t", pages: [page] });
		ir = insertNode(ir, { parentId: page.root.id, node: frame });
		ir = insertNode(ir, {
			parentId: page.root.id,
			node: createRect({ id: "s1", bounds: { width: 10, height: 10 } }),
		});
		ir = insertNode(ir, {
			parentId: page.root.id,
			node: createRect({ id: "s2", bounds: { width: 10, height: 10 } }),
		});
		return ir;
	}

	function setupFlagged(ir: CanvasIR, ids: readonly string[], flag: boolean) {
		const h = makeHarness({ ir, pageId: "p1" });
		h.studioCtx.autoLayoutCreationEnabled = flag;
		h.studioCtx.selectionStore.getState().setSelection([...ids]);
		const nodes = ids.map((id) => {
			const found = findNode(ir, id);
			if (!found) throw new Error(`missing ${id}`);
			return found.node;
		});
		render(
			<CanvasStudioContext.Provider value={h.studioCtx}>
				<AutoLayoutSection nodes={nodes} />
			</CanvasStudioContext.Provider>,
		);
		return h;
	}

	it("flag OFF (default): no creation affordance appears anywhere", () => {
		setupFlagged(plainFrameIr(), ["pf"], false);
		expect(screen.queryByTestId("prop-layout-add")).toBeNull();
		expect(screen.queryByText("Auto layout")).toBeNull();
	});

	it("flag OFF still leaves existing-intent editing available (never gated)", () => {
		setupFlagged(layoutIr(), ["f1"], false);
		expect(screen.queryByTestId("prop-layout-gap")).not.toBeNull();
		expect(screen.queryByTestId("prop-layout-remove")).toBeNull();
	});

	it("flag ON: Add auto layout converts the selected plain frame", () => {
		const h = setupFlagged(plainFrameIr(), ["pf"], true);
		fireEvent.click(screen.getByTestId("prop-layout-add"));
		expect(h.commits.at(-1)).toMatchObject({
			type: "frame.set-layout",
			nodeId: "pf",
		});
	});

	it("flag ON: Wrap appears for a same-parent multi-selection", () => {
		const h = setupFlagged(plainFrameIr(), ["s1", "s2"], true);
		fireEvent.click(screen.getByTestId("prop-layout-wrap"));
		expect(
			h.commits.some((c) => c.type === "selection.wrap-in-layout-frame"),
		).toBe(true);
	});

	it("RTL: direction and alignment stay document-space semantic words, never left/right glyphs (TS-53)", () => {
		// The Inspector mirrors under the host's dir="rtl" via CSS; what must
		// NOT mirror is the SEMANTICS: `horizontal` remains left-to-right in
		// document space, so the control labels it with the explicit localized
		// word, and alignment cells speak Start/End (document axes), never
		// physical left/right.
		const container = document.createElement("div");
		container.dir = "rtl";
		document.body.appendChild(container);
		try {
			const ir = layoutIr();
			const h = makeHarness({ ir, pageId: "p1" });
			const found = findNode(ir, "f1");
			if (!found) throw new Error("missing f1");
			render(
				<CanvasStudioContext.Provider value={h.studioCtx}>
					<AutoLayoutSection nodes={[found.node]} />
				</CanvasStudioContext.Provider>,
				{ container },
			);
			const horizontal = screen.getByTestId("prop-layout-direction-horizontal");
			expect(horizontal.textContent).toBe("Horizontal");
			expect(
				screen
					.getByTestId("prop-layout-align-start-center")
					.getAttribute("aria-label"),
			).toBe("Start / Center");
		} finally {
			container.remove();
		}
	});

	it("flag ON: Remove appears for a layout frame and commits frame.remove-layout", () => {
		const h = setupFlagged(layoutIr(), ["f1"], true);
		fireEvent.click(screen.getByTestId("prop-layout-remove"));
		expect(h.commits.at(-1)).toMatchObject({
			type: "frame.remove-layout",
			nodeId: "f1",
		});
	});
});
