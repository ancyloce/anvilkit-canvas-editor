"use client";

import { Button } from "@anvilkit/ui/button";
import { cn } from "@anvilkit/ui/lib/utils";
import { Windowed } from "@anvilkit/ui/windowed";
import * as React from "react";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";

import type {
	CanvasComponentCatalogEntry,
	CanvasComponentProvider,
} from "../component-libraries/component-provider.js";
import {
	type CanvasProviderFailureStatus,
	providerStatusMessageKey,
} from "../component-libraries/provider-errors.js";
import {
	type CanvasProviderRequestStoreApi,
	createProviderRequestStore,
} from "../component-libraries/provider-request-store.js";
import { type CanvasT, useCanvasT } from "../context/canvas-studio-context.js";
import { LibraryComponentPreview } from "./library/LibraryComponentPreview.js";

/**
 * @file The Libraries source of the Components panel (plan 0021 T-020).
 *
 * Renders provider-backed search results. It owns NO document state: inserting
 * is delegated upward through `onInsert`, so the panel stays a pure view over
 * the request store and the insert transaction lives in one place (T-022).
 *
 * ## Every provider state gets its own presentation
 *
 * The eight states from `provider-errors.ts` are rendered distinctly and each
 * failure carries a retry affordance. Collapsing them into one "couldn't load"
 * would tell a user whose token expired to check their connection.
 */

const ROW_HEIGHT = 44;
/** Below this, plain DOM: a virtualizer needs a laid-out scroll container. */
const VIRTUALIZE_THRESHOLD = 30;

export interface LibrariesPanelProps {
	provider: CanvasComponentProvider;
	search?: string;
	onInsert: (entry: CanvasComponentCatalogEntry) => void;
	/** Injected in tests; production mounts create their own. */
	store?: CanvasProviderRequestStoreApi;
	insertDisabled?: boolean;
	className?: string;
}

function StateMessage({
	testId,
	message,
	action,
}: {
	testId: string;
	message: string;
	action?: React.ReactNode;
}): React.JSX.Element {
	return (
		<div
			className="flex flex-col items-start gap-2 px-2 py-3"
			data-testid={testId}
			// Announced politely: results arriving is not urgent enough to
			// interrupt, but a user who cannot see the list still needs to know
			// the search resolved.
			role="status"
			aria-live="polite"
		>
			<span className="text-xs text-muted-foreground">{message}</span>
			{action}
		</div>
	);
}

export function LibrariesPanel({
	provider,
	search = "",
	onInsert,
	store: injectedStore,
	insertDisabled = false,
	className,
}: LibrariesPanelProps): React.JSX.Element {
	const t: CanvasT = useCanvasT();
	const storeRef = useRef<CanvasProviderRequestStoreApi | undefined>(undefined);
	if (!storeRef.current) {
		storeRef.current = injectedStore ?? createProviderRequestStore();
	}
	const store = storeRef.current;

	const state = useSyncExternalStore(
		store.subscribe,
		() => store.getState(),
		() => store.getState(),
	);

	const query = useMemo(
		() => (search.trim() ? { text: search.trim() } : {}),
		[search],
	);

	useEffect(() => {
		void store.getState().search(provider, query);
		// Abort whatever is in flight when the panel unmounts or the provider is
		// swapped, so a response cannot land against a dead component.
		return () => store.getState().reset();
	}, [store, provider, query]);

	const retry = (
		<Button
			size="sm"
			variant="outline"
			data-testid="libraries-retry"
			onClick={() => void store.getState().search(provider, query)}
		>
			{t("canvas.libraries.retry", "Try again")}
		</Button>
	);

	const body = (): React.JSX.Element => {
		switch (state.status) {
			case "idle":
			case "loading":
				return (
					<StateMessage
						testId="libraries-loading"
						message={t("canvas.libraries.loading", "Loading components…")}
					/>
				);
			case "empty":
				return (
					<StateMessage
						testId="libraries-empty"
						message={
							search.trim()
								? t(
										"canvas.libraries.noMatch",
										"No components match “{search}”.",
									).replace("{search}", search.trim())
								: t("canvas.libraries.none", "No components available.")
						}
					/>
				);
			case "offline":
			case "unauthorized":
			case "rate-limited":
			case "error":
				return (
					<StateMessage
						testId={`libraries-${state.status}`}
						message={t(
							providerStatusMessageKey(
								state.status as CanvasProviderFailureStatus,
							),
							"Couldn’t load components.",
						)}
						action={retry}
					/>
				);
			case "ready": {
				const renderRow = (
					entry: CanvasComponentCatalogEntry,
				): React.JSX.Element => (
					<LibraryComponentPreview
						entry={entry}
						onInsert={onInsert}
						disabled={insertDisabled}
						t={t}
					/>
				);
				return (
					<div
						role="list"
						aria-label={t("canvas.libraries.results", "Library components")}
						className="min-h-0 flex-1"
						data-testid="libraries-results"
					>
						{state.entries.length > VIRTUALIZE_THRESHOLD ? (
							<Windowed
								items={state.entries as CanvasComponentCatalogEntry[]}
								renderItem={renderRow}
								itemKey={(entry) =>
									`${entry.ref.libraryId}/${entry.ref.componentId}/${entry.ref.version}`
								}
								estimateSize={ROW_HEIGHT}
								maxHeight={600}
								data-testid="library-rows"
							/>
						) : (
							state.entries.map((entry) => (
								<div
									key={`${entry.ref.libraryId}/${entry.ref.componentId}/${entry.ref.version}`}
								>
									{renderRow(entry)}
								</div>
							))
						)}
						{state.nextCursor !== undefined ? (
							<div className="px-2 py-2">
								<Button
									size="sm"
									variant="outline"
									disabled={state.loadingMore}
									data-testid="libraries-load-more"
									onClick={() => void store.getState().loadMore(provider)}
								>
									{state.loadingMore
										? t("canvas.libraries.loadingMore", "Loading…")
										: t("canvas.libraries.loadMore", "Load more")}
								</Button>
							</div>
						) : null}
					</div>
				);
			}
		}
	};

	return (
		<div
			data-testid="libraries-panel"
			className={cn("flex min-h-0 flex-col", className)}
		>
			{body()}
		</div>
	);
}
