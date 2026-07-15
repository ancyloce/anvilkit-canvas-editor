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
	};
});

vi.mock("use-image", () => ({ default: () => [null, "loading"] }));

import { CanvasWorkspace } from "../CanvasWorkspace.js";

afterEach(cleanup);
beforeEach(() => localStorage.clear());

const PAGE_DRAG_MIME = "application/x-anvilkit-canvas-page";

function ir() {
	return createCanvasIR({
		title: "Demo",
		pages: [
			createPage({ id: "p1", name: "One" }),
			createPage({ id: "p2", name: "Two" }),
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

function rowOrder(container: HTMLElement): string[] {
	return Array.from(
		container.querySelectorAll("[data-testid^='page-row-']"),
	).map((el) => el.getAttribute("data-testid") ?? "");
}

describe("PagesCanvas navigator completion (B-11)", () => {
	it("renames a page via double-click on its label", () => {
		mount("b11-rename");
		fireEvent.doubleClick(screen.getByTestId("page-label-p1"));
		const input = screen.getByTestId("page-rename-input-p1");
		fireEvent.change(input, { target: { value: "Hero" } });
		fireEvent.blur(input);
		expect(screen.queryByTestId("page-rename-input-p1")).toBeNull();
		expect(screen.getByTestId("page-label-p1").textContent).toContain("Hero");
	});

	it("Escape cancels an in-progress rename", () => {
		mount("b11-rename-esc");
		fireEvent.doubleClick(screen.getByTestId("page-label-p2"));
		const input = screen.getByTestId("page-rename-input-p2");
		fireEvent.change(input, { target: { value: "Scrapped" } });
		fireEvent.keyDown(input, { key: "Escape" });
		expect(screen.queryByTestId("page-rename-input-p2")).toBeNull();
		expect(screen.getByTestId("page-label-p2").textContent).toContain("Two");
	});

	it("reorders pages by dropping one row onto another", () => {
		const { container } = mount("b11-dnd");
		expect(rowOrder(container)).toEqual(["page-row-p1", "page-row-p2"]);
		fireEvent.drop(screen.getByTestId("page-row-p1"), {
			dataTransfer: {
				types: [PAGE_DRAG_MIME],
				getData: () => "p2",
			},
		});
		expect(rowOrder(container)).toEqual(["page-row-p2", "page-row-p1"]);
	});

	it("ignores drops that are not page drags (e.g. file uploads)", () => {
		const { container } = mount("b11-dnd-files");
		fireEvent.drop(screen.getByTestId("page-row-p1"), {
			dataTransfer: { types: ["Files"], getData: () => "p2" },
		});
		expect(rowOrder(container)).toEqual(["page-row-p1", "page-row-p2"]);
	});

	it("opens the (lazy) page settings dialog from the row context menu", async () => {
		mount("b11-settings");
		fireEvent.contextMenu(screen.getByTestId("page-label-p1"));
		fireEvent.click(await screen.findByTestId("page-menu-settings-p1"));
		expect(await screen.findByTestId("page-settings-dialog")).toBeTruthy();
	});

	it("starts a rename from the row context menu", async () => {
		mount("b11-menu-rename");
		fireEvent.contextMenu(screen.getByTestId("page-label-p2"));
		fireEvent.click(await screen.findByTestId("page-menu-rename-p2"));
		expect(await screen.findByTestId("page-rename-input-p2")).toBeTruthy();
	});
});
