import type { PenAnchor } from "../stores/pen-store.js";

export interface PenBounds {
	minX: number;
	minY: number;
	width: number;
	height: number;
}

/** Round to 2dp and drop a trailing `.00` so integer inputs stay integer. */
function fmt(n: number): string {
	const r = Math.round(n * 100) / 100;
	return String(r);
}

function mirror(anchorCoord: number, handleCoord: number): number {
	return 2 * anchorCoord - handleCoord;
}

/**
 * Axis-aligned bounds of a pen path, including each anchor's point plus its
 * outgoing and (mirrored) incoming control handles so bezier overshoot is
 * enclosed. Returns a zero box for an empty anchor list.
 */
export function penBounds(anchors: readonly PenAnchor[]): PenBounds {
	if (anchors.length === 0) return { minX: 0, minY: 0, width: 0, height: 0 };
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	const consider = (px: number, py: number) => {
		minX = Math.min(minX, px);
		minY = Math.min(minY, py);
		maxX = Math.max(maxX, px);
		maxY = Math.max(maxY, py);
	};
	for (const a of anchors) {
		consider(a.x, a.y);
		consider(a.hx, a.hy);
		consider(mirror(a.x, a.hx), mirror(a.y, a.hy));
	}
	return { minX, minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Build SVG path data from pen anchors, translated by `(-ox, -oy)` so the path
 * is local to its bounds. A segment whose adjoining handles sit on their anchors
 * is emitted as a straight `L`; otherwise as a cubic `C` (prev outgoing handle,
 * next mirrored incoming handle). When `closed`, a final segment returns to the
 * first anchor followed by `Z`.
 */
export function buildPathD(
	anchors: readonly PenAnchor[],
	closed: boolean,
	ox = 0,
	oy = 0,
): string {
	if (anchors.length === 0) return "";
	const first = anchors[0];
	if (!first) return "";
	const p = (x: number, y: number) => `${fmt(x - ox)} ${fmt(y - oy)}`;
	const segment = (from: PenAnchor, to: PenAnchor): string => {
		const c1x = from.hx;
		const c1y = from.hy;
		const c2x = mirror(to.x, to.hx);
		const c2y = mirror(to.y, to.hy);
		const straight =
			c1x === from.x && c1y === from.y && c2x === to.x && c2y === to.y;
		if (straight) return ` L ${p(to.x, to.y)}`;
		return ` C ${p(c1x, c1y)} ${p(c2x, c2y)} ${p(to.x, to.y)}`;
	};
	let d = `M ${p(first.x, first.y)}`;
	for (let i = 1; i < anchors.length; i++) {
		const from = anchors[i - 1];
		const to = anchors[i];
		if (from && to) d += segment(from, to);
	}
	if (closed && anchors.length >= 2) {
		const last = anchors[anchors.length - 1];
		if (last) {
			const seg = segment(last, first);
			// A straight close is implied by `Z`; only a curved close needs its
			// explicit cubic emitted before `Z`.
			if (!seg.startsWith(" L")) d += seg;
		}
		d += " Z";
	}
	return d;
}
