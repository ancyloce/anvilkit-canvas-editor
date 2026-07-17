import { createCanvasIR, createPage } from "@anvilkit/canvas-core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

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
	};
});

vi.mock("use-image", () => ({ default: () => [null, "loading"] }));

import { createCanvasExportPlugin } from "@/header/index.js";
import { CanvasWorkspace } from "../CanvasWorkspace.js";

afterEach(cleanup);

function ir() {
	return createCanvasIR({
		title: "Demo",
		pages: [
			createPage({ id: "p1", name: "One" }),
			createPage({ id: "p2", name: "Two" }),
			createPage({ id: "p3", name: "Three" }),
			createPage({ id: "p4", name: "Four" }),
		],
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

/** Mounts WITH the export header plugin so `exportAvailable` flips true and
 * the "Export page"/"Export selected pages" menu entries are clickable. */
function mountWithExport(storeId: string) {
	return render(
		<CanvasWorkspace
			initialIR={ir()}
			initialActivePageId="p1"
			storeId={storeId}
			headerPlugins={[createCanvasExportPlugin()]}
		/>,
	);
}

describe('page navigator multi-select (Bug 3, FR-152 "Selected pages")', () => {
	it("Ctrl/Cmd-click toggles a page into the multi-select without activating it", () => {
		mount("ms-toggle");
		fireEvent.click(screen.getByTestId("page-row-p2"), { ctrlKey: true });
		expect(
			screen
				.getByTestId("page-row-p2")
				.getAttribute("data-page-multi-selected"),
		).toBe("true");
		// Ctrl-click must not have switched the active page.
		expect(screen.getByTestId("page-row-p1").getAttribute("data-active")).toBe(
			"true",
		);
		expect(screen.getByTestId("page-row-p2").getAttribute("data-active")).toBe(
			"false",
		);
		// Clicking again (still Ctrl) toggles it back off.
		fireEvent.click(screen.getByTestId("page-row-p2"), { ctrlKey: true });
		expect(
			screen
				.getByTestId("page-row-p2")
				.getAttribute("data-page-multi-selected"),
		).toBeNull();
	});

	it("a plain click (no modifier) still activates the page instead of toggling multi-select", () => {
		mount("ms-plain-click");
		fireEvent.click(screen.getByTestId("page-activate-p2"));
		expect(screen.getByTestId("page-row-p2").getAttribute("data-active")).toBe(
			"true",
		);
		expect(
			screen
				.getByTestId("page-row-p2")
				.getAttribute("data-page-multi-selected"),
		).toBeNull();
	});
});

describe('"Export selected pages" entry point (Bug 3)', () => {
	it("surfaces only once 2+ pages are multi-selected, and requests scope 'pages'", async () => {
		mountWithExport("ms-export-entry");
		// A single multi-selected page is not enough — no plural export yet.
		fireEvent.click(screen.getByTestId("page-row-p2"), { ctrlKey: true });
		fireEvent.contextMenu(screen.getByTestId("page-label-p2"));
		expect(screen.queryByTestId("page-menu-export-selected-p2")).toBeNull();
		fireEvent.keyDown(document.body, { key: "Escape" });

		// Selecting a second page surfaces the entry.
		fireEvent.click(screen.getByTestId("page-row-p4"), { ctrlKey: true });
		fireEvent.contextMenu(screen.getByTestId("page-label-p2"));
		const entry = await screen.findByTestId("page-menu-export-selected-p2");
		expect(entry.textContent).toContain("2");
		fireEvent.click(entry);

		// The export dialog opens preselected to the "pages" scope with the
		// right count (FR-152 plumbing all the way through).
		await screen.findByTestId("export-dialog", undefined, { timeout: 15_000 });
		const scopeButton = screen.getByTestId("export-pages-selected");
		expect(scopeButton.getAttribute("aria-pressed")).toBe("true");
		expect(scopeButton.textContent).toContain("2");
	});
});
