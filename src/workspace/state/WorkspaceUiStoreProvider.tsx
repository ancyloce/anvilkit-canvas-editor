"use client";

/**
 * @file React context provider for the per-instance Canva-shell UI store.
 *
 * Owns one {@link WorkspaceUiStoreApi} per `<CanvasWorkspace>` mount. The
 * canvas editor is client-only (`ssr: false`), so the store's `persist`
 * middleware auto-hydrates from `localStorage` at creation — the provider just
 * supplies it via context (cf. core's SSR-gated `EditorUiStoreProvider`).
 */

import * as React from "react";
import {
	createContext,
	type ReactNode,
	use,
	useMemo,
	useState,
	useSyncExternalStore,
} from "react";
import {
	type RecentFonts,
	RecentFontsContext,
} from "../../context/recent-fonts-context.js";
import {
	type RecentTemplates,
	RecentTemplatesContext,
} from "../../context/recent-templates-context.js";
import {
	type CanvasWorkspaceState,
	createWorkspaceUiStore,
	type WorkspaceUiStoreApi,
} from "./workspace-ui-store.js";

const WorkspaceUiStoreContext = createContext<WorkspaceUiStoreApi | null>(null);

export interface WorkspaceUiStoreProviderProps {
	/** Namespaces the persisted slice (`anvilkit-canvas-workspace-${storeId}`). */
	readonly storeId: string;
	/** PRD §11.1 seed — see `createWorkspaceUiStore`'s
	 * `CreateWorkspaceUiStoreOptions.initialWorkspaceState` for the full
	 * precedence rule against a persisted value. Read only on first render,
	 * like `storeId`. */
	readonly initialWorkspaceState?: Partial<CanvasWorkspaceState>;
	readonly children: ReactNode;
}

export function WorkspaceUiStoreProvider({
	storeId,
	initialWorkspaceState,
	children,
}: WorkspaceUiStoreProviderProps): React.JSX.Element {
	// Lazy-create once per mount. `storeId`/`initialWorkspaceState` are read
	// only on first render; hosts that need to re-target should re-key the
	// provider (`key={storeId}`).
	const [store] = useState(() =>
		createWorkspaceUiStore({ storeId, initialWorkspaceState }),
	);
	return (
		<WorkspaceUiStoreContext value={store}>{children}</WorkspaceUiStoreContext>
	);
}

/**
 * Internal accessor for the active store. Throws if used outside a
 * `WorkspaceUiStoreProvider` so missing wiring fails loudly in development.
 */
export function useWorkspaceUiStoreApi(): WorkspaceUiStoreApi {
	const store = use(WorkspaceUiStoreContext);
	if (store === null) {
		throw new Error(
			"useWorkspaceUiStore was called outside of <WorkspaceUiStoreProvider>. " +
				"Ensure the calling component is rendered inside <CanvasWorkspace>.",
		);
	}
	return store;
}

/**
 * Bridges the persisted UI store's recents slice (C-06) into the low-layer
 * {@link RecentTemplatesContext} so `panels/` never imports `workspace/`.
 * Mounted by `<CanvasWorkspace>` inside this provider.
 */
export function RecentTemplatesBridge({
	children,
}: {
	children: ReactNode;
}): React.JSX.Element {
	const store = useWorkspaceUiStoreApi();
	const ids = useSyncExternalStore(
		store.subscribe,
		() => store.getState().recentTemplateIds,
		() => store.getState().recentTemplateIds,
	);
	const value = useMemo<RecentTemplates>(
		() => ({ ids, add: (id) => store.getState().addRecentTemplate(id) }),
		[ids, store],
	);
	return (
		<RecentTemplatesContext value={value}>{children}</RecentTemplatesContext>
	);
}

/**
 * The font counterpart of {@link RecentTemplatesBridge} (`cp2-005`): bridges
 * the persisted UI store's `recentFontFamilies` slice into
 * {@link RecentFontsContext} so `panels/` never imports `workspace/`. Mounted
 * by `<CanvasWorkspace>` inside this provider, beside the templates bridge.
 *
 * A SEPARATE bridge rather than one that provides both contexts: the two
 * recents lists are independent slices with independent consumers, and folding
 * them into a single provider would re-render the templates consumer on every
 * font pick (and vice versa) for no benefit.
 */
export function RecentFontsBridge({
	children,
}: {
	children: ReactNode;
}): React.JSX.Element {
	const store = useWorkspaceUiStoreApi();
	const families = useSyncExternalStore(
		store.subscribe,
		() => store.getState().recentFontFamilies,
		() => store.getState().recentFontFamilies,
	);
	const value = useMemo<RecentFonts>(
		() => ({
			families,
			add: (family) => store.getState().addRecentFont(family),
		}),
		[families, store],
	);
	return <RecentFontsContext value={value}>{children}</RecentFontsContext>;
}
