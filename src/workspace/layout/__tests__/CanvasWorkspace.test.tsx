import { createCanvasIR, createPage } from "@anvilkit/canvas-core";
import { cleanup, fireEvent, render } from "@testing-library/react";
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

function ir() {
	return createCanvasIR({
		title: "Demo",
		pages: [createPage({ id: "p1", name: "Page 1" })],
		now: () => "2026-01-01T00:00:00.000Z",
	});
}

describe("CanvasWorkspace shell", () => {
	it("renders the Canva-style regions around the stage", () => {
		const { container } = render(
			<CanvasWorkspace
				initialIR={ir()}
				initialActivePageId="p1"
				storeId="ws-render"
			/>,
		);
		for (const id of [
			"canvas-workspace-root",
			"workspace-header",
			"workspace-undo",
			"workspace-redo",
			"workspace-title",
			"panel-dock",
			"tab-panel",
			"workspace-footer",
			"workspace-zoom",
			"workspace-page-count",
			"workspace-inspector",
			"workspace-inspector-toggle",
			"property-inspector",
			"stage",
		]) {
			expect(
				container.querySelector(`[data-testid='${id}']`),
				`expected [data-testid='${id}']`,
			).not.toBeNull();
		}
		// It is the workspace shell (renderShell), not the bare stacked layout.
		expect(
			container.querySelector("[data-testid='canvas-studio-root']"),
		).toBeNull();
	});

	it("defaults to the templates panel and switches via the dock", () => {
		const { container } = render(
			<CanvasWorkspace
				initialIR={ir()}
				initialActivePageId="p1"
				storeId="ws-switch"
			/>,
		);
		expect(
			container
				.querySelector("[data-testid='panel-dock-templates']")
				?.getAttribute("data-active"),
		).toBe("true");
		// The templates dock now renders the real panel (canvas-m0-009); with no
		// host catalog supplied it shows its empty state.
		expect(
			container.querySelector("[data-testid='templates-panel-empty']"),
		).not.toBeNull();
		// Switching to Layers renders the LayerPanel inside the Tab Panel.
		fireEvent.click(
			container.querySelector(
				"[data-testid='panel-dock-layers']",
			) as HTMLElement,
		);
		expect(
			container.querySelector("[data-testid='layer-panel']"),
		).not.toBeNull();
	});

	// canvas-m0-012: the whole shell (header, tool rail, dock, footer) must be
	// axe-clean. The Konva stage is mocked to a plain div here — the real scene
	// is mirrored to AT by SceneAccessibilityTree, scanned in a11y-axe.test.tsx.
	it("shell chrome has no axe violations", async () => {
		const { axe } = await import("vitest-axe");
		const { container } = render(
			<CanvasWorkspace
				initialIR={ir()}
				initialActivePageId="p1"
				storeId="ws-axe"
			/>,
		);
		const results = await axe(container);
		expect(results.violations).toHaveLength(0);
	});

	// PRD §11.1: the previously-missing `initialWorkspaceState` seam. The
	// workspace store's own precedence rules (seed vs. persisted value) are
	// covered by `workspace/state/__tests__/workspace-ui-store.test.ts`; this
	// test only checks the prop actually reaches the store on a fresh mount.
	it("initialWorkspaceState seeds the dock tab and inspector on mount", () => {
		const { container } = render(
			<CanvasWorkspace
				initialIR={ir()}
				initialActivePageId="p1"
				storeId="ws-initial-state"
				initialWorkspaceState={{
					activeDockId: "brand",
					inspectorCollapsed: true,
				}}
			/>,
		);
		expect(
			container
				.querySelector("[data-testid='panel-dock-brand']")
				?.getAttribute("data-active"),
		).toBe("true");
		expect(
			container
				.querySelector("[data-testid='workspace-inspector']")
				?.getAttribute("data-collapsed"),
		).toBe("true");
	});
});

describe("CanvasWorkspace toolStrip prop (FR-010)", () => {
	it("renders the default strip by default and none with toolStrip={false}", () => {
		const first = render(
			<CanvasWorkspace
				initialIR={ir()}
				initialActivePageId="p1"
				storeId="ts-a"
			/>,
		);
		expect(
			first.container.querySelector("[data-testid='tool-strip']"),
		).not.toBeNull();
		first.unmount();
		const second = render(
			<CanvasWorkspace
				initialIR={ir()}
				initialActivePageId="p1"
				storeId="ts-b"
				toolStrip={false}
			/>,
		);
		expect(
			second.container.querySelector("[data-testid='tool-strip']"),
		).toBeNull();
		expect(
			second.container.querySelector("[data-testid='tool-strip-custom']"),
		).toBeNull();
	});

	it("threads CanvasToolStripOptions: items filter and renderer replacement", () => {
		const first = render(
			<CanvasWorkspace
				initialIR={ir()}
				initialActivePageId="p1"
				storeId="ts-c"
				toolStrip={{ items: ["select", "rect"] }}
			/>,
		);
		const strip = first.container.querySelector("[data-testid='tool-strip']");
		expect(strip).not.toBeNull();
		expect(
			strip?.querySelector("[data-testid='tool-strip-select']"),
		).not.toBeNull();
		expect(strip?.querySelector("[data-testid='tool-strip-text']")).toBeNull();
		first.unmount();
		const second = render(
			<CanvasWorkspace
				initialIR={ir()}
				initialActivePageId="p1"
				storeId="ts-d"
				toolStrip={{
					renderer: ({ descriptors }) => (
						<nav data-testid="host-strip">{descriptors.length}</nav>
					),
				}}
			/>,
		);
		expect(
			second.container.querySelector("[data-testid='host-strip']"),
		).not.toBeNull();
		expect(
			second.container.querySelector("[data-testid='tool-strip']"),
		).toBeNull();
	});
});
