import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useActiveDock } from "@/workspace/state/hooks.js";
import { WorkspaceUiStoreProvider } from "@/workspace/state/WorkspaceUiStoreProvider.js";
import type { CanvasPanelRegistry } from "../panel-registry.js";
import { TabPanel } from "../TabPanel.js";

// RTL auto-cleanup is OFF in this preset; persisted store state is keyed by
// storeId, so clear storage + use a unique id per test for isolation.
afterEach(cleanup);
beforeEach(() => localStorage.clear());

// Two searchable panels so the search box stays mounted across a dock switch —
// that lets us observe the query reset directly on the same <input>.
const registry: CanvasPanelRegistry = {
	elements: {
		kind: "builtin",
		id: "elements",
		title: "Elements",
		searchable: true,
		render: ({ search }) => <div data-testid="body-elements">{search}</div>,
	},
	uploads: {
		kind: "builtin",
		id: "uploads",
		title: "Uploads",
		searchable: true,
		render: ({ search }) => <div data-testid="body-uploads">{search}</div>,
	},
};

// Minimal control so the test can switch docks without depending on PanelDock.
function DockSwitcher() {
	const [, setDock] = useActiveDock();
	return (
		<div>
			<button
				type="button"
				data-testid="to-elements"
				onClick={() => setDock("elements")}
			/>
			<button
				type="button"
				data-testid="to-uploads"
				onClick={() => setDock("uploads")}
			/>
		</div>
	);
}

function renderPanel(storeId: string) {
	return render(
		<WorkspaceUiStoreProvider storeId={storeId}>
			<DockSwitcher />
			<TabPanel registry={registry} />
		</WorkspaceUiStoreProvider>,
	);
}

describe("TabPanel", () => {
	it("resets the shared search query when the dock changes", () => {
		const { container } = renderPanel("tabpanel-reset");

		// Open a searchable panel and type a query.
		fireEvent.click(
			container.querySelector("[data-testid='to-elements']") as HTMLElement,
		);
		const search = container.querySelector(
			"[data-testid='tab-panel-search']",
		) as HTMLInputElement;
		fireEvent.change(search, { target: { value: "logo" } });
		expect(search.value).toBe("logo");

		// Switching docks must clear it so the next panel opens fresh.
		fireEvent.click(
			container.querySelector("[data-testid='to-uploads']") as HTMLElement,
		);
		expect(
			(
				container.querySelector(
					"[data-testid='tab-panel-search']",
				) as HTMLInputElement
			).value,
		).toBe("");
	});
});
