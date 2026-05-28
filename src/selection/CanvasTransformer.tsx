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
import {
	type ChromeTheme,
	FALLBACK_CHROME_THEME,
	normalizeAngle,
	resolveChromeTheme,
	selectionBox,
	setAnchorHovered,
} from "./transformer-helpers.js";

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
const ROTATE_ICON_SIZE = 22;
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
    [syncRotateIcon],
  );

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

  const activeAnchorName = useCallback(
    () =>
      (
        transformerRef.current as unknown as {
          _movingAnchorName?: string | null;
        }
      )?._movingAnchorName ?? null,
    [],
  );

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
    // `_movingAnchorName` is set before `transformstart` fires. The same badge
    // node shows the live size while resizing and the live angle while rotating.
    const active = activeAnchorName();
    // Re-run anchorStyleFunc now (not on the next frame) so every handle but the
    // active one hides immediately, with no flash.
    tr.update?.();
    if (!active) return;
    sizeLabelRef.current?.visible(true);
    if (active === "rotater") refreshAngleBadge();
    else refreshSizeBadge();
  }, [activeAnchorName, refreshAngleBadge, refreshSizeBadge]);

  const onTransform = useCallback(() => {
    if (!transformingRef.current || !sizeLabelRef.current?.visible()) return;
    if (activeAnchorName() === "rotater") refreshAngleBadge();
    else refreshSizeBadge();
  }, [activeAnchorName, refreshAngleBadge, refreshSizeBadge]);

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
    for (const id of selectedIds) {
      const knode = stage.findOne(`.${id}`) as Konva.Node | undefined;
      const irNode = childById.get(id);
      if (!knode || !irNode) continue;
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
          commit(cmd);
        }
        continue;
      }

      // Bounds-sized nodes (rect/ellipse/image/text/group): bake the scale
      // into bounds and reset the Konva scale so the next transform starts
      // from 1×.
      knode.scaleX(1);
      knode.scaleY(1);
      const newW = bounds.width * scaleX;
      const newH = bounds.height * scaleY;
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
        commit(cmd);
      }

      if (Math.abs(newRotation - transform.rotation) > EPSILON) {
        const cmd: CanvasNodeRotateCommand = {
          type: "node.rotate",
          nodeId: id,
          from: transform.rotation,
          to: newRotation,
        };
        commit(cmd);
      }
    }
  }, [stage, selectedIds, getIR, commit, activePageId]);

  if (croppingId) return null;
  // lucide art fills ~18 of its 24-unit viewBox, so scale against 18 → the
  // on-screen glyph renders at ~ROTATE_ICON_SIZE px (a true 32×32 icon).
  const iconScale = ROTATE_ICON_SIZE / 18;
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
