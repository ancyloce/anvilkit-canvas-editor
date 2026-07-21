"use client";

import type { CanvasCommand } from "@anvilkit/canvas-core";
import { type ReactNode, useRef, useState } from "react";
import {
	insertAssetsImpl,
	uploadFilesImpl,
	uploadSingleFile,
} from "../../assets/upload-actions.js";
import {
	type CanvasStudioContextValue,
	useCanvasStudio,
	useCanvasT,
} from "../../context/canvas-studio-context.js";
import { useCanvasToaster } from "../../context/toast-context.js";
import {
	buildFillFrameCommands,
	buildReplaceImageCommands,
	wellImage,
} from "../../selection/frame-image-actions.js";
import { type CanvasDropTarget, resolveDropTarget } from "./drop-target.js";

/**
 * FR-093: internal drag payload for an ALREADY-registered asset (a done
 * upload dragged from the uploads panel). Carries the `ir.assets` id — no
 * re-upload happens on drop.
 */
export const ASSET_DRAG_MIME = "application/x-anvilkit-canvas-asset";

/**
 * Convert a drop event's screen coordinates into page-space coordinates
 * (FR-092 "inserted at the drop position"). Mirrors — inverted — the
 * container + zoom + pan transform already used to place on-stage overlays
 * (`CropEditorOverlay`/`TextEditorOverlay`/`RichTextToolbar`:
 * `screenX = containerRect.left + pageX * zoom + panX`). Returns undefined
 * when there's no live stage to anchor against, so callers fall back to
 * page-center insertion.
 */
function clientPointToPage(
	ctx: CanvasStudioContextValue,
	clientX: number,
	clientY: number,
): { x: number; y: number } | undefined {
	const stage = ctx.stage;
	// Call `container()` AS A METHOD — an unbound reference drops Konva's
	// `this` binding and crashes against a real stage (see the same note on
	// CropEditorOverlay/TextEditorOverlay).
	const container =
		stage && typeof stage.container === "function" ? stage.container() : null;
	const rect = container?.getBoundingClientRect?.();
	if (!rect) return undefined;
	const vp = ctx.viewportStore.getState();
	return {
		x: (clientX - rect.left - vp.panX) / vp.zoom,
		y: (clientY - rect.top - vp.panY) / vp.zoom,
	};
}

/** The FR-093 replace target under a client point, if any. */
function targetAtClientPoint(
	ctx: CanvasStudioContextValue,
	clientX: number,
	clientY: number,
): CanvasDropTarget | undefined {
	const world = clientPointToPage(ctx, clientX, clientY);
	if (!world) return undefined;
	const page = ctx
		.getIR()
		.pages.find((p) => p.id === ctx.pagesStore.getState().activePageId);
	if (!page) return undefined;
	return resolveDropTarget(page.root.children, world);
}

/**
 * The replacement command list for dropping `assetId` onto `target` — the
 * SAME pipeline the inspector/context-menu replace paths commit
 * (`buildReplaceImageCommands` / `buildFillFrameCommands`), composed here so
 * a drop can prepend its `asset.put` and stay one atomic undo entry.
 */
function buildDropReplaceCommands(
	ctx: CanvasStudioContextValue,
	target: CanvasDropTarget,
	assetId: string,
): CanvasCommand[] {
	if (target.kind === "image") {
		return buildReplaceImageCommands(ctx, target.node, assetId);
	}
	if (wellImage(target.frame)?.assetId === assetId) return [];
	return buildFillFrameCommands({
		frame: target.frame,
		assetId,
		asset: ctx.getIR().assets[assetId],
		pageId: ctx.pagesStore.getState().activePageId,
	});
}

/**
 * FR-092/093 (B-10): dropping image files anywhere on the canvas area uploads
 * them through the host adapter. A SINGLE file (or a single asset dragged
 * from the uploads panel) landing on an existing image node or image-well
 * frame REPLACES that target — bounds, transform, and crop survive because
 * `image.replace` only swaps `assetId` — as one atomic undo entry including
 * the upload's `asset.put`. Multi-file drops never replace (that would pick
 * an arbitrary winner); they and target-less drops insert at the drop
 * position (grid-arranged for multiples), falling back to page-center when
 * the drop lands outside the active page — or before the stage has mounted.
 * While dragging, the active replace target is announced via
 * `data-drop-target*` attributes and a highlight badge.
 */
export function CanvasDropZone({
	children,
}: {
	children: ReactNode;
}): React.JSX.Element {
	const ctx = useCanvasStudio();
	const t = useCanvasT();
	const toaster = useCanvasToaster();
	const [dragging, setDragging] = useState(false);
	const [hoverTarget, setHoverTarget] = useState<CanvasDropTarget | undefined>(
		undefined,
	);
	// rAF-coalesced dragover hit-testing: dragover fires continuously; one
	// resolution per frame is plenty for hover feedback (§13.1).
	const hoverRaf = useRef<number | null>(null);

	const isAcceptedDrag = (types: readonly string[] | DOMStringList): boolean =>
		Array.from(types).some((ty) => ty === "Files" || ty === ASSET_DRAG_MIME);

	const clearHover = (): void => {
		if (hoverRaf.current !== null) {
			cancelAnimationFrame(hoverRaf.current);
			hoverRaf.current = null;
		}
		setDragging(false);
		setHoverTarget(undefined);
	};

	const commitReplace = (commands: CanvasCommand[]): void => {
		if (commands.length === 0) return;
		if (commands.length === 1 && commands[0]) ctx.commit(commands[0]);
		else ctx.commitBatch(commands, "Replace image");
	};

	const handleFileDrop = async (
		files: readonly File[],
		clientX: number,
		clientY: number,
	): Promise<void> => {
		const position = clientPointToPage(ctx, clientX, clientY);
		// Multi-file drops never replace — picking one target for N files would
		// be ambiguous (FR-093); they insert as a grid like before.
		const target =
			files.length === 1 && files[0]
				? targetAtClientPoint(ctx, clientX, clientY)
				: undefined;
		if (!target || !files[0]) {
			await uploadFilesImpl(ctx, files, position, toaster);
			return;
		}
		const result = await uploadSingleFile(ctx, files[0]);
		if (!result.ok) {
			// Failed or cancelled upload: no node, no asset entry, no replace
			// (FR-093). The uploads panel shows the failed task with retry.
			if (result.error) {
				toaster.add({
					type: "error",
					title: t("canvas.upload.failed", "Upload failed"),
					description: result.error,
				});
			}
			return;
		}
		const asset = result.assets[0];
		if (!asset) return;
		const replace = buildDropReplaceCommands(ctx, target, asset.id);
		if (replace.length === 0) {
			// Degenerate no-op swap (same asset): fall back to insertion.
			insertAssetsImpl(ctx, result.assets, position);
			return;
		}
		// One atomic undo entry: register the uploaded asset AND swap the target.
		ctx.commitBatch(
			[
				{
					type: "asset.put",
					asset: {
						id: asset.id,
						uri: asset.uri,
						...(asset.mimeType !== undefined
							? { mimeType: asset.mimeType }
							: {}),
						...(asset.width !== undefined ? { width: asset.width } : {}),
						...(asset.height !== undefined ? { height: asset.height } : {}),
					},
				},
				...replace,
			],
			"Replace image",
		);
	};

	const handleAssetDrop = (
		assetId: string,
		clientX: number,
		clientY: number,
	): void => {
		const ir = ctx.getIR();
		const asset = ir.assets[assetId];
		if (!asset) return;
		const target = targetAtClientPoint(ctx, clientX, clientY);
		const commands = target
			? buildDropReplaceCommands(ctx, target, assetId)
			: [];
		if (target && commands.length > 0) {
			commitReplace(commands);
			return;
		}
		// No target (or no-op swap): insert the existing asset at the drop point.
		insertAssetsImpl(ctx, [asset], clientPointToPage(ctx, clientX, clientY));
	};

	const hoverLabel =
		hoverTarget === undefined
			? undefined
			: t("canvas.upload.replaceTarget", "Drop to replace");

	return (
		<div
			data-testid="canvas-drop-zone"
			data-dragging={dragging ? "true" : "false"}
			data-drop-target={hoverTarget === undefined ? "none" : hoverTarget.kind}
			data-drop-target-id={
				hoverTarget === undefined
					? undefined
					: hoverTarget.kind === "image"
						? hoverTarget.node.id
						: hoverTarget.frame.id
			}
			className="relative flex min-h-0 min-w-0 flex-1 flex-col"
			onDragOver={(e) => {
				if (!e.dataTransfer || !isAcceptedDrag(e.dataTransfer.types)) return;
				e.preventDefault();
				setDragging(true);
				const { clientX, clientY } = e;
				// Single-item OS drags don't expose file counts until drop; the
				// highlight is advisory — the drop handler re-resolves and applies
				// the multi-file rule authoritatively.
				if (hoverRaf.current !== null) return;
				hoverRaf.current = requestAnimationFrame(() => {
					hoverRaf.current = null;
					setHoverTarget(targetAtClientPoint(ctx, clientX, clientY));
				});
			}}
			onDragLeave={clearHover}
			onDrop={(e) => {
				// `getData` may be absent on synthetic dataTransfer stubs.
				const assetId = e.dataTransfer?.getData?.(ASSET_DRAG_MIME);
				const files = e.dataTransfer?.files;
				clearHover();
				if (assetId) {
					e.preventDefault();
					handleAssetDrop(assetId, e.clientX, e.clientY);
					return;
				}
				if (files && files.length > 0) {
					e.preventDefault();
					void handleFileDrop(Array.from(files), e.clientX, e.clientY);
				}
			}}
		>
			{children}
			{dragging && hoverTarget !== undefined ? (
				<output
					data-testid="drop-target-highlight"
					className="pointer-events-none absolute top-3 left-1/2 z-40 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground shadow-lg"
				>
					{hoverLabel}
				</output>
			) : null}
		</div>
	);
}
