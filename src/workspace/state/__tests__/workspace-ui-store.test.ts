import { beforeEach, describe, expect, it } from "vitest";
import { DOCK_IDS, HIDDEN_DOCK_IDS } from "../../dock-ids.js";
import { ALL_DOCK_ITEMS, DOCK_ITEMS } from "../../workspace-config.js";
import {
	createWorkspaceUiStore,
	PANEL_WIDTH_DEFAULT,
	PANEL_WIDTH_MAX,
	RECENT_FONTS_MAX,
	RECENT_TEMPLATES_MAX,
	WORKSPACE_UI_STORE_PERSIST_VERSION,
} from "../workspace-ui-store.js";

beforeEach(() => localStorage.clear());

describe("workspace-ui-store", () => {
	it("defaults to the templates dock with the inspector expanded", () => {
		const store = createWorkspaceUiStore({ storeId: "t-default" });
		expect(store.getState().activeDockId).toBe("templates");
		expect(store.getState().inspectorCollapsed).toBe(false);
		expect(store.getState().panelSearch).toBe("");
	});

	it("updates each slice via its setter", () => {
		const store = createWorkspaceUiStore({ storeId: "t-set" });
		store.getState().setActiveDockId("brand");
		store.getState().setInspectorCollapsed(true);
		store.getState().setPanelSearch("logo");
		expect(store.getState().activeDockId).toBe("brand");
		expect(store.getState().inspectorCollapsed).toBe(true);
		expect(store.getState().panelSearch).toBe("logo");
	});

	it("reset returns to the initial slice", () => {
		const store = createWorkspaceUiStore({ storeId: "t-reset" });
		store.getState().setActiveDockId("layers");
		store.getState().setInspectorCollapsed(true);
		store.getState().reset();
		expect(store.getState().activeDockId).toBe("templates");
		expect(store.getState().inspectorCollapsed).toBe(false);
	});

	it("persists activeDockId + inspectorCollapsed but not panelSearch", () => {
		const a = createWorkspaceUiStore({ storeId: "t-persist" });
		a.getState().setActiveDockId("elements");
		a.getState().setInspectorCollapsed(true);
		a.getState().setPanelSearch("transient");
		// A fresh store with the same id rehydrates the persisted slice.
		const b = createWorkspaceUiStore({ storeId: "t-persist" });
		expect(b.getState().activeDockId).toBe("elements");
		expect(b.getState().inspectorCollapsed).toBe(true);
		expect(b.getState().panelSearch).toBe("");
	});

	it("namespaces persistence by storeId", () => {
		const a = createWorkspaceUiStore({ storeId: "ns-a" });
		a.getState().setActiveDockId("uploads");
		const b = createWorkspaceUiStore({ storeId: "ns-b" });
		expect(b.getState().activeDockId).toBe("templates");
	});
});

describe("initialWorkspaceState (PRD §11.1 host seed)", () => {
	it("seeds a fresh store's initial state when nothing is persisted yet", () => {
		const store = createWorkspaceUiStore({
			storeId: "seed-fresh",
			initialWorkspaceState: { activeDockId: "brand", panelWidth: 320 },
		});
		expect(store.getState().activeDockId).toBe("brand");
		expect(store.getState().panelWidth).toBe(320);
		// Fields the seed didn't touch keep their hardcoded defaults.
		expect(store.getState().inspectorCollapsed).toBe(false);
	});

	it("seeds the transient panelOpen/panelSearch fields too", () => {
		const store = createWorkspaceUiStore({
			storeId: "seed-transient",
			initialWorkspaceState: { panelOpen: false, panelSearch: "logo" },
		});
		expect(store.getState().panelOpen).toBe(false);
		expect(store.getState().panelSearch).toBe("logo");
	});

	it("an EXISTING persisted value still wins over the seed for persisted fields", () => {
		const a = createWorkspaceUiStore({ storeId: "seed-precedence" });
		a.getState().setActiveDockId("uploads");
		a.getState().setPanelWidth(300);
		// A later mount of the SAME storeId with a different seed — the
		// already-persisted value must win (the seed is only the fallback for
		// a storeId with nothing persisted yet).
		const b = createWorkspaceUiStore({
			storeId: "seed-precedence",
			initialWorkspaceState: { activeDockId: "brand", panelWidth: 250 },
		});
		expect(b.getState().activeDockId).toBe("uploads");
		expect(b.getState().panelWidth).toBe(300);
	});

	it("does not fight persistence: a value set AFTER a seeded mount still persists normally", () => {
		const a = createWorkspaceUiStore({
			storeId: "seed-no-fight",
			initialWorkspaceState: { activeDockId: "brand" },
		});
		a.getState().setActiveDockId("layers");
		const b = createWorkspaceUiStore({ storeId: "seed-no-fight" });
		expect(b.getState().activeDockId).toBe("layers");
	});

	it("clamps an out-of-range seeded panelWidth the same way a persisted payload is coerced", () => {
		const store = createWorkspaceUiStore({
			storeId: "seed-clamp",
			initialWorkspaceState: { panelWidth: 9999 },
		});
		expect(store.getState().panelWidth).toBe(PANEL_WIDTH_MAX);
	});

	it("restoreLayout() still resets to the hardcoded default, not the seed (additional seam, not a replacement)", () => {
		const store = createWorkspaceUiStore({
			storeId: "seed-restore",
			initialWorkspaceState: { activeDockId: "brand", panelWidth: 320 },
		});
		store.getState().setActiveDockId("layers");
		store.getState().restoreLayout();
		expect(store.getState().activeDockId).toBe("templates");
		expect(store.getState().panelWidth).toBe(PANEL_WIDTH_DEFAULT);
	});
});

/**
 * T-PANEL-1 (plan 0023 M5-01) — the `components` dock id joins a CLOSED,
 * PERSISTED union. The risk is a stored `activeDockId` that is no longer a
 * legal/visible choice: it must fall back, never activate an invisible panel.
 */
describe("components dock id (M5-01)", () => {
	const write = (storeId: string, state: unknown, version: number): void => {
		localStorage.setItem(
			`anvilkit-canvas-workspace-${storeId}`,
			JSON.stringify({ state, version }),
		);
	};

	it("is a member of the union but hidden while the rollout flag is off", () => {
		expect(DOCK_IDS).toContain("components");
		expect(HIDDEN_DOCK_IDS.has("components")).toBe(true);
		expect(DOCK_ITEMS.map((i) => i.id)).not.toContain("components");
	});

	it("ships a dock item with an icon and an i18n key (not just an id)", () => {
		// Filtered out of the rendered rail, so it has to be looked up in the
		// unfiltered config — a host that un-hides it must find a complete entry.
		const item = ALL_DOCK_ITEMS.find((i) => i.id === "components");
		expect(item?.labelKey).toBe("canvas.dock.components");
		expect(item?.icon).toBeTruthy();
	});

	it("falls back to the default when a stored selection is the hidden components tab", () => {
		// The flag-off reload case: someone selected the tab in a flag-on build.
		write("comp-hidden", { activeDockId: "components" }, 4);
		const store = createWorkspaceUiStore({ storeId: "comp-hidden" });
		expect(store.getState().activeDockId).toBe("templates");
	});

	it("migrates a v3 payload without discarding its other fields", () => {
		write(
			"comp-v3",
			{
				activeDockId: "layers",
				inspectorCollapsed: true,
				panelWidth: 300,
				recentTemplateIds: ["tpl-1"],
			},
			3,
		);
		const store = createWorkspaceUiStore({ storeId: "comp-v3" });
		expect(store.getState().activeDockId).toBe("layers");
		expect(store.getState().inspectorCollapsed).toBe(true);
		expect(store.getState().panelWidth).toBe(300);
		expect(store.getState().recentTemplateIds).toEqual(["tpl-1"]);
	});

	it("still coerces an outright unknown dock id", () => {
		write("comp-bogus", { activeDockId: "not-a-dock" }, 4);
		const store = createWorkspaceUiStore({ storeId: "comp-bogus" });
		expect(store.getState().activeDockId).toBe("templates");
	});

	it("declares the version the migration was written for", () => {
		expect(WORKSPACE_UI_STORE_PERSIST_VERSION).toBe(5);
	});
});

/**
 * `cp2-005` recent fonts. The slice is a deliberate MIRROR of C-06's
 * `recentTemplateIds` — same cap, same move-to-front, same oldest-first
 * eviction, same persistence, same reset behaviour — so these assertions are
 * written to fail if the two ever drift apart.
 */
describe("recent fonts (cp2-005)", () => {
	const write = (storeId: string, state: unknown, version: number): void => {
		localStorage.setItem(
			`anvilkit-canvas-workspace-${storeId}`,
			JSON.stringify({ state, version }),
		);
	};

	it("starts empty and records a pick most-recent-first", () => {
		const store = createWorkspaceUiStore({ storeId: "rf-add" });
		expect(store.getState().recentFontFamilies).toEqual([]);
		store.getState().addRecentFont("Lora");
		store.getState().addRecentFont("Inter");
		expect(store.getState().recentFontFamilies).toEqual(["Inter", "Lora"]);
	});

	it("re-picking an existing family moves it to the front without duplicating", () => {
		const store = createWorkspaceUiStore({ storeId: "rf-reorder" });
		for (const family of ["Lora", "Inter", "Lato"]) {
			store.getState().addRecentFont(family);
		}
		expect(store.getState().recentFontFamilies).toEqual([
			"Lato",
			"Inter",
			"Lora",
		]);
		store.getState().addRecentFont("Lora");
		expect(store.getState().recentFontFamilies).toEqual([
			"Lora",
			"Lato",
			"Inter",
		]);
		expect(
			store.getState().recentFontFamilies.filter((f) => f === "Lora"),
		).toHaveLength(1);
	});

	it("treats a family case-insensitively, keeping the newest spelling", () => {
		// A family name is user-facing text and reaches this store from
		// `cp2-004`'s free-text "Custom" row, so `fontFamilyKey` is the identity
		// rather than raw string equality.
		const store = createWorkspaceUiStore({ storeId: "rf-case" });
		store.getState().addRecentFont("Comic Neue");
		store.getState().addRecentFont("Lora");
		store.getState().addRecentFont("  comic neue ");
		expect(store.getState().recentFontFamilies).toEqual([
			"  comic neue ",
			"Lora",
		]);
	});

	it("caps the list and evicts oldest-first", () => {
		const store = createWorkspaceUiStore({ storeId: "rf-cap" });
		const picks = Array.from(
			{ length: RECENT_FONTS_MAX + 2 },
			(_unused, i) => `Family ${i}`,
		);
		for (const family of picks) store.getState().addRecentFont(family);
		const recents = store.getState().recentFontFamilies;
		expect(recents).toHaveLength(RECENT_FONTS_MAX);
		// Newest first, and the two OLDEST picks are the ones that fell off.
		expect(recents[0]).toBe(`Family ${RECENT_FONTS_MAX + 1}`);
		expect(recents.at(-1)).toBe("Family 2");
		expect(recents).not.toContain("Family 0");
		expect(recents).not.toContain("Family 1");
	});

	it("uses the same cap as the templates recents it mirrors", () => {
		expect(RECENT_FONTS_MAX).toBe(RECENT_TEMPLATES_MAX);
	});

	it("persists across a fresh store with the same storeId", () => {
		const a = createWorkspaceUiStore({ storeId: "rf-persist" });
		a.getState().addRecentFont("Lora");
		a.getState().addRecentFont("Inter");
		const b = createWorkspaceUiStore({ storeId: "rf-persist" });
		expect(b.getState().recentFontFamilies).toEqual(["Inter", "Lora"]);
	});

	it("reset() clears it but restoreLayout() leaves it alone", () => {
		// Exactly the templates slice's behaviour: "restore default LAYOUT" is
		// about the dock/inspector/width, not about forgetting what you used.
		const store = createWorkspaceUiStore({ storeId: "rf-reset" });
		store.getState().addRecentFont("Lora");
		store.getState().restoreLayout();
		expect(store.getState().recentFontFamilies).toEqual(["Lora"]);
		store.getState().reset();
		expect(store.getState().recentFontFamilies).toEqual([]);
	});

	it("migrates a v4 payload with an empty list, keeping its other fields", () => {
		write(
			"rf-v4",
			{
				activeDockId: "layers",
				inspectorCollapsed: true,
				panelWidth: 300,
				recentTemplateIds: ["tpl-1"],
			},
			4,
		);
		const store = createWorkspaceUiStore({ storeId: "rf-v4" });
		expect(store.getState().recentFontFamilies).toEqual([]);
		expect(store.getState().recentTemplateIds).toEqual(["tpl-1"]);
		expect(store.getState().activeDockId).toBe("layers");
		expect(store.getState().panelWidth).toBe(300);
	});

	it("coerces a corrupt or over-long persisted list instead of trusting it", () => {
		write(
			"rf-corrupt",
			{
				recentFontFamilies: [
					"Lora",
					42,
					null,
					...Array.from({ length: RECENT_FONTS_MAX }, (_u, i) => `F${i}`),
				],
			},
			5,
		);
		const store = createWorkspaceUiStore({ storeId: "rf-corrupt" });
		const recents = store.getState().recentFontFamilies;
		expect(recents).toHaveLength(RECENT_FONTS_MAX);
		expect(recents[0]).toBe("Lora");
		expect(recents.every((f) => typeof f === "string")).toBe(true);
	});

	it("accepts a host seed, sanitized like a persisted payload (PRD §11.1)", () => {
		const store = createWorkspaceUiStore({
			storeId: "rf-seed",
			initialWorkspaceState: {
				recentFontFamilies: Array.from(
					{ length: RECENT_FONTS_MAX + 3 },
					(_u, i) => `Seed ${i}`,
				),
			},
		});
		expect(store.getState().recentFontFamilies).toHaveLength(RECENT_FONTS_MAX);
	});
});
