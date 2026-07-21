import { createStore, type StoreApi } from "zustand/vanilla";

/**
 * Tracks which IR node is currently being edited in-place (text overlay for
 * MVP-6 Task 7; could extend for future inline editors). Null when no editor
 * is open.
 */
export interface EditingState {
	editingNodeId: string | null;
	setEditing: (id: string) => void;
	clearEditing: () => void;
	/**
	 * The live TextEditorOverlay textarea DOM node, while one is mounted (null
	 * otherwise). Lets a sibling control (RichTextToolbar) read the user's
	 * UNCOMMITTED live draft before building a patch, instead of the stale
	 * last-committed IR content (E-4) — the same "read the live DOM value"
	 * principle the overlay's own commit-on-blur already uses.
	 */
	textareaEl: HTMLTextAreaElement | null;
	setTextareaEl: (el: HTMLTextAreaElement | null) => void;
}

export type EditingStoreApi = StoreApi<EditingState>;

export function createEditingStore(): EditingStoreApi {
	return createStore<EditingState>()((set) => ({
		editingNodeId: null,
		setEditing(id) {
			set({ editingNodeId: id });
		},
		clearEditing() {
			set({ editingNodeId: null });
		},
		textareaEl: null,
		setTextareaEl(el) {
			set({ textareaEl: el });
		},
	}));
}
