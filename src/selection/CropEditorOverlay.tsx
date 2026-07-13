"use client";

import { type CanvasImageNode, findNode } from "@anvilkit/canvas-core";
import {
	type CSSProperties,
	useEffect,
	useRef,
	useSyncExternalStore,
} from "react";
import {
	useCanvasStudio,
	useCanvasT,
} from "../context/canvas-studio-context.js";
import type { CropRect, CropStoreApi } from "../stores/crop-store.js";

const overlayBase: CSSProperties = { position: "fixed", zIndex: 9999 };

import {
	type CropDragMode,
	cancelCrop,
	commitCrop,
	computeCropDrag,
} from "./crop-actions.js";

const HANDLE = 10;

const CORNERS: Array<{ mode: CropDragMode; fx: 0 | 1; fy: 0 | 1 }> = [
	{ mode: "nw", fx: 0, fy: 0 },
	{ mode: "ne", fx: 1, fy: 0 },
	{ mode: "sw", fx: 0, fy: 1 },
	{ mode: "se", fx: 1, fy: 1 },
];

const cursorFor: Record<CropDragMode, string> = {
	move: "move",
	nw: "nwse-resize",
	ne: "nesw-resize",
	sw: "nesw-resize",
	se: "nwse-resize",
};

/**
 * Interactive crop editor (I3-2). Renders an HTML overlay (like
 * {@link TextEditorOverlay}) over the cropping image with draggable corner
 * handles + a movable body; Enter / ✓ commits one `node.update`, Escape / ✕
 * cancels. Crop math runs through the pure {@link computeCropDrag}; only the
 * commit touches `historyStore` (MVP-7).
 */
export function CropEditorOverlay(): React.JSX.Element | null {
	const { cropStore } = useCanvasStudio();
	if (!cropStore) return null;
	return <CropEditorOverlayInner cropStore={cropStore} />;
}

function CropEditorOverlayInner({
	cropStore,
}: {
	cropStore: CropStoreApi;
}): React.JSX.Element | null {
	const ctx = useCanvasStudio();
	const t = useCanvasT();
	const { stage, getIR, viewportStore } = ctx;
	const cropNodeId = useSyncExternalStore(
		cropStore.subscribe,
		() => cropStore.getState().cropNodeId,
		() => cropStore.getState().cropNodeId,
	);
	const draft = useSyncExternalStore(
		cropStore.subscribe,
		() => cropStore.getState().draft,
		() => cropStore.getState().draft,
	);
	const dragRef = useRef<{
		start: CropRect;
		sx: number;
		sy: number;
		perX: number;
		perY: number;
		mode: CropDragMode;
	} | null>(null);

	const ir = getIR();
	const found = cropNodeId ? findNode(ir, cropNodeId) : null;
	const node =
		found && found.node.type === "image"
			? (found.node as CanvasImageNode)
			: null;
	const asset = node ? ir.assets[node.assetId] : undefined;
	const naturalW = asset?.width ?? node?.bounds.width ?? 0;
	const naturalH = asset?.height ?? node?.bounds.height ?? 0;

	// Seed the draft from the node's current crop (or the full image) once the
	// editor opens. `draft` stays null until then so this runs exactly once.
	useEffect(() => {
		if (!cropNodeId || !node || draft) return;
		cropStore
			.getState()
			.setDraft(node.crop ?? { x: 0, y: 0, width: naturalW, height: naturalH });
	}, [cropNodeId, node, draft, naturalW, naturalH, cropStore]);

	// Enter commits, Escape cancels, while the editor is open.
	useEffect(() => {
		if (!cropNodeId) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				cancelCrop(ctx);
			} else if (e.key === "Enter") {
				e.preventDefault();
				commitCrop(ctx);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [cropNodeId, ctx]);

	if (!cropNodeId || !node || !draft || !stage) return null;

	const vp = viewportStore.getState();
	// Call `container()` AS A METHOD on the stage. Konva's `container()`
	// delegates to `this.getContainer()`, so extracting it to a local
	// (`const fn = stage.container; fn()`) drops the `this` binding and crashes
	// with "Cannot read properties of undefined (reading 'getContainer')"
	// against a real Konva stage. Unit tests miss it because their fake
	// `container` is a plain `this`-less function.
	const container =
		typeof stage.container === "function" ? stage.container() : null;
	const cr = container?.getBoundingClientRect?.();
	const boxLeft = (cr?.left ?? 0) + node.transform.x * vp.zoom + vp.panX;
	const boxTop = (cr?.top ?? 0) + node.transform.y * vp.zoom + vp.panY;
	const boxW = node.bounds.width * vp.zoom;
	const boxH = node.bounds.height * vp.zoom;
	const sxPerNat = naturalW > 0 ? boxW / naturalW : 1;
	const syPerNat = naturalH > 0 ? boxH / naturalH : 1;
	const rectLeft = boxLeft + draft.x * sxPerNat;
	const rectTop = boxTop + draft.y * syPerNat;
	const rectW = draft.width * sxPerNat;
	const rectH = draft.height * syPerNat;

	const beginDrag = (mode: CropDragMode) => (e: React.PointerEvent) => {
		e.preventDefault();
		e.stopPropagation();
		const current = cropStore.getState().draft;
		if (!current) return;
		dragRef.current = {
			start: { ...current },
			sx: e.clientX,
			sy: e.clientY,
			// Screen px → natural px (inverse of the render scale).
			perX: naturalW > 0 ? naturalW / boxW : 1,
			perY: naturalH > 0 ? naturalH / boxH : 1,
			mode,
		};
		const onMove = (ev: PointerEvent) => {
			const d = dragRef.current;
			if (!d) return;
			const dxNat = (ev.clientX - d.sx) * d.perX;
			const dyNat = (ev.clientY - d.sy) * d.perY;
			cropStore
				.getState()
				.setDraft(
					computeCropDrag(d.mode, d.start, dxNat, dyNat, naturalW, naturalH),
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
		<>
			{/* Movable crop rectangle. */}
			<div
				data-testid="crop-editor-overlay"
				onPointerDown={beginDrag("move")}
				style={{
					...overlayBase,
					left: rectLeft,
					top: rectTop,
					width: rectW,
					height: rectH,
					border: "1px solid #3b82f6",
					boxShadow: "0 0 0 9999px rgba(0,0,0,0.35)",
					cursor: cursorFor.move,
					boxSizing: "border-box",
				}}
			/>
			{CORNERS.map(({ mode, fx, fy }) => (
				<div
					key={mode}
					data-testid={`crop-handle-${mode}`}
					onPointerDown={beginDrag(mode)}
					style={{
						...overlayBase,
						left: rectLeft + fx * rectW - HANDLE / 2,
						top: rectTop + fy * rectH - HANDLE / 2,
						width: HANDLE,
						height: HANDLE,
						background: "#ffffff",
						border: "1px solid #3b82f6",
						borderRadius: 2,
						cursor: cursorFor[mode],
					}}
				/>
			))}
			{/* Confirm / cancel toolbar above the rect. */}
			<div
				style={{
					...overlayBase,
					left: rectLeft,
					top: rectTop - 28,
					display: "flex",
					gap: 4,
				}}
			>
				<button
					type="button"
					data-testid="crop-confirm"
					title={t("canvas.crop.applyTitle", "Apply crop (Enter)")}
					aria-label={t("canvas.crop.apply", "Apply crop")}
					onClick={() => commitCrop(ctx)}
					style={cropButtonStyle("#2563eb", "#ffffff")}
				>
					✓
				</button>
				<button
					type="button"
					data-testid="crop-cancel"
					title={t("canvas.crop.cancelTitle", "Cancel crop (Esc)")}
					aria-label={t("canvas.crop.cancel", "Cancel crop")}
					onClick={() => cancelCrop(ctx)}
					style={cropButtonStyle("#ffffff", "#374151")}
				>
					✕
				</button>
			</div>
		</>
	);
}

function cropButtonStyle(bg: string, color: string): CSSProperties {
	return {
		width: 24,
		height: 24,
		border: "1px solid #d1d5db",
		borderRadius: 3,
		background: bg,
		color,
		cursor: "pointer",
		font: "inherit",
		lineHeight: 1,
	};
}
