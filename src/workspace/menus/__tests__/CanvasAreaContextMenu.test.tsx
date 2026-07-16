import {
	type CanvasIR,
	type CanvasNodeReorderCommand,
	createCanvasIR,
	createGroup,
	createPage,
	createRect,
} from "@anvilkit/canvas-core";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import { CanvasAreaContextMenu } from "../CanvasAreaContextMenu.js";

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

/** p1 root children: rect a, rect b, rect c (three siblings for reorder). */
function fixtureIR(): CanvasIR {
	const page = createPage({ id: "p1" });
	page.root = createGroup({
		id: "p1-root",
		bounds: page.root.bounds,
		children: [
			createRect({ id: "a", bounds: { width: 10, height: 10 } }),
			createRect({ id: "b", bounds: { width: 10, height: 10 } }),
			createRect({ id: "c", bounds: { width: 10, height: 10 } }),
		],
	});
	return createCanvasIR({ id: "ir", pages: [page], now: () => FIXED_TS });
}

function setup(hitId: string | null) {
	const h = makeHarness({ ir: fixtureIR() });
	render(
		<CanvasStudioContext.Provider value={h.studioCtx}>
			<CanvasAreaContextMenu resolveContextTarget={() => hitId}>
				<div data-testid="canvas-body" />
			</CanvasAreaContextMenu>
		</CanvasStudioContext.Provider>,
	);
	return h;
}

async function openMenu(): Promise<void> {
	fireEvent.contextMenu(screen.getByTestId("canvas-context-surface"), {
		clientX: 40,
		clientY: 40,
	});
	await waitFor(() => {
		expect(screen.getByTestId("canvas-context-menu")).toBeTruthy();
	});
}

describe("CanvasAreaContextMenu (A-06)", () => {
	it("empty space opens the CANVAS menu; Select All selects the page children", async () => {
		const h = setup(null);
		await openMenu();
		expect(screen.queryByTestId("ctx-select-all")).toBeTruthy();
		expect(screen.queryByTestId("ctx-cut")).toBeNull();
		fireEvent.click(screen.getByTestId("ctx-select-all"));
		expect(h.studioCtx.selectionStore.getState().selectedIds).toEqual([
			"a",
			"b",
			"c",
		]);
	});

	it("toggle grid flips the viewport store", async () => {
		const h = setup(null);
		const before = h.studioCtx.viewportStore.getState().gridEnabled;
		await openMenu();
		fireEvent.click(screen.getByTestId("ctx-toggle-grid"));
		expect(h.studioCtx.viewportStore.getState().gridEnabled).toBe(!before);
	});

	it("right-clicking a node selects it and opens the NODE menu", async () => {
		const h = setup("b");
		await openMenu();
		expect(h.studioCtx.selectionStore.getState().selectedIds).toEqual(["b"]);
		expect(screen.queryByTestId("ctx-cut")).toBeTruthy();
		// Group needs >= 2 same-parent nodes → disabled for a single node.
		const group = screen.getByTestId("ctx-group");
		expect(
			group.getAttribute("data-disabled") !== null ||
				group.getAttribute("aria-disabled") === "true",
		).toBe(true);
	});

	it("node menu delete routes through the action layer (single commit)", async () => {
		const h = setup("a");
		await openMenu();
		fireEvent.click(screen.getByTestId("ctx-delete"));
		expect(h.commits.map((c) => c.type)).toEqual(["node.delete"]);
		expect(h.studioCtx.selectionStore.getState().selectedIds).toHaveLength(0);
	});

	it("bring-to-front emits a clamped node.reorder", async () => {
		const h = setup("a");
		await openMenu();
		fireEvent.click(screen.getByTestId("ctx-bring-front"));
		const cmd = h.commits[0] as CanvasNodeReorderCommand;
		expect(cmd.type).toBe("node.reorder");
		expect(cmd.nodeId).toBe("a");
		expect(cmd.toIndex).toBe(2);
	});

	it("node menu Hide routes a node.update visible:false (FR-031)", async () => {
		const h = setup("a");
		await openMenu();
		fireEvent.click(screen.getByTestId("ctx-visibility"));
		const cmd = h.commits[0] as {
			type: string;
			patch: { visible?: boolean };
		};
		expect(cmd.type).toBe("node.update");
		expect(cmd.patch.visible).toBe(false);
	});

	it("canvas menu exposes Zoom to fit, Actual size and Page settings (FR-030)", async () => {
		setup(null);
		await openMenu();
		expect(screen.queryByTestId("ctx-zoom-fit")).toBeTruthy();
		expect(screen.queryByTestId("ctx-actual-size")).toBeTruthy();
		expect(screen.queryByTestId("ctx-page-settings")).toBeTruthy();
	});

	it("canvas menu Page settings opens the settings dialog (FR-030)", async () => {
		setup(null);
		await openMenu();
		fireEvent.click(screen.getByTestId("ctx-page-settings"));
		await waitFor(() => {
			expect(screen.getByTestId("page-settings-dialog")).toBeTruthy();
		});
	});

	it("node menu exposes Rename layer and Export selection (FR-031)", async () => {
		setup("a");
		await openMenu();
		expect(screen.queryByTestId("ctx-rename")).toBeTruthy();
		expect(screen.queryByTestId("ctx-export-selection")).toBeTruthy();
	});
});
