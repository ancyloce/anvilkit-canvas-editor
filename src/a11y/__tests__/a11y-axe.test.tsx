/**
 * @file Automated axe scans for the AT-critical editor surfaces, plus the
 * keyboard-path parity assertion (canvas-m0-012 / FR-006 bullet 4).
 *
 * The Konva stage itself is out of axe scope by design — it is mirrored to
 * assistive tech by `SceneAccessibilityTree`, which IS scanned here. The
 * `CanvasWorkspace` shell scan lives in the workspace suite (it needs that
 * suite's react-konva mock).
 */

import {
	createCanvasIR,
	createGroup,
	createPage,
	createRect,
} from "@anvilkit/canvas-core";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import {
	CanvasStudioContext,
	type CanvasStudioContextValue,
} from "@/context/canvas-studio-context.js";
import { LayerPanel } from "@/panels/LayerPanel.js";
import { PropertyInspector } from "@/panels/PropertyInspector.js";
import { createFocusStore } from "@/stores/focus-store.js";
import { createSelectionStore } from "@/stores/selection-store.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import { nudgeCommand } from "../keyboard-actions.js";
import { SceneAccessibilityTree } from "../SceneAccessibilityTree.js";
import { ToolAnnouncer } from "../ToolAnnouncer.js";
import { CanvasKeyboardLayer } from "../useCanvasKeyboard.js";

// react-library vitest preset has globals:false — RTL auto-cleanup is OFF.
afterEach(cleanup);

function sceneCtx(): CanvasStudioContextValue {
	const page = createPage({ id: "p1" });
	page.root = createGroup({
		id: "p1-root",
		bounds: page.root.bounds,
		children: [
			createRect({ id: "a", bounds: { width: 10, height: 10 } }),
			createGroup({
				id: "g",
				bounds: { width: 0, height: 0 },
				children: [createRect({ id: "b", bounds: { width: 5, height: 5 } })],
			}),
		],
	});
	const ir = createCanvasIR({ id: "ir-1", pages: [page], now: () => "T" });
	return {
		ir,
		activePageId: "p1",
		focusStore: createFocusStore(),
		selectionStore: createSelectionStore(),
	} as unknown as CanvasStudioContextValue;
}

async function expectNoViolations(container: HTMLElement): Promise<void> {
	const results = await axe(container);
	expect(results.violations).toHaveLength(0);
}

describe("a11y — axe scans (canvas-m0-012)", () => {
	it("SceneAccessibilityTree has no axe violations", async () => {
		const { container } = render(
			<CanvasStudioContext.Provider value={sceneCtx()}>
				<SceneAccessibilityTree />
			</CanvasStudioContext.Provider>,
		);
		await expectNoViolations(container);
	});

	it("ToolAnnouncer has no axe violations and is a polite live region", async () => {
		const h = makeHarness();
		const { container } = render(
			<CanvasStudioContext.Provider value={h.studioCtx}>
				<ToolAnnouncer />
			</CanvasStudioContext.Provider>,
		);
		const region = container.querySelector("[aria-live]");
		expect(region?.getAttribute("aria-live")).toBe("polite");
		await expectNoViolations(container);
	});

	it("LayerPanel has no axe violations with a populated tree", async () => {
		const page = createPage({ id: "p1" });
		page.root = createGroup({
			id: "p1-root",
			bounds: page.root.bounds,
			children: [
				createRect({ id: "a", bounds: { width: 10, height: 10 } }),
				createRect({ id: "b", bounds: { width: 12, height: 12 } }),
			],
		});
		const ir = createCanvasIR({ id: "ir-lp", pages: [page], now: () => "T" });
		const h = makeHarness({ ir });
		const { container } = render(
			<CanvasStudioContext.Provider value={h.studioCtx}>
				<LayerPanel />
			</CanvasStudioContext.Provider>,
		);
		await expectNoViolations(container);
	});

	// canvas-m2-007 (FR-033): the token-aware color/font pickers are new
	// interactive controls — scan a selected rect with a brand kit configured
	// so both the picker (token-mode) and the missing-token badge render.
	it("PropertyInspector's token-aware color picker has no axe violations", async () => {
		const rect = createRect({
			id: "a",
			bounds: { width: 10, height: 10 },
			fill: { type: "brand-token", tokenType: "color", id: "primary" } as never,
		});
		const page = createPage({ id: "p1" });
		page.root = createGroup({
			id: "p1-root",
			bounds: page.root.bounds,
			children: [rect],
		});
		const ir = createCanvasIR({ id: "ir-pi", pages: [page], now: () => "T" });
		const h = makeHarness({ ir });
		h.studioCtx.brandKit = {
			colors: [{ id: "primary", name: "Primary", value: "#2563eb" }],
			fonts: ["Inter"],
		};
		h.studioCtx.selectionStore.getState().setSelection(["a"]);
		const { container } = render(
			<CanvasStudioContext.Provider value={h.studioCtx}>
				<PropertyInspector />
			</CanvasStudioContext.Provider>,
		);
		await expectNoViolations(container);
	});
});

describe("a11y — keyboard path parity (A11Y-2)", () => {
	it("GridSettingsDialog has no axe violations (FR-112)", async () => {
		const { default: GridSettingsDialog } = await import(
			"@/workspace/dialogs/GridSettingsDialog.js"
		);
		const h = makeHarness();
		const { container } = render(
			<CanvasStudioContext.Provider value={h.studioCtx}>
				<GridSettingsDialog onClose={() => undefined} />
			</CanvasStudioContext.Provider>,
		);
		await expectNoViolations(container);
	});

	it("the extended ColorField (hex/RGB/eyedropper) has no axe violations (FR-074)", async () => {
		const { ColorField } = await import("@/panels/fields.js");
		const { container } = render(
			<ColorField
				label="Fill"
				value="#11aa33"
				dataTestId="axe-color"
				onCommit={() => undefined}
				eyeDropper={() => Promise.resolve(null)}
			/>,
		);
		await expectNoViolations(container);
	});

	it("an arrow nudge via CanvasKeyboardLayer dispatches EXACTLY the pure builder's command", () => {
		const page = createPage({ id: "p1" });
		page.root = createGroup({
			id: "p1-root",
			bounds: page.root.bounds,
			children: [createRect({ id: "a", bounds: { width: 10, height: 10 } })],
		});
		const ir = createCanvasIR({ id: "ir-kb", pages: [page], now: () => "T" });
		const h = makeHarness({ ir });
		h.studioCtx.selectionStore.getState().setSelection(["a"]);

		render(
			<CanvasStudioContext.Provider value={h.studioCtx}>
				<CanvasKeyboardLayer />
			</CanvasStudioContext.Provider>,
		);

		const container = h.studioCtx.stage?.container();
		expect(container).toBeDefined();
		fireEvent.keyDown(container as HTMLElement, { key: "ArrowRight" });

		const node = page.root.children[0];
		expect(node).toBeDefined();
		// The mouse path, the keyboard layer, and the pure builder must agree —
		// identical commands mean identical undo and collab behavior.
		expect(h.studioCtx.commit).toHaveBeenCalledTimes(1);
		expect(h.studioCtx.commit).toHaveBeenCalledWith(
			nudgeCommand(node as never, 1, 0),
		);
	});
});
