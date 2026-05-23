import { createStore, type StoreApi } from "zustand/vanilla";

/** Crop rectangle in the source image's natural-pixel space. */
export interface CropRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * Drives the interactive image-crop editor (I3-2). `cropNodeId` is the image
 * node being cropped (null when the editor is closed). `draft` is the live,
 * in-progress crop rect updated on every handle drag — transient UI state, like
 * {@link DraftStore}; the single committed `node.update` happens on confirm
 * (MVP-7: refs/transient state during interaction, one command on commit).
 */
export interface CropState {
	cropNodeId: string | null;
	draft: CropRect | null;
	/** Open the editor for `nodeId`; the overlay seeds `draft` once it mounts. */
	begin: (nodeId: string) => void;
	setDraft: (rect: CropRect) => void;
	clear: () => void;
}

export type CropStoreApi = StoreApi<CropState>;

export function createCropStore(): CropStoreApi {
	return createStore<CropState>()((set) => ({
		cropNodeId: null,
		draft: null,
		begin(nodeId) {
			set({ cropNodeId: nodeId, draft: null });
		},
		setDraft(rect) {
			set({ draft: rect });
		},
		clear() {
			set({ cropNodeId: null, draft: null });
		},
	}));
}
