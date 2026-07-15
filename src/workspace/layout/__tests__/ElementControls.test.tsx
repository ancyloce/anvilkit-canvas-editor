import {
	type CanvasIR,
	type CanvasNodeMoveCommand,
	createCanvasIR,
	createGroup,
	createPage,
	createRect,
} from "@anvilkit/canvas-core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type Konva from "konva";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import { type ElementActions, ElementControls } from "../ElementControls.js";

// Base UI popups position through floating-ui, which needs ResizeObserver —
// absent in jsdom.
beforeAll(() => {
	class ResizeObserverStub {
		observe(): void {
			/* jsdom stub */
		}
		unobserve(): void {
			/* jsdom stub */
		}
		disconnect(): void {
			/* jsdom stub */
		}
	}
	if (!("ResizeObserver" in globalThis)) {
		(
			globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }
		).ResizeObserver = ResizeObserverStub;
	}
});

afterEach(cleanup);

const FIXED_TS = "2026-05-20T00:00:00.000Z";

/** Page p1 with three unlocked rects a/b/c at x = 0 / 80 / 200. */
function fixtureIR(): CanvasIR {
	const page = createPage({ id: "p1" });
	page.root = createGroup({
		id: "p1-root",
		bounds: page.root.bounds,
		children: [
			createRect({
				id: "a",
				transform: { x: 0 },
				bounds: { width: 50, height: 50 },
			}),
			createRect({
				id: "b",
				transform: { x: 80 },
				bounds: { width: 50, height: 50 },
			}),
			createRect({
				id: "c",
				transform: { x: 200 },
				bounds: { width: 50, height: 50 },
			}),
		],
	});
	return createCanvasIR({ id: "ir", pages: [page], now: () => FIXED_TS });
}

/** Stage stub good enough for `measureSelection` (findOne + getClientRect). */
function makeMeasurableStage(): Konva.Stage {
	return {
		findOne: () => ({
			getClientRect: () => ({ x: 0, y: 0, width: 50, height: 50 }),
		}),
	} as unknown as Konva.Stage;
}

function setup(selected: readonly string[], actions?: ElementActions) {
	const h = makeHarness({ ir: fixtureIR() });
	h.studioCtx.stage = makeMeasurableStage();
	h.studioCtx.selectionStore.getState().setSelection([...selected]);
	render(
		<CanvasStudioContext.Provider value={h.studioCtx}>
			<ElementControls actions={actions} />
		</CanvasStudioContext.Provider>,
	);
	// Base UI's virtual-pointer checks reject `pointer-events: none`, which its
	// own submenus set transiently during hover transitions — disable the check.
	const user = userEvent.setup({ pointerEventsCheck: 0 });
	return { h, user };
}

type User = ReturnType<typeof userEvent.setup>;

/** Open the "⋯ more" menu; Base UI mounts the popup a frame later. */
async function openMoreMenu(user: User): Promise<void> {
	await user.click(screen.getByTestId("element-controls-more"));
	await screen.findByTestId("more-align");
}

/** Hover a submenu trigger open, then activate one of its items. */
async function clickSubmenuItem(
	user: User,
	subTriggerId: string,
	itemId: string,
): Promise<void> {
	await openMoreMenu(user);
	await user.hover(screen.getByTestId(subTriggerId));
	await screen.findByTestId(itemId);
	fireEvent.click(screen.getByTestId(itemId));
}

function isMenuItemDisabled(el: HTMLElement): boolean {
	return (
		el.getAttribute("data-disabled") !== null ||
		el.getAttribute("aria-disabled") === "true"
	);
}

describe("ElementControls — delete via the action layer", () => {
	it("deletes a multi-selection as ONE undoable batch and clears selection", () => {
		const { h } = setup(["a", "b"]);
		fireEvent.click(screen.getByTestId("element-controls-delete"));
		expect(h.studioCtx.commitBatch).toHaveBeenCalledTimes(1);
		expect(h.studioCtx.commit).not.toHaveBeenCalled();
		expect(h.commits.map((c) => c.type)).toEqual([
			"node.delete",
			"node.delete",
		]);
		expect(h.studioCtx.selectionStore.getState().selectedIds).toHaveLength(0);
	});
});

describe("ElementControls — align/distribute menu state", () => {
	it("align is enabled without a host handler; distribute needs 3 nodes", async () => {
		const { user } = setup(["a", "b"]);
		await openMoreMenu(user);
		expect(isMenuItemDisabled(screen.getByTestId("more-align"))).toBe(false);
		expect(isMenuItemDisabled(screen.getByTestId("more-distribute"))).toBe(
			true,
		);
	});

	it("distribute is enabled with 3 nodes selected", async () => {
		const { user } = setup(["a", "b", "c"]);
		await openMoreMenu(user);
		expect(isMenuItemDisabled(screen.getByTestId("more-distribute"))).toBe(
			false,
		);
	});
});

describe("ElementControls — built-in align/distribute emission", () => {
	it("align-left emits one batch of node.move to the min-left edge", async () => {
		const { h, user } = setup(["a", "b", "c"]);
		await clickSubmenuItem(user, "more-align", "more-align-left");
		expect(h.studioCtx.commitBatch).toHaveBeenCalledTimes(1);
		const xs = h.commits.map((c) => (c as CanvasNodeMoveCommand).to.x);
		expect(xs).toEqual([0, 0, 0]);
	});

	it("distribute-horizontal emits one batch with evened gaps", async () => {
		const { h, user } = setup(["a", "b", "c"]);
		await clickSubmenuItem(user, "more-distribute", "more-distribute-x");
		expect(h.studioCtx.commitBatch).toHaveBeenCalledTimes(1);
		const xs = h.commits.map((c) => (c as CanvasNodeMoveCommand).to.x);
		// a@0 and c@200 fixed; widths 50 → equal gap 50 → b lands at 100.
		expect(xs).toEqual([0, 100, 200]);
	});

	it("a host onAlign override takes precedence over the built-in action", async () => {
		const seen: string[] = [];
		const { h, user } = setup(["a", "b"], {
			onAlign: (_ids, dir) => seen.push(dir),
		});
		await clickSubmenuItem(user, "more-align", "more-align-left");
		expect(seen).toEqual(["left"]);
		expect(h.commits).toHaveLength(0);
	});
});

describe("ElementControls — reorder + group via the action layer (B-13)", () => {
	it("reorder submenu is built in: front emits reorder commands", async () => {
		const { h, user } = setup(["a"]);
		await clickSubmenuItem(user, "more-reorder", "more-reorder-front");
		expect(h.commits.length).toBeGreaterThan(0);
		expect(h.commits.every((c) => c.type === "node.reorder")).toBe(true);
	});

	it("a host onReorder override takes precedence", async () => {
		const seen: string[] = [];
		const { h, user } = setup(["a"], {
			onReorder: (_ids, dir) => seen.push(dir),
		});
		await clickSubmenuItem(user, "more-reorder", "more-reorder-back");
		expect(seen).toEqual(["back"]);
		expect(h.commits).toHaveLength(0);
	});

	it("group needs 2+ nodes and emits node.group; ungroup needs a group", async () => {
		const { h, user } = setup(["a", "b"]);
		await openMoreMenu(user);
		expect(isMenuItemDisabled(screen.getByTestId("more-group"))).toBe(false);
		// No group node in the selection → ungroup disabled.
		expect(isMenuItemDisabled(screen.getByTestId("more-ungroup"))).toBe(true);
		fireEvent.click(screen.getByTestId("more-group"));
		expect(h.commits.some((c) => c.type === "node.group")).toBe(true);
	});

	it("group is disabled for a single-node selection", async () => {
		const { user } = setup(["a"]);
		await openMoreMenu(user);
		expect(isMenuItemDisabled(screen.getByTestId("more-group"))).toBe(true);
	});
});
