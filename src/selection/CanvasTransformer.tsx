"use client";

import type {
	CanvasAnyNodeUpdateCommand,
	CanvasNode,
	CanvasNodeResizeCommand,
	CanvasNodeRotateCommand,
} from "@anvilkit/canvas-core";
import type Konva from "konva";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { Label, Tag, Text, Transformer } from "react-konva";
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

/** Violet selection accent (matches the editor's `#7c3aed` workspace accent). */
const SELECTION_ACCENT = "#7c3aed";
/** Resting anchor fill — handles are white until hovered. */
const ANCHOR_FILL = "#ffffff";

/**
 * Reshape a single Transformer anchor: white **circular** corner handles and
 * white **pill** edge handles. Konva applies the global anchor attrs
 * (size/fill/stroke/cornerRadius) to every anchor first, then calls this
 * per-anchor hook — so corners keep the circular global style and we only
 * reshape the edge handles here. After changing an anchor's size we recentre it
 * via offset (padding is 0, so offset = size / 2). Fill is left to the caller so
 * the hovered anchor can be tinted (see `setAnchorHovered`).
 */
function shapeSelectionAnchor(anchor: Konva.Rect): void {
	if (anchor.hasName("rotater")) {
		// Vertical pill (kept on the right via `rotateAnchorAngle`). White at rest;
		// fill is applied by the caller (purple on hover / while rotating).
		anchor.width(10);
		anchor.height(22);
		anchor.offsetX(5);
		anchor.offsetY(11);
		anchor.cornerRadius(5);
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
 * Tint an anchor on hover: the dragger under the cursor fills violet, and
 * reverts to white on leave. Replaces the old always-on purple block parked off
 * the side of the box — the accent is now hover feedback on the handles
 * themselves.
 */
export function setAnchorHovered(anchor: Konva.Rect, hovered: boolean): void {
	anchor.fill(hovered ? SELECTION_ACCENT : ANCHOR_FILL);
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
	// Size readout shown while resizing (imperative — no re-render per frame).
	const sizeLabelRef = useRef<Konva.Label | null>(null);
	const sizeTextRef = useRef<Konva.Text | null>(null);
	// Position token (e.g. "top-left") of the hovered anchor, or null.
	const hoveredAnchorRef = useRef<string | null>(null);
	// True between transformstart/transformend so `anchorStyleFunc` hides every
	// dragger except the one under the cursor.
	const transformingRef = useRef(false);

	// Per-anchor styling: white circular corners, white pill edges, and a
	// hover/active tint. While transforming, hide every anchor except the one
	// being dragged (kept purple) so only the active handle and the size badge
	// show. Konva runs this last in update() (after positioning + visibility),
	// so it has the final say on each anchor's fill/visibility every frame.
	const anchorStyleFunc = useCallback((anchor: Konva.Rect) => {
		shapeSelectionAnchor(anchor);
		if (transformingRef.current) {
			const dragging = anchor.isDragging?.() ?? false;
			anchor.visible(dragging);
			if (dragging) anchor.fill(SELECTION_ACCENT);
			return;
		}
		anchor.visible(true);
		const hovered = hoveredAnchorRef.current;
		anchor.fill(
			hovered !== null && anchor.hasName(hovered)
				? SELECTION_ACCENT
				: ANCHOR_FILL,
		);
	}, []);

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
		// Park the badge just below the box, right edge aligned to the box's.
		label.position({ x: box.x + box.width, y: box.y + box.height + 12 });
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
			hoveredAnchorRef.current = anchor.name().split(" ")[0] ?? null;
			if (!transformingRef.current) setAnchorHovered(anchor, true);
		};
		const leave = (e: Konva.KonvaEventObject<MouseEvent>) => {
			hoveredAnchorRef.current = null;
			if (!transformingRef.current)
				setAnchorHovered(e.target as Konva.Rect, false);
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
	return (
		<>
			<Transformer
				ref={transformerRef}
				onTransformStart={onTransformStart}
				onTransform={onTransform}
				onTransformEnd={onTransformEnd}
				borderStroke={SELECTION_ACCENT}
				borderStrokeWidth={1.5}
				anchorStroke={SELECTION_ACCENT}
				anchorStrokeWidth={1.5}
				anchorFill={ANCHOR_FILL}
				anchorSize={12}
				anchorCornerRadius={6}
				rotateAnchorAngle={90}
				rotateAnchorOffset={22}
				rotateLineVisible={false}
				anchorStyleFunc={anchorStyleFunc}
			/>
			{/* Live size readout while resizing (positioned imperatively). */}
			<Label ref={sizeLabelRef} visible={false} listening={false}>
				<Tag
					fill="#27272a"
					cornerRadius={6}
					shadowColor="#000000"
					shadowBlur={8}
					shadowOpacity={0.25}
					shadowOffsetY={2}
				/>
				<Text
					ref={sizeTextRef}
					text=""
					fill="#ffffff"
					fontSize={13}
					fontStyle="bold"
					padding={7}
				/>
			</Label>
		</>
	);
}
