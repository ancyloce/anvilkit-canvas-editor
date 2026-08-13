/**
 * @file K-10 (review 0036) — drop shadows Konva's single native shadow cannot
 * express: SHADOW STACKS and SPREAD.
 *
 * THE DIVERGENCE THIS CLOSES. Core's effect model (`CanvasDropShadowEffect`)
 * carries a list of shadows, each with an optional `spread`, and the SVG
 * serializer renders that model exactly — one
 * `dilate(spread) → blur → offset → flood/composite` chain per shadow, merged
 * under the source in list order (`core/src/serialize/svg.ts` `effectsMarkup`).
 * A Konva shape has ONE `shadow*` prop set and no spread primitive, so the live
 * canvas used to show only the FIRST drop shadow and fake `spread` by widening
 * the blur. That is a silent "one pipeline, four consumers" break: the spread
 * slider is authorable in the inspector today (`panels/fill-shadow-fields.tsx`),
 * and the Konva path is what the editor, thumbnails, PNG/JPEG/WebP export AND
 * the PDF exporter (which embeds Konva rasters) all show — five of the six
 * consumers, disagreeing with the sixth.
 *
 * THE MECHANISM. For each shadow we draw the shape's silhouette an extra time
 * with the native canvas shadow configured for that effect, and put the
 * silhouette itself OFF-CANVAS while offsetting its shadow back into view by
 * the same displacement. Canvas shadows are generated from the drawn alpha and
 * are NOT affected by the CTM, so the shadow lands exactly where it belongs
 * while the body it was cast from paints outside the canvas and is discarded.
 * That yields a shadow with no crisp body — verified pixel-identical
 * (`maxDiff: 0`) to Konva's own native shadow at stage scale 2 and
 * `devicePixelRatio` 2 in headless Chrome.
 *
 * WHY NOT GHOST NODES. The obvious shape of this is an extra Konva node per
 * shadow. Two things kill it: a sibling node does not follow the imperative
 * position/scale writes that drag and transform gestures make on the real node
 * (exactly the "compensating mechanism" trap K-4 removed), and a child node
 * carrying a large `shadowOffset` inflates its parent's `getClientRect` —
 * `Shape.getClientRect` adds `|shadowOffset| + blur` — which would corrupt every
 * selection box. Drawing inside the real shape's own `sceneFunc` has neither
 * problem: the node tree, its transforms, its client rects and its hit graph
 * are all untouched.
 *
 * WHAT STAYS ON THE NATIVE PATH. A node with no shadow, or exactly one
 * spread-less shadow, is expressed exactly by Konva's `shadow*` props, so it
 * keeps them and never reaches this module. Only documents that were being
 * rendered WRONG take the new path.
 */

import type {
	CanvasDropShadowEffect,
	CanvasEffect,
} from "@anvilkit/canvas-core";
import type Konva from "konva";
import KonvaCore from "./konva.js";

/** Konva's own signature for `sceneFunc`/`hitFunc`. */
type DrawFunc = (context: Konva.Context, shape: Konva.Shape) => void;

/**
 * Extra local-space margin on the off-canvas displacement. The displacement is
 * already computed to clear the canvas and the shape; this is slack against
 * rounding, not a correctness input.
 */
const OFF_CANVAS_SAFETY = 16;

/**
 * The drop shadows that must be drawn by hand, or `null` when Konva's single
 * native shadow renders the node's effects exactly.
 *
 * Blur effects (`CanvasBlurEffect`) are deliberately NOT considered here: they
 * blur the node itself rather than casting anything, the live canvas has never
 * rendered them, and doing so needs `cache()` + a filter — a different problem
 * with different economics (see K-7). This function is only about shadows.
 */
export function ghostDropShadows(
	effects: readonly CanvasEffect[],
): readonly CanvasDropShadowEffect[] | null {
	const shadows = effects.filter(
		(e): e is CanvasDropShadowEffect => e.type === "drop-shadow",
	);
	if (shadows.length === 0) return null;
	// K-18: a node blur is rendered by caching the node and filtering the bitmap,
	// and SVG blurs the shadows WITH the source (`effectsMarkup` merges shadows
	// under the source, then blurs the result). A shadow only ends up inside that
	// bitmap if it was painted in `sceneFunc` — Konva applies a native `shadow*`
	// when the cached bitmap is composited, i.e. after the blur, which is the
	// wrong order. So any blur forces every shadow onto the ghost path.
	if (effects.some((e) => e.type === "blur")) return shadows;
	// One spread-less shadow IS Konva's native model — leave it alone.
	if (shadows.length === 1 && (shadows[0]?.spread ?? 0) === 0) return null;
	return shadows;
}

/** Device-space shadow settings plus the local-space displacement they cancel. */
export interface GhostShadowDrawParams {
	/** How far to translate the silhouette, in LOCAL units, along local +x. */
	shift: number;
	shadowBlur: number;
	shadowOffsetX: number;
	shadowOffsetY: number;
}

/**
 * The device-space shadow settings for one ghost pass.
 *
 * Canvas shadow attributes live in DEVICE space and ignore the CTM, which is
 * why Konva's own `Context._applyShadow` multiplies blur and offset by
 * `absoluteScale × pixelRatio`; blur takes the smaller axis and the offset is
 * NOT rotated. Both rules are mirrored exactly here so a ghost shadow and a
 * native one are the same pixels.
 *
 * The displacement is the part Konva has no equivalent for. `ctx.translate` is
 * applied in LOCAL space, so it is rotated and scaled by the shape's absolute
 * transform, while the shadow offset that has to cancel it is not. The cancel
 * therefore runs the displacement through the transform's linear part
 * (`matrix[0]`, `matrix[1]`) rather than through the scale alone — otherwise
 * every rotated node's shadow would fly off.
 *
 * Returns `null` for a degenerate transform (zero/non-finite scale), where
 * nothing is visible anyway and the arithmetic would divide by zero.
 */
export function ghostShadowDrawParams(input: {
	effect: Pick<CanvasDropShadowEffect, "blur" | "offsetX" | "offsetY">;
	/**
	 * Where one local +x unit points in DEVICE pixels — the first column of the
	 * live CTM. Taken from the context rather than from the node's absolute
	 * transform on purpose: when Konva draws into a cache or a buffer canvas it
	 * transforms relative to the cache root, not to the stage, so the node's
	 * absolute transform is not what the silhouette will actually be moved by.
	 */
	axis: { x: number; y: number };
	absoluteScale: { x: number; y: number };
	absolutePosition: { x: number; y: number };
	pixelRatio: number;
	/** Backing-store size of the canvas being drawn into, in device pixels. */
	canvasWidth: number;
	canvasHeight: number;
	/** Furthest the silhouette reaches from the shape's origin, in local units. */
	silhouetteExtent: number;
}): GhostShadowDrawParams | null {
	const {
		effect,
		axis,
		absoluteScale,
		absolutePosition,
		pixelRatio,
		canvasWidth,
		canvasHeight,
		silhouetteExtent,
	} = input;
	const scaleX = absoluteScale.x * pixelRatio;
	const scaleY = absoluteScale.y * pixelRatio;
	// Device length of one local unit along the shape's local +x axis. Rotation
	// preserves length, so this is what converts the displacement either way.
	const axisLength = Math.hypot(axis.x, axis.y);
	if (!Number.isFinite(axisLength) || axisLength <= 0) return null;
	if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY)) return null;

	// Push the silhouette past the far corner of the canvas AND past its own
	// origin, so it lands outside the backing store whatever the rotation, the
	// flip, or where in the scene the node sits. Distance is rotation-invariant,
	// so a single magnitude covers every direction the local +x axis can point.
	const canvasDiagonal = Math.hypot(canvasWidth, canvasHeight);
	const originDistance =
		Math.hypot(absolutePosition.x, absolutePosition.y) * pixelRatio;
	const shift =
		(canvasDiagonal + originDistance) / axisLength +
		Math.abs(silhouetteExtent) +
		OFF_CANVAS_SAFETY;
	if (!Number.isFinite(shift)) return null;

	// Where translating (-shift, 0) in local space actually puts the silhouette,
	// in device pixels — the vector the shadow offset has to undo.
	const displacementX = -shift * axis.x;
	const displacementY = -shift * axis.y;

	return {
		shift,
		shadowBlur: effect.blur * Math.min(Math.abs(scaleX), Math.abs(scaleY)),
		shadowOffsetX: effect.offsetX * scaleX - displacementX,
		shadowOffsetY: effect.offsetY * scaleY - displacementY,
	};
}

/**
 * `shadowColor` + `shadowOpacity` folded into one rgba string, the way Konva's
 * `Shape.getShadowRGBA` does it, so an effect's `opacity` means the same thing
 * on both paths.
 */
export function shadowRGBA(effect: CanvasDropShadowEffect): string {
	// Konva's parser returns undefined for a colour it cannot read. The colour
	// still goes to the canvas verbatim in that case — exactly what the native
	// path does with it — rather than silently substituting black.
	const rgba = KonvaCore.Util.colorToRGBA(effect.color);
	if (!rgba) return effect.color;
	return `rgba(${rgba.r},${rgba.g},${rgba.b},${rgba.a * (effect.opacity ?? 1)})`;
}

/**
 * A Konva class's DEFAULT draw functions, borrowed from one throwaway instance
 * per class.
 *
 * `getSceneFunc()` is `attrs.sceneFunc || this._sceneFunc`, so an instance with
 * no overrides hands back the class's own geometry function — the public way to
 * ask "how does a Rect draw itself". We then call it bound to the REAL shape, so
 * it reads the real attrs and, on the hit canvas, fills with the real node's
 * `colorKey`; borrowing the function but not the instance is what keeps
 * hit-testing pointed at the mounted node.
 *
 * Cached per class because constructing a Konva shape registers it in Konva's
 * global `shapes` colour-key map — bounded here to one entry per shape class.
 */
const defaultDrawCache = new WeakMap<
	object,
	{ scene: DrawFunc | undefined; hit: DrawFunc | undefined }
>();

function defaultDrawFuncs(shape: Konva.Shape): {
	scene: DrawFunc | undefined;
	hit: DrawFunc | undefined;
} {
	const ctor = shape.constructor as unknown as new (
		config: Record<string, unknown>,
	) => Konva.Shape;
	const cached = defaultDrawCache.get(ctor);
	if (cached) return cached;
	let entry: { scene: DrawFunc | undefined; hit: DrawFunc | undefined };
	try {
		const probe = new ctor({});
		entry = {
			scene: probe.getSceneFunc() as DrawFunc | undefined,
			hit: probe.getHitFunc() as DrawFunc | undefined,
		};
		probe.destroy();
	} catch {
		// A shape class that will not construct bare is not one we can ghost;
		// the caller falls back to drawing nothing rather than throwing mid-frame.
		entry = { scene: undefined, hit: undefined };
	}
	defaultDrawCache.set(ctor, entry);
	return entry;
}

/**
 * Colour for the `spread` dilation ring. The ring is part of the same silhouette
 * as the fill, so it has to carry the same alpha — a solid ring around a
 * translucent shape would cast a denser shadow at the edge than in the middle.
 * A gradient fill has no single colour to copy (Konva keeps it in
 * `fillLinearGradient*`), so those fall back to the stroke and then to opaque
 * black; the fidelity note is in the module docs.
 */
function dilationColor(attrs: Record<string, unknown>): string {
	if (typeof attrs.fill === "string") return attrs.fill;
	if (typeof attrs.stroke === "string") return attrs.stroke;
	return "#000";
}

/**
 * One detached shape per class, used to draw dilated silhouettes.
 *
 * WHY A TWIN AND NOT THE REAL SHAPE. A `spread` silhouette is the shape drawn
 * with a wider stroke, and there is no safe way to widen the REAL node's stroke
 * for the length of one draw:
 *
 *  - writing `shape.attrs.stroke` directly does nothing, because `hasStroke()`
 *    is memoised on the node (`Shape._getCache`) and only an attr SETTER
 *    invalidates it — measured: the silhouette came out undilated, and the
 *    shadow therefore landed exactly under the body and was invisible;
 *  - calling the setters instead fires change events. `strokeWidthChange` is
 *    one of the events `Konva.Transformer` binds on the node it is attached to,
 *    and the setters also call `_requestDraw()` — so a selected node would kick
 *    the Transformer and schedule another frame from INSIDE a frame, twice per
 *    shadow.
 *
 * A detached twin has no layer (so `_requestDraw` finds nothing to schedule) and
 * nothing is listening to it, so the setters are free. It is reused per class
 * rather than per node: drawing is synchronous, so one instance can serve every
 * node of that class, and its attrs are re-synced from the real shape on each
 * draw — which is also what keeps it from drifting as geometry changes.
 */
const silhouetteTwins = new WeakMap<object, Konva.Shape>();

function silhouetteTwin(shape: Konva.Shape): Konva.Shape | undefined {
	const ctor = shape.constructor as unknown as new (
		config: Record<string, unknown>,
	) => Konva.Shape;
	const existing = silhouetteTwins.get(ctor);
	if (existing) return existing;
	try {
		const twin = new ctor({});
		silhouetteTwins.set(ctor, twin);
		return twin;
	} catch {
		return undefined;
	}
}

/**
 * Point the twin at the real shape's geometry and paint.
 *
 * Copying the whole attr bag is deliberate — it is what makes the silhouette
 * track EVERY geometry prop (corner radii, path data, star ratios, text
 * metrics) without this module knowing one shape kind from another. Four keys
 * are stripped rather than copied: `sceneFunc`/`hitFunc` would point the twin
 * back at this module and recurse, and `id`/`name` would register the detached
 * twin in Konva's global id map where a `findOne('#id')` could return it
 * instead of the mounted node.
 */
function syncSilhouetteTwin(twin: Konva.Shape, shape: Konva.Shape): void {
	const attrs = shape.attrs as Record<string, unknown>;
	twin.setAttrs({
		...attrs,
		sceneFunc: undefined,
		hitFunc: undefined,
		id: undefined,
		name: undefined,
		// A dashed dilation ring would punch holes in the silhouette.
		dash: undefined,
		dashEnabled: false,
		stroke: dilationColor(attrs),
		strokeEnabled: true,
		// Round joins make the ring a true outward offset at corners instead of
		// shooting mitre spikes off sharp vertices (stars, arrow paths).
		lineJoin: "round",
		lineCap: "round",
		// The shadow is set on the context by the caller; the twin must not cast
		// one of its own on top of it.
		shadowEnabled: false,
		shadowColor: undefined,
		shadowBlur: 0,
		shadowOffsetX: 0,
		shadowOffsetY: 0,
	});
}

/**
 * Draw the shadow-casting silhouette once.
 *
 * With no spread the silhouette IS the shape, so the real node draws itself and
 * the pass is pixel-identical to a native Konva shadow. With spread the twin
 * draws it dilated outward by `spread`, which a stroke of `2 × spread` centred
 * on the outline produces exactly — measured: a 60-unit box with spread 8 casts
 * a 76-unit shadow.
 */
function drawSilhouette(
	context: Konva.Context,
	shape: Konva.Shape,
	draw: DrawFunc,
	spread: number,
	baseStrokeWidth: number,
): void {
	if (spread <= 0) {
		draw.call(shape, context, shape);
		return;
	}
	const twin = silhouetteTwin(shape);
	if (!twin) return;
	twin.strokeWidth(baseStrokeWidth + spread * 2);
	draw.call(twin, context, twin);
}

/** How far the silhouette reaches from the shape's origin, in local units. */
function silhouetteExtent(
	shape: Konva.Shape,
	spread: number,
	baseStrokeWidth: number,
): number {
	const rect = shape.getSelfRect();
	const reach = Math.max(
		Math.abs(rect.x) + Math.abs(rect.width),
		Math.abs(rect.y) + Math.abs(rect.height),
	);
	if (!Number.isFinite(reach)) return 0;
	return reach + baseStrokeWidth / 2 + spread;
}

/**
 * Where one local +x unit lands in device pixels, read from the LIVE canvas
 * transform.
 *
 * The node's own absolute transform is the wrong basis whenever Konva is not
 * drawing straight to the stage: a cached group transforms its children
 * relative to the cache root (`drawScene(canvas, top)`), so the absolute
 * transform would include ancestor scale — the stage zoom above all — that the
 * silhouette will not actually be moved by, and the shadow would land that
 * factor away from its shape. The CTM is what the translate is really multiplied
 * by, and it already carries the pixel ratio.
 *
 * Falls back to the absolute transform where `getTransform` is unavailable
 * (older engines; jsdom has no 2D context at all), which is exact for the
 * ordinary straight-to-stage draw.
 */
function localXAxisInDevicePixels(
	context: Konva.Context,
	shape: Konva.Shape,
	pixelRatio: number,
): { x: number; y: number } {
	const raw = (context as unknown as { _context?: CanvasRenderingContext2D })
		._context;
	const ctm = raw?.getTransform?.();
	if (ctm && Number.isFinite(ctm.a) && Number.isFinite(ctm.b)) {
		return { x: ctm.a, y: ctm.b };
	}
	const matrix = shape.getAbsoluteTransform().getMatrix();
	return {
		x: (matrix[0] ?? 0) * pixelRatio,
		y: (matrix[1] ?? 0) * pixelRatio,
	};
}

/**
 * The `sceneFunc`/`hitFunc` pair implementing {@link ghostDropShadows}.
 *
 * `hitFunc` is not optional. Konva's `drawHit` resolves its draw function as
 * `hitFunc() || sceneFunc()`, so a custom `sceneFunc` alone would also be used
 * to paint the HIT canvas — drawing every ghost pass into it, off-canvas and
 * pointlessly. Handing back the class's default hit function keeps hit-testing
 * byte-for-byte what it was before this module existed.
 *
 * Shadows paint in list order, so the first entry ends up at the bottom of the
 * stack and the body lands on top of all of them — the same order
 * `effectsMarkup`'s `<feMerge>` produces (`sh0` first, `SourceGraphic` last).
 */
export function createShadowGhostFuncs(
	shadows: readonly CanvasDropShadowEffect[],
	baseStrokeWidth: number,
): { sceneFunc: DrawFunc; hitFunc: DrawFunc } {
	const dilates = shadows.some((effect) => (effect.spread ?? 0) > 0);

	const sceneFunc: DrawFunc = (context, shape) => {
		const { scene } = defaultDrawFuncs(shape);
		if (!scene) return;
		// Re-synced ONCE per draw rather than once per shadow: every shadow in the
		// stack dilates the same silhouette, so only the ring width varies.
		if (dilates) {
			const twin = silhouetteTwin(shape);
			if (twin) syncSilhouetteTwin(twin, shape);
		}
		const canvas = context.canvas;
		const pixelRatio = canvas.getPixelRatio();
		const absoluteScale = shape.getAbsoluteScale();
		const absolutePosition = shape.getAbsolutePosition();
		const axis = localXAxisInDevicePixels(context, shape, pixelRatio);
		for (const effect of shadows) {
			const spread = effect.spread ?? 0;
			const params = ghostShadowDrawParams({
				effect,
				axis,
				absoluteScale,
				absolutePosition,
				pixelRatio,
				canvasWidth: canvas.width,
				canvasHeight: canvas.height,
				silhouetteExtent: silhouetteExtent(shape, spread, baseStrokeWidth),
			});
			if (!params) continue;
			context.save();
			context.shadowColor = shadowRGBA(effect);
			context.shadowBlur = params.shadowBlur;
			context.shadowOffsetX = params.shadowOffsetX;
			context.shadowOffsetY = params.shadowOffsetY;
			context.translate(-params.shift, 0);
			drawSilhouette(context, shape, scene, spread, baseStrokeWidth);
			context.restore();
		}
		scene.call(shape, context, shape);
	};

	const hitFunc: DrawFunc = (context, shape) => {
		const { scene, hit } = defaultDrawFuncs(shape);
		const draw = hit ?? scene;
		draw?.call(shape, context, shape);
	};

	return { sceneFunc, hitFunc };
}
