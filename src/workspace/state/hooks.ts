"use client";

/**
 * @file Selector hooks for the Canva-shell UI store.
 *
 * `useWorkspaceUiStore` is the generic selector entrypoint; the named
 * shortcuts return a `[value, setter]` tuple so consumers wire them like
 * `useState` (matching `studio/state/hooks.ts`).
 */

import { useStore } from "zustand";
import type { DockId } from "../dock-ids.js";
import { useWorkspaceUiStoreApi } from "./WorkspaceUiStoreProvider.js";
import type { WorkspaceUiState } from "./workspace-ui-store.js";

export function useWorkspaceUiStore<TResult>(
	selector: (state: WorkspaceUiState) => TResult,
): TResult {
	const store = useWorkspaceUiStoreApi();
	return useStore(store, selector);
}

export function useActiveDock(): readonly [DockId, (id: DockId) => void] {
	const value = useWorkspaceUiStore((s) => s.activeDockId);
	const set = useWorkspaceUiStore((s) => s.setActiveDockId);
	return [value, set];
}

export function useInspectorCollapsed(): readonly [
	boolean,
	(collapsed: boolean) => void,
] {
	const value = useWorkspaceUiStore((s) => s.inspectorCollapsed);
	const set = useWorkspaceUiStore((s) => s.setInspectorCollapsed);
	return [value, set];
}

export function usePanelSearch(): readonly [string, (query: string) => void] {
	const value = useWorkspaceUiStore((s) => s.panelSearch);
	const set = useWorkspaceUiStore((s) => s.setPanelSearch);
	return [value, set];
}

export function usePanelWidth(): readonly [number, (width: number) => void] {
	const value = useWorkspaceUiStore((s) => s.panelWidth);
	const set = useWorkspaceUiStore((s) => s.setPanelWidth);
	return [value, set];
}

export function useRestoreLayout(): () => void {
	return useWorkspaceUiStore((s) => s.restoreLayout);
}

export function usePanelOpen(): readonly [boolean, (open: boolean) => void] {
	const value = useWorkspaceUiStore((s) => s.panelOpen);
	const set = useWorkspaceUiStore((s) => s.setPanelOpen);
	return [value, set];
}
