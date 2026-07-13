"use client";

import Konva from "konva";
import {
	useCallback,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { Label, Tag, Text, Transformer } from "react-konva";
import { useCanvasStudio } from "../context/canvas-studio-context.js";
import { draggedIdsKey } from "../perf/active-nodes.js";
import {
	activeAnchorName,
	type ChromeTheme,
	collectTransformEndCommands,
	FALLBACK_CHROME_THEME,
	normalizeAngle,
	resolveChromeTheme,
	selectionBox,
	setAnchorHovered,
} from "./transformer-helpers.js";

type StudioCtx = ReturnType<typeof useCanvasStudio>;

/**
 * Binds a react-konva <Transformer> to the currently-selected Konva nodes.
 * On `transformend`, fires one resize and/or rotate command per affected node
 * (MVP-7: refs during interaction; one command on commit). Konva's scaleX/Y
 * is reset to 1 after each commit so subsequent transforms re-derive from the
 * new bounds — standard react-konva transformer pattern.
 */
const noopSubscribe = () => () => undefined;

/**
 * Minimum box span (design units) ALONG an edge to show its handle: it must
 * clear both corner handles (~6px each) plus the ~22px pill plus a small gap.
 */
const MIN_EDGE_HANDLE_SPAN = 48;
/**
 * Minimum box thickness (design units) PERPENDICULAR to an edge to show its
 * handle. A short/thin box fits the pill along the long edge but is too cramped
 * across it (the opposite-edge pills crowd together), so the center handles are
 * dropped to corners-only. Both checks together: a top/bottom-center handle
 * needs width ≥ SPAN and height ≥ THICKNESS; left/right need the transpose.
 */
const MIN_EDGE_HANDLE_THICKNESS = 40;

/** Diameter of the circular rotate-icon handle parked below the box. */
const ROTATE_HANDLE_SIZE = 24;
/**
 * On-screen size of the rotation glyph in px. The lucide `refresh-ccw` art fills
 * ~18 of its 24-unit viewBox, so `iconScale` divides by 18 (not 24) — making
 * this the *visible* glyph size, which fills the handle like the reference.
 */
const ROTATE_ICON_SIZE = 12;
/**
 * lucide `refresh-ccw` (two counter-clockwise arrows forming a circle) in its
 * 24×24 viewBox — the rotation glyph drawn inside the rotate handle. Combined
 * sub-paths so a single <Path data> strokes the whole icon.
 */
const ROTATE_ICON_PATH =
	"M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8 M3 3v5h5 M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16 M16 16h5v5";

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
 * Chrome colors from the host's shadcn/Tailwind theme. `theme` drives the
 * declarative props (re-renders on change); `themeRef` mirrors it for the
 * imperative anchorStyleFunc, which runs outside React on every Konva frame.
 */
function useChromeTheme(
	stage: Konva.Stage | null,
	selectedIds: readonly string[],
) {
	const [theme, setTheme] = useState<ChromeTheme>(FALLBACK_CHROME_THEME);
	const themeRef = useRef<ChromeTheme>(FALLBACK_CHROME_THEME);
	useEffect(() => {
		const next = resolveChromeTheme(stage?.container?.() ?? null);
		themeRef.current = next;
		setTheme(next);
	}, [stage, selectedIds]);
	return { theme, themeRef };
}

/**
 * Create the rotate-icon glyph imperatively and add it as a CHILD of the
 * Transformer node. Because both the icon and the rotate handle now share
 * the SAME parent transform (the Transformer's screen-space frame, which
 * already counter-scales the stage zoom and tracks the content on pan), the
 * icon inherits every property the handle has for free — constant on-screen
 * size, atomic tracking on pan/zoom/rotate, no cross-space `absolutePosition`
 * conversion. The earlier "icon-as-layer-sibling" design drifted during pan
 * because the rotate handle lives in the transformer's screen-space frame
 * while a layer-child icon lives in the zoomed/panned layer frame, and
 * `absolutePosition` is only consistent when computed from the *same* stage
 * transform — which got stale between the rotater's reposition and the next
 * icon resync.
 *
 * Konva 10.3+ guards `Transformer.add` to forbid external children (logs
 * "You cannot add external nodes to the Transformer" and no-ops). We
 * intentionally need the icon parented to the Transformer for the reasons
 * above, so call `Group.prototype.add` directly to bypass the guard.
 *
 * Returns `syncRotateIcon`, which positions the icon at the rotate handle's
 * LOCAL position within the transformer. Both nodes share the same parent →
 * same transform → the glyph renders exactly where the handle does, at the
 * same constant screen-size, on every frame Konva repositions the handle
 * (which already covers pan/zoom/rotate via the transformer's
 * `absoluteTransformChange` listener on the selected node).
 */
function useRotateIcon(
	transformerRef: React.RefObject<Konva.Transformer | null>,
	stage: Konva.Stage | null,
	theme: ChromeTheme,
	themeRef: React.RefObject<ChromeTheme>,
) {
	// Decorative rotate glyph parked on the rotate handle (positioned imperatively
	// to track the handle, including under box rotation).
	const rotateIconRef = useRef<Konva.Group | null>(null);

	useEffect(() => {
		const tr = transformerRef.current;
		// Tests render with a fake transformer that has no `add`; skip there.
		if (!tr || typeof (tr as unknown as { add?: unknown }).add !== "function")
			return;
		let g = rotateIconRef.current;
		if (!g) {
			const path = new Konva.Path({
				data: ROTATE_ICON_PATH,
				stroke: themeRef.current.onSurface,
				strokeWidth: 1.8,
				lineCap: "round",
				lineJoin: "round",
				// lucide art fills ~18 of its 24-unit viewBox; scale against 18 so
				// ROTATE_ICON_SIZE is the on-screen glyph px.
				scaleX: ROTATE_ICON_SIZE / 18,
				scaleY: ROTATE_ICON_SIZE / 18,
				offsetX: 12,
				offsetY: 12,
				listening: false,
			});
			g = new Konva.Group({ listening: false, visible: false });
			g.add(path);
			Konva.Group.prototype.add.call(tr, g);
			rotateIconRef.current = g;
		}
		// Re-apply stroke when the theme changes.
		const path = g.findOne?.("Path") as Konva.Path | undefined;
		path?.stroke(theme.onSurface);
		tr.getLayer?.()?.batchDraw?.();
	}, [theme, stage, transformerRef, themeRef]);

	useEffect(() => {
		return () => {
			rotateIconRef.current?.destroy?.();
			rotateIconRef.current = null;
		};
	}, []);

	const syncRotateIcon = useCallback(
		(rotater: Konva.Rect, visible: boolean) => {
			const g = rotateIconRef.current;
			if (!g) return;
			g.position({ x: rotater.x?.() ?? 0, y: rotater.y?.() ?? 0 });
			g.visible(visible);
		},
		[],
	);

	return syncRotateIcon;
}

/**
 * The floating readout badge shown during a transform: live W/H while
 * resizing, live angle while rotating. Positioned imperatively at the cursor
 * (no re-render per frame); the returned refs bind the Konva nodes in JSX.
 */
function useTransformBadges(
	stage: Konva.Stage | null,
	selectionStore: StudioCtx["selectionStore"],
) {
	// Size readout shown while resizing (imperative — no re-render per frame).
	const sizeLabelRef = useRef<Konva.Label | null>(null);
	const sizeTextRef = useRef<Konva.Text | null>(null);

	// Park the badge just down-right of the cursor, in layer/design coords, and
	// counter-scale it by the stage zoom so it keeps a constant on-screen size
	// regardless of canvas scaling. `setPointersPositions` runs on every window
	// mousemove of a resize/rotate drag, so the stage pointer is current — both
	// the size and angle readouts follow the mouse this way.
	const positionBadgeAtCursor = useCallback(() => {
		const label = sizeLabelRef.current;
		if (!stage || !label) return;
		const inv = 1 / (stage.scaleX?.() || 1);
		label.scale({ x: inv, y: inv });
		label.offsetX(0); // anchor top-left near the cursor (not right-aligned)
		const p = stage.getRelativePointerPosition?.();
		if (p) label.position({ x: p.x + 18 * inv, y: p.y + 18 * inv });
		label.getLayer()?.batchDraw();
	}, [stage]);

	// Live W/H readout while resizing — follows the cursor.
	const refreshSizeBadge = useCallback(() => {
		const label = sizeLabelRef.current;
		const text = sizeTextRef.current;
		if (!stage || !label || !text) return;
		const box = selectionBox(
			stage,
			selectionStore.getState().selectedIds,
			label.getLayer?.() ?? null,
		);
		if (!box) return;
		text.text(`w: ${Math.round(box.width)}  h: ${Math.round(box.height)}`);
		positionBadgeAtCursor();
	}, [stage, selectionStore, positionBadgeAtCursor]);

	// Live rotation readout while rotating — angle normalized to (-180, 180],
	// follows the cursor.
	const refreshAngleBadge = useCallback(() => {
		const label = sizeLabelRef.current;
		const text = sizeTextRef.current;
		if (!stage || !label || !text) return;
		const [firstId] = selectionStore.getState().selectedIds;
		const node = firstId ? stage.findOne(`.${firstId}`) : null;
		const angle = normalizeAngle(node?.rotation?.() ?? 0);
		text.text(`${Math.round(angle)}°`);
		positionBadgeAtCursor();
	}, [stage, selectionStore, positionBadgeAtCursor]);

	return { sizeLabelRef, sizeTextRef, refreshSizeBadge, refreshAngleBadge };
}

/**
 * Keep the Transformer pointed at the live Konva nodes for the current
 * selection — across drag-layer promote/demote remounts and viewport moves.
 */
function useTransformerNodeSync({
	transformerRef,
	stage,
	selectedIds,
	draggedKey,
	viewportKey,
	croppingId,
	selectionStore,
	draftStore,
}: {
	transformerRef: React.RefObject<Konva.Transformer | null>;
	stage: Konva.Stage | null;
	selectedIds: readonly string[];
	draggedKey: string;
	viewportKey: string;
	croppingId: string | null;
	selectionStore: StudioCtx["selectionStore"];
	draftStore: StudioCtx["draftStore"];
}): void {
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
	}, [stage, selectedIds, draggedKey, transformerRef]);

	// Re-sync the chrome to the canvas after a pan/zoom. The Transformer doesn't
	// re-run on viewport changes, so its screen-space handles and the rotate icon
	// (positioned/scaled imperatively via `anchorStyleFunc` → `syncRotateIcon`)
	// otherwise go stale — jittering during a hand pan and flying off-screen on
	// zoom until a click re-runs `update()`. Runs after commit, so the stage
	// transform is already current; `update()` repositions every handle AND the
	// icon together in one pass.
	useEffect(() => {
		transformerRef.current?.update?.();
	}, [viewportKey, selectedIds, croppingId, transformerRef]);

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
	}, [stage, draftStore, selectionStore, transformerRef]);
}

/**
 * Hover feedback: the dragger under the cursor fills violet. Attached
 * imperatively to the Transformer's anchor nodes (react-konva gives no JSX
 * seam for them). Anchors persist for the Transformer's lifetime, so we
 * (re)bind whenever the Transformer remounts (crop toggle) or selection
 * changes. Namespaced events keep us from stripping Konva's own listeners.
 * Returns the ref holding the hovered anchor's position token (e.g.
 * "top-left"), read by `anchorStyleFunc`.
 */
function useAnchorHoverHighlight({
	transformerRef,
	stage,
	croppingId,
	selectedIds,
	themeRef,
	transformingRef,
}: {
	transformerRef: React.RefObject<Konva.Transformer | null>;
	stage: Konva.Stage | null;
	croppingId: string | null;
	selectedIds: readonly string[];
	themeRef: React.RefObject<ChromeTheme>;
	transformingRef: React.RefObject<boolean>;
}) {
	// Position token (e.g. "top-left") of the hovered anchor, or null.
	const hoveredAnchorRef = useRef<string | null>(null);

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
	}, [
		stage,
		croppingId,
		selectedIds,
		transformerRef,
		themeRef,
		transformingRef,
	]);

	return hoveredAnchorRef;
}

export function CanvasTransformer(): React.JSX.Element | null {
	const {
		stage,
		selectionStore,
		draftStore,
		cropStore,
		viewportStore,
		getIR,
		commit,
		commitBatch,
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
	// Canvas zoom/pan snapshot. The Transformer lays its handles out in screen
	// space (it ignores the stage zoom), but it only re-runs on selection/
	// transform changes — NOT on viewport changes. So on pan/zoom the handles and
	// the imperatively-positioned rotate icon go stale until the next click. This
	// key lets an effect force a re-sync whenever the viewport moves.
	const viewportKey = useSyncExternalStore(
		viewportStore.subscribe,
		() => {
			const v = viewportStore.getState();
			return `${v.zoom}:${v.panX}:${v.panY}`;
		},
		() => {
			const v = viewportStore.getState();
			return `${v.zoom}:${v.panX}:${v.panY}`;
		},
	);
	const transformerRef = useRef<Konva.Transformer | null>(null);
	// True between transformstart/transformend so `anchorStyleFunc` hides every
	// dragger except the one under the cursor.
	const transformingRef = useRef(false);

	const { theme, themeRef } = useChromeTheme(stage, selectedIds);
	const syncRotateIcon = useRotateIcon(transformerRef, stage, theme, themeRef);
	const { sizeLabelRef, sizeTextRef, refreshSizeBadge, refreshAngleBadge } =
		useTransformBadges(stage, selectionStore);
	useTransformerNodeSync({
		transformerRef,
		stage,
		selectedIds,
		draggedKey,
		viewportKey,
		croppingId,
		selectionStore,
		draftStore,
	});
	const hoveredAnchorRef = useAnchorHoverHighlight({
		transformerRef,
		stage,
		croppingId,
		selectedIds,
		themeRef,
		transformingRef,
	});

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
				const active = activeAnchorName(anchor.getParent?.());
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
			// Size-adaptive: when the box is too small to fit an edge handle between
			// its corners, hide that edge handle (corners always stay). Sizes are in
			// design units — box and handles scale with zoom together, so the fit
			// test is zoom-independent. Top/bottom-center span the width;
			// middle-left/right span the height.
			const parent = anchor.getParent?.() as
				| (Konva.Node & { getWidth?: () => number; getHeight?: () => number })
				| null
				| undefined;
			const onWidthEdge =
				anchor.hasName("top-center") || anchor.hasName("bottom-center");
			const onHeightEdge =
				anchor.hasName("middle-left") || anchor.hasName("middle-right");
			if (onWidthEdge || onHeightEdge) {
				const w = parent?.getWidth?.() ?? Number.POSITIVE_INFINITY;
				const h = parent?.getHeight?.() ?? Number.POSITIVE_INFINITY;
				// along = edge length (fit between corners); across = box thickness
				// perpendicular to the edge (not too thin/cramped).
				const along = onWidthEdge ? w : h;
				const across = onWidthEdge ? h : w;
				if (
					along < MIN_EDGE_HANDLE_SPAN ||
					across < MIN_EDGE_HANDLE_THICKNESS
				) {
					anchor.visible(false);
					return;
				}
			}
			const hovered = hoveredAnchorRef.current;
			anchor.fill(
				hovered !== null && anchor.hasName(hovered) ? t.accent : t.surface,
			);
		},
		[syncRotateIcon, themeRef, hoveredAnchorRef],
	);

	const onTransformStart = useCallback(() => {
		const tr = transformerRef.current;
		if (!tr) return;
		transformingRef.current = true;
		// `_movingAnchorName` is set before `transformstart` fires. The same badge
		// node shows the live size while resizing and the live angle while rotating.
		const active = activeAnchorName(tr);
		// Re-run anchorStyleFunc now (not on the next frame) so every handle but the
		// active one hides immediately, with no flash.
		tr.update?.();
		if (!active) return;
		sizeLabelRef.current?.visible(true);
		if (active === "rotater") refreshAngleBadge();
		else refreshSizeBadge();
	}, [refreshAngleBadge, refreshSizeBadge, sizeLabelRef]);

	const onTransform = useCallback(() => {
		if (!transformingRef.current || !sizeLabelRef.current?.visible()) return;
		if (activeAnchorName(transformerRef.current) === "rotater")
			refreshAngleBadge();
		else refreshSizeBadge();
	}, [refreshAngleBadge, refreshSizeBadge, sizeLabelRef]);

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
		const childById = new Map(page.root.children.map((c) => [c.id, c]));
		// Collect every node's resize/rotate command so a single gesture (incl.
		// simultaneous resize + rotate, and multi-node transforms) is ONE undo entry.
		const cmds = collectTransformEndCommands(stage, selectedIds, childById);
		if (cmds.length > 1) {
			commitBatch(cmds, "Transform");
		} else if (cmds.length === 1 && cmds[0]) {
			commit(cmds[0]);
		}
	}, [
		stage,
		selectedIds,
		getIR,
		commit,
		commitBatch,
		activePageId,
		sizeLabelRef,
	]);

	if (croppingId) return null;
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
			{/* The rotate-icon glyph is created imperatively and added as a CHILD of
			    the Transformer (see `useRotateIcon`) so it inherits the transformer's
			    screen-space transform — tracks the rotate handle atomically through
			    pan/zoom/rotate with no cross-space drift. */}
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
