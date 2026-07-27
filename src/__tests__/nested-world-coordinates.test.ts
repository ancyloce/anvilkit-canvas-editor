import {
	type CanvasIR,
	type CanvasNode,
	createCanvasIR,
	createFrame,
	createGroup,
	createPage,
	createRect,
	marqueeHits,
	nodeWorldAabb,
	toAffineMatrix,
} from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import { buildSelectionExportPage } from "../render/selection-export.js";
import { getNodeWorldRect } from "../snap/get-node-rect.js";
import { resolveNodeWorldPosition } from "../stage/node-world-position.js";

/**
 * @file T-M0-06 (plan 0022 M0) — nested world-coordinate regression lock.
 *
 * M3 rewrites every geometry consumer in this package to read one resolved
 * layout tree instead of walking `node.transform`/`node.bounds` directly.
 * That is a rewrite of ~9 call sites plus ~40 renderer reads, and the failure
 * mode is silent: a nested node lands a few pixels off, or an overlay anchors
 * to the wrong place, and no existing test notices.
 *
 * This suite is the safety net, and it is a **hard prerequisite for M3**
 * (PRD §16, TD §19 step 0). It pins what these functions do **today**, on
 * fixtures that nest group → frame → node with rotation, scale, and skew at
 * different levels — the shapes where an ancestor-composition mistake is
 * actually observable. An unrotated, unscaled, top-level node cannot detect
 * any of these bugs, which is why the current tests did not.
 *
 * ### This file records current behaviour, including where it is wrong
 *
 * These consumers do **not** agree with each other today. Three compose the
 * ancestor chain; two do not. Cases marked `KNOWN LIMITATION` assert the
 * present (incorrect) output deliberately — encoding them as *desired* would
 * be wrong, and leaving them untested would let M3 change them by accident
 * rather than by decision. When M3 unifies them on the resolved tree, those
 * assertions are expected to change, and each one says so.
 */

/** Transform helper: the builders take a Partial and fill the rest. */
const T = (t: {
	x?: number;
	y?: number;
	rotation?: number;
	scaleX?: number;
	scaleY?: number;
	skewX?: number;
	skewY?: number;
}) => t;

/**
 * group "g" (translate + uniform scale)
 *   └── frame "f" (translate + 90° rotation)
 *         └── rect "r" (translate only)
 *
 * Hand-derived world origin of "r", composing outermost-first with the
 * package's TRS order (`toAffineMatrix`: translate → rotate → skew → scale):
 *
 *   r local origin           → (0, 0)
 *   through r  (+5, +5)      → (5, 5)
 *   through f  rot90, (+10,+20): rot90 maps (x, y) → (−y, x)
 *                            → (−5, 5) → (5, 25)
 *   through g  scale 2, (+100,+50)
 *                            → (10, 50) → (110, 100)
 */
function nestedIR(): CanvasIR {
	const page = createPage({ id: "p1", size: { width: 800, height: 600 } });
	const rect = createRect({
		id: "r",
		transform: T({ x: 5, y: 5 }),
		bounds: { width: 20, height: 10 },
	});
	const frame = createFrame({
		id: "f",
		transform: T({ x: 10, y: 20, rotation: 90 }),
		bounds: { width: 100, height: 40 },
		children: [rect],
	});
	const group = createGroup({
		id: "g",
		transform: T({ x: 100, y: 50, scaleX: 2, scaleY: 2 }),
		bounds: { width: 200, height: 200 },
		children: [frame],
	});
	page.root = createGroup({
		id: "root",
		bounds: { width: 800, height: 600 },
		children: [group],
	});
	return createCanvasIR({
		id: "doc",
		pages: [page],
		now: () => "2026-07-27T00:00:00.000Z",
	});
}

/** A skewed ancestor — skew is the transform most often dropped by a rewrite. */
function skewedIR(): CanvasIR {
	const page = createPage({ id: "p1", size: { width: 800, height: 600 } });
	const rect = createRect({
		id: "r",
		transform: T({ x: 10, y: 0 }),
		bounds: { width: 20, height: 20 },
	});
	const group = createGroup({
		id: "g",
		transform: T({ x: 0, y: 0, skewX: 30 }),
		bounds: { width: 200, height: 200 },
		children: [rect],
	});
	page.root = createGroup({
		id: "root",
		bounds: { width: 800, height: 600 },
		children: [group],
	});
	return createCanvasIR({
		id: "doc",
		pages: [page],
		now: () => "2026-07-27T00:00:00.000Z",
	});
}

function findById(node: CanvasNode, id: string): CanvasNode | undefined {
	if (node.id === id) return node;
	const children = (node as { children?: readonly CanvasNode[] }).children;
	if (!children) return undefined;
	for (const child of children) {
		const hit = findById(child, id);
		if (hit) return hit;
	}
	return undefined;
}

describe("resolveNodeWorldPosition — composes the ancestor chain", () => {
	it("composes every ancestor transform between the node and the page root", () => {
		const ir = nestedIR();
		const pos = resolveNodeWorldPosition(ir, "r");
		// Matches the hand derivation above. If a refactor drops the ancestor
		// walk, this becomes (5, 5) — the node's own transform alone.
		expect(pos?.x).toBeCloseTo(110, 6);
		expect(pos?.y).toBeCloseTo(100, 6);
	});

	it("returns a top-level node's own transform unchanged", () => {
		// The convention floating overlays rely on: for a direct child of the
		// page root, `transform.x/y` already IS page space.
		const ir = nestedIR();
		expect(resolveNodeWorldPosition(ir, "g")).toEqual({ x: 100, y: 50 });
	});

	it("deliberately EXCLUDES the page root's own transform", () => {
		// Documented on the function: composing the root in would double-count
		// it and move every existing overlay. Pinned so a "fix" that starts the
		// walk at the root fails here first.
		const ir = nestedIR();
		const page = ir.pages[0];
		if (page) page.root.transform = toRootTransform();
		expect(resolveNodeWorldPosition(ir, "g")).toEqual({ x: 100, y: 50 });
	});

	it("returns null for an unknown node", () => {
		expect(resolveNodeWorldPosition(nestedIR(), "nope")).toBeNull();
	});

	it("composes a skewed ancestor", () => {
		// skewX 30° maps (x, y) → (x + y·tan30, y). The rect origin sits at
		// y = 0, so skew contributes nothing to the ORIGIN — the point of this
		// case is that it must not contribute anything either.
		const pos = resolveNodeWorldPosition(skewedIR(), "r");
		expect(pos?.x).toBeCloseTo(10, 6);
		expect(pos?.y).toBeCloseTo(0, 6);
	});
});

function toRootTransform() {
	return {
		x: 999,
		y: 999,
		rotation: 0,
		scaleX: 1,
		scaleY: 1,
	};
}

describe("nodeWorldAabb — composes only what the caller passes in", () => {
	it("uses the node's own transform when given no parent matrix", () => {
		const ir = nestedIR();
		const rect = findById(ir.pages[0]?.root as CanvasNode, "r") as CanvasNode;
		const aabb = nodeWorldAabb(rect);
		// Local box: origin (5,5), 20×10, no rotation of its own.
		expect(aabb.minX).toBeCloseTo(5, 6);
		expect(aabb.minY).toBeCloseTo(5, 6);
		expect(aabb.maxX).toBeCloseTo(25, 6);
		expect(aabb.maxY).toBeCloseTo(15, 6);
	});

	it("composes the full chain when the caller supplies the parent matrix", () => {
		const ir = nestedIR();
		const root = ir.pages[0]?.root as CanvasNode;
		const group = findById(root, "g") as CanvasNode;
		const frame = findById(root, "f") as CanvasNode;
		const rect = findById(root, "r") as CanvasNode;

		const gm = toAffineMatrix(group.transform);
		const fm = multiply(gm, toAffineMatrix(frame.transform));
		const aabb = nodeWorldAabb(rect, fm);

		// The rect's four corners after rot90 + scale2: width and height swap.
		expect(aabb.minX).toBeCloseTo(90, 6);
		expect(aabb.minY).toBeCloseTo(100, 6);
		expect(aabb.maxX).toBeCloseTo(110, 6);
		expect(aabb.maxY).toBeCloseTo(140, 6);
	});
});

/** Local mirror of core's `multiplyMatrix`, kept explicit for readability. */
function multiply(
	a: readonly number[],
	b: readonly number[],
): [number, number, number, number, number, number] {
	return [
		(a[0] as number) * (b[0] as number) + (a[2] as number) * (b[1] as number),
		(a[1] as number) * (b[0] as number) + (a[3] as number) * (b[1] as number),
		(a[0] as number) * (b[2] as number) + (a[2] as number) * (b[3] as number),
		(a[1] as number) * (b[2] as number) + (a[3] as number) * (b[3] as number),
		(a[0] as number) * (b[4] as number) +
			(a[2] as number) * (b[5] as number) +
			(a[4] as number),
		(a[1] as number) * (b[4] as number) +
			(a[3] as number) * (b[5] as number) +
			(a[5] as number),
	];
}

describe("getNodeWorldRect (snap) — KNOWN LIMITATION: ignores ancestors", () => {
	it("reports a NESTED node's LOCAL box, not its world box", () => {
		// `getNodeWorldRect(node)` calls `nodeWorldAabb(node)` with no parent
		// matrix, so despite the name it is only world-correct for a direct
		// child of the page root. A nested node snaps against coordinates it
		// does not occupy.
		//
		// Pinned as-is on purpose. M3 routes snapping through the resolved
		// tree, at which point this SHOULD become the world box
		// (minX 90, minY 100, width 20, height 40) and this assertion must be
		// updated deliberately — not silently.
		const ir = nestedIR();
		const rect = findById(ir.pages[0]?.root as CanvasNode, "r") as CanvasNode;
		expect(getNodeWorldRect(rect)).toEqual({
			x: 5,
			y: 5,
			width: 20,
			height: 10,
		});
	});

	it("is world-correct for a top-level node", () => {
		const ir = nestedIR();
		const group = findById(ir.pages[0]?.root as CanvasNode, "g") as CanvasNode;
		const rect = getNodeWorldRect(group);
		expect(rect.x).toBeCloseTo(100, 6);
		expect(rect.y).toBeCloseTo(50, 6);
		// 200×200 scaled by 2.
		expect(rect.width).toBeCloseTo(400, 6);
		expect(rect.height).toBeCloseTo(400, 6);
	});
});

describe("marqueeHits — KNOWN LIMITATION: ignores ancestors", () => {
	it("tests a nested node's LOCAL box against a world-space marquee", () => {
		// `marqueeHits` also calls `nodeWorldAabb(node)` with no parent matrix.
		// Passing it a nested node therefore compares world marquee against
		// local box. The editor currently only ever passes the isolation
		// scope's direct children, which is why this has not surfaced.
		const ir = nestedIR();
		const rect = findById(ir.pages[0]?.root as CanvasNode, "r") as CanvasNode;

		// A marquee over the rect's TRUE world position (90..110, 100..140)
		// does NOT hit it today.
		expect(
			marqueeHits([rect], { minX: 85, minY: 95, maxX: 115, maxY: 145 }),
		).toHaveLength(0);

		// A marquee over its LOCAL box does.
		expect(
			marqueeHits([rect], { minX: 0, minY: 0, maxX: 30, maxY: 20 }),
		).toHaveLength(1);
	});

	it("is world-correct for top-level nodes (the editor's actual usage)", () => {
		const ir = nestedIR();
		const group = findById(ir.pages[0]?.root as CanvasNode, "g") as CanvasNode;
		expect(
			marqueeHits([group], { minX: 0, minY: 0, maxX: 600, maxY: 600 }),
		).toHaveLength(1);
		expect(
			marqueeHits([group], { minX: 600, minY: 0, maxX: 700, maxY: 100 }),
		).toHaveLength(0);
	});
});

describe("buildSelectionExportPage — composes ancestors correctly", () => {
	it("frames a nested selection to its composed world AABB", () => {
		// This one walks the tree carrying a parent matrix, so it is already
		// ancestor-correct. Pinned so M3's rewrite cannot regress it to the
		// ancestor-ignoring behaviour of its two siblings above.
		const ir = nestedIR();
		const page = ir.pages[0];
		const exported = buildSelectionExportPage(page as never, ["r"]);
		expect(exported).not.toBeNull();
		// The rect's composed world box is 20 wide × 40 tall (rot90 + scale2).
		expect(exported?.size.width).toBeCloseTo(20, 6);
		expect(exported?.size.height).toBeCloseTo(40, 6);
	});

	it("returns null when nothing is selected", () => {
		const ir = nestedIR();
		expect(buildSelectionExportPage(ir.pages[0] as never, [])).toBeNull();
	});
});

/**
 * NOT asserted here, recorded deliberately:
 *
 * `actions/viewport-actions.ts` (`zoomToSelectionImpl`) computes its fit box
 * as `transform.x + bounds.width` over the selected ids. That ignores the
 * ancestor chain **and** rotation/scale/skew entirely, so zoom-to-selection
 * on a nested or rotated node frames the wrong region. It is a genuine bug,
 * not a convention.
 *
 * It is not pinned because it takes a whole `CanvasStudioContextValue` and
 * writes to the viewport store — asserting today's wrong number would add a
 * harness whose only purpose is to be deleted in M3, and per the task's own
 * instruction a known-wrong behaviour is marked, never encoded as desired.
 * M3 (T-M3-07) must migrate it to the resolved tree along with the rest.
 */
