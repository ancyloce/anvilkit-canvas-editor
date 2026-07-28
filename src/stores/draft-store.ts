import { createStore, type StoreApi } from "zustand/vanilla";

/**
 * Transient draft node geometry used by draw tools (rect/ellipse/polygon/star/line) and
 * the marquee selection box. Lives outside `CanvasIR` because it never commits
 * — `clearDraft()` runs on pointerup (and on tool change / unmount).
 */
/** T-M4-06 — flow-insertion preview carried by a `move` draft. */
export interface LayoutDropPreview {
	/** Target Auto Layout frame id. */
	frameId: string;
	/** Insertion index among the frame's remaining (non-dragged) flow children. */
	index: number;
	/** Drop-indicator segment in page space, for `DraftRenderer`. */
	indicator: { x1: number; y1: number; x2: number; y2: number };
	/** True when the Alt modifier requests Absolute insertion. */
	absolute: boolean;
}

export interface NodeStart {
	id: string;
	x: number;
	y: number;
}

export type DrawDraft =
	| {
			type: "rect";
			startX: number;
			startY: number;
			currentX: number;
			currentY: number;
	  }
	| {
			type: "frame";
			startX: number;
			startY: number;
			currentX: number;
			currentY: number;
	  }
	| {
			type: "ellipse";
			startX: number;
			startY: number;
			currentX: number;
			currentY: number;
	  }
	| {
			type: "polygon";
			startX: number;
			startY: number;
			currentX: number;
			currentY: number;
	  }
	| {
			type: "star";
			startX: number;
			startY: number;
			currentX: number;
			currentY: number;
	  }
	| {
			type: "line";
			startX: number;
			startY: number;
			currentX: number;
			currentY: number;
	  }
	| {
			type: "move";
			startX: number;
			startY: number;
			currentX: number;
			currentY: number;
			nodeStarts: NodeStart[];
			/**
			 * T-M4-06 flow-reorder preview: the Auto Layout frame under the
			 * pointer plus the previewed insertion slot. Preview-only state — the
			 * IR is never reordered during pointer movement; `onPointerUp` reads
			 * this to commit. `null`/absent = no layout drop target.
			 */
			layoutDrop?: LayoutDropPreview | null;
	  }
	| {
			type: "marquee";
			startX: number;
			startY: number;
			currentX: number;
			currentY: number;
	  }
	| {
			type: "pan";
			startScreenX: number;
			startScreenY: number;
			startPanX: number;
			startPanY: number;
	  };

export interface DraftState {
	draft: DrawDraft | null;
	setDraft: (d: DrawDraft) => void;
	clearDraft: () => void;
}

export type DraftStoreApi = StoreApi<DraftState>;

export function createDraftStore(): DraftStoreApi {
	return createStore<DraftState>()((set) => ({
		draft: null,
		setDraft(draft) {
			set({ draft });
		},
		clearDraft() {
			set({ draft: null });
		},
	}));
}
