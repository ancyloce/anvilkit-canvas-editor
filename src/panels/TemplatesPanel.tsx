"use client";

/**
 * @file Templates dock panel (canvas-m0-009 / FR-005 minimal scope).
 *
 * Lists the host-supplied template catalog (`CanvasStudioProps.templates`) and
 * loads a template into the current document after an inline confirmation.
 * The load replaces every page as ONE undo entry (see `template-actions.ts`).
 * Previews are deterministic placeholders — a page-aspect swatch — until the
 * FR-023 panel upgrade (Milestone 2) adds real thumbnails, categories, and
 * search.
 */

import { Button } from "@anvilkit/ui/button";
import { useState } from "react";
import {
	useCanvasStudio,
	useCanvasT,
} from "../context/canvas-studio-context.js";
import type { CanvasTemplateEntry } from "../templates/template-entry.js";
import { loadTemplate } from "./template-actions.js";

function sizeCaption(entry: CanvasTemplateEntry): string {
	const size = entry.ir.pages[0]?.size;
	if (!size) return "";
	const unit = size.unit === "px" ? "" : size.unit;
	return `${size.width}×${size.height}${unit}`;
}

/** Deterministic placeholder: a neutral swatch with the page's aspect ratio. */
function PreviewPlaceholder({
	entry,
}: {
	entry: CanvasTemplateEntry;
}): React.JSX.Element {
	const size = entry.ir.pages[0]?.size;
	const ratio = size ? size.width / size.height : 1;
	return (
		<div
			aria-hidden
			data-testid={`template-preview-${entry.slug}`}
			className="mx-auto max-h-24 rounded-sm border border-border bg-muted"
			style={{
				aspectRatio: `${ratio}`,
				width: ratio >= 1 ? "100%" : "auto",
				height: ratio >= 1 ? "auto" : "6rem",
			}}
		/>
	);
}

export function TemplatesPanel(): React.JSX.Element {
	const ctx = useCanvasStudio();
	const t = useCanvasT();
	const [pendingSlug, setPendingSlug] = useState<string | null>(null);
	const templates = ctx.templates ?? [];

	if (templates.length === 0) {
		return (
			<div
				data-testid="templates-panel-empty"
				className="p-4 text-xs text-muted-foreground italic"
			>
				{t("canvas.templates.empty", "No templates provided by the host.")}
			</div>
		);
	}

	return (
		<div data-testid="templates-panel" className="flex flex-col gap-2 p-2">
			{templates.map((entry) => {
				const pending = pendingSlug === entry.slug;
				return (
					<div
						key={entry.slug}
						className="rounded-md border border-border bg-background p-2"
					>
						<button
							type="button"
							data-testid={`template-item-${entry.slug}`}
							className="w-full text-left"
							onClick={() => setPendingSlug(pending ? null : entry.slug)}
						>
							<PreviewPlaceholder entry={entry} />
							<div className="mt-2 text-xs font-medium">{entry.name}</div>
							{entry.description ? (
								<div className="mt-0.5 text-[11px] text-muted-foreground">
									{entry.description}
								</div>
							) : null}
							<div className="mt-0.5 text-[11px] text-muted-foreground">
								{sizeCaption(entry)}
							</div>
						</button>
						{pending ? (
							<div
								data-testid={`template-confirm-${entry.slug}`}
								className="mt-2 flex flex-col gap-1.5"
							>
								<div className="text-[11px] text-muted-foreground">
									{t(
										"canvas.templates.confirmBody",
										"Loading a template replaces every page. This can be undone.",
									)}
								</div>
								<div className="flex gap-1.5">
									<Button
										size="sm"
										data-testid={`template-load-${entry.slug}`}
										onClick={() => {
											loadTemplate(ctx, entry);
											setPendingSlug(null);
										}}
									>
										{t("canvas.templates.replace", "Replace")}
									</Button>
									<Button
										size="sm"
										variant="outline"
										onClick={() => setPendingSlug(null)}
									>
										{t("canvas.templates.cancel", "Cancel")}
									</Button>
								</div>
							</div>
						) : null}
					</div>
				);
			})}
		</div>
	);
}
