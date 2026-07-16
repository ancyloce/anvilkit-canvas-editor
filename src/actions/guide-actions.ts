import type {
	CanvasPage,
	CanvasPageGuides,
	CanvasPageLayoutAids,
} from "@anvilkit/canvas-core";
import type { CanvasStudioContextValue } from "../context/canvas-studio-context.js";
import type { CanvasGuideAxis } from "../stores/ruler-guide-store.js";

/**
 * Guide + layout-aid mutations (C-02, FR-111/§9.3). Every mutation is ONE
 * `page.set-layout-aids` command — a whole-object replace with an exact
 * inverse in core — so each add/move/remove/clear is a single undo entry.
 * UI-only state (visibility, lock) lives in `ruler-guide-store`, not here.
 */

const EMPTY_GUIDES: CanvasPageGuides = { horizontal: [], vertical: [] };

/** Guides are stored to 2 decimals — enough for mm/in precision, no float noise. */
function roundPosition(position: number): number {
	return Math.round(position * 100) / 100;
}

function activePage(ctx: CanvasStudioContextValue): CanvasPage | undefined {
	const pageId = ctx.pagesStore.getState().activePageId;
	return ctx.getIR().pages.find((p) => p.id === pageId);
}

function commitAids(
	ctx: CanvasStudioContextValue,
	pageId: string,
	to: CanvasPageLayoutAids | undefined,
): void {
	ctx.commit({ type: "page.set-layout-aids", pageId, to });
}

/**
 * Drop empty guide arrays (and then an empty aids object) so clearing the
 * last guide leaves the document byte-identical to one that never had any.
 */
function normalizeAids(
	aids: CanvasPageLayoutAids,
): CanvasPageLayoutAids | undefined {
	const { guides, ...rest } = aids;
	const next: CanvasPageLayoutAids =
		guides && (guides.horizontal.length > 0 || guides.vertical.length > 0)
			? { ...rest, guides }
			: { ...rest };
	return Object.keys(next).length > 0 ? next : undefined;
}

function withGuides(
	aids: CanvasPageLayoutAids | undefined,
	guides: CanvasPageGuides,
): CanvasPageLayoutAids | undefined {
	return normalizeAids({ ...(aids ?? {}), guides });
}

/**
 * Add a persistent guide to the active page. Returns the new guide's index
 * on its axis, or -1 when there is no active page.
 */
export function addGuideImpl(
	ctx: CanvasStudioContextValue,
	axis: CanvasGuideAxis,
	position: number,
): number {
	const page = activePage(ctx);
	if (!page) return -1;
	const prior = page.layoutAids?.guides ?? EMPTY_GUIDES;
	const next: CanvasPageGuides = {
		horizontal:
			axis === "horizontal"
				? [...prior.horizontal, roundPosition(position)]
				: prior.horizontal,
		vertical:
			axis === "vertical"
				? [...prior.vertical, roundPosition(position)]
				: prior.vertical,
	};
	commitAids(ctx, page.id, withGuides(page.layoutAids, next));
	return (axis === "horizontal" ? next.horizontal : next.vertical).length - 1;
}

/** Move the guide at `index` on `axis` to a new position. No-op on a bad index. */
export function moveGuideImpl(
	ctx: CanvasStudioContextValue,
	axis: CanvasGuideAxis,
	index: number,
	position: number,
): void {
	const page = activePage(ctx);
	const prior = page?.layoutAids?.guides;
	if (!page || !prior) return;
	const list = axis === "horizontal" ? prior.horizontal : prior.vertical;
	if (index < 0 || index >= list.length) return;
	const moved = list.map((p, i) => (i === index ? roundPosition(position) : p));
	const next: CanvasPageGuides =
		axis === "horizontal"
			? { horizontal: moved, vertical: prior.vertical }
			: { horizontal: prior.horizontal, vertical: moved };
	commitAids(ctx, page.id, withGuides(page.layoutAids, next));
}

/** Remove the guide at `index` on `axis`. No-op on a bad index. */
export function removeGuideImpl(
	ctx: CanvasStudioContextValue,
	axis: CanvasGuideAxis,
	index: number,
): void {
	const page = activePage(ctx);
	const prior = page?.layoutAids?.guides;
	if (!page || !prior) return;
	const list = axis === "horizontal" ? prior.horizontal : prior.vertical;
	if (index < 0 || index >= list.length) return;
	const removed = list.filter((_, i) => i !== index);
	const next: CanvasPageGuides =
		axis === "horizontal"
			? { horizontal: removed, vertical: prior.vertical }
			: { horizontal: prior.horizontal, vertical: removed };
	commitAids(ctx, page.id, withGuides(page.layoutAids, next));
}

/** FR-111 "Clear all guides" — one undo entry; margins/bleed/safe survive. */
export function clearGuidesImpl(ctx: CanvasStudioContextValue): void {
	const page = activePage(ctx);
	const prior = page?.layoutAids?.guides;
	if (!page || !prior) return;
	if (prior.horizontal.length === 0 && prior.vertical.length === 0) return;
	commitAids(ctx, page.id, withGuides(page.layoutAids, EMPTY_GUIDES));
}

/**
 * Replace a page's whole layout-aid set (margin/bleed/safeArea/guides) —
 * the host/page-settings seam for FR-113. One undo entry.
 */
export function setPageLayoutAidsImpl(
	ctx: CanvasStudioContextValue,
	pageId: string,
	aids: CanvasPageLayoutAids | undefined,
): void {
	const page = ctx.getIR().pages.find((p) => p.id === pageId);
	if (!page) return;
	commitAids(ctx, pageId, aids === undefined ? undefined : normalizeAids(aids));
}
