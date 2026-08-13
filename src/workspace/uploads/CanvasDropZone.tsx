"use client";

import {
	type CanvasCommand,
	type CanvasFrameShape,
	resolveFrameClipShape,
} from "@anvilkit/canvas-core";
import * as React from "react";
import { type ReactNode, useRef, useState } from "react";
import {
	draggedElementEntry,
	ELEMENT_DRAG_MIME,
	endElementDrag,
	insertCanvasElement,
	insertElementAtPoint,
} from "../../actions/element-insert-actions.js";
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
import { resolvedPageSpace } from "../../stage/resolved-page-space.js";
import { clientPointToPage } from "../../stage/viewport-point.js";
import { type CanvasDropTarget, resolveDropTarget } from "./drop-target.js";
import { runUploadWork } from "./upload-failure.js";

/**
 * FR-093: internal drag payload for an ALREADY-registered asset (a done
 * upload dragged from the uploads panel). Carries the `ir.assets` id — no
 * re-upload happens on drop.
 */
export const ASSET_DRAG_MIME = "application/x-anvilkit-canvas-asset";

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
	return resolveDropTarget(
		page.root.children,
		world,
		undefined,
		resolvedPageSpace(ctx.resolvedDocumentStore),
	);
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
 * cp4-004: the NON-RECTANGULAR clip a hovered well would apply to the dropped
 * photo, if any. Read from core's ONE resolver, so the affordance describes the
 * geometry the renderer is actually about to use rather than a second reading
 * of `clip`/`shape`. `undefined` for a plain rectangular well — the badge then
 * keeps the shipped "Drop to replace" wording, which is still accurate.
 */
function hoveredClipShapeKind(
	target: CanvasDropTarget | undefined,
): CanvasFrameShape["kind"] | undefined {
	if (target?.kind !== "well") return undefined;
	const resolved = resolveFrameClipShape(target.frame);
	if (!resolved.clipped || resolved.source !== "declared") return undefined;
	return resolved.shape.kind === "rect" ? undefined : resolved.shape.kind;
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
		Array.from(types).some(
			(ty) =>
				ty === "Files" || ty === ASSET_DRAG_MIME || ty === ELEMENT_DRAG_MIME,
		);

	/**
	 * `cp3-004`: an element drag is a CREATE, never a replace. Resolving a
	 * replace target for it would light the "Drop to replace" badge over an
	 * image the drop is not going to touch — so the hover pass is skipped
	 * entirely and the drop parents into the frame under the cursor instead
	 * (see `insertElementAtPoint`).
	 */
	const isElementDrag = (types: readonly string[] | DOMStringList): boolean =>
		Array.from(types).some((ty) => ty === ELEMENT_DRAG_MIME);

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
		// Re-resolve the target from the CURRENT document (E-17): the upload
		// await can span an arbitrary amount of time, during which the node/
		// frame captured above may have been deleted or replaced. A vanished
		// target falls back to plain insertion instead of committing a patch
		// against a node that no longer exists.
		const liveTarget = targetAtClientPoint(ctx, clientX, clientY);
		const replace = liveTarget
			? buildDropReplaceCommands(ctx, liveTarget, asset.id)
			: [];
		if (replace.length === 0) {
			// Degenerate no-op swap (same asset), or the target is gone: insert.
			insertAssetsImpl(ctx, result.assets, position);
			return;
		}
		try {
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
		} catch {
			// The re-resolved target vanished in the narrow window between
			// resolution and commit — same fallback as a missing target.
			insertAssetsImpl(ctx, result.assets, position);
		}
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

	/**
	 * `cp3-004`: a catalog element dragged out of the Elements panel. ONE
	 * `node.create` at the drop point, parented into the frame under the cursor
	 * when there is one — see `actions/element-insert-actions.ts`. A drop whose
	 * payload never arrived (a drag begun in another window) inserts nothing:
	 * the entry's `build()` is not something a `dataTransfer` can carry.
	 */
	const handleElementDrop = (
		entryId: string,
		clientX: number,
		clientY: number,
	): void => {
		const entry = draggedElementEntry(ctx, entryId);
		endElementDrag();
		if (!entry) return;
		const point = clientPointToPage(ctx, clientX, clientY);
		// No measurable stage → page centre, the same fallback
		// `buildAssetInsertCommands` uses for an unanchorable drop. Never (0, 0):
		// an element pinned to the page origin reads as a bug.
		if (point) insertElementAtPoint(ctx, entry, point);
		else insertCanvasElement(ctx, entry);
	};

	const hoverShapeKind = hoveredClipShapeKind(hoverTarget);
	const hoverLabel =
		hoverTarget === undefined
			? undefined
			: hoverShapeKind !== undefined
				? t("canvas.upload.replaceTargetShape", "Drop to fill shape")
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
			data-drop-target-shape={hoverShapeKind}
			className="relative flex min-h-0 min-w-0 flex-1 flex-col"
			onDragOver={(e) => {
				if (!e.dataTransfer || !isAcceptedDrag(e.dataTransfer.types)) return;
				e.preventDefault();
				setDragging(true);
				const { clientX, clientY } = e;
				// An element drag creates; it never replaces. Skipping the hover
				// pass is what keeps "Drop to replace" off an image the drop is
				// not going to touch.
				if (isElementDrag(e.dataTransfer.types)) return;
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
				const elementId = e.dataTransfer?.getData?.(ELEMENT_DRAG_MIME);
				const assetId = e.dataTransfer?.getData?.(ASSET_DRAG_MIME);
				const files = e.dataTransfer?.files;
				clearHover();
				if (elementId) {
					e.preventDefault();
					handleElementDrop(elementId, e.clientX, e.clientY);
					return;
				}
				if (assetId) {
					e.preventDefault();
					handleAssetDrop(assetId, e.clientX, e.clientY);
					return;
				}
				if (files && files.length > 0) {
					e.preventDefault();
					// Never plain `void` (E-17-R): the guarded no-such-node path is
					// only ONE of the ways this pipeline can reject — the uploader,
					// the post-upload insert commit, and the selection update can all
					// throw too, and a bare `void` would let those escape unobserved.
					runUploadWork(
						handleFileDrop(Array.from(files), e.clientX, e.clientY),
						toaster,
						t,
					);
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
