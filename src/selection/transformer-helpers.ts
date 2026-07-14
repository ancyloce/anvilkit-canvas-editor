import type {
	CanvasAnyNodeUpdateCommand,
	CanvasCommand,
	CanvasNode,
	CanvasNodeResizeCommand,
	CanvasNodeRotateCommand,
} from "@anvilkit/canvas-core";
import type Konva from "konva";
import { nodeRenderOffset } from "../stage/node-render-offset.js";

/**
 * Selection-chrome colors, sourced from the editor's shadcn/Tailwind theme
 * tokens (`--primary`, `--background`, …) so the chrome follows the host theme
 * (light/dark) instead of hardcoded values.
 */
export interface ChromeTheme {
	/** Accent for the border + resize handles (`--primary`). */
	accent: string;
	/** Resting handle / surface fill (`--background`). */
	surface: string;
	/** Foreground on a surface — badge bg, rotate-icon glyph (`--foreground`). */
	onSurface: string;
	/** Hairline border for the rotate-icon button (`--border`). */
	border: string;
}

/** Light-theme token defaults (mirrors `styles.src.css` `:root`). */
export const FALLBACK_CHROME_THEME: ChromeTheme = {
	accent: "oklch(0.205 0 0)",
	surface: "oklch(1 0 0)",
	onSurface: "oklch(0.145 0 0)",
	border: "oklch(0.922 0 0)",
};

/**
 * Read the shadcn theme tokens off the stage container's computed style.
 * Custom properties inherit, so this picks up the active light/dark values.
 * Falls back to the light defaults when the DOM/value is unavailable (SSR,
 * jsdom, pre-mount).
 */
export function resolveChromeTheme(el: HTMLElement | null): ChromeTheme {
	if (!el || typeof getComputedStyle !== "function")
		return FALLBACK_CHROME_THEME;
	const cs = getComputedStyle(el);
	const read = (name: string, fallback: string) =>
		cs.getPropertyValue(name).trim() || fallback;
	return {
		accent: read("--primary", FALLBACK_CHROME_THEME.accent),
		surface: read("--background", FALLBACK_CHROME_THEME.surface),
		onSurface: read("--foreground", FALLBACK_CHROME_THEME.onSurface),
		border: read("--border", FALLBACK_CHROME_THEME.border),
	};
}

/**
 * KONVA-INTERNAL (T7). The name (e.g. `"top-left"`, `"rotater"`) of the anchor
 * currently being dragged during a transform, or `null` when idle. Konva drives
 * resize/rotate off raw window mouse events and immediately `stopDrag()`s the
 * anchor, so `anchor.isDragging()` is always false inside `anchorStyleFunc`; the
 * only signal Konva exposes is the **undocumented private** `_movingAnchorName`
 * on the `Transformer`. We deliberately read it, but funnel every access through
 * this one helper so the brittle coupling lives in a single, marked place — a
 * Konva rename then breaks here (and its pinning test) instead of silently
 * across the component. `node` is the Transformer (or an anchor's parent, which
 * is the Transformer).
 *
 * @see CanvasTransformer — `anchorStyleFunc` and `onTransformStart`.
 */
export function activeAnchorName(
	node: Konva.Node | null | undefined,
): string | null {
	return (
		(node as { _movingAnchorName?: string | null } | null | undefined)
			?._movingAnchorName ?? null
	);
}

/**
 * Tint an anchor on hover: the dragger under the cursor fills with the accent,
 * reverting to the surface fill on leave. The accent is hover feedback on the
 * handles themselves (no persistent colored block).
 */
export function setAnchorHovered(
	anchor: Konva.Rect,
	hovered: boolean,
	accent: string,
	surface: string,
): void {
	anchor.fill(hovered ? accent : surface);
	anchor.getLayer?.()?.batchDraw?.();
}

/**
 * Normalize a rotation (degrees) to the readable `(-180, 180]` range used by the
 * angle readout, e.g. `229 → -131`, `-200 → 160`.
 */
export function normalizeAngle(deg: number): number {
	let a = deg % 360;
	if (a > 180) a -= 360;
	if (a <= -180) a += 360;
	return a;
}

interface Box {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * Axis-aligned union of the selected nodes' bounding boxes, in `layer`
 * (design) coordinates. During a transform each node already carries its live
 * resize scale, so the rect reflects the dimensions being dragged. Returns null
 * when nothing resolves (empty selection / detached nodes).
 */
export function selectionBox(
	stage: Konva.Stage,
	ids: readonly string[],
	layer: Konva.Node | null,
): Box | null {
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	let found = false;
	for (const id of ids) {
		const node = stage.findOne(`.${id}`);
		if (!node) continue;
		const r = node.getClientRect({
			relativeTo: (layer ?? undefined) as Konva.Container | undefined,
			skipShadow: true,
		});
		minX = Math.min(minX, r.x);
		minY = Math.min(minY, r.y);
		maxX = Math.max(maxX, r.x + r.width);
		maxY = Math.max(maxY, r.y + r.height);
		found = true;
	}
	if (!found) return null;
	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

const EPSILON = 0.5;

/**
 * Floor for a committed resize, in design units. Konva's `Transformer`
 * computes its bounding box (and every anchor position) by inverting the
 * selected nodes' transform matrices; a box collapsed to 0×0 makes that
 * matrix singular, and Konva's own inversion divides by the (zero)
 * determinant — producing `NaN` corners that propagate to every later
 * `width`/`height`/`x` Konva sets from this box (see the `boundBoxFunc` on
 * `<Transformer>` in `CanvasTransformer.tsx`, which stops a live drag from
 * ever reaching this collapse; this floor is the belt-and-braces guard on
 * the commit path itself). Mirrors the draw tools' `MIN_DIMENSION` (e.g.
 * `rect-tool.ts`).
 */
export const MIN_DIMENSION = 1;

/**
 * Nodes sized by their geometry × transform scale, NOT by `bounds`:
 * `Konva.Path` renders from its `d`, `Konva.Line` from its `points`, each
 * scaled by `transform.scaleX/Y`. A resize must PERSIST that scale — baking it
 * into `bounds` (the bounds-sized path) is ignored by the renderer, so the
 * element snaps back to its intrinsic size the instant the commit re-renders.
 */
const SCALE_SIZED: ReadonlySet<CanvasNode["type"]> = new Set(["path", "line"]);

/**
 * Translate the live Konva transforms of the selected nodes into IR commands
 * on `transformend` — one resize and/or rotate command per affected node so
 * the caller can commit a whole gesture (incl. simultaneous resize + rotate,
 * and multi-node transforms) as ONE undo entry. Locked nodes are reset to
 * their IR transform and skipped. Bounds-sized nodes get their Konva scale
 * baked into bounds and reset to 1 (the next transform starts from 1×);
 * path/line nodes keep the scale, persisted into the IR transform instead.
 */
export function collectTransformEndCommands(
	stage: Konva.Stage,
	selectedIds: readonly string[],
	childById: ReadonlyMap<string, CanvasNode>,
): CanvasCommand[] {
	const cmds: CanvasCommand[] = [];
	for (const id of selectedIds) {
		const knode = stage.findOne(`.${id}`) as Konva.Node | undefined;
		const irNode = childById.get(id);
		if (!knode || !irNode) continue;
		// Locked nodes are protected from resize/rotate. If one slipped into
		// the selection (e.g. via the layer panel) and the user dragged a
		// handle anyway, reset the live Konva transform on commit and skip.
		if (irNode.locked === true) {
			knode.scaleX(1);
			knode.scaleY(1);
			knode.rotation(irNode.transform.rotation);
			knode.x(irNode.transform.x);
			knode.y(irNode.transform.y);
			continue;
		}
		const { transform, bounds } = irNode;

		const scaleX = knode.scaleX();
		const scaleY = knode.scaleY();
		const konvaX = knode.x();
		const konvaY = knode.y();
		const newRotation = knode.rotation();

		if (SCALE_SIZED.has(irNode.type)) {
			// Path/line: persist the Transformer's scale into the IR transform so
			// the new size survives the commit (the renderer scales the geometry
			// by `transform.scaleX/Y`). Don't reset the Konva scale — the
			// re-render reapplies it from the IR. Position offset is 0 here.
			const offset = nodeRenderOffset(irNode);
			const nextX = konvaX - offset.x;
			const nextY = konvaY - offset.y;
			const changed =
				Math.abs(scaleX - transform.scaleX) > EPSILON ||
				Math.abs(scaleY - transform.scaleY) > EPSILON ||
				Math.abs(nextX - transform.x) > EPSILON ||
				Math.abs(nextY - transform.y) > EPSILON ||
				Math.abs(newRotation - transform.rotation) > EPSILON;
			if (changed) {
				const cmd: CanvasAnyNodeUpdateCommand = {
					type: "node.update",
					nodeId: id,
					kind: irNode.type,
					patch: {
						transform: {
							...transform,
							x: nextX,
							y: nextY,
							scaleX,
							scaleY,
							rotation: newRotation,
						},
					},
				} as CanvasAnyNodeUpdateCommand;
				cmds.push(cmd);
			}
			continue;
		}

		// Bounds-sized nodes (rect/ellipse/image/text/group): bake the scale
		// into bounds and reset the Konva scale so the next transform starts
		// from 1×.
		knode.scaleX(1);
		knode.scaleY(1);
		const newW = Math.max(MIN_DIMENSION, bounds.width * scaleX);
		const newH = Math.max(MIN_DIMENSION, bounds.height * scaleY);
		// Konva.Ellipse positions by its CENTER, so `knode.x()` is the center.
		// Convert back to the IR top-left using the NEW bounds, or a resized
		// ellipse drifts by half its new size on commit.
		const offset = nodeRenderOffset({
			...irNode,
			bounds: { width: newW, height: newH },
		} as CanvasNode);
		const newX = konvaX - offset.x;
		const newY = konvaY - offset.y;

		const boundsChanged =
			Math.abs(newW - bounds.width) > EPSILON ||
			Math.abs(newH - bounds.height) > EPSILON ||
			Math.abs(newX - transform.x) > EPSILON ||
			Math.abs(newY - transform.y) > EPSILON;
		if (boundsChanged) {
			const cmd: CanvasNodeResizeCommand = {
				type: "node.resize",
				nodeId: id,
				from: {
					x: transform.x,
					y: transform.y,
					width: bounds.width,
					height: bounds.height,
				},
				to: { x: newX, y: newY, width: newW, height: newH },
			};
			cmds.push(cmd);
		}

		if (Math.abs(newRotation - transform.rotation) > EPSILON) {
			const cmd: CanvasNodeRotateCommand = {
				type: "node.rotate",
				nodeId: id,
				from: transform.rotation,
				to: newRotation,
			};
			cmds.push(cmd);
		}
	}
	return cmds;
}
