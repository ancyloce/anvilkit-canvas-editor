"use client";

import type {
	CanvasComponentDefinition,
	CanvasComponentIssue,
} from "@anvilkit/canvas-core";
import {
	buildComponentGraph,
	buildComponentReferenceIndex,
} from "@anvilkit/canvas-core";
import { Button } from "@anvilkit/ui/button";
import { Input } from "@anvilkit/ui/input";
import { cn } from "@anvilkit/ui/lib/utils";
import { Windowed } from "@anvilkit/ui/windowed";
import {
	AlertTriangle,
	Component,
	Copy,
	Pencil,
	PencilRuler,
	Plus,
	Trash2,
} from "lucide-react";
import * as React from "react";
import { useMemo, useState, useSyncExternalStore } from "react";
import {
	createComponentFromSelectionImpl,
	deleteComponentImpl,
	duplicateComponentImpl,
	enterComponentSourceImpl,
	insertComponentInstanceImpl,
	renameComponentImpl,
} from "../actions/component-actions.js";
import {
	type CanvasT,
	useCanvasStudio,
	useCanvasT,
} from "../context/canvas-studio-context.js";
import { useCanvasDialogs } from "../context/dialog-context.js";
import { useCanvasToaster } from "../context/toast-context.js";

/**
 * @file The Components dock panel (plan 0023 M5-02, LC-INSTANCE-001, PRD §9.5).
 *
 * Reads the document Registry directly — a Source list is document state, not
 * host-provided catalog data, so unlike `TemplatesPanel` there is no provider
 * seam to go through.
 *
 * Virtualized through the shared `Windowed` primitive (the same one
 * `LayerPanel` uses) rather than a hand-rolled window, because a document may
 * hold up to `MAX_COMPONENT_DEFINITIONS_PER_DOCUMENT` (256) Sources.
 */

export interface ComponentsPanelProps {
	/** Filter by component name (driven by the Tab Panel search box). */
	search?: string;
	className?: string;
}

/** Row height in px — fixed so the virtualizer needs no measurement pass. */
const ROW_HEIGHT = 52;
/** Above this many rows the list virtualizes; below it, plain DOM is cheaper. */
const VIRTUALIZE_THRESHOLD = 24;

/** One Registry entry plus everything the row displays. */
export interface ComponentsPanelEntry {
	readonly definition: CanvasComponentDefinition;
	/** Instances on pages — what "used N times" counts, and what blocks delete. */
	readonly pageInstanceCount: number;
	/** Instances inside OTHER Sources: a nested dependency, not a page usage. */
	readonly nestedDependencyCount: number;
	/**
	 * Why this Source cannot be used safely, if anything: a cycle it takes part
	 * in, or a nested chain deeper than the resolver will expand. Both come from
	 * the graph rather than from resolution, so a Source that is never
	 * instantiated is still reported.
	 */
	readonly problem: "cycle" | "depth-exceeded" | null;
}

/**
 * Registry → sorted, annotated rows.
 *
 * Sorted by NAME (locale-aware, stable tiebreak on id) rather than by Registry
 * key order: the key order is insertion order, which would make the list jump
 * around as Sources are created and deleted.
 */
export function componentsPanelEntries(
	ctx: Pick<ReturnType<typeof useCanvasStudio>, "ir">,
): readonly ComponentsPanelEntry[] {
	const registry = ctx.ir.components;
	if (!registry) return [];
	const index = buildComponentReferenceIndex(ctx.ir);
	const graph = buildComponentGraph(registry);
	const inCycle = new Set(graph.cycles.flat());
	const tooDeep = new Set(graph.depthExceeded);
	return Object.values(registry)
		.map((definition) => ({
			definition,
			pageInstanceCount: (
				index.pageInstancesByComponent.get(definition.id) ?? []
			).length,
			nestedDependencyCount: (
				index.sourceDependenciesByComponent.get(definition.id) ?? []
			).length,
			problem: inCycle.has(definition.id)
				? ("cycle" as const)
				: tooDeep.has(definition.id)
					? ("depth-exceeded" as const)
					: null,
		}))
		.sort(
			(a, b) =>
				a.definition.name.localeCompare(b.definition.name) ||
				a.definition.id.localeCompare(b.definition.id),
		);
}

function usageLabel(entry: ComponentsPanelEntry, t: CanvasT): string {
	const { pageInstanceCount: pages, nestedDependencyCount: nested } = entry;
	if (pages === 0 && nested === 0) {
		return t("canvas.components.unused", "Not used yet");
	}
	const used = t("canvas.components.usageCount", "Used {n}×").replace(
		"{n}",
		String(pages),
	);
	if (nested === 0) return used;
	return `${used} · ${t(
		"canvas.components.nestedCount",
		"nested in {n}",
	).replace("{n}", String(nested))}`;
}

function problemLabel(
	problem: NonNullable<ComponentsPanelEntry["problem"]>,
	t: CanvasT,
): string {
	return problem === "cycle"
		? t("canvas.components.problemCycle", "Circular reference")
		: t("canvas.components.problemDepth", "Nested too deeply");
}

/**
 * Diagnostics from the live resolution, keyed by component id — so a row can
 * show that THIS Source is the one failing to resolve, not just that the
 * document has a problem somewhere.
 */
function issuesByComponent(
	issues: readonly CanvasComponentIssue[],
): ReadonlyMap<string, CanvasComponentIssue> {
	const byId = new Map<string, CanvasComponentIssue>();
	for (const issue of issues) {
		// First error wins over later warnings for the same component: the row has
		// room for one badge, and the blocking problem is the useful one.
		if (!issue.componentId) continue;
		const existing = byId.get(issue.componentId);
		if (
			!existing ||
			(existing.severity === "warning" && issue.severity === "error")
		) {
			byId.set(issue.componentId, issue);
		}
	}
	return byId;
}

interface ComponentRowActions {
	readonly onInsert: (componentId: string) => void;
	readonly onEditSource: (componentId: string) => void;
	readonly onRename: (componentId: string, name: string) => void;
	readonly onDuplicate: (componentId: string) => void;
	readonly onDelete: (entry: ComponentsPanelEntry) => void;
}

function ComponentRow({
	entry,
	issue,
	renaming,
	onRenameStart,
	onRenameEnd,
	actions,
	t,
}: {
	entry: ComponentsPanelEntry;
	issue: CanvasComponentIssue | undefined;
	renaming: boolean;
	onRenameStart: (componentId: string) => void;
	onRenameEnd: () => void;
	actions: ComponentRowActions;
	t: CanvasT;
}): React.JSX.Element {
	const { definition, problem } = entry;
	const broken = problem !== null || issue?.severity === "error";
	// A Source in a cycle or over the depth cap resolves to a placeholder, so
	// inserting one would place a known-broken instance.
	const insertable = problem === null;

	const commitRename = (value: string): void => {
		actions.onRename(definition.id, value);
		onRenameEnd();
	};

	return (
		<div
			data-testid={`component-row-${definition.id}`}
			data-problem={problem ?? (issue ? issue.code : undefined)}
			className={cn(
				"group flex items-center gap-1 rounded-md px-1 text-left",
				broken ? "text-destructive" : "text-foreground",
			)}
			style={{ height: ROW_HEIGHT }}
		>
			{renaming ? (
				<Input
					autoFocus
					defaultValue={definition.name}
					aria-label={t("canvas.components.rename", "Rename component")}
					data-testid={`component-rename-${definition.id}`}
					className="h-7 text-xs"
					onKeyDown={(e) => {
						if (e.key === "Enter") commitRename(e.currentTarget.value);
						// Escape abandons the edit without committing — the same contract
						// the layer panel's inline rename honours.
						else if (e.key === "Escape") onRenameEnd();
					}}
					onBlur={(e) => commitRename(e.currentTarget.value)}
				/>
			) : (
				<>
					<button
						type="button"
						data-testid={`component-insert-${definition.id}`}
						disabled={!insertable}
						title={
							insertable
								? t("canvas.components.insert", "Insert {name}").replace(
										"{name}",
										definition.name,
									)
								: problemLabel(
										problem as NonNullable<ComponentsPanelEntry["problem"]>,
										t,
									)
						}
						onClick={() => actions.onInsert(definition.id)}
						className="flex min-w-0 flex-1 items-center gap-2.5 rounded px-1 py-1 text-left disabled:opacity-60"
					>
						{broken ? (
							<AlertTriangle className="size-4 shrink-0" aria-hidden />
						) : (
							<Component
								className="size-4 shrink-0 text-muted-foreground"
								aria-hidden
							/>
						)}
						<span className="flex min-w-0 flex-col">
							<span className="truncate text-xs font-medium">
								{definition.name}
							</span>
							<span className="truncate text-[11px] text-muted-foreground">
								{/* Never colour alone (NFR-004): the problem is spelled out in
								    text and carries an icon, so the state survives a greyscale
								    render and a screen reader. */}
								{problem
									? problemLabel(problem, t)
									: issue
										? issue.message
										: usageLabel(entry, t)}
							</span>
						</span>
					</button>
					{/* Row actions stay in the DOM (not conditionally mounted) so they are
					    reachable by keyboard; only their opacity is hover/focus-driven. */}
					<span className="flex shrink-0 items-center opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className="size-6"
							data-testid={`component-edit-${definition.id}`}
							title={t("canvas.component.editSource", "Edit component")}
							onClick={() => actions.onEditSource(definition.id)}
						>
							<PencilRuler className="size-3.5" aria-hidden />
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className="size-6"
							data-testid={`component-rename-start-${definition.id}`}
							title={t("canvas.components.rename", "Rename component")}
							onClick={() => onRenameStart(definition.id)}
						>
							<Pencil className="size-3.5" aria-hidden />
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className="size-6"
							data-testid={`component-duplicate-${definition.id}`}
							title={t("canvas.components.duplicate", "Duplicate component")}
							onClick={() => actions.onDuplicate(definition.id)}
						>
							<Copy className="size-3.5" aria-hidden />
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className="size-6"
							data-testid={`component-delete-${definition.id}`}
							title={t("canvas.components.delete", "Delete component")}
							onClick={() => actions.onDelete(entry)}
						>
							<Trash2 className="size-3.5" aria-hidden />
						</Button>
					</span>
				</>
			)}
		</div>
	);
}

/**
 * The Components dock panel (LC-INSTANCE-001, PRD §9.5): a document-local Source
 * list with usage counts, search, per-row problem states, insert-by-click, and
 * create / rename / duplicate / delete.
 *
 * Every mutation goes through `actions/component-actions.ts`, never by building
 * commands here, so the read-only-document guard, batch boundaries and undo
 * granularity are the same as everywhere else.
 */
export function ComponentsPanel({
	search = "",
	className,
}: ComponentsPanelProps): React.JSX.Element {
	const ctx = useCanvasStudio();
	const t = useCanvasT();
	const toaster = useCanvasToaster();
	// Null-tolerant seam: a headless embed with no dialog host auto-confirms, so
	// a destructive flow never deadlocks waiting for UI that is not mounted.
	const dialogs = useCanvasDialogs();
	const [renamingId, setRenamingId] = useState<string | null>(null);

	const componentIssues = useSyncExternalStore(
		ctx.resolvedDocumentStore
			? ctx.resolvedDocumentStore.subscribe
			: NOOP_SUBSCRIBE,
		() => ctx.resolvedDocumentStore?.getState().resolved.componentIssues,
		() => undefined,
	);
	const selectedIds = useSyncExternalStore(
		ctx.selectionStore.subscribe,
		() => ctx.selectionStore.getState().selectedIds,
		() => ctx.selectionStore.getState().selectedIds,
	);

	const entries = useMemo(() => componentsPanelEntries(ctx), [ctx]);
	const byComponent = useMemo(
		() => issuesByComponent(componentIssues ?? []),
		[componentIssues],
	);

	const actions: ComponentRowActions = {
		onInsert: (componentId) => {
			insertComponentInstanceImpl(ctx, componentId);
		},
		onEditSource: (componentId) => {
			const rejection = enterComponentSourceImpl(ctx, componentId);
			if (rejection === null) return;
			// Never fail silently: "already open" and "too deep" are both states the
			// user can reason about and recover from.
			toaster.add({
				type: "warning",
				title:
					rejection === "already-open"
						? t(
								"canvas.component.enterBlockedCycle",
								"That component is already open further up — a component cannot contain itself",
							)
						: rejection === "depth-exceeded"
							? t(
									"canvas.component.enterBlockedDepth",
									"Components cannot be nested any deeper",
								)
							: t("canvas.component.missing", "Missing component"),
			});
		},
		onRename: (componentId, name) => {
			renameComponentImpl(ctx, componentId, name);
		},
		onDuplicate: (componentId) => {
			duplicateComponentImpl(ctx, componentId);
		},
		onDelete: (entry) => {
			// Zero references: the plain guarded delete, no prompt needed.
			if (deleteComponentImpl(ctx, entry.definition.id)) return;
			// Referenced: core refuses outright, and silently detaching would break
			// links the user may not have meant to break (LC-DELETE). So the
			// destructive escalation is EXPLICIT — one atomic "detach all and
			// delete" batch, confirmed first.
			const used = entry.pageInstanceCount + entry.nestedDependencyCount;
			void dialogs
				.confirm({
					destructive: true,
					title: t(
						"canvas.components.deleteConfirmTitle",
						"Delete “{name}” and detach {n} instance(s)?",
					)
						.replace("{name}", entry.definition.name)
						.replace("{n}", String(used)),
					description: t(
						"canvas.components.deleteConfirmBody",
						"Every instance becomes ordinary layers that keep their current appearance. This is one undo step.",
					),
					confirmLabel: t(
						"canvas.components.deleteConfirmAction",
						"Detach all and delete",
					),
				})
				.then((confirmed) => {
					if (!confirmed) return;
					if (
						!deleteComponentImpl(ctx, entry.definition.id, { detachAll: true })
					) {
						// The plan could not be built safely (a cycle, or a Source that
						// no longer resolves): report it instead of failing silently.
						toaster.add({
							type: "warning",
							title: t(
								"canvas.components.deleteBlocked",
								"“{name}” is still used {n}×",
							)
								.replace("{name}", entry.definition.name)
								.replace("{n}", String(used)),
							description: t(
								"canvas.components.deleteBlockedHint",
								"Detach or remove those instances first.",
							),
						});
					}
				});
		},
	};

	const createFromSelection = (): void => {
		if (createComponentFromSelectionImpl(ctx) !== null) return;
		toaster.add({
			type: "warning",
			title: t(
				"canvas.components.createBlocked",
				"Select something unlocked on the canvas first",
			),
		});
	};

	const query = search.trim().toLowerCase();
	const visible = query
		? entries.filter((e) => e.definition.name.toLowerCase().includes(query))
		: entries;

	const createButton = (
		<Button
			type="button"
			variant="outline"
			size="sm"
			className="w-full justify-start gap-2 text-xs"
			data-testid="components-create"
			disabled={selectedIds.length === 0}
			onClick={createFromSelection}
		>
			<Plus className="size-3.5" aria-hidden />
			{t("canvas.components.create", "Create from selection")}
		</Button>
	);

	if (entries.length === 0) {
		return (
			<div
				data-testid="components-panel"
				className={cn("flex flex-col gap-2 p-3", className)}
			>
				{createButton}
				<div
					className="px-1 py-2 text-xs text-muted-foreground italic"
					data-testid="components-panel-empty"
				>
					{t(
						"canvas.components.empty",
						"No components yet. Select something on the canvas and create one.",
					)}
				</div>
			</div>
		);
	}

	if (visible.length === 0) {
		return (
			<div
				data-testid="components-panel"
				className={cn("flex flex-col gap-2 p-3", className)}
			>
				{createButton}
				<div
					className="px-1 py-2 text-xs text-muted-foreground italic"
					data-testid="components-panel-no-match"
				>
					{t(
						"canvas.components.noMatch",
						"No components match “{search}”.",
					).replace("{search}", search)}
				</div>
			</div>
		);
	}

	const renderRow = (entry: ComponentsPanelEntry): React.JSX.Element => (
		<ComponentRow
			entry={entry}
			issue={byComponent.get(entry.definition.id)}
			renaming={renamingId === entry.definition.id}
			onRenameStart={setRenamingId}
			onRenameEnd={() => setRenamingId(null)}
			actions={actions}
			t={t}
		/>
	);

	return (
		<div
			data-testid="components-panel"
			className={cn("flex min-h-0 flex-col gap-2 p-1.5", className)}
		>
			<div className="px-1 pt-1">{createButton}</div>
			<div
				role="list"
				aria-label={t("canvas.panel.components", "Components")}
				className="min-h-0 flex-1"
			>
				{/* Virtualized only past the threshold: the virtualizer needs a laid-out
				    scroll container to compute a window, so below it plain DOM is both
				    cheaper AND observable in a jsdom test (where every measured height
				    is 0 and a virtualizer legitimately renders no rows). */}
				{visible.length > VIRTUALIZE_THRESHOLD ? (
					<Windowed
						items={visible}
						renderItem={renderRow}
						itemKey={(entry) => entry.definition.id}
						estimateSize={ROW_HEIGHT}
						maxHeight={600}
						data-testid="component-rows"
					/>
				) : (
					visible.map((entry) => (
						<div key={entry.definition.id}>{renderRow(entry)}</div>
					))
				)}
			</div>
		</div>
	);
}

const NOOP_SUBSCRIBE = () => () => undefined;
