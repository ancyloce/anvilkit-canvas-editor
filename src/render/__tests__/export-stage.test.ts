// @vitest-environment node
// Pure logic test (fake stage, no DOM) — runs under the node environment so it
// is independent of jsdom.
import type Konva from "konva";
import { describe, expect, it, vi } from "vitest";
import type { RenderLayerName } from "../../stage/RenderLayer.js";
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

/** Fake stage exposing getLayers/toDataURL/batchDraw. */
function fakeStage(layers: ReturnType<typeof fakeLayer>[]) {
	const toDataURL = vi.fn(
		// Snapshot which layers were visible at the moment of serialization,
		// so a test can prove chrome layers were hidden *during* the call.
		() =>
			`data:image/png;base64,${layers
				.filter((l) => l._isVisible())
				.map((l) => l.name())
				.join("+")}`,
	);
	const stage = {
		getLayers: () => layers as unknown as ReadonlyArray<Konva.Layer>,
		toDataURL,
		batchDraw: vi.fn(),
	};
	return stage as unknown as Konva.Stage & {
		batchDraw: ReturnType<typeof vi.fn>;
	};
}

describe("exportStageContentDataURL", () => {
	it("hides the selection + presence layers during serialization", () => {
		const background = fakeLayer("background");
		const objects = fakeLayer("objects");
		const drag = fakeLayer("drag");
		const selection = fakeLayer("selection");
		const presence = fakeLayer("presence");
		const stage = fakeStage([background, objects, drag, selection, presence]);

		const url = exportStageContentDataURL(stage, { pixelRatio: 2 });

		// Only content layers were visible at serialize time — selection and
		// presence (transformer handles, smart guides, remote cursors) were not.
		expect(url).toBe("data:image/png;base64,background+objects+drag");
	});

	it("restores chrome-layer visibility after serialization", () => {
		const objects = fakeLayer("objects");
		const selection = fakeLayer("selection");
		const presence = fakeLayer("presence");
		const stage = fakeStage([objects, selection, presence]);

		exportStageContentDataURL(stage);

		expect(selection._isVisible()).toBe(true);
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
});
