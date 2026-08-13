/**
 * @file cp4-005 — Konva ↔ SVG frame-clip parity (PLAN-0035 §5 P4, §9 R-4).
 *
 * The structural guard that keeps `cp4-002` (SVG `<clipPath>`) and `cp4-003`
 * (Konva `clipFunc`) from drifting. `cp4-001`'s single `resolveFrameClipShape`
 * prevents *logic* drift — both paths ask the same resolver what a frame clips
 * to — but nothing yet prevents *rendering* drift: two implementations of the
 * same outline, in two different drawing vocabularies, that quietly stop
 * describing the same shape.
 *
 * ## Why this is a GEOMETRY-level parity test and not a pixel diff
 *
 * "Rasterize both, diff pixels" is the obvious design and it does not survive
 * this repo's CI. Three independent blockers, each verified rather than assumed:
 *
 * 1. **No rasterizer is a workspace dependency.** Neither `canvas`/`node-canvas`
 *    nor `@resvg/resvg-js` nor `sharp` appears in any `package.json` in the
 *    workspace, and cp4-005 may not add one. Without one there is nothing in
 *    Node that can turn either an SVG string or a Konva scene into pixels.
 * 2. **jsdom has no 2D canvas at all** — this suite's own
 *    `CanvasNodeRenderer.test.tsx` records that `typeof Path2D === "undefined"`
 *    here — so even a real `react-konva` mount could not produce a bitmap.
 * 3. **Headless-Chromium screenshots and canvas readback are broken on this
 *    host** (WSL2). The recorded workaround is `xvfb-run` + `headless: false`,
 *    which is a legitimate thing for an E2E job to do and an illegitimate thing
 *    for a unit-test merge gate to depend on. The task's own acceptance
 *    criterion names this limitation.
 *
 * So parity is asserted where the two paths actually have to agree and where
 * both are observable without a browser: the **outline each path describes**.
 * Both real production code paths are executed —
 * `CanvasNodeRenderer`/`frameClipProps` for Konva (the same component
 * `rasterizePage` mounts, so this covers PNG/PDF export too) and
 * `serializePageToSvg`/`frameClipElement` for SVG — and each result is reduced
 * to one normalized {@link ClipOutline} by a parser that reads only that path's
 * own output. The two normalized outlines are then compared parameter by
 * parameter.
 *
 * The in-tree precedent is `@anvilkit/canvas-core`'s
 * `layout/__tests__/contract/resolver-svg-parity.test.ts`, which compares the
 * layout resolver against the SVG serializer the same way: extract from the
 * emitted markup, compare numerically against the other path's output, with a
 * `near(actual, expected, label)` helper carrying a diagnosable label. This
 * file follows that structure and reuses its tolerance.
 *
 * ## The tolerance, and why it is this number
 *
 * `TOLERANCE = 1e-3` local canvas units. Derivation, not a guess:
 *
 * - The **only** representational difference between the two paths is number
 *   formatting. The SVG serializer prints every coordinate through `fmt`
 *   (`canvas/core/src/serialize/svg.ts:267`), which rounds to 4 decimal places;
 *   the Konva path passes raw doubles into the scene context. Maximum error
 *   from that rounding is 5e-5 per coordinate.
 * - `1e-3` is therefore **20× above the representational floor** — enough that
 *   formatting can never trip it — and, at 1 local unit = 1 CSS px at 1× export
 *   scale, **500× below a half-pixel error**, which is the coarsest divergence
 *   anyone could call invisible. Every real geometry mistake this suite was
 *   written to catch (wrong centre, wrong inscribed radii, a star traced with
 *   polygon maths, a dropped `innerRadiusRatio`, an off-by-one vertex) is off by
 *   whole units or more.
 * - It is the same number, for the same reason, as
 *   `resolver-svg-parity.test.ts:39`. Two parity suites in one program with two
 *   different tolerances would itself be drift.
 *
 * The tolerance is a *ceiling*, not a target: every fixture in this file
 * currently agrees to the last printed digit. It must never be loosened to make
 * a fixture pass.
 *
 * ## What this design CAN catch
 *
 * Any disagreement about the clip's geometry: a different shape kind, a
 * different centre or inscribed radii, a different vertex list or vertex order,
 * different corner rounding, a different decision about *whether* the frame
 * clips at all, a different degradation decision for an unhonourable shape, and
 * path data reaching one path but not the other.
 *
 * ## What this design CANNOT catch — stated plainly
 *
 * - **Antialiasing and pixel coverage.** Konva's canvas rasterizer and any SVG
 *   renderer will disagree on edge pixels. That is why pixel-exactness is not
 *   the bar and why a tolerance exists at all; it is also why this file does not
 *   pretend to measure it.
 * - **Compositing.** A blend mode's *rasterized result* is out of reach. This
 *   file asserts only that both paths put the blend and the clip on the same
 *   element so they compose (fixture `clip-plus-blend-mode`) — Konva's own
 *   `Container._drawChildren` ordering does the rest.
 * - **Effect rasterization.** Same: it asserts the effect lands on the child on
 *   both paths and does not perturb the clip, not that `feDropShadow` and
 *   Konva's shadow produce the same pixels. They do not, and no ADR claims they
 *   do.
 * - **Interpretation of identical path data.** When both paths carry the same
 *   `d`, this file asserts the strings are identical; whether a browser's SVG
 *   renderer and `Path2D` fill a degenerate arc identically is a rasterizer
 *   question.
 * - **Anything about children.** Paint order, z-order, and how content that
 *   extends beyond the clip region is composited are not clip geometry.
 *
 * A browser-level assertion of the raster half belongs to the canvas E2E suite,
 * not to a unit-test merge gate — see the execution record in
 * `docs/tasks/cp4-005-konva-svg-parity-test.md`.
 *
 * ## Alpha masking is NOT in this corpus
 *
 * ADR 0008 decision 3 deprecates `CanvasImageNode.maskAssetId` rather than
 * implementing it, and `0008:130` states outright that this task's fixture set
 * "drops the alpha-mask fixture and gains one fixture per `CanvasFrameShape`
 * variant". There is no alpha-mask code on either path to compare.
 *
 * ## The two reported divergences
 *
 * Both were found by `cp4-003` and handed here for adjudication. Neither is
 * papered over: see `describe("known Konva ↔ SVG divergences")` at the bottom,
 * where D-1 is now RESOLVED (the fixture that recorded it is an ordinary parity
 * assertion, and the characterization records the reconciled behaviour) and D-2
 * is a fixture that shows the reported divergence is not a clip-geometry
 * divergence at all.
 */

import {
	type CanvasFrameNode,
	type CanvasFrameShape,
	type CanvasIR,
	type CanvasNode,
	computePolygonVertices,
	computeStarVertices,
	createCanvasIR,
	createFrame,
	createGroup,
	createPage,
	createRect,
	type PolygonVertex,
	serializePageToSvg,
} from "@anvilkit/canvas-core";
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- react-konva capture -----------------------------------------------------

type ElementCall = { type: string; props: Record<string, unknown> };
const calls: ElementCall[] = [];

function makeMock(type: string) {
	return (props: Record<string, unknown>) => {
		calls.push({ type, props });
		const { children } = props as { children?: ReactNode };
		return <div data-testid={type}>{children}</div>;
	};
}

vi.mock("react-konva", () => ({
	Group: makeMock("Group"),
	Rect: makeMock("Rect"),
	Ellipse: makeMock("Ellipse"),
	RegularPolygon: makeMock("RegularPolygon"),
	Star: makeMock("Star"),
	Line: makeMock("Line"),
	Path: makeMock("Path"),
	Text: makeMock("Text"),
	Image: makeMock("Image"),
}));

vi.mock("use-image", () => ({ default: () => [null, "loading"] }));

import { CanvasNodeRenderer } from "../CanvasNodeRenderer.js";

// --- the tolerance -----------------------------------------------------------

/** See the file header for the derivation. Never loosen this to make a fixture pass. */
const TOLERANCE = 1e-3;

/** Which two things a comparison is between. Named so a failure says so. */
type Sides = readonly [left: string, right: string];

const RENDER_PATHS: Sides = ["Konva", "SVG"];

function near(
	left: number,
	right: number,
	label: string,
	sides: Sides = RENDER_PATHS,
): void {
	expect(
		Math.abs(left - right),
		`${label}: ${sides[0]} ${left} vs ${sides[1]} ${right} — differs by ${Math.abs(
			left - right,
		)}, tolerance ${TOLERANCE}`,
	).toBeLessThanOrEqual(TOLERANCE);
}

// --- the normalized outline both paths reduce to -----------------------------

/** Corner radii in the order both paths already use: top-left, top-right, bottom-right, bottom-left. */
type Corners = readonly [number, number, number, number];

const NO_CORNERS: Corners = [0, 0, 0, 0];

/**
 * The clip region, in the frame's LOCAL space, described in a vocabulary
 * neither render path owns.
 *
 * Local space is the right frame of reference for both: Konva runs `clipFunc`
 * after pushing the group's absolute transform, and an SVG `clip-path` resolves
 * in the user space established by the referencing `<g>`'s own `transform`. A
 * frame's position, rotation and scale therefore cancel out of this comparison
 * on both sides — which is why a fixture can place a frame anywhere without
 * weakening the assertion.
 */
type ClipOutline =
	| { readonly kind: "none" }
	| {
			readonly kind: "rect";
			readonly width: number;
			readonly height: number;
			readonly radii: Corners;
	  }
	| {
			readonly kind: "ellipse";
			readonly cx: number;
			readonly cy: number;
			readonly rx: number;
			readonly ry: number;
	  }
	| { readonly kind: "polygon"; readonly points: readonly PolygonVertex[] }
	| { readonly kind: "path"; readonly d: string };

type OutlineKind = ClipOutline["kind"];

/**
 * The generated rounded-rect path grammar, parsed back into parameters.
 *
 * `roundedRectPath` (`canvas/core/src/serialize/svg.ts:875`) is what the SVG
 * side emits for per-corner radii, and Konva has no equivalent — it calls
 * `roundRect` with a radii array. Rather than declare those "different by
 * design" (which would be a hole exactly where per-corner rounding lives), both
 * sides run any path data through this parser, so a `d` that describes a
 * rounded rectangle normalizes to `kind: "rect"` on BOTH paths or on neither.
 * Applying it symmetrically is what keeps it from becoming a thumb on the scale.
 *
 * Returns `undefined` for anything that is not exactly the generated grammar
 * `M tl 0 H w-tr [A tr..] V h-br [A br..] H bl [A bl..] V tl [A tl..] Z`.
 */
function parseRoundedRectPath(
	d: string,
): { width: number; height: number; radii: Corners } | undefined {
	const tok = d.trim().split(/\s+/);
	let i = 0;
	let bad = false;

	const lit = (s: string): void => {
		if (tok[i] === s) i += 1;
		else bad = true;
	};
	const num = (): number => {
		const value = Number(tok[i]);
		if (!Number.isFinite(value) || tok[i] === undefined) {
			bad = true;
			return Number.NaN;
		}
		i += 1;
		return value;
	};
	/** `A r r 0 0 1 x y`, or `undefined` when this corner has no arc (radius 0). */
	const arc = (): { r: number; x: number; y: number } | undefined => {
		if (tok[i] !== "A") return undefined;
		i += 1;
		const r = num();
		if (num() !== r) bad = true;
		lit("0");
		lit("0");
		lit("1");
		const x = num();
		const y = num();
		return { r, x, y };
	};

	lit("M");
	const topLeft = num();
	lit("0");
	lit("H");
	const afterTop = num();
	const topArc = arc();
	const topRight = topArc?.r ?? 0;
	const width = topArc ? topArc.x : afterTop;
	lit("V");
	const afterRight = num();
	const rightArc = arc();
	const bottomRight = rightArc?.r ?? 0;
	const height = rightArc ? rightArc.y : afterRight;
	lit("H");
	const bottomLeft = num();
	const leftArc = arc();
	if (leftArc && leftArc.r !== bottomLeft) bad = true;
	lit("V");
	const backToTopLeft = num();
	const closingArc = arc();
	if (closingArc && closingArc.r !== topLeft) bad = true;
	lit("Z");

	if (bad || i !== tok.length) return undefined;
	// The grammar's own internal consistency — a coincidental match must not
	// slip through as a rectangle it does not actually describe.
	if (Math.abs(afterTop - (width - topRight)) > TOLERANCE) return undefined;
	if (Math.abs(afterRight - (height - bottomRight)) > TOLERANCE) {
		return undefined;
	}
	if (Math.abs(backToTopLeft - topLeft) > TOLERANCE) return undefined;
	return { width, height, radii: [topLeft, topRight, bottomRight, bottomLeft] };
}

/** Path data → the outline it describes, applied identically to both paths' path data. */
function pathOutline(d: string): ClipOutline {
	const asRect = parseRoundedRectPath(d);
	return asRect ? { kind: "rect", ...asRect } : { kind: "path", d };
}

// --- Konva path: props → outline ---------------------------------------------

type ContextCall = { readonly op: string; readonly args: readonly number[] };

/** Records what `d` a clip's `Path2D` was built from. jsdom has none of its own. */
class RecordingPath2D {
	readonly d: string;
	constructor(d: string) {
		this.d = d;
	}
}

/** A stand-in for Konva's scene context that records the path it is asked to trace. */
function recordingContext(ops: ContextCall[]): Record<string, unknown> {
	const record =
		(op: string) =>
		(...args: unknown[]): void => {
			ops.push({ op, args: args.flat() as number[] });
		};
	return {
		moveTo: record("moveTo"),
		lineTo: record("lineTo"),
		closePath: record("closePath"),
		ellipse: record("ellipse"),
		roundRect: record("roundRect"),
		rect: record("rect"),
		arc: record("arc"),
		bezierCurveTo: record("bezierCurveTo"),
		quadraticCurveTo: record("quadraticCurveTo"),
	};
}

/**
 * The clip the Konva renderer emitted for one frame's `<Group>`.
 *
 * Reads only Konva's own output — the declarative `clipX/Y/Width/Height` props,
 * or the drawing calls `clipFunc` makes, or the `Path2D` it returns. It knows
 * nothing about the SVG side and nothing about `resolveFrameClipShape`.
 */
function konvaClipOutline(props: Record<string, unknown>): ClipOutline {
	const clipFunc = props.clipFunc as ((ctx: unknown) => unknown) | undefined;
	if (clipFunc === undefined) {
		if (props.clipWidth === undefined) return { kind: "none" };
		expect(
			[props.clipX, props.clipY],
			"a declarative Konva box clip must start at the frame's local origin",
		).toEqual([0, 0]);
		return {
			kind: "rect",
			width: props.clipWidth as number,
			height: props.clipHeight as number,
			radii: NO_CORNERS,
		};
	}

	const ops: ContextCall[] = [];
	const returned = clipFunc(recordingContext(ops));
	if (Array.isArray(returned)) {
		const first: unknown = returned[0];
		if (first instanceof RecordingPath2D) return pathOutline(first.d);
		throw new Error(
			`Konva clipFunc returned a ClipFuncOutput this parity harness does not model: ${String(first)}`,
		);
	}

	const first = ops[0];
	if (first?.op === "roundRect" && ops.length === 1) {
		const [x, y, width, height, ...radii] = first.args;
		expect(
			[x, y],
			"a Konva roundRect clip must start at the frame's local origin",
		).toEqual([0, 0]);
		const corners: Corners =
			radii.length === 1
				? [
						radii[0] as number,
						radii[0] as number,
						radii[0] as number,
						radii[0] as number,
					]
				: [
						radii[0] as number,
						radii[1] as number,
						radii[2] as number,
						radii[3] as number,
					];
		return {
			kind: "rect",
			width: width as number,
			height: height as number,
			radii: corners,
		};
	}
	if (first?.op === "ellipse" && ops.length === 1) {
		const [cx, cy, rx, ry] = first.args;
		return {
			kind: "ellipse",
			cx: cx as number,
			cy: cy as number,
			rx: rx as number,
			ry: ry as number,
		};
	}
	if (first?.op === "moveTo") {
		const points = ops
			.filter((op) => op.op === "moveTo" || op.op === "lineTo")
			.map((op) => ({ x: op.args[0] as number, y: op.args[1] as number }));
		expect(
			ops.at(-1)?.op,
			"a Konva polyline clip must close its path, or the clip region is undefined",
		).toBe("closePath");
		return { kind: "polygon", points };
	}
	throw new Error(
		`Konva clipFunc traced an outline this parity harness does not model: ${ops
			.map((op) => op.op)
			.join(",")}`,
	);
}

// --- SVG path: markup → outline ----------------------------------------------

function svgNum(attrs: string, name: string): number {
	const match = attrs.match(new RegExp(`\\b${name}="([-\\d.eE+]+)"`));
	return match?.[1] === undefined ? 0 : Number(match[1]);
}

/**
 * The clip the SVG serializer emitted for one frame, read out of the markup.
 *
 * Reads only the emitted `<clipPath>` — it knows nothing about the Konva side
 * and nothing about `resolveFrameClipShape`. `frame-clip-<id>` is the id
 * `emitFrame` has used since canvas-m1-003.
 */
function svgClipOutline(svg: string, frameId: string): ClipOutline {
	const block = svg.match(
		new RegExp(`<clipPath id="frame-clip-${frameId}">(.*?)</clipPath>`),
	);
	if (!block?.[1]) return { kind: "none" };
	const child = block[1];

	const rect = child.match(/^<rect ([^>]*?)\s*\/>$/);
	if (rect?.[1]) {
		const radius = svgNum(rect[1], "rx");
		return {
			kind: "rect",
			width: svgNum(rect[1], "width"),
			height: svgNum(rect[1], "height"),
			radii: [radius, radius, radius, radius],
		};
	}
	const ellipse = child.match(/^<ellipse ([^>]*?)\s*\/>$/);
	if (ellipse?.[1]) {
		return {
			kind: "ellipse",
			cx: svgNum(ellipse[1], "cx"),
			cy: svgNum(ellipse[1], "cy"),
			rx: svgNum(ellipse[1], "rx"),
			ry: svgNum(ellipse[1], "ry"),
		};
	}
	const polygon = child.match(/^<polygon points="([^"]*)"\s*\/>$/);
	if (polygon?.[1] !== undefined) {
		return {
			kind: "polygon",
			points: polygon[1]
				.split(/\s+/)
				.filter(Boolean)
				.map((pair) => {
					const [x, y] = pair.split(",");
					return { x: Number(x), y: Number(y) };
				}),
		};
	}
	const path = child.match(/^<path d="([^"]*)"\s*\/>$/);
	if (path?.[1] !== undefined) return pathOutline(path[1]);
	throw new Error(
		`SVG <clipPath> child this parity harness does not model: ${child}`,
	);
}

// --- the comparison ----------------------------------------------------------

/**
 * Assert two outlines describe the same clip region, and say exactly which
 * fixture, which frame, which side and which parameter when they do not.
 *
 * `sides` defaults to the two render paths, which is what every corpus fixture
 * compares. The ADR 0008 circle test reuses it to compare two DOCUMENTS on one
 * path, and relabels accordingly so its failures do not lie about what diverged.
 */
function expectClipParity(
	fixtureId: string,
	frameId: string,
	left: ClipOutline,
	right: ClipOutline,
	sides: Sides = RENDER_PATHS,
): void {
	const where = `${fixtureId} · frame "${frameId}"`;
	expect(
		left.kind,
		`${where}: disagreement about the clip's GEOMETRY KIND — ${sides[0]} clipped to "${left.kind}", ${sides[1]} clipped to "${right.kind}"`,
	).toBe(right.kind);

	if (left.kind === "rect" && right.kind === "rect") {
		near(left.width, right.width, `${where} · rect width`, sides);
		near(left.height, right.height, `${where} · rect height`, sides);
		const corners = ["topLeft", "topRight", "bottomRight", "bottomLeft"];
		for (const [i, corner] of corners.entries()) {
			near(
				left.radii[i] as number,
				right.radii[i] as number,
				`${where} · corner radius ${corner}`,
				sides,
			);
		}
		return;
	}
	if (left.kind === "ellipse" && right.kind === "ellipse") {
		near(left.cx, right.cx, `${where} · ellipse cx`, sides);
		near(left.cy, right.cy, `${where} · ellipse cy`, sides);
		near(left.rx, right.rx, `${where} · ellipse rx`, sides);
		near(left.ry, right.ry, `${where} · ellipse ry`, sides);
		return;
	}
	if (left.kind === "polygon" && right.kind === "polygon") {
		expect(
			left.points.length,
			`${where}: different VERTEX COUNTS — ${sides[0]} ${left.points.length}, ${sides[1]} ${right.points.length}`,
		).toBe(right.points.length);
		for (const [i, leftPoint] of left.points.entries()) {
			const rightPoint = right.points[i];
			if (!rightPoint) {
				throw new Error(`${where}: missing ${sides[1]} vertex ${i}`);
			}
			near(leftPoint.x, rightPoint.x, `${where} · vertex ${i} x`, sides);
			near(leftPoint.y, rightPoint.y, `${where} · vertex ${i} y`, sides);
		}
		return;
	}
	if (left.kind === "path" && right.kind === "path") {
		// Both paths consume the SAME `d` verbatim — Konva hands it to `Path2D`,
		// SVG writes it into the attribute — so string equality is the tightest
		// available bar. Whether two rasterizers interpret identical data
		// identically is outside this design (see the file header).
		expect(
			left.d,
			`${where}: DIFFERENT path data — ${sides[0]} "${left.d}", ${sides[1]} "${right.d}"`,
		).toBe(right.d);
	}
}

// --- fixtures ----------------------------------------------------------------

interface ParityFrame {
	readonly id: string;
	/**
	 * The outline kind this frame must produce on BOTH paths. Declared so a
	 * regression that stops clipping entirely fails loudly instead of passing
	 * trivially with `none === none`.
	 */
	readonly kind: OutlineKind;
}

interface ParityFixture {
	readonly id: string;
	/** One line on what this fixture exists to catch. */
	readonly why: string;
	readonly frames: readonly ParityFrame[];
	readonly build: () => CanvasNode;
}

const BOUNDS = { width: 200, height: 100 };

/** A clipping frame carrying `shape`, which `createFrame` deliberately does not take. */
function shapedFrame(
	shape: CanvasFrameShape | undefined,
	over: Partial<Parameters<typeof createFrame>[0]> = {},
	extra: Partial<CanvasFrameNode> = {},
): CanvasFrameNode {
	return {
		...createFrame({
			id: "f1",
			bounds: BOUNDS,
			clip: true,
			// A frame placed away from the origin: local-space parity has to hold
			// regardless of where the frame sits, and both paths cancel the
			// transform out (see `ClipOutline`).
			transform: { x: 40, y: 30 },
			children: [
				createRect({
					id: "r1",
					bounds: { width: 20, height: 20 },
					fill: "#f00",
				}),
			],
			...over,
		}),
		...(shape ? { shape } : {}),
		...extra,
	};
}

const PARITY_FIXTURES: readonly ParityFixture[] = [
	{
		id: "rect-default",
		why: "the pre-ADR-0008 baseline: `clip` with no `shape` must still be the plain frame box on both paths",
		frames: [{ id: "f1", kind: "rect" }],
		build: () => shapedFrame(undefined),
	},
	{
		id: "rect-declared",
		why: "`{ kind: 'rect' }` means *deliberately no shape mask* and must render identically to an absent shape",
		frames: [{ id: "f1", kind: "rect" }],
		build: () => shapedFrame({ kind: "rect" }),
	},
	{
		id: "rect-uniform-radius",
		why: "`radius` reaches the clip on both paths — SVG as `rx`/`ry`, Konva as a scalar `roundRect` radius",
		frames: [{ id: "f1", kind: "rect" }],
		build: () => shapedFrame(undefined, { radius: 12 }),
	},
	{
		id: "rect-corner-radii",
		why: "per-corner radii, where the two vocabularies diverge most: SVG emits a generated arc path, Konva a radii array",
		frames: [{ id: "f1", kind: "rect" }],
		build: () =>
			shapedFrame(
				undefined,
				{ radius: 40 },
				{
					cornerRadii: {
						topLeft: 8,
						topRight: 16,
						bottomRight: 24,
						bottomLeft: 4,
					},
				},
			),
	},
	{
		id: "ellipse",
		why: "the inscribed ellipse — SVG's `emitEllipse` radii vs Konva's `ctx.ellipse`",
		frames: [{ id: "f1", kind: "ellipse" }],
		build: () => shapedFrame({ kind: "ellipse" }),
	},
	{
		id: "polygon-hexagon",
		why: "`computePolygonVertices` reaching both paths unmodified, on a NON-square box so a swapped rx/ry shows up",
		frames: [{ id: "f1", kind: "polygon" }],
		build: () => shapedFrame({ kind: "polygon", sides: 6 }),
	},
	{
		id: "star-five-point",
		why: "`computeStarVertices` including `innerRadiusRatio` — the parameter a copy-paste from the polygon branch drops",
		frames: [{ id: "f1", kind: "polygon" }],
		build: () =>
			shapedFrame({ kind: "star", points: 5, innerRadiusRatio: 0.4 }),
	},
	{
		id: "path-triangle",
		why: "raw path data must reach both paths byte-identically",
		frames: [{ id: "f1", kind: "path" }],
		build: () => shapedFrame({ kind: "path", d: "M0 0 L200 0 L100 100 Z" }),
	},
	{
		id: "clip-plus-blend-mode",
		why: "a blend mode must not perturb the clip — and both must land on the same element so they compose",
		frames: [{ id: "f1", kind: "ellipse" }],
		build: () =>
			shapedFrame({ kind: "ellipse" }, {}, { blendMode: "multiply" }),
	},
	{
		id: "clip-plus-effects",
		why: "an effect-bearing child inside a shaped clip must not perturb the clip geometry",
		frames: [{ id: "f1", kind: "polygon" }],
		build: () =>
			shapedFrame(
				{ kind: "star", points: 5, innerRadiusRatio: 0.5 },
				{
					children: [
						{
							...createRect({
								id: "r1",
								bounds: { width: 20, height: 20 },
								fill: "#f00",
							}),
							effects: [
								{
									type: "drop-shadow",
									color: "#000",
									blur: 4,
									offsetX: 2,
									offsetY: 3,
								},
							],
						},
					],
				},
			),
	},
	{
		id: "nested-clip",
		why: "a shaped clipping frame INSIDE a shaped clipping frame — each clip is resolved in its own local space on both paths",
		frames: [
			{ id: "f1", kind: "ellipse" },
			{ id: "inner", kind: "polygon" },
		],
		build: () =>
			shapedFrame(
				{ kind: "ellipse" },
				{
					children: [
						{
							...createFrame({
								id: "inner",
								bounds: { width: 80, height: 80 },
								clip: true,
								transform: { x: 10, y: 10 },
								children: [
									createRect({
										id: "r2",
										bounds: { width: 10, height: 10 },
										fill: "#00f",
									}),
								],
							}),
							shape: { kind: "polygon", sides: 5 },
						},
					],
				},
			),
	},
	{
		id: "clip-inside-clipped-frame",
		why: "a shaped frame inside a PLAIN rectangular clipping frame — the outer box must not leak into the inner shape on either path",
		frames: [
			{ id: "f1", kind: "rect" },
			{ id: "inner", kind: "ellipse" },
		],
		build: () =>
			shapedFrame(undefined, {
				children: [
					{
						...createFrame({
							id: "inner",
							bounds: { width: 60, height: 40 },
							clip: true,
							transform: { x: 20, y: 20 },
							children: [
								createRect({
									id: "r2",
									bounds: { width: 10, height: 10 },
									fill: "#00f",
								}),
							],
						}),
						shape: { kind: "ellipse" },
					},
				],
			}),
	},
	{
		id: "shape-on-unclipped-frame",
		why: "`clip` is the ONLY on/off switch — an inert shape must stay inert on both paths, not become a second silent trigger",
		frames: [{ id: "f1", kind: "none" }],
		build: () => shapedFrame({ kind: "ellipse" }, { clip: false }),
	},
	{
		id: "degraded-polygon",
		why: "an unhonourable shape degrades to the frame box on both paths — SVG warns, Konva is silent, and the GEOMETRY must still agree",
		frames: [{ id: "f1", kind: "rect" }],
		build: () => shapedFrame({ kind: "polygon", sides: 2 }),
	},
];

// --- running both paths ------------------------------------------------------

function buildDocument(frame: CanvasNode): CanvasIR {
	return createCanvasIR({
		id: "cp4-005-parity",
		pages: [
			createPage({
				id: "p1",
				size: { width: 400, height: 300 },
				root: createGroup({
					id: "root",
					bounds: { width: 400, height: 300 },
					children: [frame],
				}),
			}),
		],
	});
}

interface BothPaths {
	readonly konva: (frameId: string) => ClipOutline;
	readonly svg: (frameId: string) => ClipOutline;
	readonly warnings: readonly string[];
	readonly markup: string;
	readonly groupProps: (frameId: string) => Record<string, unknown>;
	/** Every mocked react-konva element THIS render produced, snapshotted. */
	readonly elements: readonly ElementCall[];
}

/**
 * Run one document through BOTH production render paths.
 *
 * The Konva half mounts `CanvasNodeRenderer` on the page root — the exact
 * component `rasterizePage` mounts (`render/rasterize-page.tsx:149-151`), so
 * this covers the PNG and PDF exporters as well as the interactive stage. The
 * SVG half calls `serializePageToSvg`, the exact function the SVG exporter
 * calls (`header/exporters.ts:141-148`).
 */
async function bothPaths(fixture: ParityFixture): Promise<BothPaths> {
	const ir = buildDocument(fixture.build());
	const page = ir.pages[0];
	if (!page) throw new Error("fixture produced no page");

	calls.length = 0;
	render(<CanvasNodeRenderer node={page.root} />);
	// Snapshotted, NOT read lazily: `calls` is module-level and the next
	// `bothPaths` clears it, so a lazy closure would silently report the LATER
	// render's props. A test comparing two documents (the ADR 0008 circle
	// equivalence) would then compare a render against itself and pass no matter
	// what — found by the cp4-005 mutation check, which is exactly what it is for.
	const elements: readonly ElementCall[] = [...calls];
	const groupProps = (frameId: string): Record<string, unknown> => {
		const group = elements.find(
			(call) => call.type === "Group" && call.props.id === frameId,
		);
		if (!group) {
			throw new Error(
				`${fixture.id}: the Konva path rendered no <Group> for frame "${frameId}"`,
			);
		}
		return group.props;
	};

	const { svg, warnings } = await serializePageToSvg(ir, "p1");
	return {
		konva: (frameId) => konvaClipOutline(groupProps(frameId)),
		svg: (frameId) => svgClipOutline(svg, frameId),
		warnings: warnings.map((warning) => warning.code),
		markup: svg,
		groupProps,
		elements,
	};
}

// --- the suite ---------------------------------------------------------------

describe("Konva ↔ SVG frame-clip parity (cp4-005)", () => {
	beforeEach(() => {
		// jsdom has no `Path2D`, and without one the Konva renderer degrades every
		// `path` clip to the frame box — which would make the path fixtures pass
		// for the wrong reason. Recording the constructor argument is also how the
		// harness reads the `d` back out.
		vi.stubGlobal("Path2D", RecordingPath2D);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		cleanup();
	});

	it("carries the fixture corpus ADR 0008 scopes for this task", () => {
		// One fixture per `CanvasFrameShape` variant plus the composition cases,
		// and NO alpha-mask fixture — `0008:130`, decision 3.
		expect(PARITY_FIXTURES.map((fixture) => fixture.id)).toEqual([
			"rect-default",
			"rect-declared",
			"rect-uniform-radius",
			"rect-corner-radii",
			"ellipse",
			"polygon-hexagon",
			"star-five-point",
			"path-triangle",
			"clip-plus-blend-mode",
			"clip-plus-effects",
			"nested-clip",
			"clip-inside-clipped-frame",
			"shape-on-unclipped-frame",
			"degraded-polygon",
		]);
	});

	for (const fixture of PARITY_FIXTURES) {
		it(`agrees on every clipping frame in "${fixture.id}" within ${TOLERANCE} local units`, async () => {
			const paths = await bothPaths(fixture);
			for (const frame of fixture.frames) {
				const konva = paths.konva(frame.id);
				const svg = paths.svg(frame.id);
				// Guard against a trivial pass: a regression that stopped clipping
				// altogether would otherwise satisfy `none === none`.
				expect(
					konva.kind,
					`${fixture.id} · frame "${frame.id}": the Konva path produced a "${konva.kind}" clip where this fixture requires "${frame.kind}" — ${fixture.why}`,
				).toBe(frame.kind);
				expectClipParity(fixture.id, frame.id, konva, svg);
			}
		});
	}
});

describe("the shape maths is SHARED, not re-derived (three-way anchor)", () => {
	beforeEach(() => {
		vi.stubGlobal("Path2D", RecordingPath2D);
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		cleanup();
	});

	// Parity alone would still pass if BOTH paths drifted the same way. These two
	// pin each path to core's own `geometry/polygon.ts` as the third anchor.
	const versusCore = (path: string): Sides => [
		`${path} emitted`,
		"core geometry",
	];

	it("traces the hexagon both paths emit through core's computePolygonVertices", async () => {
		const fixture = PARITY_FIXTURES.find((f) => f.id === "polygon-hexagon");
		if (!fixture) throw new Error("fixture missing");
		const paths = await bothPaths(fixture);
		const expected = computePolygonVertices(BOUNDS, 6);
		for (const path of ["Konva", "SVG"] as const) {
			const outline = path === "Konva" ? paths.konva("f1") : paths.svg("f1");
			if (outline.kind !== "polygon") throw new Error("expected a polygon");
			expect(outline.points).toHaveLength(expected.length);
			for (const [i, vertex] of expected.entries()) {
				near(
					outline.points[i]?.x ?? Number.NaN,
					vertex.x,
					`hexagon vertex ${i} x`,
					versusCore(path),
				);
				near(
					outline.points[i]?.y ?? Number.NaN,
					vertex.y,
					`hexagon vertex ${i} y`,
					versusCore(path),
				);
			}
		}
	});

	it("traces the star both paths emit through core's computeStarVertices", async () => {
		const fixture = PARITY_FIXTURES.find((f) => f.id === "star-five-point");
		if (!fixture) throw new Error("fixture missing");
		const paths = await bothPaths(fixture);
		const expected = computeStarVertices(BOUNDS, 5, 0.4);
		expect(expected).toHaveLength(10);
		for (const path of ["Konva", "SVG"] as const) {
			const outline = path === "Konva" ? paths.konva("f1") : paths.svg("f1");
			if (outline.kind !== "polygon") throw new Error("expected a polygon");
			expect(outline.points).toHaveLength(expected.length);
			for (const [i, vertex] of expected.entries()) {
				near(
					outline.points[i]?.x ?? Number.NaN,
					vertex.x,
					`star vertex ${i} x`,
					versusCore(path),
				);
				near(
					outline.points[i]?.y ?? Number.NaN,
					vertex.y,
					`star vertex ${i} y`,
					versusCore(path),
				);
			}
		}
	});
});

describe("composition: what parity can assert without a rasterizer", () => {
	beforeEach(() => {
		vi.stubGlobal("Path2D", RecordingPath2D);
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		cleanup();
	});

	// The rasterized RESULT of a blend is out of reach here. What is in reach —
	// and what actually goes wrong — is the blend and the clip landing on
	// different elements, which would stop them composing at all.
	it("puts the blend mode and the clip on the same element on both paths", async () => {
		const fixture = PARITY_FIXTURES.find(
			(f) => f.id === "clip-plus-blend-mode",
		);
		if (!fixture) throw new Error("fixture missing");
		const paths = await bothPaths(fixture);
		expect(
			paths.groupProps("f1").globalCompositeOperation,
			"clip-plus-blend-mode: the Konva Group carrying the clip must also carry the blend",
		).toBe("multiply");
		// Matched on ONE `<g …>` opening tag rather than on two independent
		// `toContain`s: the failure being guarded against is the blend and the
		// clip landing on DIFFERENT elements, which two separate substring checks
		// would happily pass. The tag's other attributes (the frame's transform)
		// are deliberately not pinned here.
		const clippedGroup = paths.markup.match(
			/<g [^>]*clip-path="url\(#frame-clip-f1\)"[^>]*>/,
		);
		expect(
			clippedGroup?.[0] ?? paths.markup,
			"clip-plus-blend-mode: the SVG <g> carrying clip-path must also carry mix-blend-mode, or the two do not compose",
		).toContain("mix-blend-mode:multiply");
	});

	// Same shape of claim for effects: the effect belongs to the CHILD on both
	// paths and must not reach the clip. Whether `feDropShadow` and Konva's
	// shadow rasterize identically is not something this design can answer.
	it("keeps an effect on the child and out of the clip on both paths", async () => {
		const fixture = PARITY_FIXTURES.find((f) => f.id === "clip-plus-effects");
		if (!fixture) throw new Error("fixture missing");
		const paths = await bothPaths(fixture);
		const child = paths.elements.find(
			(call) => call.type === "Rect" && call.props.id === "r1",
		);
		expect(
			child?.props.shadowBlur,
			"clip-plus-effects: the Konva child must carry the drop shadow",
		).toBe(4);
		expect(paths.markup).toContain('filter="url(#shadow-r1)"');
		// And the clip is untouched by it — asserted by the corpus run above; this
		// only pins that the effect did not migrate onto the clipping Group.
		expect(paths.groupProps("f1").shadowBlur).toBeUndefined();
	});

	// ADR 0008 decision 1 records that a square frame with `radius = side / 2`
	// already clips to a circle on both paths, and flags the claim as derived
	// from markup rather than executed. cp4-001 executed the SVG half and
	// cp4-003 the Konva half; this is the cross-path half — the one place this
	// suite compares two DIFFERENT representations of one shape, via an exact
	// algebraic bridge rather than a loosened tolerance.
	it("confirms ADR 0008 decision 1's circle: radius = side/2 equals the inscribed ellipse", async () => {
		const square = { width: 200, height: 200 };
		const viaRadius = await bothPaths({
			id: "circle-via-radius",
			why: "ADR 0008 decision 1",
			frames: [{ id: "f1", kind: "rect" }],
			build: () => shapedFrame(undefined, { bounds: square, radius: 100 }),
		});
		const viaEllipse = await bothPaths({
			id: "circle-via-ellipse",
			why: "ADR 0008 decision 1",
			frames: [{ id: "f1", kind: "ellipse" }],
			build: () => shapedFrame({ kind: "ellipse" }, { bounds: square }),
		});

		/** A rectangle whose radii saturate BOTH half-extents is exactly the inscribed ellipse. Exact, not approximate. */
		const asEllipse = (outline: ClipOutline): ClipOutline => {
			if (outline.kind !== "rect") return outline;
			const saturated = outline.radii.every(
				(r) =>
					Math.abs(r - outline.width / 2) <= TOLERANCE &&
					Math.abs(r - outline.height / 2) <= TOLERANCE,
			);
			return saturated
				? {
						kind: "ellipse",
						cx: outline.width / 2,
						cy: outline.height / 2,
						rx: outline.width / 2,
						ry: outline.height / 2,
					}
				: outline;
		};

		for (const path of ["konva", "svg"] as const) {
			expectClipParity(
				`ADR 0008 decision 1 circle, on the ${path} path`,
				"f1",
				asEllipse(viaRadius[path]("f1")),
				viaEllipse[path]("f1"),
				["radius=side/2 form", "shape:ellipse form"],
			);
		}
	});
});

/**
 * Real, already-identified disagreements between the two render paths, handed
 * over by `cp4-003`'s execution record. They are encoded as fixtures rather
 * than described in prose so that the day either is reconciled, this file
 * fails and forces the record to be updated.
 *
 * **Nothing here is a statement that the current behaviour is correct.**
 */
describe("known Konva ↔ SVG divergences (cp4-003 handoff)", () => {
	beforeEach(() => {
		vi.stubGlobal("Path2D", RecordingPath2D);
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		cleanup();
	});

	const undrawablePath: ParityFixture = {
		id: "D-1-path-undrawable",
		why: '`d: "Z"` passes SVG\'s character allowlist but yields Konva no points',
		frames: [{ id: "f1", kind: "rect" }],
		build: () => shapedFrame({ kind: "path", d: "Z" }),
	};

	/**
	 * **D-1 — RESOLVED. This is now an ordinary parity assertion.**
	 *
	 * The two paths used to guard `kind: "path"` with different oracles: SVG
	 * applied `PATH_D_RE`, a character allowlist, and Konva applied
	 * `hasDrawablePathData`, i.e. Konva's own parser. `d: "Z"` passes the
	 * allowlist and yields no points, so SVG emitted `<path d="Z" />` inside the
	 * `<clipPath>` — an empty clip region that erased the frame's entire content
	 * — while Konva degraded to the frame box.
	 *
	 * The resolution is the one this file recommended, and it went further in the
	 * only direction that removes the defect class rather than this instance of
	 * it: BOTH predicates moved to `canvas/core/src/path-data.ts` (rank 0, the
	 * same forcing argument that produced `uri.ts` — `ir/` at rank 1 could not
	 * import a rank-5 regex, which is the entire reason the question was split in
	 * two), and `resolveFrameClipShape` now applies both. Drawability and
	 * character safety are still separate questions with separate
	 * `FrameClipDegradation` reasons, but ONE resolver answers them for every
	 * consumer, so neither renderer decides for itself any more. Konva's own
	 * parser is no longer consulted for frame clips at all.
	 *
	 * `hasDrawablePathData` remains in `finite-geometry.ts` for path NODES, where
	 * the question really is Konva's ("does `getSelfRect` return a real rect").
	 */
	it('D-1: an undrawable path `d` ("Z") degrades identically on both paths', async () => {
		const paths = await bothPaths(undrawablePath);
		expectClipParity(
			undrawablePath.id,
			"f1",
			paths.konva("f1"),
			paths.svg("f1"),
		);
	});

	/**
	 * Characterization of the RESOLVED D-1 — a record of what each path does, so
	 * a silent change on either side is caught. The parity assertion above proves
	 * they agree; this proves *what* they agree on, which is the half that
	 * matters: agreeing to emit an empty clip would also be parity.
	 */
	it("D-1 characterization: both paths degrade to the frame box, and SVG warns", async () => {
		const paths = await bothPaths(undrawablePath);
		const box = {
			kind: "rect",
			width: BOUNDS.width,
			height: BOUNDS.height,
			radii: NO_CORNERS,
		};
		expect(paths.svg("f1")).toEqual(box);
		expect(paths.konva("f1")).toEqual(box);
		// And it is no longer silent: the resolver rejected the shape, so the
		// export says so instead of shipping an empty region.
		expect(paths.warnings).toContain("FRAME_CLIP_SHAPE_DEGRADED");
	});

	/**
	 * **D-2 — NOT a clip-geometry divergence.** `cp4-003`'s handoff reports that
	 * a `path` whose `d` leaves the frame's bounds "clips to `path ∩ bounds` on
	 * the Konva side (the bounds-sized background/geometry `Rect` is what
	 * constrains it), where SVG's background is painted from the shape element
	 * itself."
	 *
	 * The second half of that does not hold against the source. `emitFrame`
	 * paints the background from `frameBoxElement(node, …)` — the frame's own
	 * BOX (`canvas/core/src/serialize/svg.ts:1902-1911`, called at `:2020-2027`)
	 * — explicitly so that an inert `shape` cannot reach it; the Konva frame
	 * renderer paints its background/geometry `Rect` at `width={width}
	 * height={height}` (`CanvasNodeRenderer.tsx:456-483`). Both are bounds-sized
	 * and both sit inside the clipped container, so both render
	 * `box ∩ clip` — the same thing.
	 *
	 * This fixture asserts what IS in reach: the clip REGION is the same `d` on
	 * both paths even when it leaves the bounds. What remains genuinely out of
	 * reach is whether a CHILD placed in the part of the clip region outside the
	 * frame's bounds composites identically — that is a rasterizer question, and
	 * it belongs to a browser-level canvas E2E assertion (`cp6-004`), not to a
	 * unit-test merge gate.
	 */
	it("D-2: an out-of-bounds path `d` is the same clip region on both paths", async () => {
		const paths = await bothPaths({
			id: "D-2-path-out-of-bounds",
			why: "the clip region extends past the frame's own bounds",
			frames: [{ id: "f1", kind: "path" }],
			build: () =>
				shapedFrame({ kind: "path", d: "M-50 -50 L250 -50 L250 150 Z" }),
		});
		expectClipParity(
			"D-2-path-out-of-bounds",
			"f1",
			paths.konva("f1"),
			paths.svg("f1"),
		);
		expect(paths.konva("f1")).toEqual({
			kind: "path",
			d: "M-50 -50 L250 -50 L250 150 Z",
		});
	});
});
