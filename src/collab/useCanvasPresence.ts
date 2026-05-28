"use client";

import { createContext, use, useMemo, useSyncExternalStore } from "react";
import type {
	CanvasBindingUnsubscribe,
	CanvasPresenceState,
} from "./presence-types.js";

/**
 * The minimal shape `useCanvasPresence` consumes — satisfied by a
 * {@link CanvasYjsBinding}'s `presence` bridge, or any fake in tests. Declared
 * structurally so this module imports NO yjs: the `/collab` React seam stays
 * free of the CRDT runtime.
 */
export interface CanvasPresenceSource {
	onPeerChange(
		callback: (peers: readonly CanvasPresenceState[]) => void,
	): CanvasBindingUnsubscribe;
}

export const CanvasPresenceContext = createContext<CanvasPresenceSource | null>(
	null,
);

const EMPTY: readonly CanvasPresenceState[] = [];

/**
 * Subscribe to validated remote peer presence (cursors / selections) from the
 * nearest {@link CanvasPresenceContext}. Returns `[]` when no provider is
 * mounted. This is the data seam for the deferred collab UI (I3-1): the
 * presence layer (`<RemoteCursors>` / `<RemoteSelections>`) can read it once
 * cursor/selection rendering ships, without changing the binding.
 */
export function useCanvasPresence(): readonly CanvasPresenceState[] {
	const source = use(CanvasPresenceContext);
	const store = useMemo(() => {
		let snapshot: readonly CanvasPresenceState[] = EMPTY;
		const listeners = new Set<() => void>();
		let unsubscribe: CanvasBindingUnsubscribe | undefined;
		return {
			subscribe(onStoreChange: () => void): () => void {
				listeners.add(onStoreChange);
				if (!unsubscribe && source) {
					// onPeerChange fires immediately with the current set, then on
					// every change — each call hands back a fresh array, so the
					// snapshot reference changes and React re-renders.
					unsubscribe = source.onPeerChange((peers) => {
						snapshot = peers;
						for (const listener of listeners) listener();
					});
				}
				return () => {
					listeners.delete(onStoreChange);
					if (listeners.size === 0 && unsubscribe) {
						unsubscribe();
						unsubscribe = undefined;
					}
				};
			},
			getSnapshot: (): readonly CanvasPresenceState[] => snapshot,
		};
	}, [source]);

	return useSyncExternalStore(
		store.subscribe,
		store.getSnapshot,
		store.getSnapshot,
	);
}
