import type { CanvasIR } from "@anvilkit/canvas-core";
import { createStore, type StoreApi } from "zustand/vanilla";

/**
 * Owns the canvas scene — the live {@link CanvasIR} document. This is the
 * single source of truth for the IR: `<CanvasStudio>` reads it reactively via
 * `useSyncExternalStore` and exposes it through the context as `getIR()` /
 * `commit()` / `ir`. Committed mutations land here through `setIR(...)` after
 * `historyStore.commit(...)` produces the next IR.
 *
 * Splitting the IR into its own store (rather than a `useState`/`useRef` pair)
 * gives the Yjs collab prototype (I3-1) a real store to bind: the binding
 * subscribes here for local → remote pushes and calls `setIR(...)` to apply
 * remote → local updates without routing through the undo stack.
 */
export interface SceneState {
	ir: CanvasIR;
	setIR: (ir: CanvasIR) => void;
}

export type SceneStoreApi = StoreApi<SceneState>;

export interface CreateSceneStoreOptions {
	initialIR: CanvasIR;
}

export function createSceneStore(
	options: CreateSceneStoreOptions,
): SceneStoreApi {
	return createStore<SceneState>()((set) => ({
		ir: options.initialIR,
		setIR(ir) {
			set({ ir });
		},
	}));
}
