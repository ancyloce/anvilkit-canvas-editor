"use client";

import type {
	CanvasAnyNodeUpdateCommand,
	CanvasNode,
	CanvasNodeResizeCommand,
	CanvasNodeRotateCommand,
} from "@anvilkit/canvas-core";
import type Konva from "konva";
import {
	useCallback,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { Group, Label, Path, Tag, Text, Transformer } from "react-konva";
import { useCanvasStudio } from "../context/canvas-studio-context.js";
import { draggedIdsKey } from "../perf/active-nodes.js";
import { nodeRenderOffset } from "../stage/node-render-offset.js";

const EPSILON = 0.5;

/**
 * Nodes sized by their geometry × transform scale, NOT by `bounds`:
 * `Konva.Path` renders from its `d`, `Konva.Line` from its `points`, each
 * scaled by `transform.scaleX/Y`. A resize must PERSIST that scale — baking it
 * into `bounds` (the bounds-sized path) is ignored by the renderer, so the
 * element snaps back to its intrinsic size the instant the commit re-renders.
 */
const SCALE_SIZED: ReadonlySet<CanvasNode["type"]> = new Set(["path", "line"]);

/**
 * Binds a react-konva <Transformer> to the currently-selected Konva nodes.
 * On `transformend`, fires one resize and/or rotate command per affected node
 * (MVP-7: refs during interaction; one command on commit). Konva's scaleX/Y
 * is reset to 1 after each commit so subsequent transforms re-derive from the
 * new bounds — standard react-konva transformer pattern.
 */
const noopSubscribe = () => () => undefined;

/** Diameter of the circular rotate-icon handle parked below the box. */
const ROTATE_HANDLE_SIZE = 34;
/**
 * Scaled size of the rotation icon's 24×24 viewBox. The lucide `refresh-cw` art
 * only fills ~18 of those 24 units, so this is oversized past the viewBox to
 * make the *visible* glyph (~0.75×) fill the handle like the reference design.
 */
const ROTATE_ICON_SIZE = 30;
/**
 * lucide `refresh-cw` (two arrows forming a circle) in its 24×24 viewBox — the
 * rotation glyph drawn inside the rotate handle. Combined sub-paths so a single
 * <Path data> strokes the whole icon.
 */
const ROTATE_ICON_PATH =
	"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8 M21 3v5h-5 M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16 M8 16H3v5";

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
 * Reshape a single Transformer anchor: circular corner handles, pill edge
 * handles, and the larger circular rotate handle. Konva applies the global
 * anchor attrs (size/fill/stroke/cornerRadius) to every anchor first, then
 * calls this per-anchor hook, so we only override the anchors that differ from
 * the global circle. After changing an anchor's size we recentre it via offset
 * (padding is 0, so offset = size / 2). Fill/stroke are left to the caller
 * (theme-aware tinting in `anchorStyleFunc`).
 */
function shapeSelectionAnchor(anchor: Konva.Rect): void {
	if (anchor.hasName("rotater")) {
		// Circular icon button parked below the box (via `rotateAnchorAngle`).
		const r = ROTATE_HANDLE_SIZE;
		anchor.width(r);
		anchor.height(r);
		anchor.offsetX(r / 2);
		anchor.offsetY(r / 2);
		anchor.cornerRadius(r / 2);
		return;
	}
	if (anchor.hasName("top-center") || anchor.hasName("bottom-center")) {
		// Horizontal pill.
		anchor.width(22);
		anchor.height(8);
		anchor.offsetX(11);
		anchor.offsetY(4);
		anchor.cornerRadius(4);
		return;
	}
	if (anchor.hasName("middle-left") || anchor.hasName("middle-right")) {
		// Vertical pill.
		anchor.width(8);
		anchor.height(22);
		anchor.offsetX(4);
		anchor.offsetY(11);
		anchor.cornerRadius(4);
	}
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

export function CanvasTransformer(): React.JSX.Element | null {
	const {
		stage,
		selectionStore,
		draftStore,
		cropStore,
		getIR,
		commit,
		activePageId,
	} = useCanvasStudio();
	// Hide the resize/rotate transformer while the crop editor owns the handles.
	const croppingId = useSyncExternalStore(
		cropStore ? cropStore.subscribe : noopSubscribe,
		() => cropStore?.getState().cropNodeId ?? null,
		() => cropStore?.getState().cropNodeId ?? null,
	);
	const selectedIds = useSyncExternalStore(
		selectionStore.subscribe,
		() => selectionStore.getState().selectedIds,
		() => selectionStore.getState().selectedIds,
	);
	// I2-5: dragging promotes a node into the drag layer, which remounts its
	// Konva node. Re-bind when the dragged set changes (start/end) so the
	// Transformer points at the live node, not the unmounted one.
	const draggedKey = useSyncExternalStore(
		draftStore.subscribe,
		() => draggedIdsKey(draftStore.getState().draft),
		() => draggedIdsKey(draftStore.getState().draft),
	);
	const transformerRef = useRef<Konva.Transformer | null>(null);
	// Decorative rotate glyph parked on the rotate handle (positioned imperatively
	// to track the handle, including under box rotation).
	const rotateIconRef = useRef<Konva.Group | null>(null);
	// Size readout shown while resizing (imperative — no re-render per frame).
	const sizeLabelRef = useRef<Konva.Label | null>(null);
	const sizeTextRef = useRef<Konva.Text | null>(null);
	// Position token (e.g. "top-left") of the hovered anchor, or null.
	const hoveredAnchorRef = useRef<string | null>(null);
	// True between transformstart/transformend so `anchorStyleFunc` hides every
	// dragger except the one under the cursor.
	const transformingRef = useRef(false);

	// Chrome colors from the host's shadcn/Tailwind theme. `theme` drives the
	// declarative props (re-renders on change); `themeRef` mirrors it for the
	// imperative anchorStyleFunc, which runs outside React on every Konva frame.
	const [theme, setTheme] = useState<ChromeTheme>(FALLBACK_CHROME_THEME);
	const themeRef = useRef<ChromeTheme>(FALLBACK_CHROME_THEME);
	useEffect(() => {
		const next = resolveChromeTheme(stage?.container?.() ?? null);
		themeRef.current = next;
		setTheme(next);
	}, [stage, selectedIds]);

	// Keep the rotate glyph centred on the (Konva-positioned) rotate handle.
	// absolutePosition copies the handle's absolute position regardless of the
	// differing parent transforms, so it tracks box rotation too.
	const syncRotateIcon = useCallback(
		(rotater: Konva.Rect, visible: boolean) => {
			const g = rotateIconRef.current;
			const getAbs = rotater.getAbsolutePosition?.bind(rotater);
			if (!g || !getAbs) return;
			g.absolutePosition(getAbs());
			g.visible(visible);
		},
		[],
	);

	// Per-anchor styling: circular corners, pill edges, a circular rotate-icon
	// handle, and theme-aware tinting. While transforming, show ONLY the active
	// dragger (kept accent-filled) so just the direction marker + size badge
	// show. The active handle is read from the Transformer's `_movingAnchorName`
	// — Konva drives the resize off window mouse events and immediately
	// `stopDrag()`s the anchor, so `anchor.isDragging()` is always false here.
	// Konva runs this last in update() (after positioning + visibility), so it
	// has the final say each frame.
	const anchorStyleFunc = useCallback(
		(anchor: Konva.Rect) => {
			const t = themeRef.current;
			shapeSelectionAnchor(anchor);
			const isRotater = anchor.hasName("rotater");
			if (isRotater) {
				// Surface-filled icon button with a hairline border — never tinted.
				anchor.fill(t.surface);
				anchor.stroke(t.border);
			}
			if (transformingRef.current) {
				const parent = anchor.getParent?.() as
					| (Konva.Node & { _movingAnchorName?: string | null })
					| null
					| undefined;
				const active = parent?._movingAnchorName ?? null;
				const isActive = active !== null && anchor.hasName(active);
				anchor.visible(isActive);
				if (isRotater) {
					syncRotateIcon(anchor, isActive);
				} else if (isActive) {
					anchor.fill(t.accent);
				}
				return;
			}
			anchor.visible(true);
			if (isRotater) {
				syncRotateIcon(anchor, true);
				return;
			}
			const hovered = hoveredAnchorRef.current;
			anchor.fill(
				hovered !== null && anchor.hasName(hovered) ? t.accent : t.surface,
			);
		},
		[syncRotateIcon],
	);

	const refreshSizeBadge = useCallback(() => {
		const tr = transformerRef.current;
		const label = sizeLabelRef.current;
		const text = sizeTextRef.current;
		if (!stage || !tr || !label || !text) return;
		const box = selectionBox(
			stage,
			selectionStore.getState().selectedIds,
			tr.getLayer?.() ?? null,
		);
		if (!box) return;
		text.text(`w: ${Math.round(box.width)}  h: ${Math.round(box.height)}`);
		// Counter-scale by the stage zoom so the badge keeps a constant on-screen
		// size (and a constant gap) regardless of canvas scaling. Position stays in
		// layer/design coords so it still tracks the box.
		const inv = 1 / (stage.scaleX?.() || 1);
		label.scale({ x: inv, y: inv });
		// Park the badge just below the box, right edge aligned to the box's.
		label.position({ x: box.x + box.width, y: box.y + box.height + 12 * inv });
		label.offsetX(label.width());
		label.getLayer()?.batchDraw();
	}, [stage, selectionStore]);

	useEffect(() => {
		const tr = transformerRef.current;
		if (!stage || !tr) return;
		const nodes: Konva.Node[] = [];
		for (const id of selectedIds) {
			const n = stage.findOne(`.${id}`);
			if (n) nodes.push(n);
		}
		tr.nodes(nodes);
		tr.getLayer?.()?.batchDraw?.();
	}, [stage, selectedIds, draggedKey]);

	// Hover feedback: the dragger under the cursor fills violet. Attached
	// imperatively to the Transformer's anchor nodes (react-konva gives no JSX
	// seam for them). Anchors persist for the Transformer's lifetime, so we
	// (re)bind whenever the Transformer remounts (crop toggle) or selection
	// changes. Namespaced events keep us from stripping Konva's own listeners.
	useEffect(() => {
		const tr = transformerRef.current;
		if (!tr) return;
		const anchors = (tr.find?.("._anchor") ?? []) as Konva.Rect[];
		const enter = (e: Konva.KonvaEventObject<MouseEvent>) => {
			const anchor = e.target as Konva.Rect;
			const token = anchor.name().split(" ")[0] ?? null;
			hoveredAnchorRef.current = token;
			// The rotate handle is an icon button, never tinted.
			if (!transformingRef.current && token !== "rotater") {
				const t = themeRef.current;
				setAnchorHovered(anchor, true, t.accent, t.surface);
			}
		};
		const leave = (e: Konva.KonvaEventObject<MouseEvent>) => {
			const anchor = e.target as Konva.Rect;
			hoveredAnchorRef.current = null;
			if (!transformingRef.current && !anchor.hasName("rotater")) {
				const t = themeRef.current;
				setAnchorHovered(anchor, false, t.accent, t.surface);
			}
		};
		for (const a of anchors) {
			a.on("mouseenter.akhover", enter);
			a.on("mouseleave.akhover", leave);
		}
		return () => {
			for (const a of anchors) a.off(".akhover");
		};
	}, [stage, croppingId, selectedIds]);

	// During a move drag the dragged node is promoted onto the drag layer, which
	// remounts its Konva node as a NEW instance. The drag runs on raw Konva
	// pointer events (outside React's event system), so the rebind effect above
	// fires asynchronously and gets starved by the move loop — leaving the
	// Transformer bound to the stale (destroyed) node, so the selection box stops
	// tracking the element (it stays at the original position). Subscribe to the
	// draft store and re-point the Transformer at the live nodes *synchronously*
	// on every move. This runs in the same tick as the node mutation (no React
	// re-render, so the per-move drag-layer optimization is preserved).
	//
	// On move END the node DEMOTES back to the objects layer — another instance
	// swap. The passive rebind effect above is meant to catch it, but it races
	// react-konva's reconciler and can land on the just-detached drag-layer node,
	// so a resize/rotate immediately after a move silently no-ops. Re-point once
	// more on the next frame, after react-konva has committed the demote.
	useEffect(() => {
		if (!stage) return;
		let raf = 0;
		const repoint = () => {
			const tr = transformerRef.current;
			if (!tr) return;
			const nodes: Konva.Node[] = [];
			for (const id of selectionStore.getState().selectedIds) {
				const n = stage.findOne(`.${id}`);
				if (n) nodes.push(n);
			}
			tr.nodes(nodes);
			tr.getLayer?.()?.batchDraw?.();
		};
		const sync = () => {
			const draft = draftStore.getState().draft;
			if (draft && draft.type === "move") {
				repoint();
				return;
			}
			// Draft cleared (or non-move): defer one frame so the demoted node has
			// re-mounted on the objects layer before we re-point at the live node.
			if (typeof requestAnimationFrame === "function") {
				cancelAnimationFrame(raf);
				raf = requestAnimationFrame(repoint);
			} else {
				repoint();
			}
		};
		const unsubscribe = draftStore.subscribe(sync);
		return () => {
			if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(raf);
			unsubscribe();
		};
	}, [stage, draftStore, selectionStore]);

	const onTransformStart = useCallback(() => {
		const tr = transformerRef.current;
		if (!tr) return;
		transformingRef.current = true;
		// `_movingAnchorName` is set before `transformstart` fires; the size badge
		// is only meaningful while resizing, so skip it for rotation.
		const active =
			(tr as unknown as { _movingAnchorName?: string | null })
				._movingAnchorName ?? null;
		// Re-run anchorStyleFunc now (not on the next frame) so every handle but the
		// active one hides immediately, with no flash.
		tr.update?.();
		if (active && active !== "rotater") {
			sizeLabelRef.current?.visible(true);
			refreshSizeBadge();
		}
	}, [refreshSizeBadge]);

	const onTransform = useCallback(() => {
		if (transformingRef.current && sizeLabelRef.current?.visible())
			refreshSizeBadge();
	}, [refreshSizeBadge]);

	const onTransformEnd = useCallback(() => {
		// Leave transform mode first: drop the size badge and restore every
		// dragger (anchorStyleFunc keys off `transformingRef`, so a synchronous
		// update() un-hides them even though Konva clears `_movingAnchorName`
		// only after this handler returns).
		const tr = transformerRef.current;
		transformingRef.current = false;
		sizeLabelRef.current?.visible(false);
		tr?.update?.();
		tr?.getLayer?.()?.batchDraw?.();
		if (!stage) return;
		const ir = getIR();
		const page = ir.pages.find((p) => p.id === activePageId);
		if (!page) return;
		for (const id of selectedIds) {
			const knode = stage.findOne(`.${id}`) as Konva.Node | undefined;
			const irNode = page.root.children.find((c) => c.id === id);
			if (!knode || !irNode) continue;

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
					Math.abs(scaleX - irNode.transform.scaleX) > EPSILON ||
					Math.abs(scaleY - irNode.transform.scaleY) > EPSILON ||
					Math.abs(nextX - irNode.transform.x) > EPSILON ||
					Math.abs(nextY - irNode.transform.y) > EPSILON ||
					Math.abs(newRotation - irNode.transform.rotation) > EPSILON;
				if (changed) {
					const cmd: CanvasAnyNodeUpdateCommand = {
						type: "node.update",
						nodeId: id,
						kind: irNode.type,
						patch: {
							transform: {
								...irNode.transform,
								x: nextX,
								y: nextY,
								scaleX,
								scaleY,
								rotation: newRotation,
							},
						},
					} as CanvasAnyNodeUpdateCommand;
					commit(cmd);
				}
				continue;
			}

			// Bounds-sized nodes (rect/ellipse/image/text/group): bake the scale
			// into bounds and reset the Konva scale so the next transform starts
			// from 1×.
			knode.scaleX(1);
			knode.scaleY(1);
			const newW = irNode.bounds.width * scaleX;
			const newH = irNode.bounds.height * scaleY;
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
				Math.abs(newW - irNode.bounds.width) > EPSILON ||
				Math.abs(newH - irNode.bounds.height) > EPSILON ||
				Math.abs(newX - irNode.transform.x) > EPSILON ||
				Math.abs(newY - irNode.transform.y) > EPSILON;
			if (boundsChanged) {
				const cmd: CanvasNodeResizeCommand = {
					type: "node.resize",
					nodeId: id,
					from: {
						x: irNode.transform.x,
						y: irNode.transform.y,
						width: irNode.bounds.width,
						height: irNode.bounds.height,
					},
					to: { x: newX, y: newY, width: newW, height: newH },
				};
				commit(cmd);
			}

			if (Math.abs(newRotation - irNode.transform.rotation) > EPSILON) {
				const cmd: CanvasNodeRotateCommand = {
					type: "node.rotate",
					nodeId: id,
					from: irNode.transform.rotation,
					to: newRotation,
				};
				commit(cmd);
			}
		}
	}, [stage, selectedIds, getIR, commit, activePageId]);

	if (croppingId) return null;
	const iconScale = ROTATE_ICON_SIZE / 24; // lucide 24×24 viewBox → glyph px
	return (
		<>
			<Transformer
				ref={transformerRef}
				onTransformStart={onTransformStart}
				onTransform={onTransform}
				onTransformEnd={onTransformEnd}
				borderStroke={theme.accent}
				borderStrokeWidth={1.5}
				anchorStroke={theme.accent}
				anchorStrokeWidth={1.5}
				anchorFill={theme.surface}
				anchorSize={12}
				anchorCornerRadius={6}
				rotateAnchorAngle={180}
				rotateAnchorOffset={34}
				rotateLineVisible={false}
				anchorStyleFunc={anchorStyleFunc}
			/>
			{/* Rotation glyph drawn on the rotate handle (positioned imperatively). */}
			<Group ref={rotateIconRef} visible={false} listening={false}>
				<Path
					data={ROTATE_ICON_PATH}
					stroke={theme.onSurface}
					strokeWidth={1.8}
					lineCap="round"
					lineJoin="round"
					scaleX={iconScale}
					scaleY={iconScale}
					offsetX={12}
					offsetY={12}
				/>
			</Group>
			{/* Live size readout while resizing (positioned imperatively). */}
			<Label ref={sizeLabelRef} visible={false} listening={false}>
				<Tag
					fill={theme.onSurface}
					cornerRadius={6}
					shadowColor={theme.onSurface}
					shadowBlur={8}
					shadowOpacity={0.25}
					shadowOffsetY={2}
				/>
				<Text
					ref={sizeTextRef}
					text=""
					fill={theme.surface}
					fontSize={13}
					fontStyle="bold"
					padding={7}
				/>
			</Label>
		</>
	);
}
