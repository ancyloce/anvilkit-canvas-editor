import type { DrawDraft } from "../stores/draft-store.js";

/**
 * Minimum pointer travel (world units) before a `move` draft counts as an
 * actual drag. Mirrors `MIN_MOVE_DISTANCE` in `select-tool.ts`: a gesture that
 * stays under this threshold commits no move, so it must not promote nodes onto
 * the drag layer either.
 */
const MIN_DRAG_DISTANCE = 0.5;

/**
 * Top-level node ids currently being dragged, derived from a `move` draft.
 * Empty for any other (or absent) draft. Pure — shared by the static-group
 * cache (I2-5 Task 1) and the drag-layer optimization (Task 2) so both agree
 * on what "currently dragging" means.
 *
 * A freshly-created `move` draft (pointer down, not yet moved) is NOT a drag:
 * `selectTool.onPointerDown` opens a move draft on every click, including a
 * pure selection click. Promoting the node onto the drag layer for that
 * zero-distance gesture remounts its Konva instance, then demotes it right back
 * on pointerup — and the selection `Transformer` is left bound to the now
 * detached (no-layer) instance, so the next resize/rotate silently no-ops. Only
 * count a move draft once the pointer has actually travelled past the threshold.
 */
export function selectDraggedIds(draft: DrawDraft | null): string[] {
	if (!draft || draft.type !== "move") return [];
	const dx = Math.abs(draft.currentX - draft.startX);
	const dy = Math.abs(draft.currentY - draft.startY);
	if (dx < MIN_DRAG_DISTANCE && dy < MIN_DRAG_DISTANCE) return [];
	return draft.nodeStarts.map((n) => n.id);
}

/**
 * A stable string key for the dragged-id SET, for `useSyncExternalStore`. It
 * changes only when the set of dragged ids changes (drag start / end) — NOT on
 * every pointermove (a `move` draft mutates only `currentX/Y`, not `nodeStarts`).
 * Sorted so id order never spuriously changes the key. This is what keeps the
 * drag-layer promotion from re-rendering `<CanvasStudio>` on every move (MVP-7).
 */
export function draggedIdsKey(draft: DrawDraft | null): string {
	return selectDraggedIds(draft).sort().join(",");
}
