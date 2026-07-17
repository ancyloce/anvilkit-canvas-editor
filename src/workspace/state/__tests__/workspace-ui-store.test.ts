import { beforeEach, describe, expect, it } from "vitest";
import {
	createWorkspaceUiStore,
	PANEL_WIDTH_DEFAULT,
	PANEL_WIDTH_MAX,
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
