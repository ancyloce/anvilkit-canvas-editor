"use client";

/**
 * @file The Elements dock panel (PLAN-0035 §5 P3, `cp3-003`).
 *
 * WHAT CHANGED, AND WHY IT IS A BREAK.
 *
 * This panel used to be a misnomer: it mapped the drawing-TOOL registry to
 * buttons and filtered them by localized label. There was no shape library, no
 * icon set, no graphics — the single biggest perceived gap in the product. It
 * is now a CONTENT BROWSER over {@link CanvasElementProvider}: a category tab
 * strip, a result grid, and pagination, all fed by the same
 * `search(query) → { entries, nextCursor }` protocol the Templates panel
 * speaks. ADR 0008 decision 4 approved the restructuring as an announced
 * user-visible break (owner sign-off 2026-08-07).
 *
 * INSERTION (`cp3-004`) HAS TWO PATHS AND ONE IMPLEMENTATION.
 *
 * Clicking a cell (or Enter/Space on it — the cells are real buttons) inserts
 * at the viewport centre; dragging one onto the canvas inserts at the drop
 * point, inside the frame under the cursor. Both go through
 * `actions/element-insert-actions.ts`, which commits ONE `node.create` and
 * selects it, so undo removes an inserted element in a single step. The drag
 * rides `CanvasDropZone`'s existing handlers rather than a second drop surface.
 *
 * THE DRAWING TOOLS ARE GONE FROM HERE — `cp3-009` MOVED THEM.
 *
 * `cp3-003` left the old tool grid behind as a dated, marked, single-block
 * migration bridge so the deletion and the selector swap in the nine E2E specs
 * that drove it could land as ONE change with no red window. `cp3-009` is that
 * change: `LegacyToolSection`, its call site and `ElementsPanelProps.tools` are
 * deleted, and the specs now drive `tool-strip-<id>`. The tools were never
 * stranded for a moment — `<ToolStrip>` renders the identical effective
 * registry (`chrome/icons.ts`'s `toolDescriptorsFromRegistry`) and
 * `<CanvasWorkspace>` has mounted it all along (`toolStrip` defaults to true).
 * This panel no longer reads the tool registry or the tool store at all; the
 * ONE thing it still takes from `useCanvasStudio()` is the insert dispatch
 * (`cp3-004`). ADR 0008 decision 4, conditions 2 and 3.
 *
 * THE CATALOG IS NEVER STATICALLY IMPORTED.
 *
 * The default provider comes from `../elements/default-element-provider.js`,
 * whose only edge to the 189 KB catalog is a dynamic `import()` inside the
 * loader callback. Making that import static moves the eager editor chunk by
 * +55,796 B gzipped — 13.6% of the whole budget (`cp3-002` measured it). A test
 * asserts the catalog module is not evaluated when this module is imported:
 * `__tests__/ElementsPanel.lazy-catalog.test.tsx`.
 */

import { Button } from "@anvilkit/ui/button";
import { cn } from "@anvilkit/ui/lib/utils";
import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	beginElementDrag,
	ELEMENT_DRAG_MIME,
	endElementDrag,
	insertElementAtViewportCenter,
} from "../actions/element-insert-actions.js";
import {
	useCanvasStudio,
	useCanvasT,
} from "../context/canvas-studio-context.js";
import { createDefaultElementProvider } from "../elements/default-element-provider.js";
import {
	CANVAS_ELEMENT_CATEGORIES,
	type CanvasElementCategory,
	type CanvasElementEntry,
} from "../elements/element-entry.js";
import type { CanvasElementProvider } from "../elements/element-provider.js";

/** Sentinel category for "no facet". Not a {@link CanvasElementCategory}. */
const ALL_CATEGORIES = "all";

/** Same debounce the Templates panel uses, so the two surfaces feel identical. */
const SEARCH_DEBOUNCE_MS = 250;

/**
 * Fixed column count for the result grid.
 *
 * Fixed rather than measured on purpose. Arrow-Up/Down have to move by a row,
 * and a measured column count is unknowable in jsdom (`getBoundingClientRect`
 * returns zeroes), which would make the keyboard traversal spec assert against
 * a layout that never happened — the same class of false green as
 * `tanstack/react-virtual` rendering 0 rows without layout.
 */
const GRID_COLUMNS = 3;

/** The icon-set convention `CanvasElementPreview` documents as its default. */
const DEFAULT_PREVIEW_VIEW_BOX = "0 0 24 24";

/**
 * Preview stroke width, as a fraction of the preview's viewBox width.
 *
 * THE ONE CONVENTION THE CONTRACT DOES NOT CARRY A FIELD FOR.
 *
 * `CanvasElementPreview` has no stroke width — `{ kind: "path", d, viewBox }`
 * is all there is — but `entry.recolor` says whether the path is meant to be
 * filled or stroked, and rendering a stroked path as a filled one turns 181 of
 * the 425 default entries into black blobs. So the branch is on `recolor`, and
 * the width comes from this ratio: every outline icon in the default catalog is
 * authored at stroke width 1.5 in a `0 0 24 24` box, which is 6.25%.
 *
 * KNOWN IMPRECISION, recorded rather than hidden: exact for the 156 outline
 * ICON entries, approximate for the 25 `line` entries, whose geometry is
 * authored at width 4 in a 240-unit box (1.67%) — those previews render heavier
 * than the inserted node, and `line-plain` and `line-thick` draw alike. Fixing
 * that properly is an additive `strokeWidth?: number` on
 * `CanvasElementPreview`, which this task is not permitted to add.
 */
const PREVIEW_STROKE_RATIO = 0.0625;

/** Skeleton cells while the first page is in flight — Templates renders 3. */
const SKELETON_COUNT = 6;

/** Tab labels. Static literals so the A-11 catalog scan can see every key. */
const CATEGORY_LABELS: Record<
	CanvasElementCategory,
	{ readonly key: string; readonly fallback: string }
> = {
	shape: { key: "canvas.elements.categoryShape", fallback: "Shapes" },
	icon: { key: "canvas.elements.categoryIcon", fallback: "Icons" },
	line: { key: "canvas.elements.categoryLine", fallback: "Lines" },
	frame: { key: "canvas.elements.categoryFrame", fallback: "Frames" },
	sticker: { key: "canvas.elements.categorySticker", fallback: "Stickers" },
};

/**
 * The default catalog provider, allocated at most once per module instance.
 *
 * `createDefaultElementProvider` is cheap — it allocates a wrapper, not a
 * catalog — but calling it per mount would mean a second promise chain and a
 * second parsed catalog for every panel remount, which `cp3-002`'s handoff
 * explicitly warns against. Lazily initialised so merely importing this module
 * allocates nothing.
 */
let sharedDefaultProvider: CanvasElementProvider | undefined;
function defaultElementProvider(): CanvasElementProvider {
	sharedDefaultProvider ??= createDefaultElementProvider();
	return sharedDefaultProvider;
}

/** `"0 0 24 24"` → `{ width: 24, height: 24 }`, total and never zero. */
function viewBoxSize(viewBox: string): {
	readonly width: number;
	readonly height: number;
} {
	const parts = viewBox
		.split(/[\s,]+/)
		.map(Number)
		.filter((n) => Number.isFinite(n));
	const width = parts[2];
	const height = parts[3];
	return {
		width: width !== undefined && width > 0 ? width : 24,
		height: height !== undefined && height > 0 ? height : 24,
	};
}

/**
 * The aspect ratio a preview should be drawn at.
 *
 * The viewBox wins where there is one: it is the box the `d` is actually
 * authored in, so using anything else letterboxes or distorts the artwork.
 * `entry.defaultSize` is the documented fallback — it is required on every
 * entry, so this is total.
 */
function previewAspectRatio(entry: CanvasElementEntry): number {
	if (entry.preview.kind === "path" && entry.preview.viewBox) {
		const { width, height } = viewBoxSize(entry.preview.viewBox);
		return width / height;
	}
	const { width, height } = entry.defaultSize;
	return height > 0 ? width / height : 1;
}

/**
 * A catalog thumbnail: attribute-only SVG, never `dangerouslySetInnerHTML`.
 *
 * Filled or stroked by {@link CanvasElementEntry.recolor} — see
 * {@link PREVIEW_STROKE_RATIO} for why that branch is load-bearing. Inherits
 * `currentColor` so the thumbnail tracks the panel's theme instead of being
 * baked light or dark.
 */
function ElementPreview({
	entry,
}: {
	entry: CanvasElementEntry;
}): React.JSX.Element {
	const style: React.CSSProperties = {
		aspectRatio: `${previewAspectRatio(entry)}`,
	};
	if (entry.preview.kind === "image") {
		return (
			<img
				aria-hidden
				alt=""
				data-testid={`elements-preview-${entry.id}`}
				src={entry.preview.src}
				className="max-h-full max-w-full object-contain"
				style={style}
			/>
		);
	}
	const viewBox = entry.preview.viewBox ?? DEFAULT_PREVIEW_VIEW_BOX;
	const stroked = entry.recolor === "stroke";
	return (
		<svg
			aria-hidden
			focusable="false"
			data-testid={`elements-preview-${entry.id}`}
			data-recolor={entry.recolor}
			viewBox={viewBox}
			className="max-h-full max-w-full"
			style={style}
		>
			<path
				d={entry.preview.d}
				fill={stroked ? "none" : "currentColor"}
				{...(stroked
					? {
							stroke: "currentColor",
							strokeWidth: PREVIEW_STROKE_RATIO * viewBoxSize(viewBox).width,
							strokeLinecap: "round" as const,
							strokeLinejoin: "round" as const,
						}
					: {})}
			/>
		</svg>
	);
}

/**
 * Loading cell. Deliberately the Templates panel's skeleton vocabulary —
 * `animate-pulse rounded-md border border-border bg-background p-2` wrapping a
 * `bg-muted` block — reshaped for a grid cell rather than a full-width card.
 * `TemplateSkeleton` is a module-private component in `TemplatesPanel.tsx`, so
 * it cannot be imported; matching its classes is the closest reuse available
 * without editing a file this task does not own.
 */
function ElementSkeleton({ index }: { index: number }): React.JSX.Element {
	return (
		<div
			data-testid={`elements-skeleton-${index}`}
			className="animate-pulse rounded-md border border-border bg-background p-2"
		>
			<div className="aspect-square rounded-sm bg-muted" />
			<div className="mt-2 h-2.5 w-2/3 rounded bg-muted" />
		</div>
	);
}

interface ElementSearchState {
	readonly entries: readonly CanvasElementEntry[];
	readonly loading: boolean;
	readonly error: boolean;
	readonly nextCursor: string | undefined;
}

const INITIAL_SEARCH_STATE: ElementSearchState = {
	entries: [],
	loading: true,
	error: false,
	nextCursor: undefined,
};

export interface ElementsPanelProps {
	/**
	 * Free-text query. Supplied by the Tab Panel's own search box, which the
	 * `elements` descriptor already enables (`searchable: true`), so the panel
	 * does not render a second one. Matched across name, tags AND keywords by
	 * the provider.
	 */
	search?: string;
	/**
	 * Element catalog. Defaults to the built-in ~425-entry catalog, fetched on
	 * first query rather than at editor mount.
	 *
	 * A host supplying its own provider pays nothing for the built-in one: the
	 * default is never constructed, so its chunk is never requested.
	 */
	elementProvider?: CanvasElementProvider;
	/**
	 * Activation callback — click, Enter or Space on a grid cell.
	 *
	 * OVERRIDES the built-in insert (`cp3-004`) rather than observing it: a
	 * supplied handler owns the interaction, which is what an element PICKER —
	 * a host dialog that returns a choice instead of editing the document —
	 * needs. Absent (the normal case) inserts the entry at the viewport centre
	 * as one undo entry and selects it.
	 *
	 * A host that wants both its own handler AND the default behaviour calls
	 * `insertElementAtViewportCenter(ctx, entry)` itself; it is exported from
	 * the package root for exactly that.
	 */
	onSelect?: (entry: CanvasElementEntry) => void;
	className?: string;
}

export function ElementsPanel({
	search = "",
	elementProvider,
	onSelect,
	className,
}: ElementsPanelProps): React.JSX.Element {
	const t = useCanvasT();
	// `cp3-004` — the insert dispatch, and the ONLY reason this panel still
	// reads the studio context now that `cp3-009` has deleted the tool grid.
	// (`cp3-003`'s handoff predicted this import would go with the grid; it
	// cannot — the click and drag insert paths dispatch through it.)
	const ctx = useCanvasStudio();
	const [category, setCategory] = useState<CanvasElementCategory | "all">(
		ALL_CATEGORIES,
	);
	const [debouncedSearch, setDebouncedSearch] = useState(search.trim());
	const [result, setResult] =
		useState<ElementSearchState>(INITIAL_SEARCH_STATE);
	// Retry counter: bumping it re-runs the search effect after an error. The
	// lazy provider deliberately does not cache a rejected load, so this really
	// does re-attempt the chunk fetch rather than replaying the same failure.
	const [attempt, setAttempt] = useState(0);
	const [activeIndex, setActiveIndex] = useState(0);
	const requestSeq = useRef(0);
	const gridRef = useRef<HTMLDivElement | null>(null);

	const provider = useMemo(
		() => elementProvider ?? defaultElementProvider(),
		[elementProvider],
	);

	useEffect(() => {
		const handle = setTimeout(
			() => setDebouncedSearch(search.trim()),
			SEARCH_DEBOUNCE_MS,
		);
		return () => clearTimeout(handle);
	}, [search]);

	useEffect(() => {
		const seq = ++requestSeq.current;
		setResult((prev) => ({ ...prev, loading: true, error: false }));
		provider
			.search({
				...(debouncedSearch ? { text: debouncedSearch } : {}),
				...(category !== ALL_CATEGORIES ? { category } : {}),
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
	}, [provider, debouncedSearch, category, attempt]);

	function loadMore(): void {
		const cursor = result.nextCursor;
		if (!cursor || result.loading) return;
		const seq = ++requestSeq.current;
		setResult((prev) => ({ ...prev, loading: true }));
		provider
			.search({
				...(debouncedSearch ? { text: debouncedSearch } : {}),
				...(category !== ALL_CATEGORIES ? { category } : {}),
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

	/**
	 * `cp3-004` click / Enter / Space: insert at the viewport centre, unless the
	 * host took the seam. Real `<button type="button">` cells mean the keyboard
	 * path is the platform's and needs no key handler of its own.
	 */
	function activate(entry: CanvasElementEntry): void {
		if (onSelect) {
			onSelect(entry);
			return;
		}
		insertElementAtViewportCenter(ctx, entry);
	}

	// Clamped during render rather than reset in an effect: a shrinking result
	// set must not leave the roving tabindex pointing past the end for a frame,
	// which would render a listbox with no tabbable option in it.
	const lastIndex = Math.max(0, result.entries.length - 1);
	const focusIndex = Math.min(activeIndex, lastIndex);

	function focusOption(index: number): void {
		// Queried rather than ref-collected: `Button` is a ui primitive whose
		// ref target is its own business, and the DOM order IS the grid order.
		gridRef.current
			?.querySelectorAll<HTMLElement>('[role="option"]')
			.item(index)
			?.focus();
	}

	function onGridKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
		if (result.entries.length === 0) return;
		let next: number;
		switch (event.key) {
			case "ArrowRight":
				next = focusIndex + 1;
				break;
			case "ArrowLeft":
				next = focusIndex - 1;
				break;
			case "ArrowDown":
				next = focusIndex + GRID_COLUMNS;
				break;
			case "ArrowUp":
				next = focusIndex - GRID_COLUMNS;
				break;
			case "Home":
				next = 0;
				break;
			case "End":
				next = lastIndex;
				break;
			default:
				return;
		}
		event.preventDefault();
		const clamped = Math.min(Math.max(next, 0), lastIndex);
		setActiveIndex(clamped);
		focusOption(clamped);
	}

	return (
		<div
			data-testid="elements-panel"
			className={cn("flex flex-col gap-2 p-2", className)}
		>
			<div
				role="tablist"
				aria-label={t("canvas.elements.categoriesLabel", "Element categories")}
				data-testid="elements-categories"
				className="flex flex-wrap gap-1"
			>
				<Button
					type="button"
					size="xs"
					variant={category === ALL_CATEGORIES ? "secondary" : "ghost"}
					role="tab"
					aria-selected={category === ALL_CATEGORIES}
					data-testid="elements-category-all"
					onClick={() => setCategory(ALL_CATEGORIES)}
				>
					{t("canvas.elements.categoryAll", "All")}
				</Button>
				{CANVAS_ELEMENT_CATEGORIES.map((value) => (
					<Button
						key={value}
						type="button"
						size="xs"
						variant={category === value ? "secondary" : "ghost"}
						role="tab"
						aria-selected={category === value}
						data-testid={`elements-category-${value}`}
						onClick={() => setCategory(value)}
					>
						{t(CATEGORY_LABELS[value].key, CATEGORY_LABELS[value].fallback)}
					</Button>
				))}
			</div>

			{result.error ? (
				<div
					data-testid="elements-panel-error"
					className="flex flex-col gap-1.5 p-2"
				>
					<div className="text-xs text-destructive">
						{t("canvas.elements.loadError", "Elements couldn't be loaded.")}
					</div>
					<Button
						size="sm"
						variant="outline"
						data-testid="elements-retry"
						onClick={() => setAttempt((n) => n + 1)}
					>
						{t("canvas.elements.retry", "Retry")}
					</Button>
				</div>
			) : result.loading && result.entries.length === 0 ? (
				<div className="grid grid-cols-3 gap-2" data-testid="elements-loading">
					{Array.from({ length: SKELETON_COUNT }, (_, i) => (
						<ElementSkeleton key={i} index={i} />
					))}
				</div>
			) : result.entries.length === 0 ? (
				<div
					data-testid="elements-panel-no-results"
					className="p-2 text-xs text-muted-foreground italic"
				>
					{t("canvas.elements.noResults", "No elements match your search.")}
				</div>
			) : (
				<>
					{/* A listbox of thumbnail options rather than a native control:
					    the grid needs a roving tabindex over `role="option"`, which
					    no native element provides, and it is the same pattern the
					    tool grid this panel replaces already used. */}
					<div
						ref={gridRef}
						role="listbox"
						aria-label={t("canvas.elements.gridLabel", "Elements")}
						data-testid="elements-grid"
						className="grid grid-cols-3 gap-2"
						onKeyDown={onGridKeyDown}
					>
						{result.entries.map((entry, index) => (
							<Button
								key={entry.id}
								type="button"
								variant="ghost"
								role="option"
								aria-selected={index === focusIndex}
								aria-label={entry.name}
								tabIndex={index === focusIndex ? 0 : -1}
								data-testid={`elements-item-${entry.id}`}
								data-category={entry.category}
								title={entry.name}
								// `cp3-004` drag path. The id goes in the `dataTransfer`
								// (so `CanvasDropZone`'s `dragover` can recognise the drag
								// from `types` alone, before any data is readable); the
								// ENTRY goes in the module-scope handoff, because
								// `entry.build()` is a function and a `DataTransfer`
								// carries strings. `dragend` always fires, including on a
								// cancelled drag, so the handoff cannot outlive the gesture.
								draggable
								onDragStart={(event) => {
									event.dataTransfer.setData(ELEMENT_DRAG_MIME, entry.id);
									event.dataTransfer.effectAllowed = "copy";
									beginElementDrag(entry);
								}}
								onDragEnd={endElementDrag}
								onFocus={() => setActiveIndex(index)}
								onClick={() => activate(entry)}
								className="h-auto flex-col gap-1.5 rounded-lg px-1 py-2 text-[10.5px] font-medium text-muted-foreground"
							>
								<span className="flex h-10 w-full items-center justify-center">
									<ElementPreview entry={entry} />
								</span>
								<span className="w-full truncate">{entry.name}</span>
							</Button>
						))}
					</div>
					{result.nextCursor ? (
						<Button
							size="sm"
							variant="outline"
							data-testid="elements-load-more"
							disabled={result.loading}
							onClick={loadMore}
						>
							{result.loading
								? t("canvas.elements.loading", "Loading…")
								: t("canvas.elements.loadMore", "Load more")}
						</Button>
					) : null}
				</>
			)}
		</div>
	);
}
