import {
	type CanvasIR,
	createCanvasIR,
	createFrame,
	createGroup,
	createPage,
	createRect,
} from "@anvilkit/canvas-core";
import type Konva from "konva";
import { describe, expect, it } from "vitest";
import {
	makeHarness,
	pointerEvent,
} from "../tools/__tests__/_tool-test-helpers.js";
import { ellipseTool } from "../tools/ellipse-tool.js";
import { frameTool } from "../tools/frame-tool.js";
import { handTool } from "../tools/hand-tool.js";
import { imageTool } from "../tools/image-tool.js";
import { lineTool } from "../tools/line-tool.js";
import { polygonTool } from "../tools/polygon-tool.js";
import { rectTool } from "../tools/rect-tool.js";
import { richTextTool } from "../tools/rich-text-tool.js";
import { selectTool } from "../tools/select-tool.js";
import { starTool } from "../tools/star-tool.js";
import { textTool } from "../tools/text-tool.js";

/**
 * MVP-7 (PRD FR-011) contract: a full pointer interaction (down → many
 * pointermove → up) commits at most ONE history entry per tool, and never
 * commits during pointermove. This file is the phase-execute exit gate —
 * if any tool regresses to per-frame commits, this suite fails.
 */
describe("MVP-7 single-command-per-interaction contract", () => {
	function fullSequence<T>(
		tool: {
			onPointerDown?: (e: ReturnType<typeof pointerEvent>, ctx: T) => void;
			onPointerMove?: (e: ReturnType<typeof pointerEvent>, ctx: T) => void;
			onPointerUp?: (e: ReturnType<typeof pointerEvent>, ctx: T) => void;
		},
		ctx: T,
		opts: {
			downAt?: { x: number; y: number };
			upAt?: { x: number; y: number };
			moveCount?: number;
			onDuringMove?: () => void;
			downTarget?: Konva.Node;
			downShift?: boolean;
		} = {},
	): void {
		const down = opts.downAt ?? { x: 50, y: 50 };
		const up = opts.upAt ?? { x: 150, y: 130 };
		const count = opts.moveCount ?? 10;
		tool.onPointerDown?.(
			pointerEvent(down.x, down.y, {
				target: opts.downTarget,
				shiftKey: opts.downShift,
			}),
			ctx,
		);
		for (let i = 0; i < count; i++) {
			const t = (i + 1) / count;
			const x = down.x + (up.x - down.x) * t;
			const y = down.y + (up.y - down.y) * t;
			tool.onPointerMove?.(pointerEvent(x, y), ctx);
			opts.onDuringMove?.();
		}
		tool.onPointerUp?.(pointerEvent(up.x, up.y), ctx);
	}

	it("rect tool: 1 node.create on pointerup, zero during move", () => {
		const h = makeHarness();
		fullSequence(rectTool, h.ctx, {
			onDuringMove: () => expect(h.commits).toHaveLength(0),
		});
		expect(h.commits).toHaveLength(1);
		expect(h.commits[0]?.type).toBe("node.create");
	});

	it("ellipse tool: 1 node.create on pointerup, zero during move", () => {
		const h = makeHarness();
		fullSequence(ellipseTool, h.ctx, {
			onDuringMove: () => expect(h.commits).toHaveLength(0),
		});
		expect(h.commits).toHaveLength(1);
		expect(h.commits[0]?.type).toBe("node.create");
	});

	it("polygon tool: 1 node.create on pointerup, zero during move", () => {
		const h = makeHarness();
		fullSequence(polygonTool, h.ctx, {
			onDuringMove: () => expect(h.commits).toHaveLength(0),
		});
		expect(h.commits).toHaveLength(1);
		expect(h.commits[0]?.type).toBe("node.create");
	});

	it("star tool: 1 node.create on pointerup, zero during move", () => {
		const h = makeHarness();
		fullSequence(starTool, h.ctx, {
			onDuringMove: () => expect(h.commits).toHaveLength(0),
		});
		expect(h.commits).toHaveLength(1);
		expect(h.commits[0]?.type).toBe("node.create");
	});

	it("line tool: 1 node.create on pointerup, zero during move", () => {
		const h = makeHarness();
		fullSequence(lineTool, h.ctx, {
			onDuringMove: () => expect(h.commits).toHaveLength(0),
		});
		expect(h.commits).toHaveLength(1);
		expect(h.commits[0]?.type).toBe("node.create");
	});

	it("text tool: 1 node.create on pointerdown; move/up undefined so still 1", () => {
		const h = makeHarness();
		fullSequence(textTool, h.ctx, {
			onDuringMove: () =>
				// text tool has no onPointerMove — count should hold at 1.
				expect(h.commits).toHaveLength(1),
		});
		expect(h.commits).toHaveLength(1);
		expect(h.commits[0]?.type).toBe("node.create");
	});

	it("rich-text tool: 1 node.create on pointerdown; move/up undefined so still 1", () => {
		const h = makeHarness();
		fullSequence(richTextTool, h.ctx, {
			onDuringMove: () =>
				// rich-text tool has no onPointerMove — count should hold at 1.
				expect(h.commits).toHaveLength(1),
		});
		expect(h.commits).toHaveLength(1);
		expect(h.commits[0]?.type).toBe("node.create");
	});

	it("frame tool: 1 node.create on pointerup, zero during move", () => {
		const h = makeHarness();
		fullSequence(frameTool, h.ctx, {
			onDuringMove: () => expect(h.commits).toHaveLength(0),
		});
		expect(h.commits).toHaveLength(1);
		expect(h.commits[0]?.type).toBe("node.create");
	});

	it("image tool: 1 node.create after async pickAsset resolves", async () => {
		const h = makeHarness();
		imageTool.onPointerDown?.(pointerEvent(50, 50), h.ctx);
		// pickAsset is mocked as Promise.resolve('asset-1') in the harness.
		await Promise.resolve();
		await Promise.resolve();
		expect(h.commits).toHaveLength(1);
		expect(h.commits[0]?.type).toBe("node.create");
	});

	// Placing into an image well needs TWO commands (insert the child image, then
	// point the frame's placeholder at it). The single-command-per-gesture
	// contract is about undo steps, not raw command count — so they must leave as
	// exactly one `commitBatch`, never as two loose `commit`s. The harness
	// flattens a batch into `commits`, which is why this asserts on the call
	// counts rather than on `commits.length`.
	it("image tool into a frame well: 2 commands, but exactly ONE undo step", async () => {
		const TS = "2026-05-20T00:00:00.000Z";
		const page = createPage({ id: "p1" });
		page.root = createGroup({
			id: "p1-root",
			bounds: page.root.bounds,
			children: [
				createFrame({
					id: "well",
					bounds: { width: 200, height: 100 },
					clip: true,
					placeholder: { kind: "image" },
				}),
			],
		});
		const h = makeHarness({
			ir: createCanvasIR({ id: "ir-1", pages: [page], now: () => TS }),
		});
		imageTool.onPointerDown?.(pointerEvent(50, 50), h.ctx);
		await Promise.resolve();
		await Promise.resolve();

		expect(h.ctx.commitBatch).toHaveBeenCalledTimes(1);
		expect(h.ctx.commit).not.toHaveBeenCalled();
		expect(h.commits.map((c) => c.type)).toEqual([
			"node.create",
			"node.update",
		]);
	});

	it("select tool — drag selected node: 1 node.move on pointerup, zero during move", () => {
		const h = makeHarness();
		const FIXED_TS = "2026-05-20T00:00:00.000Z";
		const ir: CanvasIR = (() => {
			const page = createPage({ id: "p1" });
			page.root = createGroup({
				id: "p1-root",
				bounds: page.root.bounds,
				children: [
					createRect({
						id: "rectA",
						bounds: { width: 100, height: 50 },
						transform: { x: 10, y: 20 },
					}),
				],
			});
			return createCanvasIR({
				id: "ir-1",
				pages: [page],
				now: () => FIXED_TS,
			});
		})();
		h.ctx.getIR = () => ir;
		// Stage findOne returns a node mock with position(); select-tool calls
		// `position(...)` during direct mutation.
		(h.ctx.stage as unknown as { findOne: (sel: string) => unknown }).findOne =
			() => ({ position: () => undefined });
		const rectTarget = {
			name: () => "rectA",
			getParent: () => null,
		} as unknown as Konva.Node;
		fullSequence(selectTool, h.ctx, {
			downAt: { x: 15, y: 25 },
			upAt: { x: 200, y: 100 },
			downTarget: rectTarget,
			onDuringMove: () => expect(h.commits).toHaveLength(0),
		});
		expect(h.commits).toHaveLength(1);
		expect(h.commits[0]?.type).toBe("node.move");
	});

	it("select tool — marquee on empty stage: zero commits (selection-only)", () => {
		const h = makeHarness();
		const emptyTarget = {
			name: () => "",
			getParent: () => null,
		} as unknown as Konva.Node;
		fullSequence(selectTool, h.ctx, {
			downAt: { x: 0, y: 0 },
			upAt: { x: 200, y: 200 },
			downTarget: emptyTarget,
			onDuringMove: () => expect(h.commits).toHaveLength(0),
		});
		expect(h.commits).toHaveLength(0);
	});

	it("hand tool: zero commits (pan is view-only)", () => {
		const h = makeHarness();
		fullSequence(handTool, h.ctx, {
			onDuringMove: () => expect(h.commits).toHaveLength(0),
		});
		expect(h.commits).toHaveLength(0);
	});
});

describe("MVP-7 source audit: no commits inside any pointermove handler", () => {
	// This complements the runtime assertions above with a textual audit.
	// If a future tool regresses by calling `ctx.commit(...)` inside its
	// onPointerMove body, this test would need to be relaxed AND a new
	// runtime test added — that combo makes accidental regressions noisy.
	const tools = [
		{ name: "rect", source: rectTool.onPointerMove?.toString() ?? "" },
		{ name: "frame", source: frameTool.onPointerMove?.toString() ?? "" },
		{ name: "ellipse", source: ellipseTool.onPointerMove?.toString() ?? "" },
		{ name: "polygon", source: polygonTool.onPointerMove?.toString() ?? "" },
		{ name: "star", source: starTool.onPointerMove?.toString() ?? "" },
		{ name: "line", source: lineTool.onPointerMove?.toString() ?? "" },
		{ name: "select", source: selectTool.onPointerMove?.toString() ?? "" },
		{ name: "hand", source: handTool.onPointerMove?.toString() ?? "" },
	];
	for (const t of tools) {
		it(`${t.name} tool's onPointerMove does not call ctx.commit`, () => {
			// The handler body, stringified, must NOT contain a commit invocation.
			// (Stringification is robust because TS compiles these to function
			// expressions; ctx.commit shows up verbatim in the source.)
			expect(t.source).not.toMatch(/\bcommit\s*\(/);
		});
	}
});
