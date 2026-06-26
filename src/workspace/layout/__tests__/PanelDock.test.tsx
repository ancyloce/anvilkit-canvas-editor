import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DOCK_IDS } from "@/workspace/dock-ids.js";
import { WorkspaceUiStoreProvider } from "@/workspace/state/WorkspaceUiStoreProvider.js";
import { PanelDock } from "../PanelDock.js";

// RTL auto-cleanup is OFF in this preset; persisted store state is keyed by
// storeId, so clear storage + use a unique id per test for isolation.
afterEach(cleanup);
beforeEach(() => localStorage.clear());

function renderDock(storeId: string) {
	return render(
		<WorkspaceUiStoreProvider storeId={storeId}>
			<PanelDock />
		</WorkspaceUiStoreProvider>,
	);
}

describe("PanelDock", () => {
	it("renders a button per dock entry", () => {
		const { container } = renderDock("dock-render");
		expect(
			container.querySelector("[data-testid='panel-dock']"),
		).not.toBeNull();
		for (const id of DOCK_IDS) {
			expect(
				container.querySelector(`[data-testid='panel-dock-${id}']`),
			).not.toBeNull();
		}
	});

	it("marks templates active by default and switches on click", () => {
		const { container } = renderDock("dock-switch");
		const templates = container.querySelector(
			"[data-testid='panel-dock-templates']",
		) as HTMLElement;
		const layers = container.querySelector(
			"[data-testid='panel-dock-layers']",
		) as HTMLElement;
		expect(templates.getAttribute("data-active")).toBe("true");
		expect(layers.getAttribute("data-active")).toBe("false");
		fireEvent.click(layers);
		expect(layers.getAttribute("data-active")).toBe("true");
		expect(templates.getAttribute("data-active")).toBe("false");
	});
});
