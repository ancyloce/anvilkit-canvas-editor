"use client";

/**
 * @file Templates dock panel (canvas-m0-009 / FR-005 minimal scope, upgraded
 * to the full FR-023 product surface in canvas-m2-004).
 *
 * Lists the host-supplied template catalog (`CanvasStudioProps.templates`),
 * filterable by category and a free-text search across title/description/tags,
 * and instantiates a template into the current document — either replacing
 * every page (one undo entry) or inserted as new pages alongside the existing
 * ones (also one undo entry). Preview is a real thumbnail when a template
 * resolves a `previewAssetId` against its own `document.assets`, else a
 * deterministic aspect-ratio placeholder — never blank.
 */

import type { InstantiateTemplateWarning } from "@anvilkit/canvas-core";
import { Button } from "@anvilkit/ui/button";
import { Input } from "@anvilkit/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@anvilkit/ui/select";
import { useMemo, useState } from "react";
import {
	type CanvasT,
	useCanvasStudio,
	useCanvasT,
} from "../context/canvas-studio-context.js";
import type { CanvasTemplateEntry } from "../templates/template-entry.js";
import {
	insertTemplateAsNewPages,
	loadTemplate,
	type TemplateActionResult,
} from "./template-actions.js";

const ALL_CATEGORIES = "all";

// Stable fallback for hosts that pass no catalog, so the `categories`/
// `filtered` memos don't recompute on a fresh `[]` identity every render.
const NO_TEMPLATES: readonly CanvasTemplateEntry[] = [];

function sizeCaption(entry: CanvasTemplateEntry): string {
	const size = entry.document.pages[0]?.size;
	if (!size) return "";
	const unit = size.unit === "px" ? "" : size.unit;
	return `${size.width}×${size.height}${unit}`;
}

function matchesSearch(entry: CanvasTemplateEntry, query: string): boolean {
	if (!query) return true;
	const haystack = [entry.title, entry.description ?? "", ...entry.tags]
		.join(" ")
		.toLowerCase();
	return haystack.includes(query);
}

function warningMessage(
	t: CanvasT,
	warning: InstantiateTemplateWarning,
): string {
	switch (warning.code) {
		case "required-variable-missing":
			return t(
				"canvas.templates.warningRequiredMissing",
				"A required value was left blank.",
			);
		case "variable-slot-not-found":
		case "slot-node-not-found":
			return t(
				"canvas.templates.warningSlotMissing",
				"A template value could not be applied.",
			);
		default:
			return t(
				"canvas.templates.warningUnsupported",
				"A template value could not be applied to this element.",
			);
	}
}

/** A real thumbnail when the template resolves one, else a deterministic aspect-ratio swatch. */
function TemplatePreview({
	entry,
}: {
	entry: CanvasTemplateEntry;
}): React.JSX.Element {
	const size = entry.document.pages[0]?.size;
	const ratio = size ? size.width / size.height : 1;
	const style: React.CSSProperties = {
		aspectRatio: `${ratio}`,
		width: ratio >= 1 ? "100%" : "auto",
		height: ratio >= 1 ? "auto" : "6rem",
	};
	const previewUri = entry.previewAssetId
		? entry.document.assets[entry.previewAssetId]?.uri
		: undefined;

	if (previewUri) {
		return (
			<img
				aria-hidden
				data-testid={`template-preview-${entry.id}`}
				src={previewUri}
				alt=""
				className="mx-auto max-h-24 rounded-sm border border-border object-cover"
				style={style}
			/>
		);
	}
	return (
		<div
			aria-hidden
			data-testid={`template-preview-${entry.id}`}
			className="mx-auto max-h-24 rounded-sm border border-border bg-muted"
			style={style}
		/>
	);
}

export function TemplatesPanel(): React.JSX.Element {
	const ctx = useCanvasStudio();
	const t = useCanvasT();
	const [pendingId, setPendingId] = useState<string | null>(null);
	const [category, setCategory] = useState<string>(ALL_CATEGORIES);
	const [search, setSearch] = useState("");
	const [feedback, setFeedback] = useState<
		Record<string, TemplateActionResult | undefined>
	>({});
	const templates = ctx.templates ?? NO_TEMPLATES;

	const categories = useMemo(
		() => Array.from(new Set(templates.map((entry) => entry.category))).sort(),
		[templates],
	);

	const filtered = useMemo(() => {
		const query = search.trim().toLowerCase();
		return templates.filter(
			(entry) =>
				(category === ALL_CATEGORIES || entry.category === category) &&
				matchesSearch(entry, query),
		);
	}, [templates, category, search]);

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

	function runAction(
		entry: CanvasTemplateEntry,
		action: typeof loadTemplate,
	): void {
		const result = action(ctx, entry);
		setFeedback((prev) => ({
			...prev,
			[entry.id]:
				result.ok && result.warnings.length === 0 ? undefined : result,
		}));
		if (result.ok) setPendingId(null);
	}

	return (
		<div data-testid="templates-panel" className="flex flex-col gap-2 p-2">
			<div className="flex gap-1.5">
				<Input
					data-testid="templates-search"
					placeholder={t(
						"canvas.templates.searchPlaceholder",
						"Search templates…",
					)}
					value={search}
					onChange={(event) => setSearch(event.currentTarget.value)}
					className="flex-1"
				/>
				<Select
					value={category}
					onValueChange={(next) => next && setCategory(next)}
				>
					<SelectTrigger
						data-testid="templates-category-filter"
						className="w-32"
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value={ALL_CATEGORIES}>
							{t("canvas.templates.categoryAll", "All categories")}
						</SelectItem>
						{categories.map((value) => (
							<SelectItem key={value} value={value}>
								{value}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			{filtered.length === 0 ? (
				<div
					data-testid="templates-panel-no-results"
					className="p-2 text-xs text-muted-foreground italic"
				>
					{t("canvas.templates.noResults", "No templates match your search.")}
				</div>
			) : (
				filtered.map((entry) => {
					const pending = pendingId === entry.id;
					const entryFeedback = feedback[entry.id];
					return (
						<div
							key={entry.id}
							className="rounded-md border border-border bg-background p-2"
						>
							<button
								type="button"
								data-testid={`template-item-${entry.id}`}
								className="w-full text-left"
								onClick={() => setPendingId(pending ? null : entry.id)}
							>
								<TemplatePreview entry={entry} />
								<div className="mt-2 text-xs font-medium">{entry.title}</div>
								{entry.description ? (
									<div className="mt-0.5 text-[11px] text-muted-foreground">
										{entry.description}
									</div>
								) : null}
								<div className="mt-0.5 text-[11px] text-muted-foreground">
									{sizeCaption(entry)}
								</div>
							</button>

							{entryFeedback ? (
								<div
									data-testid={`template-feedback-${entry.id}`}
									className="mt-1.5 text-[11px] text-destructive"
								>
									{entryFeedback.ok
										? entryFeedback.warnings.map((warning, index) => (
												<div key={index}>{warningMessage(t, warning)}</div>
											))
										: entryFeedback.message}
								</div>
							) : null}

							{pending ? (
								<div
									data-testid={`template-confirm-${entry.id}`}
									className="mt-2 flex flex-col gap-1.5"
								>
									<div className="text-[11px] text-muted-foreground">
										{t(
											"canvas.templates.confirmBody",
											"Loading a template replaces every page. This can be undone.",
										)}
									</div>
									<div className="flex flex-wrap gap-1.5">
										<Button
											size="sm"
											data-testid={`template-load-${entry.id}`}
											onClick={() => runAction(entry, loadTemplate)}
										>
											{t("canvas.templates.replace", "Replace")}
										</Button>
										<Button
											size="sm"
											variant="outline"
											data-testid={`template-insert-new-${entry.id}`}
											onClick={() => runAction(entry, insertTemplateAsNewPages)}
										>
											{t("canvas.templates.insertNew", "Insert as new")}
										</Button>
										<Button
											size="sm"
											variant="outline"
											onClick={() => setPendingId(null)}
										>
											{t("canvas.templates.cancel", "Cancel")}
										</Button>
									</div>
								</div>
							) : null}
						</div>
					);
				})
			)}
		</div>
	);
}
