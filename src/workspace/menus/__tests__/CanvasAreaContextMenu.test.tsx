import {
	type CanvasIR,
	type CanvasNodeReorderCommand,
	createCanvasIR,
	createFrame,
	createGroup,
	createImage,
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

	it("Snap to grid / Snap to objects toggles flip the viewport store (FR-112)", async () => {
		const h = setup(null);
		const vs = () => h.studioCtx.viewportStore.getState();
		expect(vs().snapToGridEnabled).toBe(false); // harness default
		await openMenu();
		fireEvent.click(screen.getByTestId("ctx-snap-grid"));
		expect(vs().snapToGridEnabled).toBe(true);
		// Grid snap toggles independently of grid VISIBILITY.
		expect(vs().gridEnabled).toBe(false);

		await openMenu();
		expect(vs().snapToObjectsEnabled).toBe(true);
		fireEvent.click(screen.getByTestId("ctx-snap-objects"));
		expect(vs().snapToObjectsEnabled).toBe(false);
	});

	it("snap toggles expose their checked state as menu checkbox items (FR-112)", async () => {
		// Seed BEFORE render: the menu reads viewport state at render, like the
		// grid label (fresh on every open in the real tree, where the reactive
		// studio context re-renders the menu).
		const h = makeHarness({ ir: fixtureIR() });
		h.studioCtx.viewportStore.getState().setSnapToGridEnabled(true);
		render(
			<CanvasStudioContext.Provider value={h.studioCtx}>
				<CanvasAreaContextMenu resolveContextTarget={() => null}>
					<div data-testid="canvas-body" />
				</CanvasAreaContextMenu>
			</CanvasStudioContext.Provider>,
		);
		await openMenu();
		expect(screen.getByTestId("ctx-snap-grid").getAttribute("role")).toBe(
			"menuitemcheckbox",
		);
		expect(
			screen.getByTestId("ctx-snap-grid").getAttribute("aria-checked"),
		).toBe("true");
		expect(
			screen.getByTestId("ctx-snap-objects").getAttribute("aria-checked"),
		).toBe("true");
	});

	it("canvas menu Grid settings opens the grid settings dialog (FR-112)", async () => {
		setup(null);
		await openMenu();
		fireEvent.click(screen.getByTestId("ctx-grid-settings"));
		await waitFor(() => {
			expect(screen.getByTestId("grid-settings-dialog")).toBeTruthy();
		});
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

/** p1 root children: rect (plain), image, and an image-well frame with an existing fill. */
function replaceImageFixtureIR(): CanvasIR {
	const page = createPage({ id: "p1" });
	const image = createImage({
		id: "img1",
		assetId: "asset-old",
		bounds: { width: 40, height: 40 },
	});
	const well = createFrame({
		id: "well1",
		bounds: { width: 40, height: 40 },
		placeholder: { kind: "image", assetId: "asset-old" },
		children: [
			createImage({
				id: "well1-fill",
				assetId: "asset-old",
				bounds: { width: 40, height: 40 },
			}),
		],
	});
	page.root = createGroup({
		id: "p1-root",
		bounds: page.root.bounds,
		children: [
			createRect({ id: "rect1", bounds: { width: 10, height: 10 } }),
			image,
			well,
		],
	});
	const ir = createCanvasIR({ id: "ir", pages: [page], now: () => FIXED_TS });
	ir.assets = {
		"asset-old": { id: "asset-old", uri: "data:old" },
		"asset-1": { id: "asset-1", uri: "data:new" },
	};
	return ir;
}

describe("CanvasAreaContextMenu — Replace image (FR-093)", () => {
	function setupReplaceable(hitId: string) {
		const h = makeHarness({ ir: replaceImageFixtureIR() });
		render(
			<CanvasStudioContext.Provider value={h.studioCtx}>
				<CanvasAreaContextMenu resolveContextTarget={() => hitId}>
					<div data-testid="canvas-body" />
				</CanvasAreaContextMenu>
			</CanvasStudioContext.Provider>,
		);
		return h;
	}

	it("shows Replace image for a single selected plain image node", async () => {
		setupReplaceable("img1");
		await openMenu();
		expect(screen.queryByTestId("ctx-replace-image")).toBeTruthy();
	});

	it("clicking Replace image on a plain image node commits image.replace", async () => {
		const h = setupReplaceable("img1");
		await openMenu();
		fireEvent.click(screen.getByTestId("ctx-replace-image"));
		await waitFor(() => {
			expect(h.commits.map((c) => c.type)).toContain("image.replace");
		});
	});

	it("shows Replace image for a single selected image-well frame", async () => {
		setupReplaceable("well1");
		await openMenu();
		expect(screen.queryByTestId("ctx-replace-image")).toBeTruthy();
	});

	it("clicking Replace image on an image-well frame replaces the well's fill", async () => {
		const h = setupReplaceable("well1");
		await openMenu();
		fireEvent.click(screen.getByTestId("ctx-replace-image"));
		await waitFor(() => {
			expect(h.commits.length).toBeGreaterThan(0);
		});
	});

	it("does not show Replace image for a plain (non-image) node", async () => {
		setupReplaceable("rect1");
		await openMenu();
		expect(screen.queryByTestId("ctx-replace-image")).toBeNull();
	});

	it("does not show Replace image when the image node is part of a multi-selection", async () => {
		const h = setupReplaceable("img1");
		// Right-clicking a node already in the selection preserves a
		// multi-selection rather than collapsing it to one.
		h.studioCtx.selectionStore.getState().setSelection(["img1", "rect1"]);
		await openMenu();
		expect(screen.queryByTestId("ctx-replace-image")).toBeNull();
	});
});
