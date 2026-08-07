import {
	applyCommand,
	type CanvasFrameNode,
	type CanvasImageNode,
	type CanvasIR,
	type CanvasNodeUpdateCommand,
	createCanvasIR,
	createFrame,
	createImage,
	createPage,
	findNode,
	resolveFrameClipShape,
} from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import {
	buildFrameShapeCommands,
	commitFrameShapeChoice,
	DEFAULT_POLYGON_SIDES,
	DEFAULT_STAR_INNER_RADIUS_RATIO,
	DEFAULT_STAR_POINTS,
	FRAME_SHAPE_CHOICES,
	frameRepositionTarget,
	frameShapeChoice,
	frameShapeForChoice,
	wellImageIsVisible,
} from "../frame-shape-actions.js";

/**
 * cp4-004 — the frame CLIP-SHAPE command layer.
 *
 * The three operations this task ships (apply, release, reposition) each have
 * to be exactly ONE undo step, and the acceptance criteria turn on properties
 * that are easy to get subtly wrong: `clip` staying the single on/off switch,
 * a release never collapsing the image, and a reposition never touching the
 * shape. Each of those has a named test below.
 */

const IMAGE_ASSET = {
	id: "asset-1",
	uri: "https://cdn/photo.png",
	width: 400,
	height: 200,
};

interface FixtureOptions {
	clip?: boolean;
	shape?: CanvasFrameNode["shape"];
	/** `false` builds a PLAIN frame (no placeholder), i.e. not an image well. */
	well?: boolean;
	/** Geometry for the image filling the well; omitted = no image at all. */
	image?: { x: number; y: number; width: number; height: number };
}

function fixtureIR(opts: FixtureOptions = {}): CanvasIR {
	const children: CanvasImageNode[] = opts.image
		? [
				createImage({
					id: "photo",
					assetId: "asset-1",
					bounds: { width: opts.image.width, height: opts.image.height },
					transform: { x: opts.image.x, y: opts.image.y },
				}),
			]
		: [];
	const page = createPage({ id: "p1", size: { width: 800, height: 600 } });
	page.root.children = [
		{
			...createFrame({
				id: "well",
				bounds: { width: 200, height: 200 },
				transform: { x: 100, y: 100 },
				children,
			}),
			...(opts.clip === undefined ? {} : { clip: opts.clip }),
			...(opts.shape === undefined ? {} : { shape: opts.shape }),
			...(opts.well === false
				? {}
				: { placeholder: { kind: "image" as const, assetId: "asset-1" } }),
		},
	];
	const ir = createCanvasIR({ id: "doc", pages: [page] });
	ir.assets["asset-1"] = IMAGE_ASSET;
	return ir;
}

function frameOf(ir: CanvasIR, id = "well"): CanvasFrameNode {
	const found = findNode(ir, id);
	if (!found || found.node.type !== "frame") throw new Error(`no frame ${id}`);
	return found.node;
}

function imageOf(ir: CanvasIR, id = "photo"): CanvasImageNode {
	const found = findNode(ir, id);
	if (!found || found.node.type !== "image") throw new Error(`no image ${id}`);
	return found.node;
}

/** Harness whose commit/commitBatch APPLY through the real history store. */
function liveSetup(ir: CanvasIR) {
	const h = makeHarness({ ir });
	const history = h.studioCtx.historyStore;
	h.studioCtx.commit = (cmd) => {
		const next = history.getState().commit(h.studioCtx.getIR(), cmd);
		h.setIR(next);
		return next;
	};
	h.studioCtx.commitBatch = (cmds, label) => {
		const next = history
			.getState()
			.commitBatch(h.studioCtx.getIR(), cmds, label);
		h.setIR(next);
		return next;
	};
	return h;
}

describe("frameShapeChoice / frameShapeForChoice (cp4-004 picker mapping)", () => {
	it("reads 'none' from the RESOLVER's default source, not a raw shape read", () => {
		const frame = frameOf(fixtureIR({ clip: true }));
		expect(resolveFrameClipShape(frame).source).toBe("default");
		expect(frameShapeChoice(frame)).toBe("none");
	});

	it("keeps an explicit rect distinguishable from no shape at all", () => {
		const frame = frameOf(fixtureIR({ clip: true, shape: { kind: "rect" } }));
		expect(resolveFrameClipShape(frame).source).toBe("declared");
		expect(frameShapeChoice(frame)).toBe("rect");
	});

	it("reports no selection for a kind this build cannot draw", () => {
		const frame = frameOf(
			fixtureIR({
				clip: true,
				shape: { kind: "hexagram" } as unknown as CanvasFrameNode["shape"],
			}),
		);
		expect(resolveFrameClipShape(frame).source).toBe("degraded");
		expect(frameShapeChoice(frame)).toBeUndefined();
	});

	it("seeds fresh polygon/star parameters and carries declared ones over", () => {
		const fresh = frameOf(fixtureIR({ clip: true }));
		expect(frameShapeForChoice("polygon", fresh)).toEqual({
			kind: "polygon",
			sides: DEFAULT_POLYGON_SIDES,
		});
		expect(frameShapeForChoice("star", fresh)).toEqual({
			kind: "star",
			points: DEFAULT_STAR_POINTS,
			innerRadiusRatio: DEFAULT_STAR_INNER_RADIUS_RATIO,
		});
		const tuned = frameOf(
			fixtureIR({
				clip: true,
				shape: { kind: "star", points: 9, innerRadiusRatio: 0.2 },
			}),
		);
		expect(frameShapeForChoice("star", tuned)).toEqual({
			kind: "star",
			points: 9,
			innerRadiusRatio: 0.2,
		});
	});

	it("seeds a fresh path from the frame's OWN box (path data is frame-local)", () => {
		const frame = frameOf(fixtureIR({ clip: true }));
		expect(frameShapeForChoice("path", frame)).toEqual({
			kind: "path",
			d: "M 100 0 L 200 100 L 100 200 L 0 100 Z",
		});
	});

	it("every picker choice round-trips through frameShapeForChoice", () => {
		const frame = frameOf(fixtureIR({ clip: true }));
		for (const choice of FRAME_SHAPE_CHOICES) {
			const shape = frameShapeForChoice(choice, frame);
			expect(shape?.kind ?? "none").toBe(choice);
		}
	});
});

describe("buildFrameShapeCommands (cp4-004 command shapes)", () => {
	it("applying a shape turns `clip` ON — a shape alone is inert", () => {
		const frame = frameOf(fixtureIR({ clip: false }));
		const [cmd] = buildFrameShapeCommands({
			frame,
			shape: { kind: "ellipse" },
		}) as [CanvasNodeUpdateCommand<"frame">];
		expect(cmd.patch).toMatchObject({
			shape: { kind: "ellipse" },
			clip: true,
		});
	});

	it("leaves `clip` out of the patch when it is already on", () => {
		const frame = frameOf(fixtureIR({ clip: true }));
		const [cmd] = buildFrameShapeCommands({
			frame,
			shape: { kind: "ellipse" },
		}) as [CanvasNodeUpdateCommand<"frame">];
		expect(Object.keys(cmd.patch)).toEqual(["shape"]);
	});

	it("releasing NEVER turns `clip` back off — that would spill a cover-filled image", () => {
		const frame = frameOf(
			fixtureIR({
				clip: true,
				shape: { kind: "ellipse" },
				image: { x: -100, y: 0, width: 400, height: 200 },
			}),
		);
		const [cmd] = buildFrameShapeCommands({ frame, shape: undefined }) as [
			CanvasNodeUpdateCommand<"frame">,
		];
		expect(cmd.patch).toEqual({ shape: undefined });
		expect("clip" in cmd.patch).toBe(false);
	});

	it("promotes an EMPTY, placeholder-less frame to an image well so drops land inside it", () => {
		const frame = frameOf(fixtureIR({ clip: false, well: false }));
		const [cmd] = buildFrameShapeCommands({
			frame,
			shape: { kind: "star", points: 5, innerRadiusRatio: 0.5 },
		}) as [CanvasNodeUpdateCommand<"frame">];
		expect(cmd.patch).toMatchObject({ placeholder: { kind: "image" } });
	});

	it("never promotes a frame that already holds children", () => {
		const frame = frameOf(
			fixtureIR({
				clip: false,
				well: false,
				image: { x: 0, y: 0, width: 200, height: 200 },
			}),
		);
		const [cmd] = buildFrameShapeCommands({
			frame,
			shape: { kind: "ellipse" },
		}) as [CanvasNodeUpdateCommand<"frame">];
		expect("placeholder" in cmd.patch).toBe(false);
	});

	it("leaves a VISIBLE well image completely untouched", () => {
		const frame = frameOf(
			fixtureIR({
				clip: true,
				image: { x: -100, y: 0, width: 400, height: 200 },
			}),
		);
		const commands = buildFrameShapeCommands({
			frame,
			shape: { kind: "ellipse" },
			asset: IMAGE_ASSET,
		});
		expect(commands).toHaveLength(1);
	});

	it("restores a collapsed well image to cover geometry in the SAME batch", () => {
		const frame = frameOf(
			fixtureIR({ clip: true, image: { x: 0, y: 0, width: 0, height: 0 } }),
		);
		const commands = buildFrameShapeCommands({
			frame,
			shape: undefined,
			asset: IMAGE_ASSET,
		});
		expect(commands).toHaveLength(2);
		const restore = commands[1] as CanvasNodeUpdateCommand<"image">;
		expect(restore).toMatchObject({ nodeId: "photo", kind: "image" });
		// cover of a 400×200 asset into a 200×200 box: scale 1, centred vertically.
		expect(restore.patch.bounds).toEqual({ width: 400, height: 200 });
		expect(restore.patch.transform).toMatchObject({ x: -100, y: 0 });
	});

	it("restores an image dragged entirely outside the frame's box", () => {
		const frame = frameOf(
			fixtureIR({
				clip: true,
				image: { x: 5000, y: 0, width: 400, height: 200 },
			}),
		);
		const commands = buildFrameShapeCommands({
			frame,
			shape: undefined,
			asset: IMAGE_ASSET,
		});
		expect(commands).toHaveLength(2);
	});
});

describe("wellImageIsVisible", () => {
	const frame = frameOf(fixtureIR({ clip: true }));
	const image = (x: number, y: number, w: number, h: number) =>
		createImage({
			id: "i",
			assetId: "asset-1",
			bounds: { width: w, height: h },
			transform: { x, y },
		});

	it("accepts any positive-area overlap with the frame box", () => {
		expect(wellImageIsVisible(frame, image(0, 0, 200, 200))).toBe(true);
		expect(wellImageIsVisible(frame, image(-100, 0, 400, 200))).toBe(true);
		expect(wellImageIsVisible(frame, image(199, 199, 10, 10))).toBe(true);
	});

	it("rejects zero area, non-finite placement, and no overlap", () => {
		expect(wellImageIsVisible(frame, image(0, 0, 0, 200))).toBe(false);
		expect(wellImageIsVisible(frame, image(Number.NaN, 0, 10, 10))).toBe(false);
		expect(wellImageIsVisible(frame, image(200, 0, 10, 10))).toBe(false);
		expect(wellImageIsVisible(frame, image(-10, 0, 10, 10))).toBe(false);
	});
});

describe("command inverses round-trip in ONE undo step (cp4-004)", () => {
	/** Apply every command in order, composing the inverses back-to-front. */
	function applyAll(
		ir: CanvasIR,
		commands: readonly ReturnType<typeof buildFrameShapeCommands>[number][],
	) {
		let current = ir;
		const inverses: unknown[] = [];
		for (const cmd of commands) {
			const result = applyCommand(current, cmd, {});
			current = result.ir;
			inverses.unshift(result.inverse);
		}
		return { ir: current, inverses };
	}

	it("apply → inverse restores the frame exactly, including `clip`", () => {
		const before = fixtureIR({ clip: false });
		const commands = buildFrameShapeCommands({
			frame: frameOf(before),
			shape: { kind: "polygon", sides: 6 },
		});
		const applied = applyAll(before, commands);
		expect(frameOf(applied.ir).shape).toEqual({ kind: "polygon", sides: 6 });
		expect(frameOf(applied.ir).clip).toBe(true);

		let undone = applied.ir;
		for (const inv of applied.inverses) {
			undone = applyCommand(undone, inv as never, {}).ir;
		}
		expect(frameOf(undone).shape).toBeUndefined();
		// Back to the fixture's explicit `clip: false`, not to "absent" — the
		// inverse restores the PRIOR value of every key the patch touched.
		expect(frameOf(undone).clip).toBe(false);
	});

	it("release → inverse restores the declared shape", () => {
		const before = fixtureIR({ clip: true, shape: { kind: "ellipse" } });
		const commands = buildFrameShapeCommands({
			frame: frameOf(before),
			shape: undefined,
		});
		const applied = applyAll(before, commands);
		expect(frameOf(applied.ir).shape).toBeUndefined();

		let undone = applied.ir;
		for (const inv of applied.inverses) {
			undone = applyCommand(undone, inv as never, {}).ir;
		}
		expect(frameOf(undone).shape).toEqual({ kind: "ellipse" });
		expect(frameOf(undone).clip).toBe(true);
	});

	it("a restore-carrying release round-trips the image geometry too", () => {
		const before = fixtureIR({
			clip: true,
			shape: { kind: "star", points: 5, innerRadiusRatio: 0.5 },
			image: { x: 0, y: 0, width: 0, height: 0 },
		});
		const commands = buildFrameShapeCommands({
			frame: frameOf(before),
			shape: undefined,
			asset: IMAGE_ASSET,
		});
		const applied = applyAll(before, commands);
		expect(imageOf(applied.ir).bounds).toEqual({ width: 400, height: 200 });

		let undone = applied.ir;
		for (const inv of applied.inverses) {
			undone = applyCommand(undone, inv as never, {}).ir;
		}
		expect(imageOf(undone).bounds).toEqual({ width: 0, height: 0 });
		expect(frameOf(undone).shape).toEqual({
			kind: "star",
			points: 5,
			innerRadiusRatio: 0.5,
		});
	});
});

describe("commitFrameShapeChoice (cp4-004 — one action, one history entry)", () => {
	it("applying a shape is a single undo step, and redo restores it", () => {
		const h = liveSetup(fixtureIR({ clip: false }));
		const s = h.studioCtx;
		expect(commitFrameShapeChoice(s, [frameOf(s.getIR())], "ellipse")).toBe(
			true,
		);
		expect(frameOf(s.getIR()).shape).toEqual({ kind: "ellipse" });
		expect(frameOf(s.getIR()).clip).toBe(true);

		const history = s.historyStore.getState();
		h.setIR(history.undo(s.getIR()));
		expect(frameOf(s.getIR()).shape).toBeUndefined();
		expect(frameOf(s.getIR()).clip).toBe(false);
		expect(s.historyStore.getState().canUndo()).toBe(false);

		h.setIR(s.historyStore.getState().redo(s.getIR()));
		expect(frameOf(s.getIR()).shape).toEqual({ kind: "ellipse" });
		expect(frameOf(s.getIR()).clip).toBe(true);
	});

	it("releasing a shape is a single undo step and leaves a SANE, VISIBLE image", () => {
		const h = liveSetup(
			fixtureIR({
				clip: true,
				shape: { kind: "ellipse" },
				image: { x: 0, y: 0, width: 0, height: 0 },
			}),
		);
		const s = h.studioCtx;
		expect(commitFrameShapeChoice(s, [frameOf(s.getIR())], "none")).toBe(true);

		const frame = frameOf(s.getIR());
		expect(frame.shape).toBeUndefined();
		// Still clipping — releasing a mask must not let the photo spill.
		expect(frame.clip).toBe(true);
		expect(wellImageIsVisible(frame, imageOf(s.getIR()))).toBe(true);

		// ONE undo puts both the shape and the image geometry back.
		h.setIR(s.historyStore.getState().undo(s.getIR()));
		expect(frameOf(s.getIR()).shape).toEqual({ kind: "ellipse" });
		expect(imageOf(s.getIR()).bounds).toEqual({ width: 0, height: 0 });
		expect(s.historyStore.getState().canUndo()).toBe(false);
	});

	it("patches a whole multi-frame selection as ONE entry", () => {
		const ir = fixtureIR({ clip: true });
		const page = ir.pages[0];
		if (!page) throw new Error("no page");
		page.root.children = [
			...page.root.children,
			{
				...createFrame({
					id: "well-2",
					bounds: { width: 100, height: 100 },
					children: [],
				}),
				clip: true,
				placeholder: { kind: "image" as const },
			},
		];
		const h = liveSetup(ir);
		const s = h.studioCtx;
		const frames = [frameOf(s.getIR(), "well"), frameOf(s.getIR(), "well-2")];
		expect(commitFrameShapeChoice(s, frames, "ellipse")).toBe(true);
		expect(frameOf(s.getIR(), "well").shape).toEqual({ kind: "ellipse" });
		expect(frameOf(s.getIR(), "well-2").shape).toEqual({ kind: "ellipse" });

		h.setIR(s.historyStore.getState().undo(s.getIR()));
		expect(frameOf(s.getIR(), "well").shape).toBeUndefined();
		expect(frameOf(s.getIR(), "well-2").shape).toBeUndefined();
		expect(s.historyStore.getState().canUndo()).toBe(false);
	});

	it("mints no history entry for a no-op pick", () => {
		const h = liveSetup(fixtureIR({ clip: true, shape: { kind: "ellipse" } }));
		const s = h.studioCtx;
		expect(commitFrameShapeChoice(s, [frameOf(s.getIR())], "ellipse")).toBe(
			false,
		);
		expect(s.historyStore.getState().canUndo()).toBe(false);
	});
});

describe("frameRepositionTarget (cp4-004 double-click gesture)", () => {
	it("resolves a CLIPPING filled well to the image inside it", () => {
		const ir = fixtureIR({
			clip: true,
			shape: { kind: "ellipse" },
			image: { x: 0, y: 0, width: 200, height: 200 },
		});
		expect(frameRepositionTarget(ir, frameOf(ir))?.id).toBe("photo");
	});

	it("resolves the image itself when the image is what was hit", () => {
		const ir = fixtureIR({
			clip: true,
			image: { x: 0, y: 0, width: 200, height: 200 },
		});
		expect(frameRepositionTarget(ir, imageOf(ir))?.id).toBe("photo");
	});

	it("declines an UNCLIPPED well — `clip` is the only on/off switch", () => {
		const ir = fixtureIR({
			clip: false,
			shape: { kind: "ellipse" },
			image: { x: 0, y: 0, width: 200, height: 200 },
		});
		expect(frameRepositionTarget(ir, frameOf(ir))).toBeUndefined();
		expect(frameRepositionTarget(ir, imageOf(ir))).toBeUndefined();
	});

	it("declines an empty well and a plain (non-well) frame", () => {
		const empty = fixtureIR({ clip: true });
		expect(frameRepositionTarget(empty, frameOf(empty))).toBeUndefined();
		const plain = fixtureIR({
			clip: true,
			well: false,
			image: { x: 0, y: 0, width: 10, height: 10 },
		});
		expect(frameRepositionTarget(plain, frameOf(plain))).toBeUndefined();
		expect(frameRepositionTarget(plain, imageOf(plain))).toBeUndefined();
	});
});
