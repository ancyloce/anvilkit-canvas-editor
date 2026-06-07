"use client";

import { Button } from "@anvilkit/ui/button";
import { Input } from "@anvilkit/ui/input";
import { cn } from "@anvilkit/ui/lib/utils";
import { type ReactNode, useEffect, useState } from "react";
import { useCanvasT } from "../../context/canvas-studio-context.js";
import type {
	CanvasPanelDescriptor,
	CanvasPanelRegistry,
	RemotePanelDescriptor,
	SearchPanelDescriptor,
} from "../panel-registry.js";
import { useActiveDock, usePanelSearch } from "../state/hooks.js";

export interface TabPanelProps {
	/** Resolves the active dock id to a panel descriptor. */
	registry: CanvasPanelRegistry;
	className?: string;
}

/**
 * Tab Panel (Aside, col 2). Renders the registry descriptor for the active
 * dock id, with an optional search box, and dispatches by descriptor kind
 * (built-in / plugin / remote / search). Search resets when the dock changes
 * so each panel opens fresh.
 */
export function TabPanel({
	registry,
	className,
}: TabPanelProps): React.JSX.Element {
	const [activeDockId] = useActiveDock();
	const [search, setSearch] = usePanelSearch();
	const t = useCanvasT();
	const descriptor = registry[activeDockId];
	const panelFallback = t("canvas.tabpanel.panel", "Panel");
	const title = descriptor
		? descriptor.titleKey
			? t(descriptor.titleKey, descriptor.title)
			: descriptor.title
		: panelFallback;

	// Reset the shared search query when switching panels. `setSearch` is a
	// stable zustand action, so `activeDockId` is what actually re-fires this
	// on each dock switch — without it the reset would only run once on mount.
	useEffect(() => {
		setSearch("");
	}, [activeDockId, setSearch]);

	const searchable =
		descriptor?.kind === "search" ||
		((descriptor?.kind === "builtin" || descriptor?.kind === "remote") &&
			descriptor.searchable === true);

	return (
		<section
			data-testid="tab-panel"
			aria-label={title}
			className={cn(
				"flex h-full min-h-0 flex-col overflow-hidden border-r border-border bg-card",
				className,
			)}
		>
			<div className="flex h-11 shrink-0 items-center border-b border-border px-3.5">
				<span className="truncate text-sm font-semibold text-foreground">
					{title}
				</span>
			</div>
			{searchable ? (
				<div className="shrink-0 p-2">
					<Input
						type="search"
						aria-label={t("canvas.tabpanel.searchLabel", "Search panel")}
						placeholder={t("canvas.tabpanel.searchPlaceholder", "Search…")}
						value={search}
						data-testid="tab-panel-search"
						className="h-8 text-xs"
						onChange={(e) => setSearch(e.currentTarget.value)}
					/>
				</div>
			) : null}
			<div className="min-h-0 flex-1 overflow-y-auto">
				<PanelBody descriptor={descriptor} search={search} />
			</div>
		</section>
	);
}

function PanelBody({
	descriptor,
	search,
}: {
	descriptor: CanvasPanelDescriptor | undefined;
	search: string;
}): ReactNode {
	const t = useCanvasT();
	if (!descriptor) {
		return (
			<div
				className="p-4 text-xs text-muted-foreground italic"
				data-testid="tab-panel-empty"
			>
				{t("canvas.tabpanel.noPanel", "No panel registered.")}
			</div>
		);
	}
	switch (descriptor.kind) {
		case "builtin":
			return descriptor.render({ search });
		case "plugin":
			return descriptor.slot;
		case "search":
			return <SearchPanelBody descriptor={descriptor} search={search} />;
		case "remote":
			return <RemotePanelBody descriptor={descriptor} search={search} />;
	}
}

function SearchPanelBody({
	descriptor,
	search,
}: {
	descriptor: SearchPanelDescriptor;
	search: string;
}): React.JSX.Element {
	const t = useCanvasT();
	const categories = descriptor.categories ?? [];
	const [category, setCategory] = useState<string>(categories[0] ?? "all");
	return (
		<div className="flex flex-col gap-2">
			{categories.length > 0 ? (
				<div
					className="flex flex-wrap gap-1 p-2"
					role="tablist"
					aria-label={t("canvas.tabpanel.categories", "Categories")}
					data-testid="tab-panel-categories"
				>
					{categories.map((c) => (
						<Button
							key={c}
							type="button"
							size="xs"
							variant={c === category ? "secondary" : "ghost"}
							role="tab"
							aria-selected={c === category}
							onClick={() => setCategory(c)}
						>
							{c}
						</Button>
					))}
				</div>
			) : null}
			{descriptor.render({ search, category })}
		</div>
	);
}

type RemoteStatus =
	| { readonly status: "loading" }
	| { readonly status: "error" }
	| { readonly status: "ready"; readonly data: unknown };

function RemotePanelBody({
	descriptor,
	search,
}: {
	descriptor: RemotePanelDescriptor;
	search: string;
}): React.JSX.Element {
	const t = useCanvasT();
	const [state, setState] = useState<RemoteStatus>({ status: "loading" });

	useEffect(() => {
		let cancelled = false;
		setState({ status: "loading" });
		descriptor
			.load({ search })
			.then((data) => {
				if (!cancelled) setState({ status: "ready", data });
			})
			.catch(() => {
				if (!cancelled) setState({ status: "error" });
			});
		return () => {
			cancelled = true;
		};
	}, [descriptor, search]);

	if (state.status === "loading") {
		return (
			<div
				className="p-4 text-xs text-muted-foreground"
				data-testid="tab-panel-loading"
			>
				{t("canvas.tabpanel.loading", "Loading…")}
			</div>
		);
	}
	if (state.status === "error") {
		return (
			<div
				className="p-4 text-xs text-destructive"
				data-testid="tab-panel-error"
			>
				{t("canvas.tabpanel.failed", "Failed to load.")}
			</div>
		);
	}
	if (descriptor.isEmpty?.(state.data)) {
		return (
			<div
				className="p-4 text-xs text-muted-foreground italic"
				data-testid="tab-panel-remote-empty"
			>
				{t("canvas.tabpanel.nothingYet", "Nothing here yet.")}
			</div>
		);
	}
	return <>{descriptor.render(state.data, { search })}</>;
}
