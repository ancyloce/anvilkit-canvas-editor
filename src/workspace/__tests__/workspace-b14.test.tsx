import { createCanvasIR, createPage } from "@anvilkit/canvas-core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-konva", () => {
	const Group = ({ children }: { children?: ReactNode }) => children ?? null;
	const Leaf = () => null;
	return {
		Stage: ({ children }: { children?: ReactNode }) => (
			<div data-testid="stage">{children}</div>
		),
		Layer: Group,
		Group,
		Rect: Leaf,
		Ellipse: Leaf,
		Line: Leaf,
		Path: Leaf,
		Text: Leaf,
		Image: Leaf,
		Label: Group,
		Tag: Leaf,
		Transformer: Leaf,
		Arrow: Leaf,
	};
});

vi.mock("use-image", () => ({ default: () => [null, "loading"] }));

import { CanvasWorkspace } from "../layout/CanvasWorkspace.js";
import {
	createWorkspaceUiStore,
	PANEL_WIDTH_DEFAULT,
	PANEL_WIDTH_MAX,
	PANEL_WIDTH_MIN,
	WORKSPACE_UI_STORE_PERSIST_VERSION,
} from "../state/workspace-ui-store.js";

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});
beforeEach(() => localStorage.clear());

function ir() {
	return createCanvasIR({
		title: "Demo",
		pages: [createPage({ id: "p1", name: "Page 1" })],
		now: () => "2026-01-01T00:00:00.000Z",
	});
}

function mount(storeId: string) {
	return render(
		<CanvasWorkspace
			initialIR={ir()}
			initialActivePageId="p1"
			storeId={storeId}
		/>,
	);
}

/** matchMedia stub whose match set is the queries listed in `matching`. */
function stubMatchMedia(matching: readonly string[]): void {
	vi.stubGlobal(
		"matchMedia",
		(query: string) =>
			({
				matches: matching.includes(query),
				media: query,
				addEventListener: () => undefined,
				removeEventListener: () => undefined,
			}) as unknown as MediaQueryList,
	);
}

describe("workspace UI store v2 (B-14)", () => {
	it("migrates a v1 payload (no panelWidth) to the default width", () => {
		localStorage.setItem(
			"anvilkit-canvas-workspace-mig",
			JSON.stringify({
				state: { activeDockId: "layers", inspectorCollapsed: true },
				version: 1,
			}),
		);
		const store = createWorkspaceUiStore({ storeId: "mig" });
		expect(store.getState().activeDockId).toBe("layers");
		expect(store.getState().inspectorCollapsed).toBe(true);
		expect(store.getState().panelWidth).toBe(PANEL_WIDTH_DEFAULT);
	});

	it("clamps an out-of-range persisted panel width", () => {
		localStorage.setItem(
			"anvilkit-canvas-workspace-clamp",
			JSON.stringify({
				state: { activeDockId: "layers", panelWidth: 9999 },
				version: WORKSPACE_UI_STORE_PERSIST_VERSION,
			}),
		);
		const store = createWorkspaceUiStore({ storeId: "clamp" });
		expect(store.getState().panelWidth).toBe(PANEL_WIDTH_MAX);
	});

	it("setPanelWidth clamps and restoreLayout resets layout fields only", () => {
		const store = createWorkspaceUiStore({ storeId: "restore" });
		store.getState().setPanelWidth(50);
		expect(store.getState().panelWidth).toBe(PANEL_WIDTH_MIN);
		store.getState().setActiveDockId("layers");
		store.getState().setInspectorCollapsed(true);
		store.getState().setPanelSearch("query");
		store.getState().restoreLayout();
		expect(store.getState().panelWidth).toBe(PANEL_WIDTH_DEFAULT);
		expect(store.getState().activeDockId).toBe("templates");
		expect(store.getState().inspectorCollapsed).toBe(false);
		// Transient search input is not layout state.
		expect(store.getState().panelSearch).toBe("query");
	});
});

describe("panel resize handle (B-14, FR-130)", () => {
	it("drag-resizes the docked panel and double-click restores the default", () => {
		const { container } = mount("b14-resize");
		const handle = screen.getByTestId("panel-resize-handle");
		// jsdom has no setPointerCapture — stub the pair on the element.
		(handle as unknown as Record<string, unknown>).setPointerCapture = () =>
			undefined;
		(handle as unknown as Record<string, unknown>).releasePointerCapture = () =>
			undefined;
		fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1 });
		fireEvent.pointerMove(handle, { clientX: 180, pointerId: 1 });
		fireEvent.pointerUp(handle, { clientX: 180, pointerId: 1 });
		const body = container.querySelector("[data-testid='workspace-body']");
		expect(
			(body as HTMLElement).style.getPropertyValue("--ak-panel-width"),
		).toBe(`${PANEL_WIDTH_DEFAULT + 80}px`);
		fireEvent.doubleClick(handle);
		expect(
			(body as HTMLElement).style.getPropertyValue("--ak-panel-width"),
		).toBe(`${PANEL_WIDTH_DEFAULT}px`);
	});

	it("arrow keys nudge the width (a11y separator)", () => {
		const { container } = mount("b14-resize-kb");
		const handle = screen.getByTestId("panel-resize-handle");
		expect(handle.getAttribute("role")).toBe("separator");
		fireEvent.keyDown(handle, { key: "ArrowRight" });
		const body = container.querySelector(
			"[data-testid='workspace-body']",
		) as HTMLElement;
		expect(body.style.getPropertyValue("--ak-panel-width")).toBe(
			`${PANEL_WIDTH_DEFAULT + 16}px`,
		);
	});
});

describe("responsive layout (B-14, FR-132)", () => {
	it("≤768px floats the Tab Panel as a dismissable overlay", () => {
		stubMatchMedia(["(max-width: 768px)", "(max-width: 1024px)"]);
		const { container } = mount("b14-overlay");
		const body = container.querySelector(
			"[data-testid='workspace-body']",
		) as HTMLElement;
		expect(body.getAttribute("data-layout")).toBe("overlay");
		// Panel starts open (store default) as an overlay with a backdrop.
		expect(screen.getByTestId("panel-overlay")).toBeTruthy();
		fireEvent.click(screen.getByTestId("panel-overlay-backdrop"));
		expect(screen.queryByTestId("panel-overlay")).toBeNull();
		// No resize handle in overlay mode.
		expect(screen.queryByTestId("panel-resize-handle")).toBeNull();
	});

	it("re-clicking the active dock item toggles the panel", () => {
		stubMatchMedia(["(max-width: 768px)"]);
		mount("b14-dock-toggle");
		const templates = screen.getByTestId("panel-dock-templates");
		fireEvent.click(templates); // active item → close
		expect(screen.queryByTestId("panel-overlay")).toBeNull();
		fireEvent.click(templates); // reopen
		expect(screen.getByTestId("panel-overlay")).toBeTruthy();
	});

	it("≤1024px auto-collapses the inspector", () => {
		stubMatchMedia(["(max-width: 1024px)"]);
		const { container } = mount("b14-collapse");
		const inspector = container.querySelector(
			"[data-testid='workspace-inspector']",
		) as HTMLElement;
		expect(inspector.getAttribute("data-collapsed")).toBe("true");
	});
});

describe("restore default layout menu (B-14)", () => {
	it("resets dock, inspector, and panel width from the header menu", async () => {
		mount("b14-restore-menu");
		fireEvent.keyDown(screen.getByTestId("panel-resize-handle"), {
			key: "ArrowRight",
		});
		fireEvent.click(screen.getByTestId("workspace-inspector-toggle"));
		fireEvent.click(screen.getByTestId("workspace-more-menu"));
		fireEvent.click(await screen.findByTestId("header-menu-restore-layout"));
		const body = document.querySelector(
			"[data-testid='workspace-body']",
		) as HTMLElement;
		expect(body.style.getPropertyValue("--ak-panel-width")).toBe(
			`${PANEL_WIDTH_DEFAULT}px`,
		);
		expect(
			document
				.querySelector("[data-testid='workspace-inspector']")
				?.getAttribute("data-collapsed"),
		).toBe("false");
	});
});
