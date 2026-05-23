"use client";

/**
 * @file React context provider for the per-instance Canva-shell UI store.
 *
 * Owns one {@link WorkspaceUiStoreApi} per `<CanvasWorkspace>` mount. The
 * canvas editor is client-only (`ssr: false`), so the store's `persist`
 * middleware auto-hydrates from `localStorage` at creation — the provider just
 * supplies it via context (cf. core's SSR-gated `EditorUiStoreProvider`).
 */

import { createContext, type ReactNode, useContext, useState } from "react";
import {
	createWorkspaceUiStore,
	type WorkspaceUiStoreApi,
} from "./workspace-ui-store.js";

const WorkspaceUiStoreContext = createContext<WorkspaceUiStoreApi | null>(null);

export interface WorkspaceUiStoreProviderProps {
	/** Namespaces the persisted slice (`anvilkit-canvas-workspace-${storeId}`). */
	readonly storeId: string;
	readonly children: ReactNode;
}

export function WorkspaceUiStoreProvider({
	storeId,
	children,
}: WorkspaceUiStoreProviderProps): React.JSX.Element {
	// Lazy-create once per mount. `storeId` is read only on first render; hosts
	// that need to re-target should re-key the provider (`key={storeId}`).
	const [store] = useState(() => createWorkspaceUiStore({ storeId }));
	return (
		<WorkspaceUiStoreContext.Provider value={store}>
			{children}
		</WorkspaceUiStoreContext.Provider>
	);
}

/**
 * Internal accessor for the active store. Throws if used outside a
 * `WorkspaceUiStoreProvider` so missing wiring fails loudly in development.
 */
export function useWorkspaceUiStoreApi(): WorkspaceUiStoreApi {
	const store = useContext(WorkspaceUiStoreContext);
	if (store === null) {
		throw new Error(
			"useWorkspaceUiStore was called outside of <WorkspaceUiStoreProvider>. " +
				"Ensure the calling component is rendered inside <CanvasWorkspace>.",
		);
	}
	return store;
}
