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

/** Fake stage exposing getLayers/find/scale/position/toDataURL/batchDraw. */
function fakeStage(
	layers: ReturnType<typeof fakeLayer>[],
	groups: ReturnType<typeof fakeGroup>[] = [],
	viewport: { scale: Vector2d; position: Vector2d } = {
		scale: { x: 1, y: 1 },
		position: { x: 0, y: 0 },
	},
) {
	let scale = viewport.scale;
	let position = viewport.position;
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
});
