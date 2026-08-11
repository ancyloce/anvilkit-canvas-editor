import type {
	CanvasIR,
	CanvasNode,
	CanvasNodeKind,
	CanvasNodeUpdateCommand,
} from "@anvilkit/canvas-core";
import { createCanvasIR, createPage } from "@anvilkit/canvas-core";
import { cleanup, render } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
	CanvasStudioContext,
	type CanvasStudioContextValue,
} from "@/context/canvas-studio-context.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import type { BrandKit } from "../../brand/brand-kit.js";
import { DEFAULT_ELEMENTS } from "../../elements/default-element-catalog.js";
import type { CanvasElementEntry } from "../../elements/element-entry.js";
import { PropertyInspector } from "../PropertyInspector.js";
import { colorRowText, setColor } from "./_color-test-helpers.js";
import { selectedLabel } from "./_select-test-helpers.js";

/**
 * `cp3-005` — an inserted catalog element recolours through the inspector the
 * editor already has, not through one built for it.
 *
 * `element-recolour.test.ts` proves the DATA half catalog-wide: a fill or
 * stroke mutation reaches every paint site of all 425 entries. That is only
 * half a deliverable — an entry can be perfectly recolourable and still expose
 * no control, and the constants that file uses to decide which kinds paint
 * (`FILL_BEARING_KINDS` / `STROKE_BEARING_KINDS`) are its own opinion until
 * something checks them against the product. This file is that something: it
 * renders the REAL `PropertyInspector` over nodes built by REAL catalog
 * entries, one per root kind the catalog produces, and reads the controls off
 * the DOM.
 *
 * The representatives are derived from the catalog rather than listed, so a
 * ninth root kind cannot appear without landing here.
 */

const FIXED_TS = "2026-05-20T00:00:00.000Z";

afterEach(cleanup);

/** First catalog entry per root node kind — derived, never hand-listed. */
const REPRESENTATIVES: ReadonlyArray<[CanvasNode["type"], CanvasElementEntry]> =
	(() => {
		const seen = new Map<CanvasNode["type"], CanvasElementEntry>();
		for (const entry of DEFAULT_ELEMENTS) {
			const kind = entry.build().type;
			if (!seen.has(kind)) seen.set(kind, entry);
		}
		return [...seen].sort(([a], [b]) => a.localeCompare(b));
	})();

function entryById(id: string): CanvasElementEntry {
	const entry = DEFAULT_ELEMENTS.find((e) => e.id === id);
	if (!entry) throw new Error(`no catalog entry "${id}"`);
	return entry;
}

/** A one-page document holding exactly the node an entry builds. */
function irWith(node: CanvasNode): CanvasIR {
	const ir = createCanvasIR({
		id: "ir-1",
		pages: [createPage({ id: "p1" })],
		now: () => FIXED_TS,
	});
	const page = ir.pages[0];
	if (!page) throw new Error("expected a page");
	page.root.children = [node];
	return ir;
}

function mount(ctx: CanvasStudioContextValue) {
	return render(
		<CanvasStudioContext.Provider value={ctx}>
			<PropertyInspector />
		</CanvasStudioContext.Provider>,
	);
}

/** Build `entry`, select it, and render the inspector over it. */
function inspect(
	entry: CanvasElementEntry,
	context: Parameters<CanvasElementEntry["build"]>[0] = {},
) {
	let n = 0;
	const node = entry.build({
		newId: () => `${entry.id}${n++ === 0 ? "" : `-part-${n - 1}`}`,
		...context,
	});
	const h = makeHarness({ ir: irWith(node) });
	return { h, node };
}

function has(container: HTMLElement, testId: string): boolean {
	return container.querySelector(`[data-testid='${testId}']`) !== null;
}

const BRAND_KIT: BrandKit = {
	colors: [{ id: "brand.primary", name: "Primary", value: "#7c3aed" }],
	fonts: [],
};

describe("inserted elements — the standard fill control (cp3-005)", () => {
	/**
	 * DELIVERABLE 1, over every root kind the catalog can produce. A `"fill"`
	 * entry must land on a section that renders the shared `FillAndShadowFields`
	 * block; a `"stroke"` entry must land on one that renders the shared
	 * `StrokeFields` block. Nothing here is a control this task added.
	 */
	it.each(REPRESENTATIVES)(
		"a %s-rooted entry gets the shared control its recolour declares",
		(kind, entry) => {
			const { h, node } = inspect(entry);
			h.studioCtx.selectionStore.getState().setSelection([node.id]);
			const { container } = mount(h.studioCtx);

			if (entry.recolor === "fill") {
				expect(has(container, "prop-fill-type"), `${entry.id} fill type`).toBe(
					true,
				);
				// Every "fill" entry builds with a solid default, so the picker — not
				// just the type selector — is on screen without any further action.
				expect(has(container, "prop-fill"), `${entry.id} fill picker`).toBe(
					true,
				);
			}
			if (entry.recolor === "stroke") {
				expect(has(container, "prop-stroke"), `${entry.id} stroke`).toBe(true);
				expect(has(container, "prop-stroke-width"), `${entry.id} width`).toBe(
					true,
				);
			}
			if (entry.recolor === "multi") {
				// DELIVERABLE 4: no single control, so no way to half-recolour.
				expect(has(container, "prop-fill-type"), `${entry.id} fill type`).toBe(
					false,
				);
				expect(has(container, "prop-fill"), `${entry.id} fill`).toBe(false);
				expect(has(container, "prop-stroke"), `${entry.id} stroke`).toBe(false);
			}
			expect(kind).toBe(node.type);
		},
	);

	/**
	 * The catalog builds eight kinds and this file covers all eight. Without
	 * this the `it.each` above silently shrinks whenever the catalog does.
	 */
	it("covers every root kind the catalog builds", () => {
		expect(REPRESENTATIVES.map(([kind]) => kind)).toEqual([
			"ellipse",
			"frame",
			"group",
			"line",
			"path",
			"polygon",
			"rect",
			"star",
		]);
	});

	/**
	 * A stroke-based icon carries NO fill (`catalog-builders.ts:234-277`
	 * deliberately omits one — an outline icon with a fill is a filled blob), so
	 * the shared fill section reads "None" rather than showing a black swatch
	 * the user did not choose. That is the standard no-fill state (FR-074), not
	 * an element-specific one, and it is what makes "add a fill to this outline
	 * icon" one click rather than an impossibility.
	 */
	it("shows a stroke icon as unfilled, with the standard no-fill state", () => {
		const entry = entryById("icon-check-outline");
		const { h, node } = inspect(entry);
		h.studioCtx.selectionStore.getState().setSelection([node.id]);
		const { container } = mount(h.studioCtx);
		expect(selectedLabel("prop-fill-type", container)).toBe("None");
		expect(has(container, "prop-fill")).toBe(false);
		expect(colorRowText("prop-stroke", container)).toContain("#0f172a");
	});
});

describe("inserted elements — recolouring commits (cp3-005)", () => {
	/**
	 * ACCEPTANCE CRITERION 1, canvas half: changing the fill really changes the
	 * document. (The export half is `element-recolour.test.ts`'s golden.) The
	 * gesture is the real one the colour helpers document — open, type, blur,
	 * dismiss — not a synthetic call to a handler.
	 */
	it("changing the fill of an inserted icon patches its fill", async () => {
		const entry = entryById("icon-heart-solid");
		const { h, node } = inspect(entry);
		h.studioCtx.selectionStore.getState().setSelection([node.id]);
		mount(h.studioCtx);

		await setColor("prop-fill", "#123456");

		const last = h.commits.at(-1) as CanvasNodeUpdateCommand<CanvasNodeKind>;
		expect(last.type).toBe("node.update");
		expect(last.nodeId).toBe(node.id);
		expect((last.patch as { fill?: unknown }).fill).toBe("#123456");
	});

	/** DELIVERABLE 5, as a commit rather than as a rendered control. */
	it("changing the stroke of an inserted outline icon patches its stroke", async () => {
		const entry = entryById("icon-check-outline");
		const { h, node } = inspect(entry);
		h.studioCtx.selectionStore.getState().setSelection([node.id]);
		mount(h.studioCtx);

		await setColor("prop-stroke", "#dc2626");

		const last = h.commits.at(-1) as CanvasNodeUpdateCommand<CanvasNodeKind>;
		expect(last.type).toBe("node.update");
		expect(last.nodeId).toBe(node.id);
		expect((last.patch as { stroke?: unknown }).stroke).toBe("#dc2626");
	});

	/**
	 * A `frame` entry answers on `background`, not `fill` — `FillAndShadowFields`
	 * takes that through its existing `fillKey` seam, so the frame section is the
	 * standard control too, writing the field the frame actually paints from.
	 */
	it("changing an inserted frame's fill patches its background", async () => {
		const entry = DEFAULT_ELEMENTS.find((e) => e.build().type === "frame");
		if (!entry) throw new Error("expected a frame entry");
		const { h, node } = inspect(entry);
		h.studioCtx.selectionStore.getState().setSelection([node.id]);
		mount(h.studioCtx);

		await setColor("prop-fill", "#123456");

		const last = h.commits.at(-1) as CanvasNodeUpdateCommand<CanvasNodeKind>;
		const patch = last.patch as { background?: unknown; fill?: unknown };
		expect(patch.background).toBe("#123456");
		expect(patch.fill).toBeUndefined();
	});
});

describe("inserted elements — brand-token fills (cp3-005)", () => {
	/**
	 * DELIVERABLE 2 / ACCEPTANCE CRITERION 2. `CanvasFill` is
	 * `string | CanvasGradientFill | BrandTokenRef` (`core/src/ir/types.ts:221` —
	 * the task text's `:222` is off by one, as `cp3-001` also found), and
	 * `CanvasElementBuildContext.fill` takes the whole union. So an inserted icon
	 * is brand-token-aware from the first frame, without a trip through the
	 * inspector to attach one.
	 */
	it("an inserted icon built with a brand token resolves in the inspector", () => {
		const entry = entryById("icon-heart-solid");
		const { h, node } = inspect(entry, {
			fill: { type: "brand-token", tokenType: "color", id: "brand.primary" },
		});
		h.studioCtx.brandKit = BRAND_KIT;
		h.studioCtx.selectionStore.getState().setSelection([node.id]);
		const { container } = mount(h.studioCtx);

		// The token branch of the existing `TokenAwareColorField`: a Select
		// naming the brand colour, not a literal swatch.
		expect(
			container.querySelector("[data-testid='prop-fill']")?.textContent,
		).toContain("Primary");
		expect(has(container, "prop-token-unresolved-badge")).toBe(false);
		expect(has(container, "prop-fill-detach")).toBe(true);
	});

	/** …and the unresolved DISPLAY path, which is the half that usually rots. */
	it("an unresolved token on an inserted icon shows the existing unresolved state", () => {
		const entry = entryById("icon-heart-solid");
		const { h, node } = inspect(entry, {
			fill: { type: "brand-token", tokenType: "color", id: "brand.missing" },
		});
		h.studioCtx.brandKit = BRAND_KIT;
		h.studioCtx.selectionStore.getState().setSelection([node.id]);
		const { container } = mount(h.studioCtx);

		expect(has(container, "prop-token-unresolved-badge")).toBe(true);
	});

	/**
	 * The token is what the DOCUMENT holds — it must not be flattened to the
	 * literal on the way in, or the icon stops tracking the brand kit the moment
	 * it is inserted.
	 */
	it("keeps the token in the node rather than resolving it at build time", () => {
		const entry = entryById("icon-heart-solid");
		const token = {
			type: "brand-token",
			tokenType: "color",
			id: "brand.primary",
		} as const;
		const node = entry.build({ fill: token });
		expect((node as { fill?: unknown }).fill).toEqual(token);
	});

	/** Attaching a token to an already-inserted icon uses the existing action. */
	it("attaches a brand token to an inserted icon through the existing action", () => {
		const entry = entryById("icon-heart-solid");
		const { h, node } = inspect(entry);
		h.studioCtx.brandKit = BRAND_KIT;
		h.studioCtx.selectionStore.getState().setSelection([node.id]);
		const { container } = mount(h.studioCtx);

		const useToken = container.querySelector(
			"[data-testid='prop-fill-use-token']",
		);
		expect(useToken).not.toBeNull();
		(useToken as HTMLElement).click();

		const last = h.commits.at(-1) as CanvasNodeUpdateCommand<CanvasNodeKind>;
		expect((last.patch as { fill?: unknown }).fill).toEqual({
			type: "brand-token",
			tokenType: "color",
			id: "brand.primary",
		});
	});
});

describe("multi-colour stickers — the per-part contract (cp3-005)", () => {
	const sticker = entryById("sticker-sale-badge");

	/**
	 * DELIVERABLE 4, stated by the product rather than only by the data. Before
	 * this, selecting a sticker showed "Children: 3" and nothing else — an
	 * absence a user reads as a missing feature. The note names the mechanism.
	 */
	it("declares the per-part contract instead of leaving a colourless section", () => {
		const { h, node } = inspect(sticker);
		h.studioCtx.selectionStore.getState().setSelection([node.id]);
		const { container } = mount(h.studioCtx);

		const note = container.querySelector(
			"[data-testid='prop-group-part-colors']",
		);
		expect(note).not.toBeNull();
		expect(note?.getAttribute("role")).toBe("note");
		expect(note?.textContent).toContain("Select a part");
	});

	/**
	 * And the mechanism works: selecting ONE part gives the standard control for
	 * that part's own kind, and the commit names that part alone. Nothing else in
	 * the sticker moves — which is the difference between "per-part recolouring"
	 * and "half-recolouring".
	 */
	it("recolours exactly the selected part, and nothing else", async () => {
		const { h, node } = inspect(sticker);
		const parts = (node as { children: CanvasNode[] }).children;
		expect(parts.length).toBeGreaterThan(1);
		const target = parts[1] as CanvasNode;
		const others = parts.filter((p) => p.id !== target.id);

		h.studioCtx.selectionStore.getState().setSelection([target.id]);
		mount(h.studioCtx);

		await setColor("prop-fill", "#123456");

		const commits = h.commits as Array<CanvasNodeUpdateCommand<CanvasNodeKind>>;
		expect(commits).toHaveLength(1);
		const only = commits[0] as CanvasNodeUpdateCommand<CanvasNodeKind>;
		expect(only.nodeId).toBe(target.id);
		expect((only.patch as { fill?: unknown }).fill).toBe("#123456");
		for (const other of others) {
			expect(commits.some((c) => c.nodeId === other.id)).toBe(false);
		}
	});

	/**
	 * The group node itself has nowhere to hold a colour, so the absence of a
	 * fill control above is a fact of the IR rather than a choice this section
	 * made. Asserted directly so a future `CanvasGroupNode.fill` cannot land
	 * without this test noticing that the stickers just became half-recolourable.
	 */
	it("builds a group with no paint field of its own", () => {
		const node = sticker.build({ fill: "#123456" });
		expect(node.type).toBe("group");
		expect("fill" in node).toBe(false);
		expect("background" in node).toBe(false);
		expect("stroke" in node).toBe(false);
	});
});
