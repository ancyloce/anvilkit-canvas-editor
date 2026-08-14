/**
 * @file K-18 (review 0036) — `CanvasBlurEffect` on the live canvas.
 *
 * THE DIVERGENCE THIS CLOSES. `CanvasBlurEffect` blurs the node itself (§9.4).
 * The SVG serializer renders it — `effectsMarkup` accumulates every blur in the
 * list and emits one `<feGaussianBlur>` over the composited result — while the
 * Konva renderer rendered NOTHING at all: `shadowProps` only ever looked for
 * drop shadows, so a blurred node drew perfectly sharp. Same shape of bug as
 * K-10's fidelity note and the same five-against-one split, since the editor,
 * thumbnails, PNG/JPEG/WebP and PDF all read the Konva path.
 *
 * WHY THIS ONE NEEDS A CACHE. A drop shadow is an extra DRAW, which is why
 * K-10's ghosts are cheap. A blur is a pixel operation over what was already
 * drawn, and Konva only exposes that through `node.cache()` + `filters` — the
 * same mechanism `AdjustedKonvaImage` uses for image adjustments, and it
 * inherits the same economics (the kernel re-runs over the whole bitmap on
 * every rebuild, so the cache is keyed to re-run as rarely as correctness
 * allows — notably NOT on transform changes, which a drag produces every frame
 * and which cannot alter a locally-rasterised bitmap).
 *
 * ORDER MATTERS, AND IT IS WHY BLUR CHANGES SHADOW ROUTING. SVG merges the
 * shadows UNDER the source and blurs the RESULT, so a blurred node's shadows
 * are blurred too. Caching reproduces that exactly — but only for shadows drawn
 * INSIDE `sceneFunc`, which is the K-10 ghost path; a native Konva `shadow*` is
 * applied when the cached bitmap is composited, i.e. OUTSIDE the blur, which
 * would be the wrong order. So `ghostDropShadows` routes every shadow through
 * the ghost path as soon as a blur is present (see `shadow-ghosts.ts`), and the
 * cache is padded to hold them.
 */
import type {
	CanvasDropShadowEffect,
	CanvasEffect,
} from "@anvilkit/canvas-core";
import type Konva from "konva";
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { canvasNodeRef } from "./find-node-by-id.js";
import { BlurFilter } from "./konva.js";

/**
 * The node's combined blur radius in page units, or 0.
 *
 * Blurs compose in QUADRATURE — two 5-unit blurs are ~7.07, not 10 — because
 * convolving two Gaussians adds their variances. Core's serializer does exactly
 * this (`blurRadiusSumOfSquares`, C-18); summing radii here instead would make
 * the canvas over-blur any node carrying more than one blur effect.
 */
export function nodeBlurRadius(effects: readonly CanvasEffect[]): number {
	let sumOfSquares = 0;
	for (const effect of effects) {
		if (effect.type !== "blur") continue;
		if (!Number.isFinite(effect.radius) || effect.radius <= 0) continue;
		sumOfSquares += effect.radius * effect.radius;
	}
	return sumOfSquares > 0 ? Math.sqrt(sumOfSquares) : 0;
}

/**
 * How far past the node's own bounds the cached bitmap has to reach, in page
 * units.
 *
 * Two independent reasons, both of which crop silently when missed:
 *
 *  - the blur kernel reads and writes ONLY the cached bitmap, so without bleed
 *    room it samples transparent pixels past the edge and the blur is cut off
 *    square instead of fading (the same trap K-7 item 3 fixed for images);
 *  - a K-10 ghost shadow is painted inside `sceneFunc`, where `getClientRect`
 *    cannot see it, so `cache()` would size the bitmap to the shape alone and
 *    drop the shadow entirely — measured, and the reason `static-cache.ts`
 *    refuses those subtrees outright.
 */
export function blurCachePadding(
	blurRadius: number,
	shadows: readonly CanvasDropShadowEffect[],
): number {
	let shadowReach = 0;
	for (const shadow of shadows) {
		const reach =
			Math.max(Math.abs(shadow.offsetX), Math.abs(shadow.offsetY)) +
			shadow.blur +
			(shadow.spread ?? 0);
		if (reach > shadowReach) shadowReach = reach;
	}
	return Math.ceil(blurRadius + shadowReach);
}

/**
 * Everything that can change what a node's cached bitmap looks like. The
 * caller supplies paint state resolved outside the IR (for example brand
 * tokens and the font manifest) because those pixels can change while `node`
 * remains byte-for-byte identical.
 *
 * `transform` is deliberately excluded: `cache()` rasterises the node in its own
 * LOCAL space and Konva draws the bitmap through the live transform afterwards,
 * so moving, rotating or scaling a node cannot invalidate it. That exclusion is
 * the difference between re-running the blur kernel once and re-running it on
 * every frame of a drag, since the IR hands us a new node object per frame.
 */
export function localRenderingKey(
	node: object,
	externalPaintState?: unknown,
): string {
	const { transform: _transform, ...rest } = node as Record<string, unknown>;
	return JSON.stringify([rest, externalPaintState]);
}

/**
 * Konva props + a ref that keep a node's blur cache in step with its effects.
 *
 * The ref is COMPOSED with the K-6 registry ref rather than replacing it: this
 * hook's result is spread onto the shape after `commonProps`, so its `ref` wins,
 * and dropping the registration would strand `findNodeById` for that node.
 */
export function useNodeBlur(
	node: {
		id: string;
		effects?: CanvasEffect[];
	},
	externalPaintState?: unknown,
): Konva.ShapeConfig {
	const effects = node.effects;
	const blurRadius = useMemo(() => nodeBlurRadius(effects ?? []), [effects]);
	const padding = useMemo(() => {
		if (blurRadius <= 0) return 0;
		const shadows = (effects ?? []).filter(
			(e): e is CanvasDropShadowEffect => e.type === "drop-shadow",
		);
		return blurCachePadding(blurRadius, shadows);
	}, [blurRadius, effects]);
	// Stable ARRAY REFERENCE (E-11 / K-3): Konva re-runs the filter chain when
	// the `filters` prop reference changes, not only when it differs in content.
	const filters = useMemo(
		() => (blurRadius > 0 ? [BlurFilter] : undefined),
		[blurRadius],
	);
	const cacheKey = useMemo(
		() => localRenderingKey(node, externalPaintState),
		[node, externalPaintState],
	);

	const shapeRef = useRef<Konva.Node | null>(null);
	const registryRef = useMemo(() => canvasNodeRef(node.id), [node.id]);
	const setRef = useCallback(
		(instance: Konva.Node | null) => {
			shapeRef.current = instance;
			return registryRef(instance);
		},
		[registryRef],
	);

	// LAYOUT effect for the same reason `AdjustedKonvaImage` uses one (K-11):
	// react-konva applies `filters` during its commit and requests a draw right
	// there, so a passive effect would leave one frame with filters set and no
	// cache — which Konva skips filtering for entirely, and warns about.
	useLayoutEffect(() => {
		const instance = shapeRef.current;
		if (!instance) return;
		if (blurRadius > 0) instance.cache({ offset: padding });
		else instance.clearCache();
		instance.getLayer()?.batchDraw();
	}, [blurRadius, padding, cacheKey]);

	// Reference-STABLE (K-3): this object is spread into the memoised style props,
	// so a fresh `{}` per render would defeat that memo for every node in the
	// document — the overwhelming majority of which take the no-blur branch.
	return useMemo(() => {
		if (blurRadius <= 0 || !filters) return NO_BLUR_PROPS;
		return {
			filters,
			// Konva's Blur is a stack blur over the CACHED bitmap's own pixels, so
			// the radius has to be converted out of page units into that bitmap's
			// scale. The bitmap is left at Konva's default device pixel ratio — the
			// trade `AdjustedKonvaImage` documents, and for the same reason: unlike
			// a shape-only group cache (K-7), this one re-runs a kernel over every
			// pixel on each rebuild, so chasing crispness at high zoom multiplies
			// real work rather than just allocation.
			blurRadius: blurRadius * cachePixelRatio(),
			ref: setRef,
		};
	}, [blurRadius, filters, setRef]);
}

/** Shared empty result, so the no-blur path never allocates (see above). */
const NO_BLUR_PROPS: Konva.ShapeConfig = Object.freeze({});

/**
 * The pixel ratio `cache()` will use, so the blur radius can be expressed in the
 * cached bitmap's pixels. Mirrors Konva's own default resolution order
 * (`Canvas.js`: `conf.pixelRatio || Konva.pixelRatio || devicePixelRatio`);
 * `Konva.pixelRatio` is unset in this repo, and the fallback keeps the maths
 * defined under SSR/jsdom, where `devicePixelRatio` is absent.
 */
function cachePixelRatio(): number {
	const ratio = globalThis.devicePixelRatio;
	return typeof ratio === "number" && ratio > 0 ? ratio : 1;
}
