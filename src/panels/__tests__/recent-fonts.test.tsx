import {
	type CanvasIR,
	createCanvasIR,
	createPage,
	createText,
} from "@anvilkit/canvas-core";
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import type { BrandKit } from "../../brand/brand-kit.js";
import type { CanvasT } from "../../context/canvas-studio-context.js";
import {
	type RecentFonts,
	RecentFontsContext,
} from "../../context/recent-fonts-context.js";
import { DEFAULT_FONT_CATALOG } from "../../text/default-font-catalog.js";
import {
	RecentFontsBridge,
	WorkspaceUiStoreProvider,
} from "../../workspace/state/WorkspaceUiStoreProvider.js";
import { RECENT_FONTS_MAX } from "../../workspace/state/workspace-ui-store.js";
import { PropertyInspector } from "../PropertyInspector.js";
import { TokenAwareFontField } from "../token-aware-fields.js";
import {
	fontGroupLabels,
	openFontPicker,
	pickFont,
} from "./_font-picker-test-helpers.js";

/**
 * @file `cp2-005` acceptance — the Recent group's backing store.
 *
 * `cp2-003` shipped the Recent group and `cp2-004` threaded the prop; the only
 * thing missing was the list itself. It is produced by a context that MIRRORS
 * `recent-templates-context.ts` (C-06) — same persisted workspace store, same
 * cap, same move-to-front — so the assertions here are deliberately the font
 * counterparts of `TemplatesPanel.test.tsx`'s recents tests plus the three
 * acceptance criteria:
 *
 * 1. Picking a family adds it to Recent; re-picking reorders without
 *    duplicating.
 * 2. The list is capped and evicts oldest-first.
 * 3. Brand group precedence is unaffected.
 *
 * Both write paths are covered, because the field has two: the legacy
 * `onCommit` (a standalone mount) and the §10 field contract (the real
 * inspector, which commits once per selected node — so "records it once" is a
 * claim about the resulting list, not about the call count).
 */

afterEach(cleanup);
beforeEach(() => localStorage.clear());

const t: CanvasT = (_key, fallback) => fallback ?? _key;

const FIXED_TS = "2026-05-20T00:00:00.000Z";

/** Eight catalog families, oldest last — one full cap's worth. */
const EIGHT: readonly string[] = [
	"Inter",
	"Roboto",
	"Open Sans",
	"Lato",
	"Montserrat",
	"Lora",
	"Merriweather",
	"Bitter",
];

/**
 * Option labels inside ONE group, by its `data-testid` suffix. `fontGroupLabels`
 * reads the headings; this reads a single heading's own rows, which is what
 * "Brand still comes first and Recent did not steal its entry" needs.
 */
function fontGroupItems(
	popup: HTMLElement,
	dataTestId: string,
	group: "brand" | "recent" | "catalog",
): string[] {
	const label = popup.querySelector(
		`[data-testid="${dataTestId}-group-${group}"]`,
	);
	const container = label?.closest<HTMLElement>('[data-slot="combobox-group"]');
	if (!container) return [];
	return Array.from(
		container.querySelectorAll<HTMLElement>('[role="option"]'),
	).map((option) => option.textContent ?? "");
}

/** A real workspace store + the real bridge — the shipped provider, not a stub. */
function Workspace({
	storeId,
	seed,
	children,
}: {
	storeId: string;
	seed?: readonly string[];
	children: ReactNode;
}): React.JSX.Element {
	return (
		<WorkspaceUiStoreProvider
			storeId={storeId}
			{...(seed ? { initialWorkspaceState: { recentFontFamilies: seed } } : {})}
		>
			<RecentFontsBridge>{children}</RecentFontsBridge>
		</WorkspaceUiStoreProvider>
	);
}

function textIR(families: readonly string[]): CanvasIR {
	const ir = createCanvasIR({
		id: "ir-recent-fonts",
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

describe("cp2-005 — the recents seam", () => {
	it("shows no Recent group and never throws with no provider (standalone mount)", async () => {
		const onCommit = vi.fn();
		render(
			<TokenAwareFontField
				label="Font"
				rawValue="Georgia"
				resolvedValue="Georgia"
				unresolved={false}
				fonts={[]}
				dataTestId="test-font"
				onCommit={onCommit}
				t={t}
			/>,
		);
		expect(fontGroupLabels(await openFontPicker("test-font"))).toEqual([
			"All fonts",
		]);
		// `useRecentFonts()` resolves to the inert value outside the shell, so
		// recording a pick is a no-op rather than a crash — the same tolerance
		// `cp2-004` gave the catalog read.
		await pickFont("test-font", "Lora");
		expect(onCommit).toHaveBeenCalledWith("Lora");
	});

	it("fills the Recent group from context, with no recentFamilies prop", async () => {
		const value: RecentFonts = { families: ["Lora", "Inter"], add: vi.fn() };
		render(
			<RecentFontsContext.Provider value={value}>
				<TokenAwareFontField
					label="Font"
					rawValue="Georgia"
					resolvedValue="Georgia"
					unresolved={false}
					fonts={[]}
					dataTestId="test-font"
					onCommit={vi.fn()}
					t={t}
				/>
			</RecentFontsContext.Provider>,
		);
		const popup = await openFontPicker("test-font");
		expect(fontGroupLabels(popup)).toEqual(["Recent", "All fonts"]);
		expect(fontGroupItems(popup, "test-font", "recent")).toEqual([
			"Lora",
			"Inter",
		]);
	});

	it("lets an explicit recentFamilies prop override the context", async () => {
		const value: RecentFonts = { families: ["Lora"], add: vi.fn() };
		render(
			<RecentFontsContext.Provider value={value}>
				<TokenAwareFontField
					label="Font"
					rawValue="Georgia"
					resolvedValue="Georgia"
					unresolved={false}
					fonts={[]}
					dataTestId="test-font"
					recentFamilies={["Anton"]}
					onCommit={vi.fn()}
					t={t}
				/>
			</RecentFontsContext.Provider>,
		);
		const popup = await openFontPicker("test-font");
		expect(fontGroupItems(popup, "test-font", "recent")).toEqual(["Anton"]);
	});

	it("records a pick through the context on the legacy onCommit path", async () => {
		const add = vi.fn();
		const value: RecentFonts = { families: [], add };
		render(
			<RecentFontsContext.Provider value={value}>
				<TokenAwareFontField
					label="Font"
					rawValue="Georgia"
					resolvedValue="Georgia"
					unresolved={false}
					fonts={[]}
					dataTestId="test-font"
					onCommit={vi.fn()}
					t={t}
				/>
			</RecentFontsContext.Provider>,
		);
		await pickFont("test-font", "Merriweather");
		expect(add).toHaveBeenCalledWith("Merriweather");
	});

	it("records an OFF-CATALOG family too, even though the picker cannot show it", async () => {
		// `buildGroups` drops a recent the catalog does not describe, so this
		// entry is written but invisible. Recording it anyway is deliberate: a
		// host that later ships a catalog entry (or a brand kit) for that family
		// gets the user's history back instead of a silently-truncated list.
		const add = vi.fn();
		render(
			<RecentFontsContext.Provider value={{ families: [], add }}>
				<TokenAwareFontField
					label="Font"
					rawValue="Georgia"
					resolvedValue="Georgia"
					unresolved={false}
					fonts={[]}
					dataTestId="test-font"
					onCommit={vi.fn()}
					t={t}
				/>
			</RecentFontsContext.Provider>,
		);
		expect(DEFAULT_FONT_CATALOG.get("Comic Neue")).toBeUndefined();
		await pickFont("test-font", "Comic Neue");
		expect(add).toHaveBeenCalledWith("Comic Neue");
	});
});

describe("cp2-005 — brand precedence", () => {
	const BRAND_KIT: BrandKit = { colors: [], fonts: ["Lora"] };

	it("keeps a family that is BOTH brand and recent in Brand, listed once", async () => {
		render(
			<RecentFontsContext.Provider
				value={{ families: ["Lora", "Inter"], add: vi.fn() }}
			>
				<TokenAwareFontField
					label="Font"
					rawValue="Georgia"
					resolvedValue="Georgia"
					unresolved={false}
					fonts={BRAND_KIT.fonts}
					dataTestId="test-font"
					onCommit={vi.fn()}
					t={t}
				/>
			</RecentFontsContext.Provider>,
		);
		const popup = await openFontPicker("test-font");
		// Brand is still the FIRST group, and still owns "Lora".
		expect(fontGroupLabels(popup)).toEqual(["Brand", "Recent", "All fonts"]);
		expect(fontGroupItems(popup, "test-font", "brand")).toEqual(["Lora"]);
		// Recent holds only the family Brand did not claim.
		expect(fontGroupItems(popup, "test-font", "recent")).toEqual(["Inter"]);
		const all = Array.from(
			popup.querySelectorAll<HTMLElement>('[role="option"]'),
		).map((option) => option.textContent);
		expect(all[0]).toBe("Lora");
		expect(all.filter((label) => label === "Lora")).toHaveLength(1);
		expect(all.filter((label) => label === "Inter")).toHaveLength(1);
	});

	it("recording a brand pick does not displace the Brand group", async () => {
		render(
			<Workspace storeId="rf-brand">
				<TokenAwareFontField
					label="Font"
					rawValue="Georgia"
					resolvedValue="Georgia"
					unresolved={false}
					fonts={BRAND_KIT.fonts}
					dataTestId="test-font"
					onCommit={vi.fn()}
					t={t}
				/>
			</Workspace>,
		);
		await pickFont("test-font", "Lora");
		const popup = await openFontPicker("test-font");
		// "Lora" WAS recorded (it is a normal pick), but precedence is resolved
		// once, at render time — so it renders under Brand and Recent stays
		// empty, meaning no Recent heading at all.
		expect(fontGroupLabels(popup)).toEqual(["Brand", "All fonts"]);
		expect(fontGroupItems(popup, "test-font", "brand")).toEqual(["Lora"]);
	});
});

describe("cp2-005 — the workspace bridge (store → context → picker)", () => {
	it("adds a pick to Recent, and re-picking reorders without duplicating", async () => {
		render(
			<Workspace storeId="rf-bridge">
				<TokenAwareFontField
					label="Font"
					rawValue="Georgia"
					resolvedValue="Georgia"
					unresolved={false}
					fonts={[]}
					dataTestId="test-font"
					onCommit={vi.fn()}
					t={t}
				/>
			</Workspace>,
		);
		await pickFont("test-font", "Lora");
		expect(
			fontGroupItems(await openFontPicker("test-font"), "test-font", "recent"),
		).toEqual(["Lora"]);

		await pickFont("test-font", "Inter");
		expect(
			fontGroupItems(await openFontPicker("test-font"), "test-font", "recent"),
		).toEqual(["Inter", "Lora"]);

		// Re-picking the older of the two moves it to the front — one entry, not
		// two. This is the assertion that fails if move-to-front is dropped.
		await pickFont("test-font", "Lora");
		const recents = fontGroupItems(
			await openFontPicker("test-font"),
			"test-font",
			"recent",
		);
		expect(recents).toEqual(["Lora", "Inter"]);
		expect(recents.filter((family) => family === "Lora")).toHaveLength(1);
	});

	it("caps the group and evicts the oldest entry first", async () => {
		render(
			<Workspace storeId="rf-cap" seed={EIGHT}>
				<TokenAwareFontField
					label="Font"
					rawValue="Georgia"
					resolvedValue="Georgia"
					unresolved={false}
					fonts={[]}
					dataTestId="test-font"
					onCommit={vi.fn()}
					t={t}
				/>
			</Workspace>,
		);
		expect(
			fontGroupItems(await openFontPicker("test-font"), "test-font", "recent"),
		).toEqual([...EIGHT]);

		await pickFont("test-font", "Anton");
		const recents = fontGroupItems(
			await openFontPicker("test-font"),
			"test-font",
			"recent",
		);
		expect(recents).toHaveLength(RECENT_FONTS_MAX);
		expect(recents[0]).toBe("Anton");
		// The OLDEST seeded family is the one that fell off; nothing else did.
		expect(recents).not.toContain("Bitter");
		expect(recents).toEqual(["Anton", ...EIGHT.slice(0, -1)]);
	});

	it("re-picking at full cap costs no slot — nothing is evicted", async () => {
		// The USER-VISIBLE consequence of a store that appends instead of moving
		// to front. `buildGroups` de-dupes at render time, so a duplicated entry
		// is invisible — but it still occupies a capped slot, so the oldest
		// family silently disappears on a re-pick. Asserted at full cap, which
		// is the only place that difference surfaces in the UI.
		render(
			<Workspace storeId="rf-repick-cap" seed={EIGHT}>
				<TokenAwareFontField
					label="Font"
					rawValue="Georgia"
					resolvedValue="Georgia"
					unresolved={false}
					fonts={[]}
					dataTestId="test-font"
					onCommit={vi.fn()}
					t={t}
				/>
			</Workspace>,
		);
		// "Lora" is already in the list, 6th of 8 — re-picking it must reorder,
		// not push "Bitter" off the end.
		await pickFont("test-font", "Lora");
		const recents = fontGroupItems(
			await openFontPicker("test-font"),
			"test-font",
			"recent",
		);
		expect(recents).toHaveLength(RECENT_FONTS_MAX);
		expect(recents).toContain("Bitter");
		expect(recents).toEqual([
			"Lora",
			...EIGHT.filter((family) => family !== "Lora"),
		]);
	});
});

describe("cp2-005 — the §10 contract path (the real inspector)", () => {
	function mountInspector(
		storeId: string,
		ir: CanvasIR,
		selection: string[],
	): void {
		const h = makeHarness({ ir });
		h.studioCtx.selectionStore.getState().setSelection(selection);
		render(
			<CanvasStudioContext.Provider value={h.studioCtx}>
				<Workspace storeId={storeId}>
					<PropertyInspector />
				</Workspace>
			</CanvasStudioContext.Provider>,
		);
	}

	it("records the family ONCE for a multi-node selection", async () => {
		// The contract commits per node, so `add` runs once per selected node.
		// Move-to-front + dedupe is what makes the RESULT one entry — which is
		// the property that matters and the one asserted here.
		mountInspector("rf-contract", textIR(["Georgia", "Georgia"]), ["t1", "t2"]);
		await pickFont("prop-font-family", "Lora");
		expect(
			fontGroupItems(
				await openFontPicker("prop-font-family"),
				"prop-font-family",
				"recent",
			),
		).toEqual(["Lora"]);
	});
});
