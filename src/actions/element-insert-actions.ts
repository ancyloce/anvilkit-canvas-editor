import type {
	CanvasFrameNode,
	CanvasNode,
	CanvasNodeCreateCommand,
} from "@anvilkit/canvas-core";
import { applyMatrix, invertMatrix } from "@anvilkit/canvas-core";
import {
	computeInsertionIndex,
	type FlowChildRect,
} from "../auto-layout/reorder.js";
import type { CanvasStudioContextValue } from "../context/canvas-studio-context.js";
import type { CanvasElementEntry } from "../elements/element-entry.js";
import { resolvedPageSpace } from "../stage/resolved-page-space.js";
import { viewportCenterInPage } from "../stage/viewport-point.js";
import { findFrameHitAtPoint } from "../tools/frame-target.js";

/**
 * @file Element insertion (PLAN-0035 §5 P3, `cp3-004`).
 *
 * Two entry points — a drop point and the viewport centre — over ONE
 * insertion, because they must not be able to disagree about what inserting an
 * element means.
 *
 * WHY THIS IS ONE `node.create` AND NOT A BATCH.
 *
 * `applyCommand`'s inverse for `node.create` is a single `node.delete`
 * (`core/src/commands/runtime.ts:411-416`), so one command is one undo entry
 * by construction. That holds for the 22 sticker entries too: they build a
 * `group` WITH ITS CHILDREN ALREADY INSIDE, so the whole sticker is one node
 * from the command layer's point of view. The natural wrong implementation
 * here is a per-child loop, which would need N undos to remove one sticker.
 * `element-insert-actions.test.ts` pins the single step against a real
 * `applyCommand` round trip rather than against the command count alone.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO.
 *
 * It never normalises a built node's `scale` into its `bounds`. 353 `path` and
 * 9 `line` entries are SCALE-sized (`elements/catalog-builders.ts`'s sizing
 * model, from `selection/transformer-helpers.ts:167-173`); folding the scale
 * into `bounds` renders a 96-unit icon at 16 units. `entry.build({ size })`
 * already produced the right pair — the insertion path just has to leave it
 * alone.
 *
 * REUSE NOTE — the frame query is `findFrameHitAtPoint`, not `resolveDropTarget`.
 *
 * `workspace/uploads/drop-target.ts`'s `resolveDropTarget` answers a different
 * question: which existing IMAGE node or image-WELL frame a dropped photo
 * should REPLACE (`CanvasDropTarget` is `{kind:"image"} | {kind:"well"}`, and
 * the frame branch is gated on `isImageWell`). A vector element replaces
 * nothing and cannot fill a well — `buildFillFrameCommands` needs an `assetId`
 * — so the question this path asks is "which frame should PARENT the new
 * node", which is exactly `tools/frame-target.ts`'s
 * {@link findFrameHitAtPoint}: "the editor's only container-aware point query",
 * already used by `tools/image-tool.ts:79` to place a picked image inside the
 * frame under the click. The DOM plumbing is still shared — the element drop
 * rides `CanvasDropZone`'s existing handlers rather than a second drop surface.
 */

/** Where the insertion lands and how it is parented. */
export interface CanvasElementInsertOptions {
	/**
	 * Page-space TOP-LEFT for the element, matching
	 * `CanvasElementBuildContext.at`. Absent centres it on the active page.
	 */
	readonly at?: { readonly x: number; readonly y: number };
	/**
	 * Page-space point used to pick the parent frame — normally the pointer.
	 * Absent means "top level": the click path deliberately never nests, since
	 * a frame merely sitting under the viewport centre is not an expression of
	 * intent the way dropping onto one is.
	 */
	readonly target?: { readonly x: number; readonly y: number };
}

/** The parent a point resolves to, with the geometry needed to place a child. */
interface FrameParent {
	readonly frame: CanvasFrameNode;
	/** `at`, expressed in the frame's local space. */
	readonly localAt: { x: number; y: number };
	/** Flow slot for an Auto Layout frame; `undefined` for a plain one. */
	readonly index: number | undefined;
}

function resolveFrameParent(
	ctx: CanvasStudioContextValue,
	pageChildren: readonly CanvasNode[],
	at: { x: number; y: number },
	target: { x: number; y: number },
): FrameParent | undefined {
	const space = resolvedPageSpace(ctx.resolvedDocumentStore);
	const hit = findFrameHitAtPoint(pageChildren, target, undefined, space);
	if (!hit) return undefined;
	const inverse = invertMatrix(hit.worldMatrix);
	const [localX, localY] = applyMatrix(inverse, at.x, at.y);
	const layout = hit.frame.autoLayout;
	if (!layout) {
		return {
			frame: hit.frame,
			localAt: { x: localX, y: localY },
			index: undefined,
		};
	}
	// T-M4-06's flow-slot maths, reused: the pointer in frame-local space
	// against the remaining flow children's resolved footprints. Without a
	// resolved store there is no footprint to compare against, so the node is
	// appended — still a flow child, still laid out, just last.
	const view = ctx.resolvedDocumentStore?.getState().view;
	if (!view) {
		return {
			frame: hit.frame,
			localAt: { x: localX, y: localY },
			index: undefined,
		};
	}
	const [pointerX, pointerY] = applyMatrix(inverse, target.x, target.y);
	const flowChildren: FlowChildRect[] = [];
	for (const child of view.getChildren(hit.frame.id)) {
		if (child.node.layoutItem?.positioning === "absolute") continue;
		flowChildren.push({
			id: child.sourceNodeId,
			footprint: child.geometry.layoutFootprint,
		});
	}
	return {
		frame: hit.frame,
		localAt: { x: localX, y: localY },
		index: computeInsertionIndex(flowChildren, layout.direction, {
			x: pointerX,
			y: pointerY,
		}),
	};
}

/**
 * Insert one catalog element into the active page as ONE undo entry, and
 * select it.
 *
 * `options.target` (the pointer) picks the parent: the innermost unlocked,
 * visible frame containing it becomes the parent and `options.at` is rebased
 * into that frame's local space, so a drop over a frame lands INSIDE it. When
 * that frame carries `autoLayout` the child is created with NO
 * `layoutItem.positioning` override, which is what makes it a flow member the
 * resolver lays out — an absolutely-positioned child would sit on top of the
 * stack instead of joining it.
 *
 * Returns the new node's id, or `null` when there is no active page.
 */
export function insertCanvasElement(
	ctx: CanvasStudioContextValue,
	entry: CanvasElementEntry,
	options: CanvasElementInsertOptions = {},
): string | null {
	const ir = ctx.getIR();
	const activePageId = ctx.pagesStore.getState().activePageId;
	const page = ir.pages.find((p) => p.id === activePageId);
	if (!page) return null;

	const at = options.at ?? {
		x: (page.size.width - entry.defaultSize.width) / 2,
		y: (page.size.height - entry.defaultSize.height) / 2,
	};
	const parent = options.target
		? resolveFrameParent(ctx, page.root.children, at, options.target)
		: undefined;

	const node = entry.build({ at: parent ? parent.localAt : at });
	const cmd: CanvasNodeCreateCommand = {
		type: "node.create",
		node,
		pageId: page.id,
		...(parent ? { parentId: parent.frame.id } : {}),
		...(parent?.index !== undefined ? { index: parent.index } : {}),
	};
	ctx.commit(cmd);
	ctx.selectionStore.getState().setSelection([node.id]);
	return node.id;
}

/**
 * Drop path: insert `entry` with its top-left at `point` (page space), inside
 * whatever frame `point` lands in.
 *
 * Top-left rather than centred-on-the-cursor to match the sibling drop path in
 * the same component: `buildAssetInsertCommands` anchors a dropped image's
 * `transform` AT the drop position (`assets/upload-actions.ts:46-57`), and
 * `cp3-001`/`cp3-002` both specify "the drag path is the resolved drop point"
 * for `CanvasElementBuildContext.at`, which is documented as the top-left.
 */
export function insertElementAtPoint(
	ctx: CanvasStudioContextValue,
	entry: CanvasElementEntry,
	point: { readonly x: number; readonly y: number },
): string | null {
	return insertCanvasElement(ctx, entry, { at: point, target: point });
}

/**
 * Click / Enter / Space path: insert `entry` centred on what the user is
 * currently looking at.
 *
 * Centred rather than top-left-anchored because there is no pointer to anchor
 * to — `cp3-001`'s handoff states the rule as `at = viewportCentre −
 * defaultSize / 2`, and `insertComponentInstanceImpl` uses the same
 * "insert lands in the middle, selected, one undo step" convention. Falls back
 * to the page centre when the stage is unmeasurable (headless, pre-paint,
 * jsdom), which is `insertCanvasElement`'s own default.
 */
export function insertElementAtViewportCenter(
	ctx: CanvasStudioContextValue,
	entry: CanvasElementEntry,
): string | null {
	const centre = viewportCenterInPage(ctx);
	return insertCanvasElement(
		ctx,
		entry,
		centre
			? {
					at: {
						x: centre.x - entry.defaultSize.width / 2,
						y: centre.y - entry.defaultSize.height / 2,
					},
				}
			: {},
	);
}

/**
 * MIME type for dragging a catalog element from the Elements panel onto the
 * canvas. Named alongside `ASSET_DRAG_MIME` and `PAGE_DRAG_MIME`, and kept off
 * `Files` so the upload drop path never reacts to it.
 */
export const ELEMENT_DRAG_MIME = "application/x-anvilkit-canvas-element";

/**
 * The entry currently being dragged, handed from the panel's `dragstart` to
 * the canvas's `drop`.
 *
 * WHY MODULE STATE AND NOT THE `dataTransfer`.
 *
 * `DataTransfer` carries strings only, and a `CanvasElementEntry`'s payload is
 * its `build()` FUNCTION — the whole contract `cp3-001` established. The
 * alternatives were both worse: serialising a pre-built node loses the drop
 * point (it would have to be built before the drop, then repositioned, and the
 * scale-sized kinds make "reposition" a second sizing model), and re-resolving
 * `entry.id` through a provider on the drop side needs the panel's provider —
 * which may be a host's `elementProvider`, is reachable only from `panels/`,
 * and is `async`, splitting the insert away from the drop event.
 *
 * WHY THE SLOT IS KEYED BY STUDIO.
 *
 * A drag is singular per POINTER, not per module. Two `<CanvasStudio>` mounts on
 * one page — a side-by-side compare view, a docs page with two live editors —
 * share this module, so an unkeyed slot lets a drag begun in studio A be applied
 * by a drop on studio B. The `id` check alone cannot see that: both sides are
 * looking at the same entry, and the ids match.
 *
 * The key is the studio's `selectionStore`: allocated once per `<CanvasStudio>`,
 * REQUIRED on the context (so it is never `undefined`, which would make two
 * mounts compare equal and defeat the whole check), and the store this drag ends
 * up writing to — a completed drop selects what it inserted.
 *
 * `dragend` always fires — including on a cancelled drag — so the slot cannot
 * outlive its gesture; a drop with no live payload (a drag from another window,
 * another studio, or a stale `dataTransfer` type) inserts nothing rather than
 * guessing.
 */
let draggedElement:
	| {
			readonly owner: CanvasStudioContextValue["selectionStore"];
			readonly entry: CanvasElementEntry;
	  }
	| undefined;

/** Publish `entry` as the payload of a drag begun in `ctx`'s studio. */
export function beginElementDrag(
	ctx: CanvasStudioContextValue,
	entry: CanvasElementEntry,
): void {
	draggedElement = { owner: ctx.selectionStore, entry };
}

/** Clear the in-flight drag payload (`dragend`, and after a handled drop). */
export function endElementDrag(): void {
	draggedElement = undefined;
}

/**
 * The in-flight drag's entry, when it belongs to `ctx`'s studio AND is the one
 * `id` names. Both checks matter: the owner check rejects another mount's drag,
 * and the id check keeps a stale slot from being applied to a later drag of a
 * different entry.
 */
export function draggedElementEntry(
	ctx: CanvasStudioContextValue,
	id: string,
): CanvasElementEntry | undefined {
	if (!draggedElement || draggedElement.owner !== ctx.selectionStore) {
		return undefined;
	}
	return draggedElement.entry.id === id ? draggedElement.entry : undefined;
}
