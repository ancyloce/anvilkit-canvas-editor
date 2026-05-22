import type { DrawDraft } from "../stores/draft-store.js";

/**
 * Top-level node ids currently being dragged, derived from a `move` draft.
 * Empty for any other (or absent) draft. Pure — shared by the static-group
 * cache (I2-5 Task 1) and the drag-layer optimization (Task 2) so both agree
 * on what "currently dragging" means.
 */
export function selectDraggedIds(draft: DrawDraft | null): string[] {
	if (!draft || draft.type !== "move") return [];
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
