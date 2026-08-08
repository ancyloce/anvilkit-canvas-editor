import {
	type CanvasCommand,
	type CanvasIR,
	type CanvasNode,
	type CanvasRichTextNode,
	type CanvasTextNode,
	createCanvasIR,
	createPage,
	createRichText,
	createText,
} from "@anvilkit/canvas-core";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import { resolveFontCatalog } from "@/context/use-font-catalog.js";
import { createHistoryStore } from "@/stores/history-store.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import type { BrandKit } from "../../../brand/brand-kit.js";
import { DEFAULT_FONT_CATALOG } from "../../../text/default-font-catalog.js";
import { createFontCatalog } from "../../../text/font-catalog.js";
import {
	fontGroupLabels,
	fontTriggerText,
	openFontPicker,
	pickFont,
} from "../../__tests__/_font-picker-test-helpers.js";
import { PropertyInspector } from "../../PropertyInspector.js";

/**
 * @file `cp2-004` acceptance, driven through the REAL inspector so both call
 * sites are exercised where they actually live: `renderTextFields`
 * (`prop-font-family`) and `renderRichTextFields` (`prop-rich-text-font-family`).
 *
 * The four criteria, each asserted literally:
 *
 * 1. With no brand kit the Font row is a searchable catalog picker, not a text
 *    box — asserted on the element's own tag, not on a test id, because the
 *    `TextField` it replaced carried the SAME test id.
 * 2. With a brand kit the brand families come first and stay brand tokens.
 * 3. A document using an off-catalog family opens, shows that family, and can
 *    still be edited to another off-catalog family.
 * 4. A mixed selection reads "Mixed" instead of silently showing one node.
 *
 * Plus verification step 2: a change across a multi-node selection is ONE
 * command, replayed here through the real `historyStore` so "restores in one
 * step" is `undo()` returning with an empty `past`, not an inference.
 *
 * `"Georgia"`, `"Verdana"` and `"Comic Neue"` are deliberately NOT in the
 * 37-family default catalog — every off-catalog assertion below would pass
 * vacuously with a catalog family.
 */

afterEach(cleanup);

const FIXED_TS = "2026-05-20T00:00:00.000Z";

const BRAND_KIT: BrandKit = {
	colors: [],
	// "Acme Grotesk" is off-catalog (a real brand face); "Lora" IS a default
	// catalog family, so the two cover both halves of the brand-tier merge.
	fonts: ["Acme Grotesk", "Lora"],
};

function textIR(families: readonly string[]): CanvasIR {
	const ir = createCanvasIR({
		id: "ir-text",
		pages: [createPage({ id: "p1" })],
		now: () => FIXED_TS,
	});
	const page = ir.pages[0];
	if (!page) throw new Error("no page");
	page.root.children = families.map((fontFamily, index) =>
		createText({
			id: `t${index + 1}`,
			text: "Hello",
			fontFamily,
			bounds: { width: 100, height: 20 },
		}),
	);
	return ir;
}

function richTextIR(families: readonly string[]): CanvasIR {
	const ir = createCanvasIR({
		id: "ir-rich",
		pages: [createPage({ id: "p1" })],
		now: () => FIXED_TS,
	});
	const page = ir.pages[0];
	if (!page) throw new Error("no page");
	page.root.children = families.map((fontFamily, index) =>
		createRichText({
			id: `rt${index + 1}`,
			bounds: { width: 240, height: 60 },
			paragraphs: [
				{ spans: [{ text: "First", fontFamily }] },
				{ spans: [{ text: "Second", fontFamily }] },
			],
		}),
	);
	return ir;
}

function mount(ir: CanvasIR, selection: string[], brandKit?: BrandKit) {
	const h = makeHarness({ ir });
	if (brandKit) h.studioCtx.brandKit = brandKit;
	h.studioCtx.selectionStore.getState().setSelection(selection);
	render(
		<CanvasStudioContext.Provider value={h.studioCtx}>
			<PropertyInspector />
		</CanvasStudioContext.Provider>,
	);
	return h;
}

/** The single command the field committed (the §10 contract commits once). */
function committedCommand(h: ReturnType<typeof mount>): CanvasCommand {
	const commit = h.studioCtx.commit as unknown as {
		mock: { calls: [CanvasCommand][] };
	};
	expect(commit.mock.calls).toHaveLength(1);
	const cmd = commit.mock.calls[0]?.[0];
	if (!cmd) throw new Error("nothing was committed");
	return cmd;
}

function nodesOf(ir: CanvasIR): readonly CanvasNode[] {
	return ir.pages[0]?.root.children ?? [];
}

function textFamilies(ir: CanvasIR): unknown[] {
	return nodesOf(ir).map((n) => (n as CanvasTextNode).fontFamily);
}

function spanFamilies(ir: CanvasIR): unknown[] {
	return nodesOf(ir).flatMap((n) =>
		(n as CanvasRichTextNode).paragraphs.flatMap((p) =>
			p.spans.map((s) => s.fontFamily),
		),
	);
}

describe("cp2-004 — plain text Font row", () => {
	it("is a searchable catalog picker with no brand kit, not a text box", async () => {
		mount(textIR(["Georgia"]), ["t1"]);
		const trigger = screen.getByTestId("prop-font-family");
		// The `TextField` this replaced kept the same test id, so the tag is what
		// distinguishes "picker" from "text box".
		expect(trigger.tagName).toBe("BUTTON");
		expect(screen.queryByRole("textbox", { name: "Font" })).toBeNull();

		const popup = await openFontPicker("prop-font-family");
		expect(
			popup.querySelectorAll('[data-testid="prop-font-family-search"]'),
		).toHaveLength(1);
		expect(popup.querySelectorAll('[role="option"]')).toHaveLength(
			DEFAULT_FONT_CATALOG.entries.length,
		);
	});

	it("shows an off-catalog family and still commits another one", async () => {
		expect(DEFAULT_FONT_CATALOG.get("Georgia")).toBeUndefined();
		expect(DEFAULT_FONT_CATALOG.get("Comic Neue")).toBeUndefined();
		const h = mount(textIR(["Georgia"]), ["t1"]);
		expect(fontTriggerText("prop-font-family")).toBe("Georgia");

		await pickFont("prop-font-family", "Comic Neue");
		expect(committedCommand(h)).toMatchObject({
			type: "node.update",
			nodeId: "t1",
			patch: { fontFamily: "Comic Neue" },
		});
	});

	it("reads Mixed for a selection whose families differ", () => {
		mount(textIR(["Georgia", "Verdana"]), ["t1", "t2"]);
		expect(fontTriggerText("prop-font-family")).toBe("Mixed");
	});

	it("reads the shared family when every selected node agrees", () => {
		mount(textIR(["Georgia", "Georgia"]), ["t1", "t2"]);
		expect(fontTriggerText("prop-font-family")).toBe("Georgia");
	});

	it("commits a multi-node change as ONE undoable batch", async () => {
		const h = mount(textIR(["Georgia", "Verdana"]), ["t1", "t2"]);
		await pickFont("prop-font-family", "Comic Neue");
		const cmd = committedCommand(h);
		expect(cmd).toMatchObject({
			type: "batch",
			commands: [
				{
					type: "node.update",
					nodeId: "t1",
					patch: { fontFamily: "Comic Neue" },
				},
				{
					type: "node.update",
					nodeId: "t2",
					patch: { fontFamily: "Comic Neue" },
				},
			],
		});

		// Replayed through the real history store: one entry in, one undo back.
		// A per-node commit loop would push TWO entries and leave the second node
		// changed after a single undo.
		const history = createHistoryStore();
		const applied = history.getState().commit(h.ir, cmd);
		expect(textFamilies(applied)).toEqual(["Comic Neue", "Comic Neue"]);
		expect(history.getState().past).toHaveLength(1);
		const restored = history.getState().undo(applied);
		expect(textFamilies(restored)).toEqual(["Georgia", "Verdana"]);
		expect(history.getState().canUndo()).toBe(false);
	});
});

describe("cp2-004 — rich-text span Font row", () => {
	it("is the same catalog picker (the second call site)", async () => {
		mount(richTextIR(["Georgia"]), ["rt1"]);
		expect(screen.getByTestId("prop-rich-text-font-family").tagName).toBe(
			"BUTTON",
		);
		const popup = await openFontPicker("prop-rich-text-font-family");
		expect(popup.querySelectorAll('[role="option"]')).toHaveLength(
			DEFAULT_FONT_CATALOG.entries.length,
		);
	});

	it("reads Mixed when the selected nodes' spans disagree", () => {
		mount(richTextIR(["Georgia", "Verdana"]), ["rt1", "rt2"]);
		expect(fontTriggerText("prop-rich-text-font-family")).toBe("Mixed");
	});

	it("commits every span of every node as ONE undoable batch", async () => {
		const h = mount(richTextIR(["Georgia", "Verdana"]), ["rt1", "rt2"]);
		await pickFont("prop-rich-text-font-family", "Comic Neue");
		const cmd = committedCommand(h);
		expect(cmd).toMatchObject({ type: "batch" });
		expect((cmd as { commands: unknown[] }).commands).toHaveLength(2);

		const history = createHistoryStore();
		const applied = history.getState().commit(h.ir, cmd);
		// Two nodes × two paragraphs × one span: every span, not just the first.
		expect(spanFamilies(applied)).toEqual([
			"Comic Neue",
			"Comic Neue",
			"Comic Neue",
			"Comic Neue",
		]);
		expect(history.getState().past).toHaveLength(1);
		const restored = history.getState().undo(applied);
		expect(spanFamilies(restored)).toEqual([
			"Georgia",
			"Georgia",
			"Verdana",
			"Verdana",
		]);
		expect(history.getState().canUndo()).toBe(false);
	});
});

describe("cp2-004 — brand kit present", () => {
	it("pins the brand families first, above the catalog", async () => {
		const popup = await (async () => {
			mount(textIR(["Georgia"]), ["t1"], BRAND_KIT);
			return openFontPicker("prop-font-family");
		})();
		expect(fontGroupLabels(popup)).toEqual(["Brand", "All fonts"]);
		const options = Array.from(
			popup.querySelectorAll<HTMLElement>('[role="option"]'),
		).map((option) => option.textContent);
		expect(options.slice(0, 2)).toEqual(["Acme Grotesk", "Lora"]);
		// Pinning MOVES a family; it never duplicates it.
		expect(options.filter((label) => label === "Lora")).toHaveLength(1);
		expect(options).toHaveLength(DEFAULT_FONT_CATALOG.entries.length + 1);
	});

	it("commits a brand family as a brand TOKEN, not a flattened literal", async () => {
		const h = mount(textIR(["Georgia"]), ["t1"], BRAND_KIT);
		await pickFont("prop-font-family", "Acme Grotesk");
		expect(committedCommand(h)).toMatchObject({
			type: "node.update",
			nodeId: "t1",
			patch: {
				fontFamily: {
					type: "brand-token",
					tokenType: "font",
					id: "acme-grotesk",
				},
			},
		});
	});

	it("keeps a token-backed value rendering as a token, not as a string", () => {
		const ir = textIR(["Georgia"]);
		const node = nodesOf(ir)[0] as CanvasTextNode;
		node.fontFamily = {
			type: "brand-token",
			tokenType: "font",
			id: "acme-grotesk",
		};
		mount(ir, ["t1"], BRAND_KIT);
		// The token branch (a brand-token Select), NOT the picker: a token value
		// must never be flattened to its resolved literal by merely being shown.
		const trigger = screen.getByTestId("prop-font-family");
		expect(trigger.textContent).toContain("Acme Grotesk");
		expect(screen.getByTestId("prop-font-family-detach")).toBeDefined();
		expect(screen.queryByTestId("prop-font-family-search")).toBeNull();
	});

	it("still offers free text for a family neither the catalog nor the kit has", async () => {
		const h = mount(textIR(["Georgia"]), ["t1"], BRAND_KIT);
		await pickFont("prop-font-family", "Comic Neue");
		expect(committedCommand(h)).toMatchObject({
			patch: { fontFamily: "Comic Neue" },
		});
	});
});

describe("cp2-004 — host catalog reaches the picker", () => {
	/**
	 * The other half of `cp2-007`'s seam: the studio resolves
	 * `<CanvasStudio fontCatalog>` into `ctx.fontCatalog` ONCE, and the Font row
	 * must offer that resolution rather than the bare defaults. Without this the
	 * host prop would reach the export manifest and nothing else.
	 */
	it("offers the host's families from the studio's resolved catalog", async () => {
		const h = makeHarness({ ir: textIR(["Georgia"]) });
		h.studioCtx.fontCatalog = resolveFontCatalog(
			createFontCatalog([
				{
					family: "Acme Host Sans",
					category: "sans",
					weights: [400],
					source: { kind: "files", files: [] },
					license: "LicenseRef-acme",
				},
			]),
		);
		h.studioCtx.selectionStore.getState().setSelection(["t1"]);
		render(
			<CanvasStudioContext.Provider value={h.studioCtx}>
				<PropertyInspector />
			</CanvasStudioContext.Provider>,
		);
		const popup = await openFontPicker("prop-font-family");
		const options = Array.from(
			popup.querySelectorAll<HTMLElement>('[role="option"]'),
		).map((option) => option.textContent);
		expect(options).toHaveLength(DEFAULT_FONT_CATALOG.entries.length + 1);
		// Host tier outranks default, so it sorts ahead of every default family.
		expect(options[0]).toBe("Acme Host Sans");
	});
});
