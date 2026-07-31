"use client";

import { cn } from "@anvilkit/ui/lib/utils";
import * as React from "react";
import { useState } from "react";

import type { CanvasComponentCatalogEntry } from "../../component-libraries/component-provider.js";
import { useExternalComponent } from "../../component-libraries/use-external-component.js";
import {
	useCanvasStudio,
	useCanvasT,
} from "../../context/canvas-studio-context.js";
import { useCanvasToaster } from "../../context/toast-context.js";
import { ComponentsPanel } from "../ComponentsPanel.js";
import { LibrariesPanel } from "../LibrariesPanel.js";

/**
 * @file Local / Libraries source switch for the Components dock (plan 0021 T-020).
 *
 * ## Why this wraps rather than edits `ComponentsPanel`
 *
 * The plan says "add Local and Libraries sources to the Components panel". This
 * is that, done as composition: the dock renders the switcher, which renders
 * either the untouched local panel or the Libraries view. `ComponentsPanel.tsx`
 * is 570 lines and under active concurrent edit; threading a source mode through
 * its several early-return branches would have been a large, conflict-prone
 * change for no behavioural gain.
 *
 * It is also NOT a new dock id: `DOCK_IDS` is a closed union backing persisted
 * workspace state, and adding a member would need a state migration in both
 * directions for a tab that is one panel's internal mode.
 *
 * ## Degrading to a single source
 *
 * With no Provider, or with the `externalComponents` flag off, the tab strip is
 * not rendered at all and the local panel shows exactly as it does today —
 * rather than a disabled tab advertising a feature the host has not wired.
 */

type ComponentSource = "local" | "libraries";

export function ComponentsSourceSwitcher({
	search = "",
	className,
	onInsertExternal,
}: {
	search?: string;
	className?: string;
	/**
	 * Override the insert handler. Production leaves it unset and the switcher
	 * uses {@link useExternalComponent}; tests pass one to observe the call
	 * without standing up a Provider and a verifier.
	 */
	onInsertExternal?: (entry: CanvasComponentCatalogEntry) => void;
}): React.JSX.Element {
	const ctx = useCanvasStudio();
	const t = useCanvasT();
	const toaster = useCanvasToaster();
	const { insert } = useExternalComponent();
	const [source, setSource] = useState<ComponentSource>("local");

	// A failed insert must say WHY and must not have changed the document — the
	// orchestration guarantees the second half, this reports the first.
	const handleInsert =
		onInsertExternal ??
		((entry: CanvasComponentCatalogEntry) => {
			void insert(entry).then((result) => {
				// An abort is the user changing their mind, not a failure to report.
				if (result.ok || result.reason === "aborted") return;
				toaster.add({
					type: "warning",
					title: t(result.messageKey, "Couldn’t insert this component."),
				});
			});
		});

	const provider = ctx.componentProvider;
	const librariesAvailable =
		provider !== undefined && ctx.externalComponentsEnabled === true;

	if (!librariesAvailable) {
		return <ComponentsPanel search={search} className={className} />;
	}

	const tab = (id: ComponentSource, label: string) => (
		<button
			type="button"
			role="tab"
			aria-selected={source === id}
			data-testid={`components-source-${id}`}
			onClick={() => setSource(id)}
			className={cn(
				"flex-1 rounded px-2 py-1 text-xs",
				source === id
					? "bg-accent text-accent-foreground"
					: "text-muted-foreground hover:bg-accent/50",
			)}
		>
			{label}
		</button>
	);

	return (
		<div
			className={cn("flex min-h-0 flex-col gap-1", className)}
			data-testid="components-source-switcher"
		>
			<div
				role="tablist"
				aria-label={t("canvas.libraries.sourceLabel", "Component source")}
				className="flex gap-1 px-1.5 pt-1.5"
			>
				{tab("local", t("canvas.libraries.sourceLocal", "This document"))}
				{tab("libraries", t("canvas.libraries.sourceLibraries", "Libraries"))}
			</div>
			<div className="min-h-0 flex-1">
				{source === "local" ? (
					<ComponentsPanel search={search} />
				) : (
					<LibrariesPanel
						provider={provider}
						search={search}
						onInsert={handleInsert}
					/>
				)}
			</div>
		</div>
	);
}
