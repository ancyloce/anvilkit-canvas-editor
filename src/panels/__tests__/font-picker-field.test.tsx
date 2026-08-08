import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasT } from "../../context/canvas-studio-context.js";
import { DEFAULT_FONT_CATALOG } from "../../text/default-font-catalog.js";
import {
	type CanvasFontCatalogEntry,
	createFontCatalog,
	mergeCatalogs,
} from "../../text/font-catalog.js";
import {
	fontManifestHash,
	resetFontStatusesForTests,
} from "../../text/font-status.js";
import { FontPickerField } from "../font-picker-field.js";
import {
	FONT_PREVIEW_FALLBACK_WINDOW,
	FONT_PREVIEW_LINK_ATTRIBUTE,
	foldFontText,
	matchesFontFamily,
	resetFontStylesheetsForTests,
} from "../font-preview.js";

/**
 * @file `cp2-003` acceptance. Four criteria, each asserted literally:
 *
 * 1. Opening the picker triggers loads only for VISIBLE options — counted three
 *    independent ways (see `describe("load gating")`).
 * 2. Search matches accented and non-ASCII family names.
 * 3. Every option is reachable and selectable by keyboard alone.
 * 4. No option ever renders as blank space while loading.
 *
 * jsdom has neither `IntersectionObserver` nor the CSS Font Loading API. Both
 * absences are load-bearing here rather than incidental:
 *
 * - Without an observer, `useFontPreviewVisible` falls back to a FIXED WINDOW of
 *   the first {@link FONT_PREVIEW_FALLBACK_WINDOW} options in rendered order.
 *   That is what keeps criterion 1 non-vacuous: observing nothing would satisfy
 *   "only visible options loaded" trivially, and observing everything would make
 *   it unsatisfiable. A fixed window can be pinned from BOTH sides — these
 *   loaded, those did not — which is what the assertions below do.
 * - Without the Font Loading API, `font-status` reports the terminal
 *   `"fallback"`, which is exactly the SSR/jsdom safety `font-status.ts`
 *   promises and this suite must not let regress.
 */

afterEach(cleanup);
beforeEach(() => {
	resetFontStatusesForTests();
	resetFontStylesheetsForTests();
});

const t: CanvasT = (_key, fallback) => fallback ?? _key;

const cssSource = (family: string): CanvasFontCatalogEntry["source"] => ({
	kind: "css",
	css: `https://fonts.example/css2?family=${encodeURIComponent(family)}`,
});

function entry(
	family: string,
	category: CanvasFontCatalogEntry["category"] = "sans",
): CanvasFontCatalogEntry {
	return {
		family,
		category,
		weights: [400],
		source: cssSource(family),
		license: "OFL-1.1",
	};
}

/** Base UI opens a `Combobox.Trigger` on a real pointer sequence, not on a bare click. */
async function openPicker(testId: string): Promise<HTMLElement[]> {
	const trigger = screen.getByTestId(testId);
	trigger.focus();
	fireEvent.pointerDown(trigger, {
		pointerId: 1,
		button: 0,
		pointerType: "mouse",
	});
	fireEvent.mouseDown(trigger, { button: 0 });
	fireEvent.pointerUp(trigger, {
		pointerId: 1,
		button: 0,
		pointerType: "mouse",
	});
	fireEvent.mouseUp(trigger, { button: 0 });
	fireEvent.click(trigger);
	return waitFor(() => {
		const options = optionElements();
		if (options.length === 0)
			throw new Error(`picker "${testId}" did not open`);
		return options;
	});
}

/**
 * Both popups here are portalled to `document.body` and both use
 * `role="option"`, so every query is scoped to the combobox's own content —
 * otherwise the category `Select`'s seven options join the font list.
 */
function comboboxContent(): HTMLElement | null {
	return document.querySelector<HTMLElement>('[data-slot="combobox-content"]');
}

function optionElements(): HTMLElement[] {
	const content = comboboxContent();
	return content
		? Array.from(content.querySelectorAll<HTMLElement>('[role="option"]'))
		: [];
}

function optionLabels(): string[] {
	return optionElements().map((option) => option.textContent ?? "");
}

/** Catalog options only — the free-text "Custom" row renders no preview. */
function familyOptionLabels(): string[] {
	const content = comboboxContent();
	return content
		? Array.from(
				content.querySelectorAll<HTMLElement>("[data-font-family]"),
			).map((element) => element.dataset.fontFamily ?? "")
		: [];
}

function groupLabels(): string[] {
	const content = comboboxContent();
	return content
		? Array.from(
				content.querySelectorAll<HTMLElement>('[data-slot="combobox-label"]'),
			).map((label) => label.textContent ?? "")
		: [];
}

/** Families whose preview actually subscribed through `useFontStatus`. */
function observedFamilies(): string[] {
	return Array.from(
		document.querySelectorAll<HTMLElement>(
			'[data-font-status]:not([data-font-status="idle"])',
		),
	).map((element) => element.dataset.fontFamily ?? "");
}

function injectedStylesheetCount(): number {
	return document.head.querySelectorAll(`link[${FONT_PREVIEW_LINK_ATTRIBUTE}]`)
		.length;
}

/**
 * The number of DISTINCT families `observeFontFamily` has recorded a status
 * for. `font-status`'s manifest version bumps once per real status transition
 * and every family here settles on the terminal `"fallback"` in one step, so
 * this is a count of effective `observeFontFamily` calls taken from the store
 * itself rather than from a spy — and `observeFontFamily` is reached through
 * the real `useFontStatus`, which a module spy could not intercept.
 */
function observedFamilyCount(): number {
	return Number(fontManifestHash());
}

describe("FontPickerField — load gating (cp2-003 AC1)", () => {
	it("opening the picker loads only the visible window, not all 37 families", async () => {
		render(
			<FontPickerField
				label="Font"
				value="Inter"
				catalog={DEFAULT_FONT_CATALOG}
				dataTestId="font"
				t={t}
				onCommit={vi.fn()}
			/>,
		);
		expect(observedFamilyCount()).toBe(0);

		const options = await openPicker("font");
		expect(options.length).toBe(DEFAULT_FONT_CATALOG.entries.length);
		expect(options.length).toBe(37);

		await waitFor(() => {
			expect(observedFamilies().length).toBe(FONT_PREVIEW_FALLBACK_WINDOW);
		});
		// Three independent instruments, all agreeing: the DOM (which options
		// mounted a status subscription), the font-status store (how many families
		// `observeFontFamily` recorded), and the document head (how many face
		// stylesheets were actually fetched).
		expect(observedFamilyCount()).toBe(FONT_PREVIEW_FALLBACK_WINDOW);
		expect(injectedStylesheetCount()).toBe(FONT_PREVIEW_FALLBACK_WINDOW);
	});

	it("loads exactly the first options in rendered order, and no others", async () => {
		render(
			<FontPickerField
				label="Font"
				value=""
				catalog={DEFAULT_FONT_CATALOG}
				dataTestId="font"
				t={t}
				onCommit={vi.fn()}
			/>,
		);
		const options = await openPicker("font");
		const rendered = options.map((option) => option.textContent ?? "");
		await waitFor(() => {
			expect(observedFamilies().length).toBe(FONT_PREVIEW_FALLBACK_WINDOW);
		});
		expect(observedFamilies()).toEqual(
			rendered.slice(0, FONT_PREVIEW_FALLBACK_WINDOW),
		);
		// The other side of the same claim: everything past the window is idle.
		const idle = Array.from(
			document.querySelectorAll<HTMLElement>('[data-font-status="idle"]'),
		).map((element) => element.dataset.fontFamily ?? "");
		expect(idle).toEqual(rendered.slice(FONT_PREVIEW_FALLBACK_WINDOW));
	});

	it("filtering re-bases the window on the newly rendered order", async () => {
		render(
			<FontPickerField
				label="Font"
				value=""
				catalog={DEFAULT_FONT_CATALOG}
				dataTestId="font"
				t={t}
				onCommit={vi.fn()}
			/>,
		);
		await openPicker("font");
		const search = screen.getByTestId("font-search");
		fireEvent.change(search, { target: { value: "roboto" } });
		await waitFor(() => {
			const labels = optionLabels();
			expect(labels.length).toBeGreaterThan(0);
			expect(labels.length).toBeLessThan(FONT_PREVIEW_FALLBACK_WINDOW);
			expect(labels.every((label) => /roboto/i.test(label))).toBe(true);
		});
		// A narrowed list is entirely inside the window, so every remaining option
		// previews — and nothing outside the query was ever loaded.
		await waitFor(() => {
			expect(observedFamilies()).toEqual(optionLabels());
		});
	});
});

describe("FontPickerField — jsdom / SSR safety (cp2-003 verification step 2)", () => {
	it("reports `fallback` with no CSS Font Loading API and still renders every option", async () => {
		expect(
			(document as { fonts?: unknown }).fonts,
			"jsdom must not provide the Font Loading API for this assertion to mean anything",
		).toBeUndefined();

		render(
			<FontPickerField
				label="Font"
				value="Inter"
				catalog={DEFAULT_FONT_CATALOG}
				dataTestId="font"
				t={t}
				onCommit={vi.fn()}
			/>,
		);
		const options = await openPicker("font");
		expect(options.length).toBe(37);

		await waitFor(() => {
			const statuses = Array.from(
				document.querySelectorAll<HTMLElement>(
					'[data-font-status]:not([data-font-status="idle"])',
				),
			).map((element) => element.dataset.fontStatus);
			expect(statuses.length).toBe(FONT_PREVIEW_FALLBACK_WINDOW);
			expect(new Set(statuses)).toEqual(new Set(["fallback"]));
		});
	});

	it("never renders an option as blank space (cp2-003 AC4)", async () => {
		render(
			<FontPickerField
				label="Font"
				value=""
				catalog={DEFAULT_FONT_CATALOG}
				dataTestId="font"
				t={t}
				onCommit={vi.fn()}
			/>,
		);
		const options = await openPicker("font");
		for (const option of options) {
			expect((option.textContent ?? "").trim()).not.toBe("");
		}
		// Both preview states carry the name: the un-observed one and the
		// fallback-face one.
		const previews = Array.from(
			document.querySelectorAll<HTMLElement>("[data-font-status]"),
		);
		expect(previews.length).toBe(37);
		for (const preview of previews) {
			expect((preview.textContent ?? "").trim()).toBe(
				preview.dataset.fontFamily,
			);
		}
	});
});

describe("FontPickerField — search (cp2-003 AC2)", () => {
	const accented = mergeCatalogs(
		createFontCatalog(
			[
				entry("Lató"),
				entry("Bébas Neue", "display"),
				entry("思源黑体"),
				entry("ヒラギノ角ゴ"),
				entry("Inter"),
			],
			{ origin: "host" },
		),
	);

	it("folds diacritics in both directions", () => {
		expect(matchesFontFamily("Lató", "lato")).toBe(true);
		expect(matchesFontFamily("Lato", "LATÓ")).toBe(true);
		// The NFD form a Mac dead key or an IME produces is a DIFFERENT string
		// from the NFC form a catalog is written in; a naive `includes` misses it.
		const nfd = "Lató".normalize("NFD");
		expect(nfd).not.toBe("Lató".normalize("NFC"));
		expect(matchesFontFamily("Lató".normalize("NFC"), nfd)).toBe(true);
		expect(foldFontText("Bébas")).toBe("bebas");
	});

	it("matches non-ASCII family names", () => {
		expect(matchesFontFamily("思源黑体", "思源")).toBe(true);
		expect(matchesFontFamily("ヒラギノ角ゴ", "角ゴ")).toBe(true);
		expect(matchesFontFamily("思源黑体", "inter")).toBe(false);
	});

	it("filters the rendered list on an accented query", async () => {
		render(
			<FontPickerField
				label="Font"
				value=""
				catalog={accented}
				dataTestId="font"
				t={t}
				onCommit={vi.fn()}
			/>,
		);
		await openPicker("font");
		fireEvent.change(screen.getByTestId("font-search"), {
			target: { value: "lato" },
		});
		await waitFor(() => {
			expect(familyOptionLabels()).toEqual(["Lató"]);
		});
		// `lato` is not the family's own spelling, so the free-text row is offered
		// alongside the fold-matched catalog row.
		expect(optionLabels()).toEqual(["Lató", 'Use "lato"']);
	});

	it("filters the rendered list on a CJK query", async () => {
		render(
			<FontPickerField
				label="Font"
				value=""
				catalog={accented}
				dataTestId="font"
				t={t}
				onCommit={vi.fn()}
			/>,
		);
		await openPicker("font");
		fireEvent.change(screen.getByTestId("font-search"), {
			target: { value: "思源" },
		});
		await waitFor(() => {
			expect(familyOptionLabels()).toEqual(["思源黑体"]);
		});
	});

	it("offers no free-text row when the query is the family's own spelling", async () => {
		render(
			<FontPickerField
				label="Font"
				value=""
				catalog={accented}
				dataTestId="font"
				t={t}
				onCommit={vi.fn()}
			/>,
		);
		await openPicker("font");
		fireEvent.change(screen.getByTestId("font-search"), {
			target: { value: "inter" },
		});
		await waitFor(() => {
			expect(optionLabels()).toEqual(["Inter"]);
		});
	});

	it("renders the empty state rather than nothing for an empty catalog", async () => {
		render(
			<FontPickerField
				label="Font"
				value=""
				catalog={createFontCatalog([], { origin: "host" })}
				dataTestId="font"
				t={t}
				onCommit={vi.fn()}
			/>,
		);
		const trigger = screen.getByTestId("font");
		trigger.focus();
		fireEvent.pointerDown(trigger, {
			pointerId: 1,
			button: 0,
			pointerType: "mouse",
		});
		fireEvent.mouseDown(trigger, { button: 0 });
		fireEvent.pointerUp(trigger, {
			pointerId: 1,
			button: 0,
			pointerType: "mouse",
		});
		fireEvent.mouseUp(trigger, { button: 0 });
		fireEvent.click(trigger);
		await waitFor(() => {
			expect(screen.getByTestId("font-empty").textContent).toBe(
				"No fonts available.",
			);
		});
		expect(optionElements()).toEqual([]);
	});
});

describe("FontPickerField — grouping (Brand → Recent → Catalog)", () => {
	const brand = createFontCatalog([entry("Acme Grotesk")], { origin: "brand" });
	const host = createFontCatalog(
		[entry("Inter"), entry("Lora", "serif"), entry("Space Mono", "mono")],
		{ origin: "host" },
	);
	const catalog = mergeCatalogs(host, brand);

	it("orders the groups Brand → Recent → Catalog and never repeats a family", async () => {
		render(
			<FontPickerField
				label="Font"
				value=""
				catalog={catalog}
				dataTestId="font"
				recentFamilies={["lora", "Acme Grotesk"]}
				t={t}
				onCommit={vi.fn()}
			/>,
		);
		await openPicker("font");
		expect(groupLabels()).toEqual(["Brand", "Recent", "All fonts"]);
		// "Acme Grotesk" is claimed by Brand, so Recent skips it even though the
		// caller listed it; "Lora" leaves the catalog group for the recent one.
		expect(optionLabels()).toEqual([
			"Acme Grotesk",
			"Lora",
			"Inter",
			"Space Mono",
		]);
	});

	it("omits the Recent group entirely when there are no recents (cp2-005 slot)", async () => {
		render(
			<FontPickerField
				label="Font"
				value=""
				catalog={catalog}
				dataTestId="font"
				t={t}
				onCommit={vi.fn()}
			/>,
		);
		await openPicker("font");
		expect(groupLabels()).toEqual(["Brand", "All fonts"]);
	});

	it("narrows to one category through the category filter", async () => {
		render(
			<FontPickerField
				label="Font"
				value=""
				catalog={catalog}
				dataTestId="font"
				t={t}
				onCommit={vi.fn()}
			/>,
		);
		await openPicker("font");
		expect(optionLabels().length).toBe(4);
		fireEvent.keyDown(screen.getByTestId("font-search"), { key: "Escape" });
		await waitFor(() => {
			expect(comboboxContent()).toBeNull();
		});

		const categoryTrigger = screen.getByTestId("font-category");
		fireEvent.click(categoryTrigger);
		const monoOption = await waitFor(() => {
			const list = document.querySelector('[data-slot="select-content"]');
			const found = Array.from(
				list?.querySelectorAll<HTMLElement>('[role="option"]') ?? [],
			).find((option) => option.textContent === "Mono");
			if (!found) throw new Error("category select did not open");
			return found;
		});
		fireEvent.pointerDown(monoOption, { pointerId: 1, button: 0 });
		fireEvent.pointerUp(monoOption, { pointerId: 1, button: 0 });
		fireEvent.click(monoOption);
		await waitFor(() => {
			expect(screen.getByTestId("font-category").textContent).toContain("Mono");
		});

		await openPicker("font");
		await waitFor(() => {
			expect(optionLabels()).toEqual(["Space Mono"]);
		});
	});
});

describe("FontPickerField — keyboard (cp2-003 AC3)", () => {
	const catalog = createFontCatalog(
		[entry("Inter"), entry("Lora", "serif"), entry("Space Mono", "mono")],
		{ origin: "host" },
	);

	it("exposes a focusable button trigger", () => {
		render(
			<FontPickerField
				label="Font"
				value="Inter"
				catalog={catalog}
				dataTestId="font"
				t={t}
				onCommit={vi.fn()}
			/>,
		);
		const trigger = screen.getByTestId("font");
		expect(trigger.tagName).toBe("BUTTON");
		expect(trigger.getAttribute("aria-label")).toBe("Font");
		trigger.focus();
		expect(document.activeElement).toBe(trigger);
	});

	it("selects any option with arrow keys and Enter — no pointer on the option", async () => {
		const onCommit = vi.fn();
		render(
			<FontPickerField
				label="Font"
				value=""
				catalog={catalog}
				dataTestId="font"
				t={t}
				onCommit={onCommit}
			/>,
		);
		await openPicker("font");
		const search = screen.getByTestId("font-search");
		// Third (last) option, reached only by keyboard.
		fireEvent.keyDown(search, { key: "ArrowDown" });
		fireEvent.keyDown(search, { key: "ArrowDown" });
		fireEvent.keyDown(search, { key: "ArrowDown" });
		fireEvent.keyDown(search, { key: "Enter" });
		await waitFor(() => {
			expect(onCommit).toHaveBeenCalledWith("Space Mono");
		});
	});

	it("types to narrow, then commits with Enter", async () => {
		const onCommit = vi.fn();
		render(
			<FontPickerField
				label="Font"
				value=""
				catalog={catalog}
				dataTestId="font"
				t={t}
				onCommit={onCommit}
			/>,
		);
		await openPicker("font");
		const search = screen.getByTestId("font-search");
		fireEvent.change(search, { target: { value: "lor" } });
		await waitFor(() => {
			expect(familyOptionLabels()).toEqual(["Lora"]);
		});
		fireEvent.keyDown(search, { key: "ArrowDown" });
		fireEvent.keyDown(search, { key: "Enter" });
		await waitFor(() => {
			expect(onCommit).toHaveBeenCalledWith("Lora");
		});
	});
});

describe("FontPickerField — value handling", () => {
	const catalog = createFontCatalog([entry("Inter")], { origin: "host" });

	it("shows the current family on the trigger, and a prompt when unset", () => {
		const { unmount } = render(
			<FontPickerField
				label="Font"
				value="Inter"
				catalog={catalog}
				dataTestId="font"
				t={t}
				onCommit={vi.fn()}
			/>,
		);
		expect(screen.getByTestId("font-value").textContent).toBe("Inter");
		unmount();
		render(
			<FontPickerField
				label="Font"
				value=""
				catalog={catalog}
				dataTestId="font"
				t={t}
				onCommit={vi.fn()}
			/>,
		);
		expect(screen.getByTestId("font-value").textContent).toBe("Choose a font");
	});

	it("reads Mixed for a multi-selection with differing families", () => {
		render(
			<FontPickerField
				label="Font"
				value="Inter"
				catalog={catalog}
				dataTestId="font"
				mixed
				t={t}
				onCommit={vi.fn()}
			/>,
		);
		expect(screen.getByTestId("font-value").textContent).toBe("Mixed");
	});

	it("keeps free-text entry alive for a family the catalog does not know", async () => {
		const onCommit = vi.fn();
		render(
			<FontPickerField
				label="Font"
				value=""
				catalog={catalog}
				dataTestId="font"
				t={t}
				onCommit={onCommit}
			/>,
		);
		await openPicker("font");
		fireEvent.change(screen.getByTestId("font-search"), {
			target: { value: "Comic Neue" },
		});
		await waitFor(() => {
			expect(optionLabels()).toEqual(['Use "Comic Neue"']);
		});
		expect(groupLabels()).toEqual(["Custom"]);
		const search = screen.getByTestId("font-search");
		fireEvent.keyDown(search, { key: "ArrowDown" });
		fireEvent.keyDown(search, { key: "Enter" });
		await waitFor(() => {
			expect(onCommit).toHaveBeenCalledWith("Comic Neue");
		});
	});

	it("offers no custom option for a family the catalog already has", async () => {
		render(
			<FontPickerField
				label="Font"
				value=""
				catalog={catalog}
				dataTestId="font"
				t={t}
				onCommit={vi.fn()}
			/>,
		);
		await openPicker("font");
		fireEvent.change(screen.getByTestId("font-search"), {
			target: { value: "inter" },
		});
		await waitFor(() => {
			expect(optionLabels()).toEqual(["Inter"]);
		});
		expect(groupLabels()).toEqual(["All fonts"]);
	});
});
