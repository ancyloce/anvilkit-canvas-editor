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

import {
	CANVAS_SIZE_PRESETS,
	type InstantiateTemplateWarning,
} from "@anvilkit/canvas-core";
import { Button } from "@anvilkit/ui/button";
import { Input } from "@anvilkit/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@anvilkit/ui/select";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	type CanvasT,
	useCanvasStudio,
	useCanvasT,
} from "../context/canvas-studio-context.js";
import { useRecentTemplates } from "../context/recent-templates-context.js";
import type { CanvasTemplateEntry } from "../templates/template-entry.js";
import {
	type CanvasTemplateProvider,
	createStaticTemplateProvider,
} from "../templates/template-provider.js";
import {
	insertTemplateAsNewPages,
	loadTemplate,
	type TemplateActionResult,
} from "./template-actions.js";

const ALL_CATEGORIES = "all";
const ALL_SIZES = "all";
const SEARCH_DEBOUNCE_MS = 250;

// Stable fallback for hosts that pass no catalog, so the `categories`/
// `filtered` memos don't recompute on a fresh `[]` identity every render.
const NO_TEMPLATES: readonly CanvasTemplateEntry[] = [];

function sizeCaption(entry: CanvasTemplateEntry): string {
	const size = entry.document.pages[0]?.size;
	if (!size) return "";
	const unit = size.unit === "px" ? "" : size.unit;
	return `${size.width}×${size.height}${unit}`;
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

/** Skeleton card shown while a provider search is in flight (FR-130). */
function TemplateSkeleton({ index }: { index: number }): React.JSX.Element {
	return (
		<div
			data-testid={`templates-skeleton-${index}`}
			className="animate-pulse rounded-md border border-border bg-background p-2"
		>
			<div className="h-20 rounded-sm bg-muted" />
			<div className="mt-2 h-3 w-2/3 rounded bg-muted" />
			<div className="mt-1 h-3 w-1/3 rounded bg-muted" />
		</div>
	);
}

interface TemplateSearchState {
	entries: readonly CanvasTemplateEntry[];
	loading: boolean;
	error: boolean;
	nextCursor: string | undefined;
}

export function TemplatesPanel(): React.JSX.Element {
	const ctx = useCanvasStudio();
	const t = useCanvasT();
	const recentTemplates = useRecentTemplates();
	const [pendingId, setPendingId] = useState<string | null>(null);
	const [category, setCategory] = useState<string>(ALL_CATEGORIES);
	const [sizeId, setSizeId] = useState<string>(ALL_SIZES);
	const [search, setSearch] = useState("");
	const [debouncedSearch, setDebouncedSearch] = useState("");
	const [feedback, setFeedback] = useState<
		Record<string, TemplateActionResult | undefined>
	>({});
	const [result, setResult] = useState<TemplateSearchState>({
		entries: [],
		loading: true,
		error: false,
		nextCursor: undefined,
	});
	// Retry counter: bumping it re-runs the search effect after an error.
	const [attempt, setAttempt] = useState(0);
	const templates = ctx.templates ?? NO_TEMPLATES;
	const requestSeq = useRef(0);

	// FR-131: the panel always speaks the provider protocol — a host-supplied
	// provider wins; the static `templates` array is wrapped transparently.
	const provider: CanvasTemplateProvider = useMemo(
		() => ctx.templateProvider ?? createStaticTemplateProvider(templates),
		[ctx.templateProvider, templates],
	);

	useEffect(() => {
		const handle = setTimeout(
			() => setDebouncedSearch(search.trim()),
			SEARCH_DEBOUNCE_MS,
		);
		return () => clearTimeout(handle);
	}, [search]);

	const sizePreset = CANVAS_SIZE_PRESETS.find((p) => p.id === sizeId);

	useEffect(() => {
		const seq = ++requestSeq.current;
		setResult((prev) => ({ ...prev, loading: true, error: false }));
		provider
			.search({
				...(debouncedSearch ? { text: debouncedSearch } : {}),
				...(category !== ALL_CATEGORIES ? { category } : {}),
				...(sizePreset
					? { size: { width: sizePreset.width, height: sizePreset.height } }
					: {}),
			})
			.then((res) => {
				if (requestSeq.current !== seq) return; // stale response
				setResult({
					entries: res.entries,
					loading: false,
					error: false,
					nextCursor: res.nextCursor,
				});
			})
			.catch(() => {
				if (requestSeq.current !== seq) return;
				setResult({
					entries: [],
					loading: false,
					error: true,
					nextCursor: undefined,
				});
			});
	}, [provider, debouncedSearch, category, sizePreset, attempt]);

	const categories = useMemo(
		() =>
			Array.from(
				new Set([...templates, ...result.entries].map((e) => e.category)),
			).sort(),
		[templates, result.entries],
	);

	const recents = useMemo(
		() =>
			recentTemplates.ids
				.map((id) => result.entries.find((e) => e.id === id))
				.filter((e): e is CanvasTemplateEntry => e !== undefined)
				.slice(0, 4),
		[recentTemplates.ids, result.entries],
	);

	const hasAnySource =
		ctx.templateProvider !== undefined || templates.length > 0;
	if (!hasAnySource) {
		return (
			<div
				data-testid="templates-panel-empty"
				className="p-4 text-xs text-muted-foreground italic"
			>
				{t("canvas.templates.empty", "No templates provided by the host.")}
			</div>
		);
	}

	function loadMore(): void {
		const cursor = result.nextCursor;
		if (!cursor || result.loading) return;
		const seq = ++requestSeq.current;
		setResult((prev) => ({ ...prev, loading: true }));
		provider
			.search({
				...(debouncedSearch ? { text: debouncedSearch } : {}),
				...(category !== ALL_CATEGORIES ? { category } : {}),
				...(sizePreset
					? { size: { width: sizePreset.width, height: sizePreset.height } }
					: {}),
				cursor,
			})
			.then((res) => {
				if (requestSeq.current !== seq) return;
				setResult((prev) => ({
					entries: [...prev.entries, ...res.entries],
					loading: false,
					error: false,
					nextCursor: res.nextCursor,
				}));
			})
			.catch(() => {
				if (requestSeq.current !== seq) return;
				setResult((prev) => ({ ...prev, loading: false, error: true }));
			});
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
		if (result.ok) {
			setPendingId(null);
			recentTemplates.add(entry.id);
		}
	}

	function renderCard(
		entry: CanvasTemplateEntry,
		keyPrefix = "",
	): React.JSX.Element {
		const pending = pendingId === entry.id;
		const entryFeedback = feedback[entry.id];
		return (
			<div
				key={`${keyPrefix}${entry.id}`}
				className="rounded-md border border-border bg-background p-2"
			>
				<button
					type="button"
					data-testid={`${keyPrefix}template-item-${entry.id}`}
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
							? entryFeedback.warnings.map((warning) => (
									<div
										key={`${warning.code}-${warning.variableId ?? warning.slotId ?? warning.nodeId ?? ""}`}
									>
										{warningMessage(t, warning)}
									</div>
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
			<Select value={sizeId} onValueChange={(next) => next && setSizeId(next)}>
				<SelectTrigger data-testid="templates-size-filter" className="w-full">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value={ALL_SIZES}>
						{t("canvas.templates.sizeAll", "All sizes")}
					</SelectItem>
					{CANVAS_SIZE_PRESETS.map((preset) => (
						<SelectItem key={preset.id} value={preset.id}>
							{preset.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>

			{recents.length > 0 ? (
				<div data-testid="templates-recents" className="flex flex-col gap-2">
					<div className="text-[11px] font-medium text-muted-foreground">
						{t("canvas.templates.recentlyUsed", "Recently used")}
					</div>
					{recents.map((entry) => renderCard(entry, "recent-"))}
					<div className="border-b border-border" />
				</div>
			) : null}

			{result.error ? (
				<div
					data-testid="templates-panel-error"
					className="flex flex-col gap-1.5 p-2"
				>
					<div className="text-xs text-destructive">
						{t("canvas.templates.loadError", "Templates couldn't be loaded.")}
					</div>
					<Button
						size="sm"
						variant="outline"
						data-testid="templates-retry"
						onClick={() => setAttempt((n) => n + 1)}
					>
						{t("canvas.templates.retry", "Retry")}
					</Button>
				</div>
			) : result.loading && result.entries.length === 0 ? (
				[0, 1, 2].map((i) => <TemplateSkeleton key={i} index={i} />)
			) : result.entries.length === 0 ? (
				<div
					data-testid="templates-panel-no-results"
					className="p-2 text-xs text-muted-foreground italic"
				>
					{t("canvas.templates.noResults", "No templates match your search.")}
				</div>
			) : (
				<>
					{result.entries.map((entry) => renderCard(entry))}
					{result.nextCursor ? (
						<Button
							size="sm"
							variant="outline"
							data-testid="templates-load-more"
							disabled={result.loading}
							onClick={loadMore}
						>
							{result.loading
								? t("canvas.templates.loading", "Loading…")
								: t("canvas.templates.loadMore", "Load more")}
						</Button>
					) : null}
				</>
			)}
		</div>
	);
}
