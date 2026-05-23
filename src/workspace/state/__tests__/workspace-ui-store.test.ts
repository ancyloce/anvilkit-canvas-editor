import { beforeEach, describe, expect, it } from "vitest";
import { createWorkspaceUiStore } from "../workspace-ui-store.js";

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
