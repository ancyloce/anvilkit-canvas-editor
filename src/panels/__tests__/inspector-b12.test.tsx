import {
	type CanvasIR,
	createCanvasIR,
	createImage,
	createPage,
	createRect,
} from "@anvilkit/canvas-core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import {
	formatDashPattern,
	parseDashPattern,
} from "../inspector/stroke-section.js";
import { PropertyInspector } from "../PropertyInspector.js";

afterEach(cleanup);

const NOW = "2026-01-01T00:00:00.000Z";

function twoRectIR(): CanvasIR {
	const ir = createCanvasIR({
		id: "ir-1",
		pages: [createPage({ id: "p1" })],
		now: () => NOW,
	});
	const page = ir.pages[0];
	if (!page) throw new Error("no page");
	page.root.children = [
		createRect({
			id: "r1",
			bounds: { width: 50, height: 60 },
			transform: { x: 10 },
			now: () => NOW,
		}),
		createRect({
			id: "r2",
			bounds: { width: 50, height: 90 },
			transform: { x: 99 },
			now: () => NOW,
		}),
	];
	return ir;
}

function imageIR(): CanvasIR {
	const ir = createCanvasIR({
		id: "ir-2",
		pages: [createPage({ id: "p1" })],
		now: () => NOW,
	});
	const page = ir.pages[0];
	if (!page) throw new Error("no page");
	page.root.children = [
		createImage({
			id: "img1",
			assetId: "a1",
			bounds: { width: 100, height: 80 },
			now: () => NOW,
		}),
	];
	return ir;
}

function mount(ir: CanvasIR, selection: string[]) {
	const h = makeHarness({ ir });
	h.studioCtx.selectionStore.getState().setSelection(selection);
	render(
		<CanvasStudioContext.Provider value={h.studioCtx}>
			<PropertyInspector />
		</CanvasStudioContext.Provider>,
	);
	return h;
}

describe("PropertyInspector multi-selection (B-12, FR-070)", () => {
	it("announces the count and renders mixed values as 'Mixed'", () => {
		mount(twoRectIR(), ["r1", "r2"]);
		expect(screen.getByTestId("prop-selection-kind").textContent).toContain(
			"2 layers selected",
		);
		// x differs (10 vs 99) → mixed; width is shared (50) → concrete.
		expect((screen.getByTestId("prop-x") as HTMLInputElement).placeholder).toBe(
			"Mixed",
		);
		expect((screen.getByTestId("prop-width") as HTMLInputElement).value).toBe(
			"50",
		);
		// Kind-specific sections and the name field are single-selection only.
		expect(screen.queryByTestId("prop-name")).toBeNull();
		expect(screen.queryByTestId("prop-fill-type")).toBeNull();
	});

	it("commits a shared edit as ONE coalesced batch across the selection", () => {
		const h = mount(twoRectIR(), ["r1", "r2"]);
		const opacity = screen.getByTestId("prop-opacity") as HTMLInputElement;
		fireEvent.change(opacity, { target: { value: "0.25" } });
		fireEvent.blur(opacity);
		expect(h.studioCtx.commitCoalesced).toHaveBeenCalledTimes(1);
		const [cmd] = (
			h.studioCtx.commitCoalesced as unknown as {
				mock: { calls: [unknown, string][] };
			}
		).mock.calls[0] ?? [null];
		expect(cmd).toMatchObject({
			type: "batch",
			commands: [
				{ type: "node.update", nodeId: "r1", patch: { opacity: 0.25 } },
				{ type: "node.update", nodeId: "r2", patch: { opacity: 0.25 } },
			],
		});
	});

	it("mixed transform edits build per-node patches (own transform spread)", () => {
		const h = mount(twoRectIR(), ["r1", "r2"]);
		const x = screen.getByTestId("prop-x") as HTMLInputElement;
		fireEvent.change(x, { target: { value: "42" } });
		fireEvent.blur(x);
		const call = (
			h.studioCtx.commitCoalesced as unknown as {
				mock: { calls: [{ commands?: { patch: { transform: unknown } }[] }][] };
			}
		).mock.calls[0]?.[0];
		expect(call?.commands?.[0]?.patch.transform).toMatchObject({ x: 42 });
		expect(call?.commands?.[1]?.patch.transform).toMatchObject({ x: 42 });
	});
});

describe("Appearance section (B-12, FR-073)", () => {
	it("toggles visibility through node.update", () => {
		const h = mount(twoRectIR(), ["r1"]);
		fireEvent.click(screen.getByTestId("prop-visible"));
		expect(h.commits.at(-1)).toMatchObject({
			type: "node.update",
			nodeId: "r1",
			patch: { visible: false },
		});
	});

	it("toggles lock for the WHOLE multi-selection as one batch", () => {
		const h = mount(twoRectIR(), ["r1", "r2"]);
		fireEvent.click(screen.getByTestId("prop-locked"));
		// makeHarness flattens batches into `commits`.
		expect(h.commits).toHaveLength(2);
		expect(h.commits[0]).toMatchObject({
			nodeId: "r1",
			patch: { locked: true },
		});
		expect(h.commits[1]).toMatchObject({
			nodeId: "r2",
			patch: { locked: true },
		});
	});

	it("renders blend-mode picker and z-order buttons", () => {
		const h = mount(twoRectIR(), ["r1"]);
		expect(screen.getByTestId("prop-blend-mode")).toBeTruthy();
		fireEvent.click(screen.getByTestId("prop-order-front"));
		// reorderSelection("front") flows through the action layer → a commit.
		expect(h.commits.length).toBeGreaterThan(0);
	});
});

describe("Stroke + radius fields (B-12, B-03a/b)", () => {
	it("stroke opacity and dash commit coalesced style patches", () => {
		const h = mount(twoRectIR(), ["r1"]);
		const so = screen.getByTestId("prop-stroke-opacity") as HTMLInputElement;
		fireEvent.change(so, { target: { value: "0.4" } });
		fireEvent.blur(so);
		expect(h.studioCtx.commitCoalesced).toHaveBeenCalledWith(
			expect.objectContaining({ patch: { strokeOpacity: 0.4 } }),
			"field:prop-stroke-opacity:r1",
		);
		const dash = screen.getByTestId("prop-stroke-dash") as HTMLInputElement;
		fireEvent.change(dash, { target: { value: "4, 2" } });
		fireEvent.blur(dash);
		expect(h.studioCtx.commitCoalesced).toHaveBeenCalledWith(
			expect.objectContaining({ patch: { strokeDash: [4, 2] } }),
			"field:prop-stroke-dash:r1",
		);
	});

	it("per-corner radius seeds from the uniform radius; uniform edit clears radii", () => {
		const h = mount(twoRectIR(), ["r1"]);
		const tl = screen.getByTestId("prop-radius-tl") as HTMLInputElement;
		fireEvent.change(tl, { target: { value: "8" } });
		fireEvent.blur(tl);
		expect(h.studioCtx.commitCoalesced).toHaveBeenCalledWith(
			expect.objectContaining({
				patch: {
					cornerRadii: {
						topLeft: 8,
						topRight: 0,
						bottomRight: 0,
						bottomLeft: 0,
					},
				},
			}),
			"field:prop-radius-tl:r1",
		);
		const uniform = screen.getByTestId("prop-radius") as HTMLInputElement;
		fireEvent.change(uniform, { target: { value: "12" } });
		fireEvent.blur(uniform);
		expect(h.studioCtx.commitCoalesced).toHaveBeenCalledWith(
			expect.objectContaining({
				patch: { radius: 12, cornerRadii: undefined },
			}),
			"field:prop-radius:r1",
		);
	});
});

describe("Image fit mode (B-12, B-02)", () => {
	it("renders the fit-mode picker for image nodes", () => {
		mount(imageIR(), ["img1"]);
		expect(screen.getByTestId("prop-fit-mode")).toBeTruthy();
	});
});

describe("parseDashPattern", () => {
	it("parses space/comma separated patterns and round-trips", () => {
		expect(parseDashPattern("4 2")).toEqual([4, 2]);
		expect(parseDashPattern("4,2")).toEqual([4, 2]);
		expect(parseDashPattern(" 6 ,  3 1.5 ")).toEqual([6, 3, 1.5]);
		expect(parseDashPattern("")).toBeUndefined();
		expect(parseDashPattern("abc")).toBeUndefined();
		expect(parseDashPattern("4 -2")).toBeUndefined();
		expect(formatDashPattern([4, 2])).toBe("4 2");
		expect(formatDashPattern(undefined)).toBe("");
	});
});
