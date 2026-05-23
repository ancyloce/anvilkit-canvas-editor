"use client";

import type {
	CanvasNodeResizeCommand,
	CanvasNodeRotateCommand,
} from "@anvilkit/canvas-core";
import type Konva from "konva";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { Transformer } from "react-konva";
import { useCanvasStudio } from "../context/canvas-studio-context.js";
import { draggedIdsKey } from "../perf/active-nodes.js";

const EPSILON = 0.5;

/**
 * Binds a react-konva <Transformer> to the currently-selected Konva nodes.
 * On `transformend`, fires one resize and/or rotate command per affected node
 * (MVP-7: refs during interaction; one command on commit). Konva's scaleX/Y
 * is reset to 1 after each commit so subsequent transforms re-derive from the
 * new bounds — standard react-konva transformer pattern.
 */
const noopSubscribe = () => () => undefined;

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

	// During a move drag the dragged node is promoted onto the drag layer, which
	// remounts its Konva node as a NEW instance. The drag runs on raw Konva
	// pointer events (outside React's event system), so the rebind effect above
	// fires asynchronously and gets starved by the move loop — leaving the
	// Transformer bound to the stale (destroyed) node, so the selection box stops
	// tracking the element (it stays at the original position). Subscribe to the
	// draft store and re-point the Transformer at the live nodes *synchronously*
	// on every move. This runs in the same tick as the node mutation (no React
	// re-render, so the per-move drag-layer optimization is preserved).
	useEffect(() => {
		if (!stage) return;
		const sync = () => {
			const draft = draftStore.getState().draft;
			if (!draft || draft.type !== "move") return;
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
		return draftStore.subscribe(sync);
	}, [stage, draftStore, selectionStore]);

	const onTransformEnd = useCallback(() => {
		if (!stage) return;
		const ir = getIR();
		const page = ir.pages.find((p) => p.id === activePageId);
		if (!page) return;
		for (const id of selectedIds) {
			const knode = stage.findOne(`.${id}`) as Konva.Node | undefined;
			const irNode = page.root.children.find((c) => c.id === id);
			if (!knode || !irNode) continue;

			const scaleX = (knode as Konva.Node).scaleX();
			const scaleY = (knode as Konva.Node).scaleY();
			const newX = (knode as Konva.Node).x();
			const newY = (knode as Konva.Node).y();
			const newW = irNode.bounds.width * scaleX;
			const newH = irNode.bounds.height * scaleY;
			const newRotation = (knode as Konva.Node).rotation();

			// Reset Konva local scale so the next transform starts from 1×.
			(knode as Konva.Node).scaleX(1);
			(knode as Konva.Node).scaleY(1);

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
	return <Transformer ref={transformerRef} onTransformEnd={onTransformEnd} />;
}
