import type { CanvasCommand } from "@anvilkit/canvas-core";
import { createRect } from "@anvilkit/canvas-core";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	draggedElementEntry,
	ELEMENT_DRAG_MIME,
	endElementDrag,
} from "@/actions/element-insert-actions.js";
import type { CanvasStudioContextValue } from "@/context/canvas-studio-context.js";
import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import type { CanvasElementEntry } from "@/elements/element-entry.js";
import { createStaticElementProvider } from "@/elements/element-provider.js";
import {
	ElementsPanel,
	type ElementsPanelProps,
} from "@/panels/ElementsPanel.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";

/**
 * @file `cp3-004` — the panel's two activation seams.
 *
 * Kept out of `ElementsPanel.test.tsx` deliberately: that file is `cp3-003`'s
 * account of the content browser, and `cp3-009` was rewriting it in the same
 * session. Everything here is about getting an element OFF the panel.
 *
 * The insert itself is unit-tested in
 * `actions/__tests__/element-insert-actions.test.ts`; these tests only prove
 * the panel reaches it, and that the drag publishes a payload the drop side
 * can resolve.
 */

// react-library vitest preset has globals:false — RTL auto-cleanup is OFF.
afterEach(() => {
	endElementDrag();
	cleanup();
});

const ENTRY: CanvasElementEntry = {
	id: "square",
	name: "Square",
	category: "shape",
	tags: [],
	preview: { kind: "path", d: "M0 0H24V24H0Z", viewBox: "0 0 24 24" },
	defaultSize: { width: 60, height: 40 },
	license: "MIT",
	recolor: "fill",
	build: (context) =>
		createRect({
			bounds: { width: 60, height: 40 },
			transform: { x: context?.at?.x ?? 0, y: context?.at?.y ?? 0 },
		}),
};

function renderPanel(props: Omit<ElementsPanelProps, "elementProvider"> = {}): {
	commits: CanvasCommand[];
	selection: () => readonly string[];
	/** The mounted studio — the drag payload is keyed by it, not module-global. */
	ctx: CanvasStudioContextValue;
} {
	const harness = makeHarness();
	render(
		<CanvasStudioContext.Provider value={harness.studioCtx}>
			<ElementsPanel
				elementProvider={createStaticElementProvider([ENTRY])}
				{...props}
			/>
		</CanvasStudioContext.Provider>,
	);
	return {
		commits: harness.commits,
		selection: () => harness.studioCtx.selectionStore.getState().selectedIds,
		ctx: harness.studioCtx,
	};
}

async function cell(): Promise<HTMLElement> {
	return await screen.findByTestId("elements-item-square");
}

describe("ElementsPanel — click inserts (cp3-004)", () => {
	it("activating a cell inserts ONE node and selects it", async () => {
		const h = renderPanel();
		// `.click()` can silently fail to land in this environment; dispatch the
		// event directly (the pattern `editor-core.spec.ts:219-231` documents).
		(await cell()).dispatchEvent(new MouseEvent("click", { bubbles: true }));

		expect(h.commits).toHaveLength(1);
		expect(h.commits[0]?.type).toBe("node.create");
		const id = (h.commits[0] as { node: { id: string } }).node.id;
		expect(h.selection()).toEqual([id]);
	});

	it("inserts at the PAGE centre when the stage is unmeasurable", async () => {
		const h = renderPanel();
		(await cell()).dispatchEvent(new MouseEvent("click", { bubbles: true }));
		// Default page is 1080×1080 (`createPage`); 60×40 element.
		const node = (h.commits[0] as { node: { transform: unknown } }).node;
		expect(node.transform).toMatchObject({ x: 510, y: 520 });
	});

	it("a host `onSelect` OVERRIDES the insert — nothing is committed", async () => {
		const onSelect = vi.fn();
		const h = renderPanel({ onSelect });
		(await cell()).dispatchEvent(new MouseEvent("click", { bubbles: true }));

		expect(onSelect).toHaveBeenCalledTimes(1);
		expect(onSelect.mock.calls[0]?.[0]).toMatchObject({ id: "square" });
		expect(h.commits).toHaveLength(0);
	});
});

describe("ElementsPanel — drag publishes a payload (cp3-004)", () => {
	it("cells are draggable and put the entry id in the dataTransfer", async () => {
		const h = renderPanel();
		const option = await cell();
		expect(option.getAttribute("draggable")).toBe("true");

		const data = new Map<string, string>();
		const dataTransfer = {
			setData: (type: string, value: string) => data.set(type, value),
			effectAllowed: "",
		};
		fireDrag(option, "dragstart", dataTransfer);

		expect(data.get(ELEMENT_DRAG_MIME)).toBe("square");
		expect(dataTransfer.effectAllowed).toBe("copy");
		// The ENTRY itself — `build()` is a function no dataTransfer can carry.
		expect(draggedElementEntry(h.ctx, "square")).toMatchObject({
			id: "square",
		});
	});

	it("dragend clears the payload even when no drop happened", async () => {
		const h = renderPanel();
		const option = await cell();
		fireDrag(option, "dragstart", {
			setData: () => undefined,
			effectAllowed: "",
		});
		expect(draggedElementEntry(h.ctx, "square")).toBeDefined();

		fireDrag(option, "dragend", { setData: () => undefined });
		expect(draggedElementEntry(h.ctx, "square")).toBeUndefined();
	});
});

/** jsdom has no real drag; the React synthetic handler is driven directly. */
function fireDrag(
	element: HTMLElement,
	type: "dragstart" | "dragend",
	dataTransfer: unknown,
): void {
	const event = new Event(type, { bubbles: true });
	Object.defineProperty(event, "dataTransfer", {
		value: dataTransfer,
		configurable: true,
	});
	element.dispatchEvent(event);
}
