import { createStore, type StoreApi } from "zustand/vanilla";

/**
 * Transient draft node geometry used by draw tools (rect/ellipse/line) and
 * the marquee selection box. Lives outside `CanvasIR` because it never commits
 * — `clearDraft()` runs on pointerup (and on tool change / unmount).
 */
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
