// @vitest-environment node
// Pure logic test (fake stage, no DOM) — runs under the node environment so it
// is independent of jsdom.
import type Konva from "konva";
import { describe, expect, it, vi } from "vitest";
import { GRID_CHROME_GROUP_NAME } from "@/stage/Grid.js";
import type { RenderLayerName } from "@/stage/RenderLayer.js";
import { exportStageContentDataURL } from "../export-stage.js";

/** Minimal Konva.Layer fake tracking its name + visibility. */
function fakeLayer(name: RenderLayerName) {
	let visible = true;
	return {
		name: () => name,
		visible: vi.fn((next?: boolean) => {
			if (next === undefined) return visible;
			visible = next;
			return undefined as unknown as boolean;
		}),
		// Convenience accessor for assertions (not part of Konva's API).
		_isVisible: () => visible,
	};
}

/** Minimal named Konva.Group fake (e.g. the FR-112 "grid" group). */
function fakeGroup(name: string) {
	let visible = true;
	return {
		name: () => name,
		visible: vi.fn((next?: boolean) => {
			if (next === undefined) return visible;
			visible = next;
			return undefined as unknown as boolean;
		}),
		_isVisible: () => visible,
	};
}

type Vector2d = { x: number; y: number };

/** The surface size every fake stage below renders, before zoom. */
const PAGE = { width: 800, height: 600 };

/**
 * Fake stage exposing getLayers/find/scale/position/width/height/toDataURL/
 * batchDraw.
 *
 * `width()`/`height()` mirror how `<CanvasStudio>` sizes the real stage —
 * `surface × zoom`, with `scale` set to the same zoom — because that is the
 * relationship `surfaceRect` inverts to recover the page rect.
 */
function fakeStage(
	layers: ReturnType<typeof fakeLayer>[],
	groups: ReturnType<typeof fakeGroup>[] = [],
	viewport: { scale: Vector2d; position: Vector2d } = {
		scale: { x: 1, y: 1 },
		position: { x: 0, y: 0 },
	},
	page: { width: number; height: number } = PAGE,
) {
	let scale = viewport.scale;
	let position = viewport.position;
	const boxWidth = page.width * viewport.scale.x;
	const boxHeight = page.height * viewport.scale.y;
	const toDataURL = vi.fn(
		// Snapshot which layers/groups were visible, and the scale/position in
		// effect, at the moment of serialization (E-14) — so a test can prove
		// chrome was hidden and the viewport neutralized *during* the call.
		() =>
			`data:image/png;base64,${[...layers, ...groups]
				.filter((n) => n._isVisible())
				.map((n) => n.name())
				.join("+")}@${scale.x},${scale.y}+${position.x},${position.y}`,
	);
	const stage = {
		getLayers: () => layers as unknown as ReadonlyArray<Konva.Layer>,
		find: vi.fn((selector: (node: { name(): string }) => boolean) =>
			groups.filter((g) => selector(g)),
		),
		width: () => boxWidth,
		height: () => boxHeight,
		scale: vi.fn((next?: Vector2d) => {
			if (next === undefined) return scale;
			scale = next;
			return undefined as unknown as Vector2d;
		}),
		position: vi.fn((next?: Vector2d) => {
			if (next === undefined) return position;
			position = next;
			return undefined as unknown as Vector2d;
		}),
		toDataURL,
		batchDraw: vi.fn(),
	};
	return stage as unknown as Konva.Stage & {
		batchDraw: ReturnType<typeof vi.fn>;
		find: ReturnType<typeof vi.fn>;
		scale: ReturnType<typeof vi.fn>;
		position: ReturnType<typeof vi.fn>;
	};
}

describe("exportStageContentDataURL", () => {
	it("hides the overlay + presence layers during serialization", () => {
		const content = fakeLayer("content");
		const drag = fakeLayer("drag");
		const overlay = fakeLayer("overlay");
		const presence = fakeLayer("presence");
		const stage = fakeStage([content, drag, overlay, presence]);

		const url = exportStageContentDataURL(stage, { pixelRatio: 2 });

		// Only content layers were visible at serialize time — overlay (guides
		// + selection chrome) and presence (remote cursors) were not.
		expect(url).toBe("data:image/png;base64,content+drag@1,1+0,0");
	});

	it("restores chrome-layer visibility after serialization", () => {
		const content = fakeLayer("content");
		const overlay = fakeLayer("overlay");
		const presence = fakeLayer("presence");
		const stage = fakeStage([content, overlay, presence]);

		exportStageContentDataURL(stage);

		expect(overlay._isVisible()).toBe(true);
		expect(presence._isVisible()).toBe(true);
		// A redraw flushes the restored visibility back onto the on-screen stage.
		expect(stage.batchDraw).toHaveBeenCalledTimes(1);
	});

	it("forwards pixelRatio / mimeType / quality to toDataURL", () => {
		const objects = fakeLayer("objects");
		const stage = fakeStage([objects]);
		exportStageContentDataURL(stage, {
			pixelRatio: 3,
			mimeType: "image/jpeg",
			quality: 0.8,
		});
		expect(stage.toDataURL).toHaveBeenCalledWith({
			pixelRatio: 3,
			mimeType: "image/jpeg",
			quality: 0.8,
			x: 0,
			y: 0,
			width: PAGE.width,
			height: PAGE.height,
		});
	});

	it("falls back to a plain toDataURL when the stage exposes no layers", () => {
		// Unit-test fakes (and any non-standard stage) without getLayers must
		// still serialize — there are simply no chrome layers to hide.
		const toDataURL = vi.fn(() => "data:image/png;base64,PLAIN");
		const stage = { toDataURL } as unknown as Konva.Stage;
		const url = exportStageContentDataURL(stage, { pixelRatio: 2 });
		expect(url).toBe("data:image/png;base64,PLAIN");
		expect(toDataURL).toHaveBeenCalledWith({ pixelRatio: 2 });
	});

	it("does not redraw when there were no chrome layers to hide", () => {
		const background = fakeLayer("background");
		const objects = fakeLayer("objects");
		const stage = fakeStage([background, objects]);
		exportStageContentDataURL(stage);
		expect(stage.batchDraw).not.toHaveBeenCalled();
	});

	it("hides the FR-112 grid group inside the content layer during serialization", () => {
		const content = fakeLayer("content");
		const grid = fakeGroup(GRID_CHROME_GROUP_NAME);
		const stage = fakeStage([content], [grid]);

		const url = exportStageContentDataURL(stage);

		// The grid group was invisible at serialize time — only real content made
		// it into the export (the group lives inside a KEPT layer, so hiding
		// whole layers could never exclude it).
		expect(url).toBe("data:image/png;base64,content@1,1+0,0");
		expect(stage.find).toHaveBeenCalledWith(expect.any(Function));
	});

	it("restores the grid group's visibility (and redraws) after serialization", () => {
		const content = fakeLayer("content");
		const grid = fakeGroup(GRID_CHROME_GROUP_NAME);
		const stage = fakeStage([content], [grid]);

		exportStageContentDataURL(stage);

		expect(grid._isVisible()).toBe(true);
		expect(stage.batchDraw).toHaveBeenCalledTimes(1);
	});

	it("leaves an already-hidden grid group hidden (no spurious restore)", () => {
		const content = fakeLayer("content");
		const grid = fakeGroup(GRID_CHROME_GROUP_NAME);
		grid.visible(false);
		const stage = fakeStage([content], [grid]);

		exportStageContentDataURL(stage);

		expect(grid._isVisible()).toBe(false);
		// Nothing was hidden by the exporter → nothing to redraw.
		expect(stage.batchDraw).not.toHaveBeenCalled();
	});

	// Regression (E-13): `CanvasNodeRenderer` names every content node after its
	// raw `CanvasNode.id` (untrusted — looseObject/hostile-peer by design). A
	// bare `"grid"` chrome name used to collide with a design that happened to
	// have a node id of `"grid"`, silently hiding it from every export. The
	// chrome group is namespaced specifically so this can't happen.
	it("does not hide a design node whose id happens to be 'grid'", () => {
		const content = fakeLayer("content");
		const userNode = fakeGroup("grid");
		const stage = fakeStage([content], [userNode]);

		const url = exportStageContentDataURL(stage);

		expect(userNode._isVisible()).toBe(true);
		expect(url).toBe("data:image/png;base64,content+grid@1,1+0,0");
	});

	// E-14: `exportStageContentDataURL` used to hide chrome but leave the
	// live viewport's pan/zoom untouched. `rasterExporter` (E-8) neutralized
	// it itself before calling in, but `CanvasExportBridge`-driven DesignBlock
	// previews called straight into this function with no such reset, so a
	// saved preview shifted/cropped (and its resolution varied with zoom)
	// whenever the stage was panned/zoomed. The reset now lives here, so
	// every caller gets it for free.
	it("captures at 1:1 scale/0,0 position regardless of the live viewport's pan/zoom", () => {
		const content = fakeLayer("content");
		const stage = fakeStage([content], [], {
			scale: { x: 2, y: 2 },
			position: { x: 100, y: 50 },
		});

		const url = exportStageContentDataURL(stage);

		expect(url).toBe("data:image/png;base64,content@1,1+0,0");
	});

	it("restores the viewport's original scale/position (and redraws) after serialization", () => {
		const content = fakeLayer("content");
		const stage = fakeStage([content], [], {
			scale: { x: 2, y: 2 },
			position: { x: 100, y: 50 },
		});

		exportStageContentDataURL(stage);

		expect(stage.scale()).toEqual({ x: 2, y: 2 });
		expect(stage.position()).toEqual({ x: 100, y: 50 });
		expect(stage.batchDraw).toHaveBeenCalledTimes(1);
	});

	it("does not redraw for a viewport that was already at 1:1 scale/0,0 position", () => {
		const content = fakeLayer("content");
		const stage = fakeStage([content]);
		exportStageContentDataURL(stage);
		expect(stage.batchDraw).not.toHaveBeenCalled();
	});

	// K-2. `toDataURL` with no rect does NOT capture the page: Konva resolves
	// both the origin and the size from `getClientRect()`, which for a Stage is
	// the union of every visible child — stroke- and shadow-inflated, and taken
	// before any `clipFunc` applies. A node overhanging the page edge, a drop
	// shadow, or an oversized photo inside a clipping frame therefore resized
	// and re-origined the export. Passing the rect explicitly is what bounds the
	// output to the page, whatever the content does.
	describe("capture rectangle", () => {
		it("captures the page rect rather than Konva's content bounding box", () => {
			const content = fakeLayer("content");
			const stage = fakeStage([content]);

			exportStageContentDataURL(stage, { pixelRatio: 2 });

			expect(stage.toDataURL).toHaveBeenCalledWith({
				pixelRatio: 2,
				x: 0,
				y: 0,
				width: PAGE.width,
				height: PAGE.height,
			});
		});

		// The stage BOX is `page × zoom` (see `<CanvasStudio>`), so reading
		// `stage.width()` alone would export a canvas `zoom` times too large with
		// the page stranded in its top-left corner. The rect has to be taken
		// against the pre-neutralization scale.
		it("recovers the page rect from a zoomed stage box", () => {
			const content = fakeLayer("content");
			const stage = fakeStage([content], [], {
				scale: { x: 2, y: 2 },
				position: { x: 100, y: 50 },
			});

			// Sanity: the stage really is twice the page, as the live editor sizes it.
			expect(stage.width()).toBe(PAGE.width * 2);

			exportStageContentDataURL(stage);

			expect(stage.toDataURL).toHaveBeenCalledWith({
				x: 0,
				y: 0,
				width: PAGE.width,
				height: PAGE.height,
			});
		});

		it("recovers the page rect at a zoom below 1", () => {
			const content = fakeLayer("content");
			const stage = fakeStage([content], [], {
				scale: { x: 0.5, y: 0.5 },
				position: { x: 0, y: 0 },
			});

			exportStageContentDataURL(stage);

			// Without the rect this exported at half the page and cropped the
			// bottom-right of the design away.
			expect(stage.toDataURL).toHaveBeenCalledWith({
				x: 0,
				y: 0,
				width: PAGE.width,
				height: PAGE.height,
			});
		});

		it("omits the rect for a stage that cannot be measured", () => {
			// Unit-test fakes exposing only `toDataURL` keep Konva's own defaults
			// rather than being handed a garbage rect.
			const toDataURL = vi.fn(() => "data:image/png;base64,PLAIN");
			const stage = { toDataURL } as unknown as Konva.Stage;

			exportStageContentDataURL(stage, { pixelRatio: 2 });

			expect(toDataURL).toHaveBeenCalledWith({ pixelRatio: 2 });
		});

		it("omits the rect for a degenerate zero scale", () => {
			// A zero scale would divide the stage box to Infinity. Better to fall
			// back to Konva's default than to request an impossible canvas.
			const content = fakeLayer("content");
			const stage = fakeStage([content], [], {
				scale: { x: 0, y: 0 },
				position: { x: 0, y: 0 },
			});

			exportStageContentDataURL(stage, { pixelRatio: 2 });

			expect(stage.toDataURL).toHaveBeenCalledWith({ pixelRatio: 2 });
		});
	});
});

/** Minimal culled-content fake: a node the K-12 controller hid. */
function fakeCulledNode(name: string, culled = true) {
	let visible = !culled;
	const visibleAtSerialize: boolean[] = [];
	return {
		name: () => name,
		getAttr: (key: string) => (key === "akCulled" ? culled : undefined),
		visible: vi.fn((next?: boolean) => {
			if (next === undefined) return visible;
			visible = next;
			return undefined as unknown as boolean;
		}),
		_isVisible: () => visible,
		_visibleAtSerialize: visibleAtSerialize,
	};
}

describe("exportStageContentDataURL — K-1/K-12 additions", () => {
	it("prefers the akSurfaceSize attr over the stage-box derivation (K-1)", () => {
		// A WINDOWED stage: the box is the viewport window (500×400 at zoom 2),
		// nothing like page × zoom. The attr carries the true page size, and
		// the capture rect must come from it.
		const content = fakeLayer("content");
		const stage = fakeStage(
			[content],
			[],
			{ scale: { x: 2, y: 2 }, position: { x: -300, y: -700 } },
			{ width: 250, height: 200 }, // stage box = 500×400 — the WINDOW
		);
		(stage as unknown as { getAttr: (k: string) => unknown }).getAttr = (
			key: string,
		) => (key === "akSurfaceSize" ? { width: 800, height: 600 } : undefined);

		exportStageContentDataURL(stage, { pixelRatio: 2 });

		expect(stage.toDataURL).toHaveBeenCalledWith({
			pixelRatio: 2,
			x: 0,
			y: 0,
			width: 800,
			height: 600,
		});
	});

	it("falls back to the stage-box derivation when the attr is absent or junk", () => {
		const content = fakeLayer("content");
		const stage = fakeStage([content], [], {
			scale: { x: 2, y: 2 },
			position: { x: 0, y: 0 },
		});
		(stage as unknown as { getAttr: (k: string) => unknown }).getAttr = (
			key: string,
		) => (key === "akSurfaceSize" ? { width: Number.NaN, height: 0 } : undefined);

		exportStageContentDataURL(stage);

		expect(stage.toDataURL).toHaveBeenCalledWith({
			x: 0,
			y: 0,
			width: PAGE.width,
			height: PAGE.height,
		});
	});

	it("unhides viewport-culled nodes for the capture and re-hides them after (K-12)", () => {
		const content = fakeLayer("content");
		const culled = fakeCulledNode("ak-culled-node");
		const stage = fakeStage([content], [culled as never]);
		// Snapshot the culled node's visibility at the moment of serialization.
		const toDataURL = stage.toDataURL as unknown as ReturnType<typeof vi.fn>;
		toDataURL.mockImplementation(() => {
			culled._visibleAtSerialize.push(culled._isVisible());
			return "data:image/png;base64,SNAP";
		});

		exportStageContentDataURL(stage);

		// Visible DURING the capture…
		expect(culled._visibleAtSerialize).toEqual([true]);
		// …and re-hidden afterwards (the culling controller still owns it).
		expect(culled._isVisible()).toBe(false);
		expect(stage.batchDraw).toHaveBeenCalled();
	});

	it("leaves un-culled and already-visible nodes alone", () => {
		const content = fakeLayer("content");
		const notCulled = fakeCulledNode("ordinary", false);
		const stage = fakeStage([content], [notCulled as never]);

		exportStageContentDataURL(stage);

		// Never toggled: `visible(false)`/`visible(true)` writes would show up
		// as calls with an argument.
		const writes = (
			notCulled.visible as unknown as ReturnType<typeof vi.fn>
		).mock.calls.filter((args: unknown[]) => args.length > 0);
		expect(writes).toEqual([]);
		expect(notCulled._isVisible()).toBe(true);
	});
});
