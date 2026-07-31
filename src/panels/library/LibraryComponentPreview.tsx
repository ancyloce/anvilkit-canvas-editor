"use client";

import { sanitizeProviderUrl } from "@anvilkit/canvas-core/component-libraries";
import { cn } from "@anvilkit/ui/lib/utils";
import * as React from "react";

import type { CanvasComponentCatalogEntry } from "../../component-libraries/component-provider.js";
import type { CanvasT } from "../../context/canvas-studio-context.js";
import { VersionBadge } from "./VersionBadge.js";

/**
 * @file One row in the Libraries source (plan 0021 T-020).
 *
 * ## Every Provider-supplied URL is sanitized before it reaches the DOM
 *
 * `thumbnailUrl` comes from a remote catalog — untrusted input rendered into an
 * attribute. `sanitizeProviderUrl` (M0/T-009) allows only `http:`/`https:`, so a
 * `javascript:` or `data:` URL becomes `undefined` and the thumbnail is simply
 * not rendered. Doing it here, at the render boundary, rather than trusting an
 * earlier layer, is what makes the guarantee local and checkable.
 */
export function LibraryComponentPreview({
	entry,
	onInsert,
	disabled = false,
	t,
}: {
	entry: CanvasComponentCatalogEntry;
	onInsert: (entry: CanvasComponentCatalogEntry) => void;
	disabled?: boolean;
	t: CanvasT;
}): React.JSX.Element {
	const thumbnail =
		entry.thumbnailUrl === undefined
			? undefined
			: sanitizeProviderUrl(entry.thumbnailUrl);
	const subtitleParts = [entry.brandName, entry.libraryName].filter(
		(part): part is string => typeof part === "string" && part.length > 0,
	);

	return (
		<div role="listitem" className="px-1 py-0.5">
			<button
				type="button"
				disabled={disabled}
				onClick={() => onInsert(entry)}
				data-testid={`library-row-${entry.ref.componentId}`}
				className={cn(
					"flex w-full items-center gap-2 rounded px-2 py-1.5 text-left",
					"hover:bg-accent focus-visible:outline-none focus-visible:ring-2",
					"disabled:cursor-not-allowed disabled:opacity-50",
				)}
				// The accessible name carries what the visual row conveys through
				// layout — name, version, and owner — so a screen-reader user is not
				// told only "button".
				aria-label={t(
					"canvas.libraries.insertLabel",
					"Insert {name} ({version})",
				)
					.replace("{name}", entry.name)
					.replace("{version}", entry.ref.version)}
			>
				{thumbnail ? (
					<img
						src={thumbnail}
						alt=""
						aria-hidden="true"
						loading="lazy"
						className="size-8 shrink-0 rounded border object-cover"
						data-testid="library-thumbnail"
					/>
				) : (
					<span
						aria-hidden="true"
						className="size-8 shrink-0 rounded border bg-muted"
						data-testid="library-thumbnail-placeholder"
					/>
				)}
				<span className="flex min-w-0 flex-1 flex-col">
					<span className="truncate text-xs">{entry.name}</span>
					{subtitleParts.length > 0 ? (
						<span className="truncate text-[10px] text-muted-foreground">
							{subtitleParts.join(" · ")}
						</span>
					) : null}
				</span>
				<VersionBadge
					version={entry.ref.version}
					deprecationNotice={entry.deprecationNotice}
					t={t}
				/>
			</button>
		</div>
	);
}
