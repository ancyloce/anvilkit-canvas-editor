import {
	type CanvasIR,
	type CanvasNodeUpdateCommand,
	type CanvasRichTextNode,
	createCanvasIR,
	createGroup,
	createImage,
	createPage,
	createRect,
	createRichText,
	createText,
	findNode,
} from "@anvilkit/canvas-core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	CanvasStudioContext,
	type CanvasStudioContextValue,
} from "@/context/canvas-studio-context.js";
import { makeHarness, type TestHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import { CanvasToolbar } from "../CanvasToolbar.js";

afterEach(cleanup);

const FIXED_TS = "2026-05-20T00:00:00.000Z";

/**
 * Page p1 with one of every FR-180 toolbar-relevant kind:
 *   r1 / r2 — rects with DIFFERENT fills + strokeWidths (mixed-value cases)
 *   lr1     — a locked rect (locked-gating cases)
 *   t1 / t2 — plain text nodes with DIFFERENT font sizes
 *   rt1     — a rich-text node (2 paragraphs, 2+1 spans)
 *   i1      — an image
 */
function fixtureIR(): CanvasIR {
	const page = createPage({ id: "p1" });
	page.root = createGroup({
		id: "p1-root",
		bounds: page.root.bounds,
		children: [
			createRect({
				id: "r1",
				bounds: { width: 50, height: 50 },
				fill: "#ff0000",
				stroke: "#111111",
				strokeWidth: 2,
			}),
			createRect({
				id: "r2",
				bounds: { width: 50, height: 50 },
				fill: "#00ff00",
				stroke: "#111111",
				strokeWidth: 5,
			}),
			{
				...createRect({
					id: "lr1",
					bounds: { width: 10, height: 10 },
					fill: "#0000ff",
				}),
				locked: true,
			},
			createText({
				id: "t1",
				bounds: { width: 100, height: 20 },
				text: "Hello",
				fontSize: 16,
			}),
			createText({
				id: "t2",
				bounds: { width: 100, height: 20 },
				text: "World",
				fontSize: 24,
			}),
			createRichText({
				id: "rt1",
				bounds: { width: 100, height: 40 },
				paragraphs: [
					{ spans: [{ text: "Rich" }, { text: "Text" }] },
					{ spans: [{ text: "Two" }] },
				],
			}),
			createImage({
				id: "i1",
				bounds: { width: 40, height: 40 },
				assetId: "asset-0",
			}),
		],
	});
	return createCanvasIR({ id: "ir", pages: [page], now: () => FIXED_TS });
}

function setup(
	selected: readonly string[],
	mutate?: (ctx: CanvasStudioContextValue) => void,
): { h: TestHarness } {
	const h = makeHarness({ ir: fixtureIR() });
	h.studioCtx.selectionStore.getState().setSelection([...selected]);
	mutate?.(h.studioCtx);
	render(
		<CanvasStudioContext.Provider value={h.studioCtx}>
			<CanvasToolbar />
		</CanvasStudioContext.Provider>,
	);
	return { h };
}

/** change + blur = one completed §10 field interaction. */
function commitInput(testId: string, value: string): HTMLInputElement {
	const input = screen.getByTestId(testId) as HTMLInputElement;
	fireEvent.change(input, { target: { value } });
	fireEvent.blur(input);
	return input;
}

describe("CanvasToolbar — single shape through the field contract", () => {
	it("commits a fill change as ONE coalesced entry", () => {
		const { h } = setup(["r1"]);
		commitInput("toolbar-fill", "#123456");
		expect(h.studioCtx.commitCoalesced).toHaveBeenCalledTimes(1);
		expect(h.studioCtx.commit).not.toHaveBeenCalled();
		expect(h.studioCtx.commitBatch).not.toHaveBeenCalled();
		expect(h.commits).toEqual([
			{
				type: "node.update",
				nodeId: "r1",
				kind: "rect",
				patch: { fill: "#123456" },
			},
		]);
	});

	it("commits stroke + width + opacity, one coalesced entry each", () => {
		const { h } = setup(["r1"]);
		commitInput("toolbar-stroke", "#654321");
		commitInput("toolbar-stroke-width", "4");
		commitInput("toolbar-opacity", "0.5");
		expect(h.studioCtx.commitCoalesced).toHaveBeenCalledTimes(3);
		expect(
			h.commits.map((c) => (c as CanvasNodeUpdateCommand<"rect">).patch),
		).toEqual([{ stroke: "#654321" }, { strokeWidth: 4 }, { opacity: 0.5 }]);
	});

	it("an unchanged blur commits nothing", () => {
		const { h } = setup(["r1"]);
		const input = screen.getByTestId("toolbar-fill") as HTMLInputElement;
		fireEvent.blur(input);
		expect(h.commits).toHaveLength(0);
	});
});

describe("CanvasToolbar — multi-selection mixed values", () => {
	it("flags mixed fill on the swatch and mixed width as a placeholder", () => {
		setup(["r1", "r2"]);
		expect(screen.getByTestId("toolbar-fill")).toHaveAttribute(
			"data-mixed",
			"true",
		);
		// Strokes match → not mixed.
		expect(screen.getByTestId("toolbar-stroke")).not.toHaveAttribute(
			"data-mixed",
		);
		const width = screen.getByTestId("toolbar-stroke-width") as HTMLInputElement;
		expect(width.value).toBe("");
		expect(width.placeholder).toBe("Mixed");
	});

	it("commits a mixed-fill change to EVERY node as one batch", () => {
		const { h } = setup(["r1", "r2"]);
		commitInput("toolbar-fill", "#abcdef");
		expect(h.studioCtx.commitCoalesced).toHaveBeenCalledTimes(1);
		const cmd = h.commits[0] as {
			type: string;
			commands: CanvasNodeUpdateCommand<"rect">[];
		};
		expect(cmd.type).toBe("batch");
		expect(cmd.commands.map((c) => c.nodeId)).toEqual(["r1", "r2"]);
		expect(cmd.commands.every((c) => c.patch.fill === "#abcdef")).toBe(true);
	});

	it("typing into a mixed number field unifies the selection in one batch", () => {
		const { h } = setup(["r1", "r2"]);
		commitInput("toolbar-stroke-width", "3");
		expect(h.studioCtx.commitCoalesced).toHaveBeenCalledTimes(1);
		const cmd = h.commits[0] as {
			type: string;
			commands: CanvasNodeUpdateCommand<"rect">[];
		};
		expect(cmd.type).toBe("batch");
		expect(cmd.commands.every((c) => c.patch.strokeWidth === 3)).toBe(true);
	});
});

describe("CanvasToolbar — text selection typography (FR-180)", () => {
	it("shows the typography controls and hides the generic fill swatch", () => {
		setup(["t1", "t2"]);
		expect(screen.getByTestId("toolbar-font-family")).toBeInTheDocument();
		expect(screen.getByTestId("toolbar-bold")).toBeInTheDocument();
		expect(screen.getByTestId("toolbar-align")).toBeInTheDocument();
		expect(screen.getByTestId("toolbar-text-color")).toBeInTheDocument();
		expect(screen.queryByTestId("toolbar-fill")).toBeNull();
		// t1@16 vs t2@24 → mixed size placeholder.
		const size = screen.getByTestId("toolbar-font-size") as HTMLInputElement;
		expect(size.placeholder).toBe("Mixed");
	});

	it("commits a font-family pick to both nodes as one batch", () => {
		const { h } = setup(["t1", "t2"]);
		fireEvent.change(screen.getByTestId("toolbar-font-family"), {
			target: { value: "Georgia" },
		});
		expect(h.studioCtx.commitCoalesced).toHaveBeenCalledTimes(1);
		const cmd = h.commits[0] as {
			type: string;
			commands: CanvasNodeUpdateCommand<"text">[];
		};
		expect(cmd.type).toBe("batch");
		expect(cmd.commands.map((c) => c.patch)).toEqual([
			{ fontFamily: "Georgia" },
			{ fontFamily: "Georgia" },
		]);
	});

	it("bold toggle commits weight 700 across the selection", () => {
		const { h } = setup(["t1", "t2"]);
		const bold = screen.getByTestId("toolbar-bold");
		expect(bold).toHaveAttribute("aria-pressed", "false");
		fireEvent.click(bold);
		expect(h.studioCtx.commitCoalesced).toHaveBeenCalledTimes(1);
		const cmd = h.commits[0] as {
			commands: CanvasNodeUpdateCommand<"text">[];
		};
		expect(cmd.commands.every((c) => c.patch.fontWeight === "700")).toBe(true);
	});

	it("align cycles left → center through the contract", () => {
		const { h } = setup(["t1"]);
		fireEvent.click(screen.getByTestId("toolbar-align"));
		expect(h.commits).toEqual([
			{
				type: "node.update",
				nodeId: "t1",
				kind: "text",
				patch: { align: "center" },
			},
		]);
	});

	it("text color commits through the contract", () => {
		const { h } = setup(["t1"]);
		commitInput("toolbar-text-color", "#ff00ff");
		expect(h.commits).toEqual([
			{
				type: "node.update",
				nodeId: "t1",
				kind: "text",
				patch: { fill: "#ff00ff" },
			},
		]);
	});
});

describe("CanvasToolbar — rich-text selection typography (FR-180)", () => {
	it("bold rewrites ONLY fontWeight on every span, structure preserved", () => {
		const { h } = setup(["rt1"]);
		fireEvent.click(screen.getByTestId("toolbar-bold"));
		expect(h.studioCtx.commitCoalesced).toHaveBeenCalledTimes(1);
		const cmd = h.commits[0] as CanvasNodeUpdateCommand<"rich-text">;
		expect(cmd).toMatchObject({ type: "node.update", nodeId: "rt1" });
		const paragraphs = (cmd.patch as CanvasRichTextNode).paragraphs;
		expect(paragraphs.map((p) => p.spans.length)).toEqual([2, 1]);
		expect(
			paragraphs.every((p) => p.spans.every((s) => s.fontWeight === "700")),
		).toBe(true);
		expect(paragraphs[0]?.spans.map((s) => s.text)).toEqual(["Rich", "Text"]);
	});

	it("align patches every paragraph", () => {
		const { h } = setup(["rt1"]);
		fireEvent.click(screen.getByTestId("toolbar-align"));
		const cmd = h.commits[0] as CanvasNodeUpdateCommand<"rich-text">;
		const paragraphs = (cmd.patch as CanvasRichTextNode).paragraphs;
		expect(paragraphs.every((p) => p.align === "center")).toBe(true);
	});
});

describe("CanvasToolbar — single image (FR-180)", () => {
	it("shows crop / replace / fit and begins a crop session", () => {
		const { h } = setup(["i1"]);
		fireEvent.click(screen.getByTestId("toolbar-image-crop"));
		expect(h.studioCtx.cropStore.getState().cropNodeId).toBe("i1");
	});

	it("replace picks an asset and commits image.replace", async () => {
		const { h } = setup(["i1"]);
		fireEvent.click(screen.getByTestId("toolbar-image-replace"));
		await vi.waitFor(() => {
			expect(h.commits).toEqual([
				{
					type: "image.replace",
					nodeId: "i1",
					fromAssetId: "asset-0",
					toAssetId: "asset-1",
				},
			]);
		});
		expect(h.studioCtx.pickAsset).toHaveBeenCalledTimes(1);
	});

	it("replace is disabled when the host wires no picker (FR-011 gate)", () => {
		setup(["i1"], (ctx) => {
			ctx.hasImagePicker = false;
		});
		expect(screen.getByTestId("toolbar-image-replace")).toBeDisabled();
		expect(screen.getByTestId("toolbar-image-crop")).not.toBeDisabled();
	});

	it("fit mode commits through the contract", () => {
		const { h } = setup(["i1"]);
		const select = screen.getByTestId("toolbar-fit-mode") as HTMLSelectElement;
		expect(select.value).toBe("stretch");
		fireEvent.change(select, { target: { value: "fill" } });
		expect(h.studioCtx.commitCoalesced).toHaveBeenCalledTimes(1);
		expect(h.commits).toEqual([
			{
				type: "node.update",
				nodeId: "i1",
				kind: "image",
				patch: { fitMode: "fill" },
			},
		]);
	});

	it("a mixed-kind selection hides the image section", () => {
		setup(["i1", "r1"]);
		expect(screen.queryByTestId("toolbar-image-crop")).toBeNull();
		expect(screen.queryByTestId("toolbar-fit-mode")).toBeNull();
	});
});

describe("CanvasToolbar — locked gating (FR-024)", () => {
	it("an all-locked selection renders every field disabled and commits nothing", () => {
		const { h } = setup(["lr1"]);
		const fill = screen.getByTestId("toolbar-fill") as HTMLInputElement;
		const opacity = screen.getByTestId("toolbar-opacity") as HTMLInputElement;
		expect(fill).toBeDisabled();
		expect(fill).toHaveAttribute("aria-disabled", "true");
		expect(opacity).toBeDisabled();
		expect(opacity).toHaveAttribute("aria-disabled", "true");
		commitInput("toolbar-fill", "#999999");
		commitInput("toolbar-opacity", "0.1");
		expect(h.commits).toHaveLength(0);
	});

	it("a mixed locked/unlocked selection stays editable", () => {
		setup(["r1", "lr1"]);
		expect(screen.getByTestId("toolbar-fill")).not.toBeDisabled();
	});
});

describe("CanvasToolbar — hidden during inline editing (FR-180)", () => {
	it("renders null while a node is being edited in place", () => {
		const { h } = setup(["t1"]);
		expect(screen.getByTestId("canvas-toolbar")).toBeInTheDocument();
		act(() => h.studioCtx.editingStore.getState().setEditing("t1"));
		expect(screen.queryByTestId("canvas-toolbar")).toBeNull();
		act(() => h.studioCtx.editingStore.getState().clearEditing());
		expect(screen.getByTestId("canvas-toolbar")).toBeInTheDocument();
	});
});

describe("CanvasToolbar — undo/redo over the REAL history store", () => {
	it("a toolbar-driven opacity change undoes and redoes", () => {
		const h = makeHarness({ ir: fixtureIR() });
		const history = h.studioCtx.historyStore;
		// Wire the §10 commit half through the real history store so undo/redo
		// replay inverses (same pattern as clipboard-flow.integration.test.ts).
		h.studioCtx.commitCoalesced = (cmd, mergeKey) => {
			const next = history
				.getState()
				.commitCoalesced(h.studioCtx.getIR(), cmd, mergeKey);
			h.setIR(next);
			return next;
		};
		h.studioCtx.selectionStore.getState().setSelection(["r1"]);
		render(
			<CanvasStudioContext.Provider value={h.studioCtx}>
				<CanvasToolbar />
			</CanvasStudioContext.Provider>,
		);

		commitInput("toolbar-opacity", "0.3");
		const opacityOf = () => {
			const found = findNode(h.studioCtx.getIR(), "r1");
			if (!found) throw new Error("r1 missing");
			return (found.node as { opacity?: number }).opacity;
		};
		expect(opacityOf()).toBe(0.3);

		h.setIR(history.getState().undo(h.studioCtx.getIR()));
		expect(opacityOf()).toBeUndefined();

		h.setIR(history.getState().redo(h.studioCtx.getIR()));
		expect(opacityOf()).toBe(0.3);
	});
});
