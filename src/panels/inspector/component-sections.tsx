"use client";

import type {
	CanvasComponentDefinition,
	CanvasComponentInstanceNode,
	CanvasComponentOverride,
	CanvasComponentProperty,
	CanvasNode,
} from "@anvilkit/canvas-core";
import { Button } from "@anvilkit/ui/button";
import { Switch } from "@anvilkit/ui/components/animate-ui/components/base/switch";
import { cn } from "@anvilkit/ui/lib/utils";
import { RotateCcw, Unlink } from "lucide-react";
import * as React from "react";
import { detachComponentInstanceImpl } from "../../actions/component-actions.js";
import type {
	CanvasStudioContextValue,
	CanvasT,
} from "../../context/canvas-studio-context.js";
import { useCanvasDialogs } from "../../context/dialog-context.js";
import { useCanvasToaster } from "../../context/toast-context.js";
import {
	ColorField,
	FieldRow,
	Section,
	TextField,
	useFieldContract,
} from "../fields.js";

/**
 * @file Component Inspector sections (plan 0023 M5-04/M5-05).
 *
 * Two distinct surfaces that happen to share a domain:
 *
 * - {@link ComponentOverrideSection} — for a selected INSTANCE: every exposed
 *   property with its current value, plus reset-one / reset-all
 *   (LC-INSTANCE-003, AC-003).
 * - {@link ComponentPropertySection} — for a node selected INSIDE an open
 *   Source: expose / remove it as a component property (LC-CREATE-003, AC-005).
 *
 * Both go through the shipped §10 field contract (`useFieldContract`), which
 * already gives preview-through-`fieldPreviewStore`, `commitCoalesced` with a
 * per-field merge key, and the A-5 fallback to `commit` when the context has no
 * coalescing commit. NO new coalescer, and no bespoke preview path.
 */

/** Value state of one property on one instance (never signalled by colour alone). */
type OverrideState = "default" | "overridden" | "orphan";

function overrideStateOf(
	property: CanvasComponentProperty | undefined,
	override: CanvasComponentOverride | undefined,
): OverrideState {
	if (!override) return "default";
	// An override whose property is gone (or whose kind no longer matches) is an
	// ORPHAN: retained verbatim, never applied, never reassigned (INV-6).
	if (!property || property.kind !== override.kind) return "orphan";
	return "overridden";
}

function stateLabel(state: OverrideState, t: CanvasT): string {
	if (state === "overridden") {
		return t("canvas.override.overridden", "Overridden");
	}
	if (state === "orphan") return t("canvas.override.orphan", "Orphaned");
	return t("canvas.override.default", "Default");
}

/** The node inside the definition a property binds to. */
function definitionNode(
	definition: CanvasComponentDefinition,
	nodeId: string,
): CanvasNode | undefined {
	const stack: CanvasNode[] = [definition.root];
	while (stack.length > 0) {
		const node = stack.pop() as CanvasNode;
		if (node.id === nodeId) return node;
		const children = (node as { children?: readonly CanvasNode[] }).children;
		if (children) for (const child of children) stack.push(child);
	}
	return undefined;
}

/** Plain text of a text property's DEFAULT, for the field's placeholder value. */
function defaultTextOf(node: CanvasNode | undefined): string {
	if (!node) return "";
	if (node.type === "text") return node.text;
	if (node.type === "rich-text") {
		return node.paragraphs.flatMap((p) => p.spans.map((s) => s.text)).join("");
	}
	return "";
}

function defaultColorOf(
	node: CanvasNode | undefined,
	field: "fill" | "background",
): string | undefined {
	const value = (node as Record<string, unknown> | undefined)?.[field];
	// Only a plain hex/CSS string is editable here; a gradient or brand-token
	// default is shown as "Default" with no value rather than being flattened.
	return typeof value === "string" ? value : undefined;
}

/**
 * Override editor for ONE selected instance.
 *
 * Single-instance only on purpose: overrides are keyed by Property ID within one
 * definition, so a multi-instance selection could span definitions whose
 * identically-named properties mean different things.
 */
export function ComponentOverrideSection({
	node,
	ctx,
	t,
}: {
	node: CanvasComponentInstanceNode;
	ctx: CanvasStudioContextValue;
	t: CanvasT;
}): React.JSX.Element {
	const definition = ctx.ir.components?.[node.componentId];
	const overrides = node.overrides ?? {};

	if (!definition) {
		return <MissingComponentRecovery node={node} ctx={ctx} t={t} />;
	}

	// Orphans first, so a property that stopped applying is not buried under the
	// ones that still work.
	const orphanIds = Object.keys(overrides).filter(
		(id) =>
			overrideStateOf(
				definition.properties.find((p) => p.id === id),
				overrides[id],
			) === "orphan",
	);
	const hasAnyOverride = Object.keys(overrides).length > 0;

	return (
		<Section title={t("canvas.override.title", "Component")}>
			<div
				className="flex items-center justify-between gap-2"
				data-testid="component-instance-summary"
			>
				<span className="truncate text-xs text-muted-foreground">
					{definition.name}
				</span>
				<span className="flex shrink-0 items-center gap-0.5">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="h-6 px-1.5 text-[11px]"
						data-testid="override-reset-all"
						disabled={!hasAnyOverride}
						onClick={() =>
							ctx.commit({
								type: "component-instance.reset-all-overrides",
								nodeId: node.id,
							})
						}
					>
						<RotateCcw className="size-3" aria-hidden />
						{t("canvas.override.resetAll", "Reset all")}
					</Button>
					<DetachButton node={node} ctx={ctx} t={t} />
				</span>
			</div>

			{definition.properties.length === 0 ? (
				<div
					className="text-xs text-muted-foreground italic"
					data-testid="component-no-properties"
				>
					{t(
						"canvas.override.noProperties",
						"This component exposes no editable properties yet.",
					)}
				</div>
			) : (
				definition.properties.map((property) => (
					<OverrideField
						key={property.id}
						property={property}
						definition={definition}
						node={node}
						ctx={ctx}
						t={t}
					/>
				))
			)}

			{orphanIds.map((id) => (
				<div
					key={id}
					data-testid={`override-orphan-${id}`}
					className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground"
				>
					<span className="truncate">
						{t(
							"canvas.override.orphanRow",
							"Kept for a property that no longer exists",
						)}
					</span>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="h-6 px-1.5 text-[11px]"
						data-testid={`override-reset-${id}`}
						onClick={() =>
							ctx.commit({
								type: "component-instance.reset-override",
								nodeId: node.id,
								propertyId: id,
							})
						}
					>
						{t("canvas.override.reset", "Reset")}
					</Button>
				</div>
			))}
		</Section>
	);
}

/**
 * Recovery surface for an instance whose Source is missing (M5-08,
 * LC-RESOLVE-004, AC-011).
 *
 * The editor stays fully usable around it: the instance is still selectable on
 * the stage (the M4 placeholder keeps a hit target), still movable, still
 * exportable, and its overrides are retained verbatim so re-importing the Source
 * makes it whole again. So the recovery this offers is deliberately narrow —
 * NAME the unresolved id (the only thing that lets a user diagnose it) and offer
 * to delete the broken instance. Detach is impossible by contract: core refuses
 * to materialize an unresolvable tree rather than emit a half-built one, and
 * re-pointing an instance at a different component (swap) is explicitly out of
 * scope for this release.
 */
function MissingComponentRecovery({
	node,
	ctx,
	t,
}: {
	node: CanvasComponentInstanceNode;
	ctx: CanvasStudioContextValue;
	t: CanvasT;
}): React.JSX.Element {
	const overrideCount = Object.keys(node.overrides ?? {}).length;
	return (
		<Section title={t("canvas.override.title", "Component")}>
			<div
				className="flex flex-col gap-1.5 text-xs"
				data-testid="component-source-missing"
			>
				<span className="text-destructive">
					{t(
						"canvas.override.sourceMissing",
						"This component's source is missing from the document. Its overrides are kept.",
					)}
				</span>
				{/* The id is the ONLY diagnostic handle a user has for a dangling
				    reference — without it "missing component" is unactionable. */}
				<code
					className="truncate rounded bg-muted px-1 py-0.5 text-[11px]"
					data-testid="component-missing-id"
				>
					{node.componentId}
				</code>
				{overrideCount > 0 ? (
					<span className="text-muted-foreground">
						{t(
							"canvas.override.keptCount",
							"{n} override(s) kept for when the source returns",
						).replace("{n}", String(overrideCount))}
					</span>
				) : null}
				<Button
					type="button"
					variant="outline"
					size="sm"
					className="h-7 self-start text-[11px] text-destructive"
					data-testid="component-missing-delete"
					onClick={() => ctx.commit({ type: "node.delete", nodeId: node.id })}
				>
					{t("canvas.override.deleteBroken", "Delete this instance")}
				</Button>
			</div>
		</Section>
	);
}

/**
 * Detach this instance into ordinary layers (LC-INSTANCE-005), confirmed first.
 *
 * Destructive in the sense that matters: the link to the Source is gone
 * afterwards, so a later Source edit no longer propagates. Appearance is
 * preserved exactly (INV-12), which is what the confirmation says.
 */
function DetachButton({
	node,
	ctx,
	t,
}: {
	node: CanvasComponentInstanceNode;
	ctx: CanvasStudioContextValue;
	t: CanvasT;
}): React.JSX.Element {
	const dialogs = useCanvasDialogs();
	const toaster = useCanvasToaster();
	return (
		<Button
			type="button"
			variant="ghost"
			size="sm"
			className="h-6 px-1.5 text-[11px]"
			data-testid="component-detach"
			onClick={() => {
				void dialogs
					.confirm({
						destructive: true,
						title: t("canvas.detach.title", "Detach this component instance?"),
						description: t(
							"canvas.detach.body",
							"It becomes ordinary layers with the same appearance, and stops updating when the component changes. This is one undo step.",
						),
						confirmLabel: t("canvas.detach.action", "Detach"),
					})
					.then((confirmed) => {
						if (!confirmed) return;
						if (detachComponentInstanceImpl(ctx, node.id)) return;
						// Core rejects an unsafe detach atomically (missing Source, cycle,
						// degraded resolution) rather than emitting a half-materialized
						// tree — so say so instead of reporting success.
						toaster.add({
							type: "warning",
							title: t(
								"canvas.detach.failed",
								"This instance can't be detached safely",
							),
							description: t(
								"canvas.detach.failedHint",
								"Its component source is missing or cannot be resolved.",
							),
						});
					});
			}}
		>
			<Unlink className="size-3" aria-hidden />
			{t("canvas.detach.action", "Detach")}
		</Button>
	);
}

/** One property row: current value, state, and a reset affordance. */
function OverrideField({
	property,
	definition,
	node,
	ctx,
	t,
}: {
	property: CanvasComponentProperty;
	definition: CanvasComponentDefinition;
	node: CanvasComponentInstanceNode;
	ctx: CanvasStudioContextValue;
	t: CanvasT;
}): React.JSX.Element {
	const override = node.overrides?.[property.id];
	const state = overrideStateOf(property, override);
	const target = definitionNode(definition, property.nodeId);
	const nodes = [node as CanvasNode];

	/** Patch the instance's override MAP so the resolver previews the change. */
	const buildPatch = (
		instance: CanvasNode,
		value: CanvasComponentOverride,
	): Record<string, unknown> => ({
		overrides: {
			...(instance as CanvasComponentInstanceNode).overrides,
			[property.id]: value,
		},
	});

	const contractFor = <T,>(
		toOverride: (value: T) => CanvasComponentOverride,
	) => ({
		nodes,
		buildPatch: (instance: CanvasNode, value: T) =>
			buildPatch(instance, toOverride(value)),
		// The command seam: an override is NOT a `node.update` patch — it is its
		// own command, so history/collab see a semantic override edit.
		buildCommand: (instance: CanvasNode, value: T) =>
			({
				type: "component-instance.set-override",
				nodeId: instance.id,
				propertyId: property.id,
				value: toOverride(value),
			}) as never,
	});

	const label = property.name;
	const testId = `override-${property.id}`;

	const resetButton =
		state === "default" ? null : (
			<Button
				type="button"
				variant="ghost"
				size="sm"
				className="h-5 px-1 text-[10px]"
				data-testid={`override-reset-${property.id}`}
				onClick={() =>
					ctx.commit({
						type: "component-instance.reset-override",
						nodeId: node.id,
						propertyId: property.id,
					})
				}
			>
				{t("canvas.override.reset", "Reset")}
			</Button>
		);

	return (
		<div
			data-testid={`override-row-${property.id}`}
			data-state={state}
			className="flex flex-col gap-1"
		>
			<div className="flex items-center justify-between gap-2">
				{/* The state is TEXT, never colour alone (NFR-004). */}
				<span
					className={cn(
						"text-[10px] uppercase tracking-wide",
						state === "orphan" ? "text-destructive" : "text-muted-foreground",
					)}
					data-testid={`override-state-${property.id}`}
				>
					{stateLabel(state, t)}
				</span>
				{resetButton}
			</div>
			{property.kind === "text" ? (
				<TextField
					label={label}
					value={
						override?.kind === "text" && override.value.kind === "plain"
							? override.value.text
							: defaultTextOf(target)
					}
					dataTestId={testId}
					contract={contractFor<string>((text) => ({
						kind: "text",
						value: { kind: "plain", text },
					}))}
				/>
			) : property.kind === "color" ? (
				<ColorField
					label={label}
					value={
						override?.kind === "color" && typeof override.value === "string"
							? override.value
							: defaultColorOf(target, property.targetField)
					}
					dataTestId={testId}
					contract={contractFor<string>((value) => ({ kind: "color", value }))}
				/>
			) : property.kind === "visibility" ? (
				<FieldRow label={label}>
					<Switch
						data-testid={testId}
						checked={
							override?.kind === "visibility"
								? override.visible
								: (target?.visible ?? true)
						}
						onCheckedChange={(visible: boolean) =>
							ctx.commit({
								type: "component-instance.set-override",
								nodeId: node.id,
								propertyId: property.id,
								value: { kind: "visibility", visible },
							})
						}
					/>
				</FieldRow>
			) : (
				// Image properties are set by picking an asset, which the host owns
				// (`ctx.pickAsset`); nothing to type here.
				<FieldRow label={label}>
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="h-7 text-xs"
						data-testid={testId}
						onClick={() => {
							void ctx.pickAsset().then((assetId) => {
								if (!assetId) return;
								ctx.commit({
									type: "component-instance.set-override",
									nodeId: node.id,
									propertyId: property.id,
									value: { kind: "image", assetId },
								});
							});
						}}
					>
						{t("canvas.override.pickImage", "Replace image")}
					</Button>
				</FieldRow>
			)}
		</div>
	);
}

/** Property kinds a node type can legally back (§10.1 target contract). */
export function propertyKindsFor(
	node: CanvasNode,
): readonly CanvasComponentProperty["kind"][] {
	switch (node.type) {
		case "text":
		case "rich-text":
			return ["text", "color", "visibility"];
		case "image":
			return ["image", "visibility"];
		case "frame":
			// A frame can back an image property only through its placeholder well,
			// the same rule `TemplateImageSlot` follows.
			return node.placeholder
				? ["image", "color", "visibility"]
				: ["color", "visibility"];
		case "rect":
		case "ellipse":
		case "polygon":
		case "star":
		case "path":
		case "line":
			return ["color", "visibility"];
		default:
			return ["visibility"];
	}
}

/**
 * Expose / remove component properties for a node selected inside an open
 * Source (M5-04, AC-005).
 *
 * Renders nothing outside Source-editing mode, so `PropertyInspector` can mount
 * it unconditionally.
 */
export function ComponentPropertySection({
	nodes,
	ctx,
	t,
}: {
	nodes: readonly CanvasNode[];
	ctx: CanvasStudioContextValue;
	t: CanvasT;
}): React.JSX.Element | null {
	const componentId = ctx.componentScopeStore
		?.getState()
		.activeFrame()?.componentId;
	const definition = componentId ? ctx.ir.components?.[componentId] : undefined;
	const node = nodes.length === 1 ? nodes[0] : undefined;
	if (!definition || !node || !componentId) return null;

	const exposed = definition.properties.filter((p) => p.nodeId === node.id);
	const available = propertyKindsFor(node).filter(
		(kind) => !exposed.some((p) => p.kind === kind),
	);

	const expose = (kind: CanvasComponentProperty["kind"]): void => {
		const base = {
			id: `prop-${node.id}-${kind}`,
			name: `${node.name ?? node.type} ${kind}`,
			nodeId: node.id,
		};
		const property: CanvasComponentProperty =
			kind === "text"
				? {
						...base,
						kind: "text",
						targetKind: node.type === "rich-text" ? "rich-text" : "text",
					}
				: kind === "image"
					? {
							...base,
							kind: "image",
							targetKind: node.type === "frame" ? "frame" : "image",
						}
					: kind === "color"
						? {
								...base,
								kind: "color",
								// A frame paints `background`; every other fill-bearing kind
								// uses `fill` (stroke is deliberately not a valid target).
								targetField: node.type === "frame" ? "background" : "fill",
							}
						: { ...base, kind: "visibility" };
		ctx.commit({ type: "component.add-property", componentId, property });
	};

	return (
		<Section title={t("canvas.property.title", "Component properties")}>
			{exposed.length === 0 ? (
				<div
					className="text-xs text-muted-foreground italic"
					data-testid="component-property-none"
				>
					{t(
						"canvas.property.none",
						"This layer exposes nothing yet. Expose a property to make it editable per instance.",
					)}
				</div>
			) : (
				exposed.map((property) => (
					<PropertyRow
						key={property.id}
						property={property}
						componentId={componentId}
						ctx={ctx}
						t={t}
					/>
				))
			)}
			<div className="flex flex-wrap gap-1.5">
				{available.map((kind) => (
					<Button
						key={kind}
						type="button"
						variant="outline"
						size="sm"
						className="h-7 text-[11px]"
						data-testid={`property-expose-${kind}`}
						onClick={() => expose(kind)}
					>
						{t(`canvas.property.expose.${kind}`, `Expose ${kind}`)}
					</Button>
				))}
			</div>
		</Section>
	);
}

/** One exposed property: rename inline, or remove it. */
function PropertyRow({
	property,
	componentId,
	ctx,
	t,
}: {
	property: CanvasComponentProperty;
	componentId: string;
	ctx: CanvasStudioContextValue;
	t: CanvasT;
}): React.JSX.Element {
	const instancesWithOverride = countOverrides(ctx, componentId, property.id);
	const dialogs = useCanvasDialogs();
	return (
		<div
			className="flex flex-col gap-1"
			data-testid={`property-row-${property.id}`}
		>
			{/* Deliberately the LEGACY `onCommit` path with NO `contract`: a property
			    rename is a Registry edit, not a node patch, so there is nothing to
			    preview and no per-node coalescing to do. (`TextField` ignores
			    `onCommit` whenever a contract is present — passing an empty-node
			    contract here silently committed nothing.) */}
			<TextField
				label={t(`canvas.property.kind.${property.kind}`, property.kind)}
				value={property.name}
				dataTestId={`property-name-${property.id}`}
				onCommit={(name) => {
					const next = name.trim();
					if (next.length === 0 || next === property.name) return;
					ctx.commit({
						type: "component.update-property",
						componentId,
						propertyId: property.id,
						// The Property ID is STABLE (INV-6) — a rename must never mint a
						// new id, or every existing override would orphan.
						to: { ...property, name: next },
					});
				}}
			/>
			<Button
				type="button"
				variant="ghost"
				size="sm"
				className="h-6 self-start px-1.5 text-[11px] text-destructive"
				data-testid={`property-remove-${property.id}`}
				onClick={() => {
					// Confirm ONLY when removal would orphan real data. Core's command is
					// unconditional by contract — "the Editor owns the prompt" — and the
					// overrides survive as orphans that re-apply if the same Property ID
					// is restored compatibly (§10.3), which is what the copy says.
					if (instancesWithOverride === 0) {
						removeProperty(ctx, componentId, property.id);
						return;
					}
					void dialogs
						.confirm({
							destructive: true,
							title: t(
								"canvas.property.removeConfirmTitle",
								"Remove “{name}”? {n} instance(s) override it",
							)
								.replace("{name}", property.name)
								.replace("{n}", String(instancesWithOverride)),
							description: t(
								"canvas.property.removeConfirmBody",
								"Those overrides are kept but stop applying. Re-exposing the same property restores them.",
							),
							confirmLabel: t("canvas.property.remove", "Remove"),
						})
						.then((confirmed) => {
							if (confirmed) removeProperty(ctx, componentId, property.id);
						});
				}}
			>
				{instancesWithOverride > 0
					? t("canvas.property.removeUsed", "Remove ({n} overridden)").replace(
							"{n}",
							String(instancesWithOverride),
						)
					: t("canvas.property.remove", "Remove")}
			</Button>
		</div>
	);
}

function removeProperty(
	ctx: CanvasStudioContextValue,
	componentId: string,
	propertyId: string,
): void {
	ctx.commit({ type: "component.remove-property", componentId, propertyId });
}

/** How many instances currently override this property — what removal orphans. */
export function countOverrides(
	ctx: CanvasStudioContextValue,
	componentId: string,
	propertyId: string,
): number {
	let count = 0;
	const visit = (node: CanvasNode): void => {
		if (
			node.type === "component-instance" &&
			node.componentId === componentId &&
			node.overrides?.[propertyId] !== undefined
		) {
			count += 1;
		}
		const children = (node as { children?: readonly CanvasNode[] }).children;
		if (children) for (const child of children) visit(child);
	};
	for (const page of ctx.ir.pages) visit(page.root);
	for (const definition of Object.values(ctx.ir.components ?? {})) {
		visit(definition.root);
	}
	return count;
}
