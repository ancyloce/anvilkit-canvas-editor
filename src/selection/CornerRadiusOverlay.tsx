"use client";

import { findNode } from "@anvilkit/canvas-core";
import { type CSSProperties, useRef, useSyncExternalStore } from "react";
import {
	useCanvasStudio,
	useCanvasT,
} from "../context/canvas-studio-context.js";
import {
	computeCornerRadiusDrag,
	isRoundable,
	maxCornerRadius,
} from "./corner-radius-actions.js";

const overlayBase: CSSProperties = { position: "fixed", zIndex: 9998 };
const HANDLE = 12;
/** Minimum on-screen inset so the handle stays grabbable at radius 0. */
const MIN_INSET = 14;

/**
 * FR-076 drag-to-adjust corner radius. A single handle rides the top-left
 * corner of a selected rect/frame; dragging it toward the center grows the
 * uniform `radius` (clamped to half the shorter side), away shrinks it. The
 * gesture writes the uniform `radius` and clears any per-corner `cornerRadii`
 * (which would otherwise take precedence), coalesced into one undo entry.
 * Hidden while another interaction owns the pointer (crop, path edit, text).
 */
export function CornerRadiusOverlay(): React.JSX.Element | null {
	const ctx = useCanvasStudio();
	const t = useCanvasT();
	const { stage, selectionStore, viewportStore, cropStore, editingStore } = ctx;

	const selectedIds = useSyncExternalStore(
		selectionStore.subscribe,
		() => selectionStore.getState().selectedIds,
		() => selectionStore.getState().selectedIds,
	);
	// Re-measure on zoom/pan.
	useSyncExternalStore(
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
	const cropActive = useSyncExternalStore(
		cropStore?.subscribe ?? (() => () => undefined),
		() => cropStore?.getState().cropNodeId ?? null,
		() => cropStore?.getState().cropNodeId ?? null,
	);
	const editingId = useSyncExternalStore(
		editingStore.subscribe,
		() => editingStore.getState().editingNodeId,
		() => editingStore.getState().editingNodeId,
	);

	const dragRef = useRef<{
		startRadius: number;
		sx: number;
		sy: number;
		max: number;
	} | null>(null);

	if (selectedIds.length !== 1 || cropActive || editingId || !stage)
		return null;
	const id = selectedIds[0];
	const found = id ? findNode(ctx.getIR(), id) : null;
	if (!found || !isRoundable(found.node) || found.node.locked === true) {
		return null;
	}
	const node = found.node;
	const radius = node.radius ?? 0;
	const max = maxCornerRadius(node);

	const vp = viewportStore.getState();
	const container =
		typeof stage.container === "function" ? stage.container() : null;
	const cr = container?.getBoundingClientRect?.();
	const boxLeft = (cr?.left ?? 0) + node.transform.x * vp.zoom + vp.panX;
	const boxTop = (cr?.top ?? 0) + node.transform.y * vp.zoom + vp.panY;
	const inset = Math.max(MIN_INSET, radius * vp.zoom);

	const beginDrag = (e: React.PointerEvent) => {
		e.preventDefault();
		e.stopPropagation();
		dragRef.current = {
			startRadius: radius,
			sx: e.clientX,
			sy: e.clientY,
			max,
		};
		const onMove = (ev: PointerEvent) => {
			const d = dragRef.current;
			if (!d) return;
			const zoom = viewportStore.getState().zoom || 1;
			const next = computeCornerRadiusDrag(
				d.startRadius,
				(ev.clientX - d.sx) / zoom,
				(ev.clientY - d.sy) / zoom,
				d.max,
			);
			ctx.commitCoalesced?.(
				{
					type: "node.update",
					nodeId: node.id,
					kind: node.type,
					patch: { radius: next, cornerRadii: undefined },
				},
				`corner-radius:${node.id}`,
			);
		};
		const onUp = () => {
			dragRef.current = null;
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
		};
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
	};

	return (
		<div
			data-testid="corner-radius-handle"
			role="slider"
			aria-label={t("canvas.cornerRadius.handle", "Corner radius")}
			aria-valuenow={Math.round(radius)}
			aria-valuemin={0}
			aria-valuemax={Math.round(max)}
			tabIndex={0}
			onPointerDown={beginDrag}
			onKeyDown={(e) => {
				const step = e.shiftKey ? 10 : 1;
				if (e.key === "ArrowRight" || e.key === "ArrowUp") {
					e.preventDefault();
					ctx.commitCoalesced?.(
						{
							type: "node.update",
							nodeId: node.id,
							kind: node.type,
							patch: {
								radius: Math.min(max, Math.round(radius + step)),
								cornerRadii: undefined,
							},
						},
						`corner-radius:${node.id}`,
					);
				} else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
					e.preventDefault();
					ctx.commitCoalesced?.(
						{
							type: "node.update",
							nodeId: node.id,
							kind: node.type,
							patch: {
								radius: Math.max(0, Math.round(radius - step)),
								cornerRadii: undefined,
							},
						},
						`corner-radius:${node.id}`,
					);
				}
			}}
			style={{
				...overlayBase,
				left: boxLeft + inset - HANDLE / 2,
				top: boxTop + inset - HANDLE / 2,
				width: HANDLE,
				height: HANDLE,
				borderRadius: "50%",
				background: "#ffffff",
				border: "1.5px solid #3b82f6",
				cursor: "nwse-resize",
				boxSizing: "border-box",
			}}
		/>
	);
}
