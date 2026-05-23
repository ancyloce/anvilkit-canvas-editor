export interface Pt {
	x: number;
	y: number;
}

export type PathSeg =
	| { kind: "L"; to: Pt }
	| { kind: "C"; c1: Pt; c2: Pt; to: Pt };

export interface ParsedPath {
	start: Pt;
	segs: PathSeg[];
	closed: boolean;
}

/** Locates one editable point within a {@link ParsedPath}. */
export type PathControlRef =
	| { type: "start" }
	| { type: "to"; seg: number }
	| { type: "c1"; seg: number }
	| { type: "c2"; seg: number };

export interface PathControl {
	x: number;
	y: number;
	ref: PathControlRef;
	/** On-curve anchor vs. off-curve bezier control. */
	role: "anchor" | "control";
}

function fmt(n: number): string {
	const r = Math.round(n * 100) / 100;
	return String(r);
}

/**
 * Parse the absolute `M`/`L`/`C`/`Z` subset emitted by the pen tool (and most
 * simple hand-authored paths) into an editable structure. Returns null for any
 * unsupported command (relative ops, H/V/S/Q/A, …) so callers can fall back to
 * raw-text editing rather than corrupt the path.
 */
export function parsePathD(d: string): ParsedPath | null {
	const tokens = d.match(/[MLCZmlcz]|-?\d*\.?\d+(?:e-?\d+)?/g);
	if (!tokens || tokens.length === 0) return null;
	let i = 0;
	const num = (): number => {
		const t = tokens[i++];
		const n = t === undefined ? Number.NaN : Number(t);
		return n;
	};
	const peekIsNumber = (): boolean => {
		const t = tokens[i];
		return t !== undefined && !/[MLCZmlcz]/.test(t);
	};
	let start: Pt | null = null;
	const segs: PathSeg[] = [];
	let closed = false;
	while (i < tokens.length) {
		const cmd = tokens[i++];
		if (cmd === "M") {
			const x = num();
			const y = num();
			if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
			start = { x, y };
			// Extra pairs after an M are implicit L commands.
			while (peekIsNumber()) {
				const lx = num();
				const ly = num();
				if (!Number.isFinite(lx) || !Number.isFinite(ly)) return null;
				segs.push({ kind: "L", to: { x: lx, y: ly } });
			}
		} else if (cmd === "L") {
			do {
				const x = num();
				const y = num();
				if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
				segs.push({ kind: "L", to: { x, y } });
			} while (peekIsNumber());
		} else if (cmd === "C") {
			do {
				const c1x = num();
				const c1y = num();
				const c2x = num();
				const c2y = num();
				const x = num();
				const y = num();
				if (![c1x, c1y, c2x, c2y, x, y].every((n) => Number.isFinite(n))) {
					return null;
				}
				segs.push({
					kind: "C",
					c1: { x: c1x, y: c1y },
					c2: { x: c2x, y: c2y },
					to: { x, y },
				});
			} while (peekIsNumber());
		} else if (cmd === "Z" || cmd === "z") {
			closed = true;
		} else {
			return null; // unsupported command
		}
	}
	if (!start) return null;
	return { start, segs, closed };
}

export function serializeParsedPath(path: ParsedPath): string {
	const p = (pt: Pt) => `${fmt(pt.x)} ${fmt(pt.y)}`;
	let d = `M ${p(path.start)}`;
	for (const seg of path.segs) {
		if (seg.kind === "L") d += ` L ${p(seg.to)}`;
		else d += ` C ${p(seg.c1)} ${p(seg.c2)} ${p(seg.to)}`;
	}
	if (path.closed) d += " Z";
	return d;
}

/** Flat list of every draggable point (anchors + bezier controls). */
export function pathControlPoints(path: ParsedPath): PathControl[] {
	const out: PathControl[] = [];
	out.push({ ...path.start, ref: { type: "start" }, role: "anchor" });
	path.segs.forEach((seg, idx) => {
		if (seg.kind === "C") {
			out.push({ ...seg.c1, ref: { type: "c1", seg: idx }, role: "control" });
			out.push({ ...seg.c2, ref: { type: "c2", seg: idx }, role: "control" });
		}
		out.push({ ...seg.to, ref: { type: "to", seg: idx }, role: "anchor" });
	});
	return out;
}

/** Return a new path with the point at `ref` moved to `(x, y)`. */
export function movePathControl(
	path: ParsedPath,
	ref: PathControlRef,
	x: number,
	y: number,
): ParsedPath {
	if (ref.type === "start") return { ...path, start: { x, y } };
	const segs = path.segs.map((seg, idx) => {
		if (idx !== ref.seg) return seg;
		if (ref.type === "to") return { ...seg, to: { x, y } };
		if (seg.kind !== "C") return seg;
		if (ref.type === "c1") return { ...seg, c1: { x, y } };
		return { ...seg, c2: { x, y } };
	});
	return { ...path, segs };
}
