import { createStore, type StoreApi } from "zustand/vanilla";

/**
 * Container isolation mode (C-09, FR-055). UI STATE ONLY — the context stack
 * must never enter Canvas IR. `path` holds container node ids from the
 * outermost isolated container to the innermost (the active editing scope);
 * an empty path means no isolation. The stack is per active page —
 * `<CanvasStudio>` clears it on page switch.
 */
export interface IsolationState {
	path: readonly string[];
	/** Push one container onto the stack (entering nested isolation). */
	enter: (containerId: string) => void;
	/** Pop the innermost level; returns false when already empty. */
	exitOne: () => boolean;
	exitAll: () => void;
	/** Replace the whole path (validation trims broken tails after edits). */
	setPath: (path: readonly string[]) => void;
}

export type IsolationStoreApi = StoreApi<IsolationState>;

const EMPTY: readonly string[] = [];

export function createIsolationStore(): IsolationStoreApi {
	return createStore<IsolationState>()((set, get) => ({
		path: EMPTY,
		enter(containerId) {
			set((state) => ({ path: [...state.path, containerId] }));
		},
		exitOne() {
			const { path } = get();
			if (path.length === 0) return false;
			set({ path: path.slice(0, -1) });
			return true;
		},
		exitAll() {
			if (get().path.length > 0) set({ path: EMPTY });
		},
		setPath(path) {
			set({ path });
		},
	}));
}
