import {
	type CanvasIR,
	type CanvasTextAlign,
	createCanvasIR,
	createImage,
	createPage,
	createRect,
	createRichText,
	createText,
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
		// The name field stays single-selection only.
		expect(screen.queryByTestId("prop-name")).toBeNull();
		// Both selected nodes are rects (a shared kind) — the kind-specific
		// Shape section DOES render for a same-kind multi-selection (FR-070 gap
		// closure); see the "Multi-kind sections" describe block below.
		expect(screen.queryByTestId("prop-fill-type")).not.toBeNull();
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

describe("Transform section (FR-071)", () => {
	it("exposes scale, aspect-lock, reset-rotation and flip controls", () => {
		mount(twoRectIR(), ["r1"]);
		expect(screen.getByTestId("prop-scale")).toBeTruthy();
		expect(screen.getByTestId("prop-aspect-lock")).toBeTruthy();
		expect(screen.getByTestId("prop-reset-rotation")).toBeTruthy();
		expect(screen.getByTestId("prop-flip-h")).toBeTruthy();
		expect(screen.getByTestId("prop-flip-v")).toBeTruthy();
	});

	it("flip horizontal negates scaleX as one batch across the selection", () => {
		const h = mount(twoRectIR(), ["r1", "r2"]);
		fireEvent.click(screen.getByTestId("prop-flip-h"));
		// One batch → makeHarness flattens into `commits`; both nodes patched.
		expect(h.commits).toHaveLength(2);
		expect(
			h.commits.every(
				(c) =>
					(c as { patch: { transform?: { scaleX?: number } } }).patch.transform
						?.scaleX === -1,
			),
		).toBe(true);
	});

	it("reset rotation sets rotation to 0", () => {
		const ir = twoRectIR();
		const r1 = ir.pages[0]?.root.children[0];
		if (r1) r1.transform.rotation = 45;
		const h = mount(ir, ["r1"]);
		fireEvent.click(screen.getByTestId("prop-reset-rotation"));
		expect(
			(h.commits[0] as { patch: { transform: { rotation: number } } }).patch
				.transform.rotation,
		).toBe(0);
	});
});

describe("Fill controls (FR-074)", () => {
	function filledRectIR(): CanvasIR {
		const ir = createCanvasIR({
			id: "ir-f",
			pages: [createPage({ id: "p1" })],
			now: () => NOW,
		});
		const page = ir.pages[0];
		if (!page) throw new Error("no page");
		page.root.children = [
			createRect({
				id: "rf",
				bounds: { width: 50, height: 60 },
				fill: "#3366cc",
				now: () => NOW,
			}),
		];
		return ir;
	}

	it("switching fill type to None clears the fill", () => {
		const h = mount(filledRectIR(), ["rf"]);
		fireEvent.change(screen.getByTestId("prop-fill-type"), {
			target: { value: "none" },
		});
		expect(
			(h.commits[0] as { patch: Record<string, unknown> }).patch,
		).toHaveProperty("fill", undefined);
	});

	it("exposes a fill-alpha field for a solid fill", () => {
		mount(filledRectIR(), ["rf"]);
		expect(screen.getByTestId("prop-fill-alpha")).toBeTruthy();
	});

	it("no-fill node shows the None fill type", () => {
		mount(twoRectIR(), ["r1"]);
		expect(
			(screen.getByTestId("prop-fill-type") as HTMLSelectElement).value,
		).toBe("none");
	});
});

describe("Rich text vertical align (FR-081)", () => {
	function richTextIR(): CanvasIR {
		const ir = createCanvasIR({
			id: "ir-rt",
			pages: [createPage({ id: "p1" })],
			now: () => NOW,
		});
		const page = ir.pages[0];
		if (!page) throw new Error("no page");
		page.root.children = [
			createRichText({
				id: "rt",
				bounds: { width: 200, height: 120 },
				paragraphs: [{ spans: [{ text: "hi" }] }],
				now: () => NOW,
			}),
		];
		return ir;
	}

	it("commits verticalAlign when changed", () => {
		const h = mount(richTextIR(), ["rt"]);
		fireEvent.change(screen.getByTestId("prop-rich-text-vertical-align"), {
			target: { value: "middle" },
		});
		expect(
			(h.commits[0] as { patch: { verticalAlign?: string } }).patch
				.verticalAlign,
		).toBe("middle");
	});
});

describe("Image alt text (§12 item 11)", () => {
	it("commits alt text on the image node", () => {
		const h = mount(imageIR(), ["img1"]);
		const input = screen.getByTestId("prop-image-alt") as HTMLInputElement;
		fireEvent.change(input, { target: { value: "A cat" } });
		fireEvent.blur(input);
		expect((h.commits[0] as { patch: { alt?: string } }).patch.alt).toBe(
			"A cat",
		);
	});
});

describe("Multi-kind sections (FR-070 gap closure — PRD 0012 §7.8)", () => {
	function twoRectVaryingRadiusIR(): CanvasIR {
		const ir = createCanvasIR({
			id: "ir-radius",
			pages: [createPage({ id: "p1" })],
			now: () => NOW,
		});
		const page = ir.pages[0];
		if (!page) throw new Error("no page");
		page.root.children = [
			createRect({
				id: "r1",
				bounds: { width: 50, height: 60 },
				fill: "#3366cc",
				radius: 4,
				now: () => NOW,
			}),
			createRect({
				id: "r2",
				bounds: { width: 50, height: 60 },
				fill: "#3366cc",
				radius: 10,
				now: () => NOW,
			}),
		];
		return ir;
	}

	it("a same-kind multi-selection renders the shared Fill/Stroke/CornerRadius section, with mixed indication for a differing field", () => {
		mount(twoRectVaryingRadiusIR(), ["r1", "r2"]);
		// Fill + Stroke + Radius (CornerRadius parent field) all render — the
		// SAME "Shape" section a single rect gets.
		expect(screen.getByTestId("prop-fill-type")).toBeTruthy();
		expect(screen.getByTestId("prop-stroke")).toBeTruthy();
		expect(screen.getByTestId("prop-radius")).toBeTruthy();
		expect(screen.getByTestId("prop-radius-tl")).toBeTruthy();
		// radius differs (4 vs 10) → mixed; fill is shared → concrete.
		expect(
			(screen.getByTestId("prop-radius") as HTMLInputElement).placeholder,
		).toBe("Mixed");
		expect(
			(screen.getByTestId("prop-fill") as HTMLInputElement).value,
		).toBeTruthy();
	});

	it("editing the shared radius field patches BOTH nodes in ONE batch", () => {
		const h = mount(twoRectVaryingRadiusIR(), ["r1", "r2"]);
		const radius = screen.getByTestId("prop-radius") as HTMLInputElement;
		fireEvent.change(radius, { target: { value: "16" } });
		fireEvent.blur(radius);
		expect(h.studioCtx.commitCoalesced).toHaveBeenCalledTimes(1);
		const [cmd] = (
			h.studioCtx.commitCoalesced as unknown as {
				mock: { calls: [unknown, string][] };
			}
		).mock.calls[0] ?? [null];
		expect(cmd).toMatchObject({
			type: "batch",
			commands: [
				{
					type: "node.update",
					nodeId: "r1",
					patch: { radius: 16, cornerRadii: undefined },
				},
				{
					type: "node.update",
					nodeId: "r2",
					patch: { radius: 16, cornerRadii: undefined },
				},
			],
		});
	});

	it("editing a per-corner radius across the selection preserves each node's OTHER corners", () => {
		const ir = twoRectVaryingRadiusIR();
		const r2 = ir.pages[0]?.root.children[1] as { cornerRadii?: unknown };
		r2.cornerRadii = { topLeft: 1, topRight: 2, bottomRight: 3, bottomLeft: 4 };
		const h = mount(ir, ["r1", "r2"]);
		const tl = screen.getByTestId("prop-radius-tl") as HTMLInputElement;
		fireEvent.change(tl, { target: { value: "9" } });
		fireEvent.blur(tl);
		const [cmd] = (
			h.studioCtx.commitCoalesced as unknown as {
				mock: {
					calls: [
						{
							commands?: { nodeId: string; patch: { cornerRadii: unknown } }[];
						},
						string,
					][];
				};
			}
		).mock.calls[0] ?? [null];
		const r1Cmd = cmd?.commands?.find((c) => c.nodeId === "r1");
		const r2Cmd = cmd?.commands?.find((c) => c.nodeId === "r2");
		// r1 had no cornerRadii — seeded from its uniform radius (4).
		expect(r1Cmd?.patch.cornerRadii).toEqual({
			topLeft: 9,
			topRight: 4,
			bottomRight: 4,
			bottomLeft: 4,
		});
		// r2 already had its own distinct corners — only topLeft changes.
		expect(r2Cmd?.patch.cornerRadii).toEqual({
			topLeft: 9,
			topRight: 2,
			bottomRight: 3,
			bottomLeft: 4,
		});
	});

	it("a mixed-kind selection still renders ONLY the shared sections, no kind-specific section", () => {
		const ir = createCanvasIR({
			id: "ir-mixed",
			pages: [createPage({ id: "p1" })],
			now: () => NOW,
		});
		const page = ir.pages[0];
		if (!page) throw new Error("no page");
		page.root.children = [
			createRect({
				id: "r1",
				bounds: { width: 50, height: 60 },
				now: () => NOW,
			}),
			createText({
				id: "t1",
				text: "hi",
				bounds: { width: 50, height: 20 },
				now: () => NOW,
			}),
		];
		mount(ir, ["r1", "t1"]);
		expect(screen.queryByTestId("prop-fill-type")).toBeNull();
		expect(screen.queryByTestId("prop-text")).toBeNull();
		// The shared sections still render.
		expect(screen.getByTestId("prop-opacity")).toBeTruthy();
	});
});

describe("Plain text native fields (FR-081 gap closure — PRD 0012 §7.8)", () => {
	function plainTextIR(
		over: Partial<{ fontWeight: string; align: CanvasTextAlign }> = {},
	): CanvasIR {
		const ir = createCanvasIR({
			id: "ir-text-native",
			pages: [createPage({ id: "p1" })],
			now: () => NOW,
		});
		const page = ir.pages[0];
		if (!page) throw new Error("no page");
		page.root.children = [
			createText({
				id: "text-a",
				text: "Hello",
				bounds: { width: 100, height: 20 },
				fill: "#111111",
				now: () => NOW,
				...over,
			}),
		];
		return ir;
	}

	it("exposes fontWeight, align, and shadow controls — the node's own missing native fields", () => {
		mount(plainTextIR({ fontWeight: "700", align: "center" }), ["text-a"]);
		const weight = screen.getByTestId("prop-font-weight") as HTMLInputElement;
		expect(weight.defaultValue).toBe("700");
		const align = screen.getByTestId("prop-text-align") as HTMLSelectElement;
		expect(align.value).toBe("center");
		// Shadow controls (shared FillAndShadowFields component) render, but its
		// own duplicate Fill-type picker does NOT — plain text keeps its single
		// dedicated Color field.
		expect(screen.getByTestId("prop-shadow-color")).toBeTruthy();
		expect(screen.queryByTestId("prop-fill-type")).toBeNull();
		// No rich-text-only fields leak onto plain text (PRD explicitly forbids).
		expect(screen.queryByTestId("prop-rich-text-letter-spacing")).toBeNull();
		expect(screen.queryByTestId("prop-rich-text-vertical-align")).toBeNull();
		expect(screen.queryByTestId("prop-rich-text-strikethrough")).toBeNull();
	});

	it("commits fontWeight via the field contract on blur", () => {
		const h = mount(plainTextIR(), ["text-a"]);
		const weight = screen.getByTestId("prop-font-weight") as HTMLInputElement;
		fireEvent.input(weight, { target: { value: "600" } });
		fireEvent.blur(weight);
		expect(h.commits).toHaveLength(1);
		expect(
			(h.commits[0] as { patch: { fontWeight?: string } }).patch.fontWeight,
		).toBe("600");
	});

	it("commits align via the field contract on change", () => {
		const h = mount(plainTextIR(), ["text-a"]);
		const align = screen.getByTestId("prop-text-align") as HTMLSelectElement;
		fireEvent.change(align, { target: { value: "right" } });
		expect(h.commits).toHaveLength(1);
		expect((h.commits[0] as { patch: { align?: string } }).patch.align).toBe(
			"right",
		);
	});

	it("commits a shadow color via the field contract, writing the effects model", () => {
		const h = mount(plainTextIR(), ["text-a"]);
		const shadow = screen.getByTestId("prop-shadow-color") as HTMLInputElement;
		fireEvent.change(shadow, { target: { value: "#00ff00" } });
		fireEvent.blur(shadow);
		expect(h.commits).toHaveLength(1);
		const patch = (
			h.commits[0] as {
				patch: { effects?: Array<{ type?: string; color?: string }> };
			}
		).patch;
		expect(patch.effects?.[0]).toMatchObject({
			type: "drop-shadow",
			color: "#00ff00",
		});
	});
});
