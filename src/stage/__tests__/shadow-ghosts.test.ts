// @vitest-environment node
// Pure logic test — the routing decision and the device-space shadow maths.
// The pixel-level claims these encode (a ghost pass is identical to Konva's
// native shadow, and `spread` dilates by exactly `spread`) were verified in
// headless Chrome; what is asserted here is the arithmetic those rest on.
import type { CanvasEffect } from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import {
	ghostDropShadows,
	ghostShadowDrawParams,
	shadowRGBA,
} from "../shadow-ghosts.js";

const SHADOW = {
	type: "drop-shadow",
	color: "#ff0000",
	blur: 10,
	offsetX: 15,
	offsetY: 20,
} satisfies CanvasEffect;

/** One local +x unit lands one device pixel along +x: no scale, no rotation. */
const UNIT_AXIS = { x: 1, y: 0 } as const;

function params(
	overrides: Partial<Parameters<typeof ghostShadowDrawParams>[0]> = {},
) {
	return ghostShadowDrawParams({
		effect: SHADOW,
		axis: UNIT_AXIS,
		absoluteScale: { x: 1, y: 1 },
		absolutePosition: { x: 0, y: 0 },
		pixelRatio: 1,
		canvasWidth: 800,
		canvasHeight: 600,
		silhouetteExtent: 50,
		...overrides,
	});
}

describe("ghostDropShadows — what Konva can express natively", () => {
	it("leaves an effect-less node alone", () => {
		expect(ghostDropShadows([])).toBeNull();
	});

	it("leaves ONE spread-less shadow on the native path", () => {
		expect(ghostDropShadows([SHADOW])).toBeNull();
	});

	it("takes over as soon as a shadow has spread", () => {
		const withSpread = { ...SHADOW, spread: 4 };
		expect(ghostDropShadows([withSpread])).toEqual([withSpread]);
	});

	it("takes over for a stack, which Konva can only render the first of", () => {
		const second = { ...SHADOW, color: "#00ff00" };
		expect(ghostDropShadows([SHADOW, second])).toEqual([SHADOW, second]);
	});

	it("ignores blur effects — they cast nothing", () => {
		expect(ghostDropShadows([{ type: "blur", radius: 6 }])).toBeNull();
		// A blur alongside ONE plain shadow still leaves the shadow native.
		expect(ghostDropShadows([{ type: "blur", radius: 6 }, SHADOW])).toBeNull();
	});

	it("preserves list order, which is the paint order", () => {
		const a = { ...SHADOW, color: "#aaaaaa", spread: 1 };
		const b = { ...SHADOW, color: "#bbbbbb" };
		expect(ghostDropShadows([a, b])?.map((s) => s.color)).toEqual([
			"#aaaaaa",
			"#bbbbbb",
		]);
	});
});

describe("ghostShadowDrawParams — the displacement must cancel exactly", () => {
	/**
	 * THE invariant: the silhouette is drawn `shift` local units away, and the
	 * shadow offset has to put its shadow back exactly where a native Konva
	 * shadow would have landed. Net = displacement + offset.
	 */
	function netLanding(
		p: NonNullable<ReturnType<typeof ghostShadowDrawParams>>,
		axis: { x: number; y: number },
	) {
		return {
			x: -p.shift * axis.x + p.shadowOffsetX,
			y: -p.shift * axis.y + p.shadowOffsetY,
		};
	}

	it("lands on the native offset for an untransformed node", () => {
		const p = params();
		expect(p).not.toBeNull();
		if (!p) return;
		expect(netLanding(p, UNIT_AXIS)).toEqual({ x: 15, y: 20 });
	});

	it("lands on the native offset under scale and pixel ratio", () => {
		// Stage zoom 2 at devicePixelRatio 2: one local unit is 4 device pixels.
		const axis = { x: 4, y: 0 };
		const p = params({
			axis,
			absoluteScale: { x: 2, y: 2 },
			pixelRatio: 2,
		});
		expect(p).not.toBeNull();
		if (!p) return;
		// Konva multiplies the offset by absoluteScale × pixelRatio = 4.
		expect(netLanding(p, axis)).toEqual({ x: 60, y: 80 });
	});

	it("lands on the native offset for a ROTATED node", () => {
		// 30°: the local +x axis the shift travels along is no longer device +x,
		// so a scale-only cancel would leave the shadow adrift.
		const axis = { x: Math.cos(Math.PI / 6), y: Math.sin(Math.PI / 6) };
		const p = params({ axis });
		expect(p).not.toBeNull();
		if (!p) return;
		const net = netLanding(p, axis);
		expect(net.x).toBeCloseTo(15, 6);
		expect(net.y).toBeCloseTo(20, 6);
	});

	it("shifts the silhouette clear of the canvas, whatever the rotation", () => {
		const axis = { x: Math.cos(Math.PI / 3), y: Math.sin(Math.PI / 3) };
		const p = params({ axis, absolutePosition: { x: 300, y: 200 } });
		expect(p).not.toBeNull();
		if (!p) return;
		// Device distance travelled must clear the canvas diagonal AND the node's
		// own offset within the scene, or the silhouette would paint on screen.
		const travelled = p.shift * Math.hypot(axis.x, axis.y);
		const diagonal = Math.hypot(800, 600);
		const origin = Math.hypot(300, 200);
		expect(travelled).toBeGreaterThan(diagonal + origin);
	});

	it("takes blur from the smaller axis, as Konva's _applyShadow does", () => {
		const p = params({
			axis: { x: 3, y: 0 },
			absoluteScale: { x: 3, y: 1 },
		});
		expect(p?.shadowBlur).toBe(10);
	});

	it("declines a degenerate transform rather than dividing by zero", () => {
		expect(params({ axis: { x: 0, y: 0 } })).toBeNull();
		expect(params({ absoluteScale: { x: Number.NaN, y: 1 } })).toBeNull();
		expect(params({ pixelRatio: Number.POSITIVE_INFINITY })).toBeNull();
	});
});

describe("shadowRGBA", () => {
	it("folds opacity into the colour the way Konva's getShadowRGBA does", () => {
		expect(shadowRGBA({ ...SHADOW, color: "#ff0000", opacity: 0.5 })).toBe(
			"rgba(255,0,0,0.5)",
		);
	});

	it("keeps an existing alpha and multiplies opacity through it", () => {
		expect(
			shadowRGBA({ ...SHADOW, color: "rgba(0,0,255,0.4)", opacity: 0.5 }),
		).toBe("rgba(0,0,255,0.2)");
	});

	it("defaults to fully opaque when the effect declares no opacity", () => {
		expect(shadowRGBA({ ...SHADOW, color: "#0000ff" })).toBe("rgba(0,0,255,1)");
	});

	it("passes an unparseable colour through instead of silently blackening it", () => {
		expect(shadowRGBA({ ...SHADOW, color: "not-a-color" })).toBe("not-a-color");
	});
});
