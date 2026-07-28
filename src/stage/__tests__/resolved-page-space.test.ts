import type { CanvasIR, CanvasNode } from "@anvilkit/canvas-core";
import {
	createCanvasIR,
	createFrame,
	createGroup,
	createPage,
	createRect,
	insertNode,
	marqueeHitsResolved,
	resolveCanvasLayout,
} from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import { getNodeWorldRect } from "../../snap/get-node-rect.js";
import { resolveNodeWorldPosition } from "../node-world-position.js";
import {
	createResolvedPageSpace,
	resolvedNodeWorldPosition,
} from "../resolved-page-space.js";

/**
 * @file T-M3-07 (TS-40) — the page-space adapter every migrated consumer
 * shares. The nested fixture is the M0 coordinate suite's, with the same
 * hand-derived numbers: the M0 suite pins the raw fallback path (including
 * its KNOWN LIMITATIONS); THIS file pins that the resolved path produces the
 * world-correct values the M0 suite names as the M3 target — the deliberate
 * flip it asks for, made in a new test rather than by rewriting the lock.
 */

/** group g (translate 100,50 + scale 2) → frame f (translate 10,20 + rot90) → rect r (5,5, 20×10). */
function nestedIR(): CanvasIR {
	const rect = createRect({
		id: "r",
		transform: { x: 5, y: 5 },
		bounds: { width: 20, height: 10 },
	});
	const frame = createFrame({
		id: "f",
		transform: { x: 10, y: 20, rotation: 90 },
		bounds: { width: 100, height: 40 },
		children: [rect],
	});
	const group = {
		...createGroup({
			id: "g",
			transform: { x: 100, y: 50, scaleX: 2, scaleY: 2 },
		}),
		children: [frame] as CanvasNode[],
	};
	const page = createPage({ id: "p1" });
	let ir = createCanvasIR({ id: "doc", title: "t", pages: [page] });
	ir = insertNode(ir, { parentId: page.root.id, node: group });
	return ir;
}

function nestedSpace() {
	const ir = nestedIR();
	const resolved = resolveCanvasLayout(ir, {});
	return { ir, resolved, space: createResolvedPageSpace(resolved) };
}

describe("createResolvedPageSpace", () => {
	it("passes resolver geometry through untouched for the identity root", () => {
		const { resolved, space } = nestedSpace();
		const record = resolved.records.get("r" as never);
		if (!record) throw new Error("no record for r");
		// Fast path: the very same objects, no compensation math.
		expect(space.aabbOf("r")).toBe(record.geometry.worldAabb);
		expect(space.matrixOf("r")).toBe(record.geometry.worldTransform);
	});

	it("matches the raw ancestor-composing walk on the nested fixture", () => {
		const { ir, resolved, space } = nestedSpace();
		expect(space.originOf("r")).toEqual(resolveNodeWorldPosition(ir, "r"));
		expect(space.originOf("r")?.x).toBeCloseTo(110, 6);
		expect(space.originOf("r")?.y).toBeCloseTo(100, 6);
		expect(resolvedNodeWorldPosition(resolved, "r")).toEqual(
			space.originOf("r"),
		);
	});

	it("reports the world box the M0 suite names as the snap target", () => {
		const { ir, space } = nestedSpace();
		const page = ir.pages[0];
		const group = page?.root.children[0];
		const frame =
			group && "children" in group ? (group.children[0] as CanvasNode) : null;
		const rect =
			frame && "children" in frame
				? ((frame as { children: CanvasNode[] }).children[0] as CanvasNode)
				: null;
		if (!rect) throw new Error("fixture rect missing");
		// The M0 suite pins the record-less fallback at the LOCAL box (5,5,20,10)
		// as a KNOWN LIMITATION; the resolved path is the world box it says M3
		// should produce.
		expect(getNodeWorldRect(rect)).toEqual({
			x: 5,
			y: 5,
			width: 20,
			height: 10,
		});
		expect(getNodeWorldRect(rect, space)).toEqual({
			x: 90,
			y: 100,
			width: 20,
			height: 40,
		});
		// And a world-space marquee over the true position now hits it.
		const target = space.targetOf(rect);
		if (!target) throw new Error("no target for rect");
		expect(
			marqueeHitsResolved([target], {
				minX: 85,
				minY: 95,
				maxX: 115,
				maxY: 145,
			}),
		).toHaveLength(1);
	});

	it("excludes a non-identity page-root transform, matching the overlay convention", () => {
		const base = nestedIR();
		const page = base.pages[0];
		if (!page) throw new Error("fixture page missing");
		const moved: CanvasIR = {
			...base,
			pages: [
				{
					...page,
					root: {
						...page.root,
						transform: { ...page.root.transform, x: 999, y: 999 },
					},
				},
			],
		};
		const space = createResolvedPageSpace(resolveCanvasLayout(moved, {}));
		// Same pin as the M0 suite's root-exclusion case: moving the root does
		// not move page-space positions.
		expect(space.originOf("g")?.x).toBeCloseTo(100, 6);
		expect(space.originOf("g")?.y).toBeCloseTo(50, 6);
		expect(space.aabbOf("r")?.minX).toBeCloseTo(90, 6);
		expect(space.aabbOf("r")?.minY).toBeCloseTo(100, 6);
	});

	it("reflects Auto Layout flow geometry, not stale stored geometry", () => {
		const frame: CanvasNode = {
			...createFrame({ id: "f1", bounds: { width: 200, height: 100 } }),
			autoLayout: {
				version: 1,
				direction: "horizontal",
				padding: { top: 0, right: 0, bottom: 0, left: 0 },
				gap: 10,
				primaryAlign: "start",
				crossAlign: "start",
			},
			children: [
				createRect({ id: "r1", bounds: { width: 40, height: 20 } }),
				createRect({ id: "r2", bounds: { width: 40, height: 20 } }),
			],
		} as CanvasNode;
		const page = createPage({ id: "p1" });
		let ir = createCanvasIR({ id: "doc", title: "t", pages: [page] });
		ir = insertNode(ir, { parentId: page.root.id, node: frame });
		const space = createResolvedPageSpace(resolveCanvasLayout(ir, {}));
		// Stored geometry has both children at x=0; resolved flow puts r2 at 50.
		expect(space.aabbOf("r2")).toEqual({
			minX: 50,
			minY: 0,
			maxX: 90,
			maxY: 20,
		});
		expect(space.boundsOf("r2")).toEqual({ width: 40, height: 20 });
		expect(space.pointIn("r2", { x: 60, y: 10 })).toBe(true);
		expect(space.pointIn("r2", { x: 10, y: 10 })).toBe(false);
	});

	it("returns undefined/null for unknown nodes", () => {
		const { resolved, space } = nestedSpace();
		expect(space.aabbOf("nope")).toBeUndefined();
		expect(space.originOf("nope")).toBeUndefined();
		expect(resolvedNodeWorldPosition(resolved, "nope")).toBeNull();
	});
});
