import {
	type CanvasCommand,
	type CanvasFrameNode,
	type CanvasImageNode,
	type CanvasIR,
	createCanvasIR,
	createFrame,
	createGroup,
	createImage,
	createPage,
	findNode,
} from "@anvilkit/canvas-core";
import { describe, expect, it, vi } from "vitest";
import { createHistoryStore } from "@/stores/history-store.js";
import { imageTool } from "../image-tool.js";
import { makeHarness, pointerEvent } from "./_tool-test-helpers.js";

const FIXED_TS = "2026-05-20T00:00:00.000Z";

/** A page holding one frame at (0,0) 200×100, plus a registered asset. */
function frameIR(frame: CanvasFrameNode): CanvasIR {
	const page = createPage({ id: "p1" });
	page.root = createGroup({
		id: "p1-root",
		bounds: page.root.bounds,
		children: [frame],
	});
	const ir = createCanvasIR({ id: "ir-1", pages: [page], now: () => FIXED_TS });
	ir.assets = {
		"asset-1": { id: "asset-1", uri: "data:1", width: 400, height: 100 },
		"asset-2": { id: "asset-2", uri: "data:2", width: 400, height: 100 },
	};
	return ir;
}

const well = (over: Partial<Parameters<typeof createFrame>[0]> = {}) =>
	createFrame({
		id: "well",
		bounds: { width: 200, height: 100 },
		clip: true,
		radius: 8,
		placeholder: { kind: "image" },
		...over,
	});

/**
 * A harness whose `commit`/`commitBatch` actually APPLY through a real history
 * store, so we can assert both the resulting IR and the undo depth. The default
 * harness is record-only.
 */
function liveHarness(ir: CanvasIR) {
	const h = makeHarness({ ir });
	const history = createHistoryStore();
	let current = ir;
	h.ctx.getIR = () => current;
	h.ctx.commit = vi.fn((cmd: CanvasCommand) => {
		current = history.getState().commit(current, cmd);
		return current;
	});
	h.ctx.commitBatch = vi.fn(
		(cmds: readonly CanvasCommand[], label?: string) => {
			current = history.getState().commitBatch(current, [...cmds], label);
			return current;
		},
	);
	return {
		h,
		history,
		getIR: () => current,
		undo: () => {
			current = history.getState().undo(current);
			return current;
		},
	};
}

/** Drain the two microtasks the mocked `pickAsset` promise needs to settle. */
async function settle(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

function frameOf(ir: CanvasIR, id = "well"): CanvasFrameNode {
	const found = findNode(ir, id);
	if (!found || found.node.type !== "frame") throw new Error("frame missing");
	return found.node;
}

describe("imageTool — placing into a frame", () => {
	it("places the image as a CHILD of the frame under the pointer, not a loose sibling", async () => {
		const env = liveHarness(frameIR(well()));
		imageTool.onPointerDown?.(pointerEvent(50, 50), env.h.ctx);
		await settle();

		const frame = frameOf(env.getIR());
		expect(frame.children).toHaveLength(1);
		expect(frame.children[0]?.type).toBe("image");
		// Nothing was dropped at the top level.
		const root = env.getIR().pages[0]?.root;
		expect(root?.children).toHaveLength(1);
		expect(root?.children[0]?.id).toBe("well");
	});

	it("fills the well's placeholder with the placed asset", async () => {
		const env = liveHarness(frameIR(well()));
		imageTool.onPointerDown?.(pointerEvent(50, 50), env.h.ctx);
		await settle();
		expect(frameOf(env.getIR()).placeholder).toEqual({
			kind: "image",
			assetId: "asset-1",
		});
	});

	// The whole point of `commitBatch`: the child insert AND the placeholder
	// update are two commands but one user action.
	it("is ONE undo step, and undo restores the empty well exactly", async () => {
		const env = liveHarness(frameIR(well()));
		imageTool.onPointerDown?.(pointerEvent(50, 50), env.h.ctx);
		await settle();
		expect(env.h.ctx.commitBatch).toHaveBeenCalledTimes(1);
		expect(env.history.getState().past).toHaveLength(1);

		const after = env.undo();
		const frame = frameOf(after);
		expect(frame.children).toHaveLength(0);
		expect(frame.placeholder?.assetId).toBeUndefined();
	});

	it("sizes the image to COVER the frame, preserving aspect and centring the overflow", async () => {
		// asset is 400×100 (4:1); frame is 200×100 (2:1). Cover ⇒ scale by
		// max(200/400, 100/100) = 1 ⇒ 400×100, centred ⇒ x = (200-400)/2 = -100.
		const env = liveHarness(frameIR(well()));
		imageTool.onPointerDown?.(pointerEvent(50, 50), env.h.ctx);
		await settle();
		const img = frameOf(env.getIR()).children[0] as CanvasImageNode;
		expect(img.bounds).toEqual({ width: 400, height: 100 });
		expect(img.transform.x).toBe(-100);
		expect(img.transform.y).toBe(0);
	});

	it("stretches to the box when the asset has no natural size", async () => {
		const ir = frameIR(well());
		ir.assets = { "asset-1": { id: "asset-1", uri: "data:1" } };
		const env = liveHarness(ir);
		imageTool.onPointerDown?.(pointerEvent(50, 50), env.h.ctx);
		await settle();
		const img = frameOf(env.getIR()).children[0] as CanvasImageNode;
		expect(img.bounds).toEqual({ width: 200, height: 100 });
		expect(img.transform.x).toBe(0);
	});

	it("keeps the frame's geometry, clip and radius untouched", async () => {
		const env = liveHarness(frameIR(well()));
		imageTool.onPointerDown?.(pointerEvent(50, 50), env.h.ctx);
		await settle();
		const frame = frameOf(env.getIR());
		expect(frame.bounds).toEqual({ width: 200, height: 100 });
		expect(frame.clip).toBe(true);
		expect(frame.radius).toBe(8);
	});

	it("selects the placed image, not the frame", async () => {
		const env = liveHarness(frameIR(well()));
		imageTool.onPointerDown?.(pointerEvent(50, 50), env.h.ctx);
		await settle();
		const img = frameOf(env.getIR()).children[0];
		expect(env.h.ctx.selectionStore.getState().selectedIds).toEqual([img?.id]);
	});

	it("falls back to a loose top-level image when the click misses every frame", async () => {
		const env = liveHarness(frameIR(well()));
		// (900,900) is far outside the 200×100 frame.
		imageTool.onPointerDown?.(pointerEvent(900, 900), env.h.ctx);
		await settle();
		expect(frameOf(env.getIR()).children).toHaveLength(0);
		const root = env.getIR().pages[0]?.root;
		expect(root?.children).toHaveLength(2);
		expect(root?.children[1]?.type).toBe("image");
	});
});

describe("imageTool — re-placing into a filled well", () => {
	const filled = () =>
		well({
			placeholder: { kind: "image", assetId: "asset-2" },
			children: [
				createImage({
					id: "old",
					bounds: { width: 400, height: 100 },
					transform: { x: -100, y: 0 },
					assetId: "asset-2",
					crop: { x: 10, y: 10, width: 50, height: 50 },
				}),
			],
		});

	// A well holds exactly ONE image. Without this, clicking a filled well again
	// would stack a second image on top of the first.
	it("replaces the well's image instead of stacking a second one", async () => {
		const env = liveHarness(frameIR(filled()));
		imageTool.onPointerDown?.(pointerEvent(50, 50), env.h.ctx);
		await settle();
		const frame = frameOf(env.getIR());
		expect(frame.children).toHaveLength(1);
		const img = frame.children[0] as CanvasImageNode;
		expect(img.id).toBe("old");
		expect(img.assetId).toBe("asset-1");
		expect(frame.placeholder?.assetId).toBe("asset-1");
	});

	it("preserves the replaced image's geometry AND its crop container", async () => {
		const env = liveHarness(frameIR(filled()));
		imageTool.onPointerDown?.(pointerEvent(50, 50), env.h.ctx);
		await settle();
		const img = frameOf(env.getIR()).children[0] as CanvasImageNode;
		expect(img.bounds).toEqual({ width: 400, height: 100 });
		expect(img.transform.x).toBe(-100);
		expect(img.crop).toEqual({ x: 10, y: 10, width: 50, height: 50 });
	});

	it("is ONE undo step, and undo restores the previous asset", async () => {
		const env = liveHarness(frameIR(filled()));
		imageTool.onPointerDown?.(pointerEvent(50, 50), env.h.ctx);
		await settle();
		expect(env.history.getState().past).toHaveLength(1);

		const after = env.undo();
		const frame = frameOf(after);
		expect((frame.children[0] as CanvasImageNode).assetId).toBe("asset-2");
		expect(frame.placeholder?.assetId).toBe("asset-2");
	});

	it("does nothing when the picked asset already fills the well", async () => {
		const env = liveHarness(frameIR(filled()));
		env.h.ctx.pickAsset = vi.fn(() => Promise.resolve("asset-2"));
		imageTool.onPointerDown?.(pointerEvent(50, 50), env.h.ctx);
		await settle();
		expect(env.h.ctx.commitBatch).not.toHaveBeenCalled();
		expect(env.h.ctx.commit).not.toHaveBeenCalled();
		expect(env.history.getState().past).toHaveLength(0);
	});
});

describe("imageTool — plain frame (no placeholder)", () => {
	it("accumulates children rather than replacing, since it is not an image well", async () => {
		const plain = createFrame({
			id: "plain",
			bounds: { width: 200, height: 100 },
			clip: true,
			children: [
				createImage({
					id: "existing",
					bounds: { width: 10, height: 10 },
					assetId: "asset-2",
				}),
			],
		});
		const env = liveHarness(frameIR(plain));
		imageTool.onPointerDown?.(pointerEvent(50, 50), env.h.ctx);
		await settle();

		const frame = frameOf(env.getIR(), "plain");
		expect(frame.children).toHaveLength(2);
		expect(frame.placeholder).toBeUndefined();
		// A single insert needs no batch — it is already one undo step.
		expect(env.h.ctx.commit).toHaveBeenCalledTimes(1);
		expect(env.h.ctx.commitBatch).not.toHaveBeenCalled();
	});
});

/**
 * Acceptance criterion: "No flattening — the document keeps frame + image as
 * separate nodes (verify in serialized IR)." These assert against the actual
 * JSON the document would be persisted as, not against in-memory objects.
 */
describe("frame image workflow — no flattening in the serialized IR", () => {
	it("place → replace → reset keeps frame and image as SEPARATE nodes, each one undo step", async () => {
		const env = liveHarness(frameIR(well()));

		// 1. Place.
		imageTool.onPointerDown?.(pointerEvent(50, 50), env.h.ctx);
		await settle();

		// 2. Replace (picker now returns a different asset).
		env.h.ctx.pickAsset = vi.fn(() => Promise.resolve("asset-2"));
		imageTool.onPointerDown?.(pointerEvent(50, 50), env.h.ctx);
		await settle();

		// 3. Crop, then reset it — both plain node.updates on the child image.
		const imgId = frameOf(env.getIR()).children[0]?.id ?? "";
		env.h.ctx.commit({
			type: "node.update",
			nodeId: imgId,
			kind: "image",
			patch: { crop: { x: 1, y: 2, width: 3, height: 4 } },
		});
		env.h.ctx.commit({
			type: "node.update",
			nodeId: imgId,
			kind: "image",
			patch: { crop: undefined },
		});

		// Serialize exactly as the document would be persisted.
		const doc = JSON.parse(JSON.stringify(env.getIR())) as CanvasIR;
		const frame = doc.pages[0]?.root.children[0] as CanvasFrameNode;

		expect(frame.type).toBe("frame");
		expect(frame.clip).toBe(true);
		expect(frame.radius).toBe(8);
		expect(frame.bounds).toEqual({ width: 200, height: 100 });

		// The image is still its own node under the frame — never merged into it.
		expect(frame.children).toHaveLength(1);
		const img = frame.children[0] as CanvasImageNode;
		expect(img.type).toBe("image");
		expect(img.assetId).toBe("asset-2");
		expect(img.crop).toBeUndefined();
		// The asset lives on the child, and the placeholder merely points at it.
		expect(frame.placeholder).toEqual({ kind: "image", assetId: "asset-2" });

		// Four gestures → four undo steps, and unwinding all of them restores the
		// pristine empty well.
		expect(env.history.getState().past).toHaveLength(4);
		env.undo();
		env.undo();
		env.undo();
		const back = frameOf(env.undo());
		expect(back.children).toHaveLength(0);
		expect(back.placeholder).toEqual({ kind: "image" });
		expect(back.clip).toBe(true);
		expect(back.radius).toBe(8);
	});
});
