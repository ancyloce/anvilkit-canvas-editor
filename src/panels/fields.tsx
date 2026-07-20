"use client";

import type {
	CanvasAnyNodeUpdateCommand,
	CanvasCommand,
	CanvasNode,
} from "@anvilkit/canvas-core";
import { Input } from "@anvilkit/ui/input";
import { type ReactNode, use, useCallback, useState } from "react";
import {
	CanvasStudioContext,
	CanvasStudioStableContext,
	useCanvasStores,
	useCanvasT,
} from "../context/canvas-studio-context.js";

/**
 * @file Shared inspector field primitives. Extracted verbatim from
 * `PropertyInspector` so the Canva-shell `CanvasToolbar` can surface the same
 * commit-on-blur controls without duplicating logic.
 *
 * B-12 layers the §10 field-input contract on top, additively: a field given
 * the optional {@link FieldContractTarget} `contract` prop previews the
 * in-progress value through the studio's `fieldPreviewStore` (transient — no
 * history entries), commits on Enter/blur as ONE coalesced history entry via
 * `commitCoalesced` (mergeKey = field id + node ids), and reverts on Escape
 * without committing. Fields without `contract` keep the original
 * {@link useCommitPatch} commit-on-blur behavior plus the same Enter/Escape
 * key handling.
 */

const eyebrowClass =
	"text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";

/**
 * Remount key for the commit-on-blur uncontrolled inputs (W3). The fields are
 * uncontrolled (`defaultValue`) and re-key on external value changes
 * (drag/nudge/undo) so the displayed value refreshes. But re-keying *while the
 * user is typing* remounts the input and steals focus/caret. This freezes the
 * key to the value captured at focus time and holds it until blur, so an
 * external update mid-edit no longer interrupts typing; on blur the key tracks
 * the live value again so idle external changes still refresh the field.
 */
function useFrozenKey(value: string): {
	key: string;
	onFocus: () => void;
	onBlur: () => void;
} {
	const [frozen, setFrozen] = useState<string | null>(null);
	return {
		key: frozen ?? value,
		onFocus: () => setFrozen(value),
		onBlur: () => setFrozen(null),
	};
}

export function Section({
	title,
	children,
}: {
	title: string;
	children: ReactNode;
}): React.JSX.Element {
	return (
		<div className="flex flex-col gap-2">
			<div className={eyebrowClass}>{title}</div>
			{children}
		</div>
	);
}

export function FieldRow({
	label,
	title,
	children,
}: {
	label: string;
	/** Native tooltip, e.g. flagging an unresolved brand-token value (canvas-m1-013). */
	title?: string;
	children: ReactNode;
}): React.JSX.Element {
	return (
		<label
			className="grid grid-cols-[64px_1fr] items-center gap-2.5"
			title={title}
		>
			<span className="text-[11.5px] text-muted-foreground">{label}</span>
			{children}
		</label>
	);
}

/**
 * §10 field-input contract target (B-12): the node(s) a field edits and the
 * `node.update` patch a given value maps to. Multi-selection passes every
 * selected node; `buildPatch` runs per node so patches can spread that node's
 * own current sub-objects (transform, bounds, crop, …). Plain data — the field
 * component wires preview/commit/revert internally.
 */
export interface FieldContractTarget<T> {
	nodes: readonly CanvasNode[];
	buildPatch: (node: CanvasNode, value: T) => Record<string, unknown>;
}

/**
 * Internal contract engine shared by every field kind: preview publishes
 * per-node patches to the `fieldPreviewStore`; commit clears the preview and
 * applies the same patches as one coalesced history entry (a `batch` for
 * multi-selection); cancel just clears the preview. All no-ops without a
 * `contract` target.
 */
export function useFieldContract<T>(
	contract: FieldContractTarget<T> | undefined,
	fieldId: string,
): {
	preview: (value: T) => void;
	commit: (value: T) => void;
	cancel: () => void;
	enabled: boolean;
	/** Localized multi-selection placeholder ("Mixed"), host catalog willing. */
	mixedLabel: string;
} {
	// Non-throwing context read: fields also render standalone (e.g. the
	// token-aware fields' literal fallback in isolation); without a studio
	// tree the contract features simply disable and `onCommit` still works.
	const ctx = use(CanvasStudioStableContext) ?? use(CanvasStudioContext);
	const preview = useCallback(
		(value: T) => {
			const store = ctx?.fieldPreviewStore;
			if (!contract || !store) return;
			const entries: Record<string, Record<string, unknown>> = {};
			for (const node of contract.nodes) {
				entries[node.id] = contract.buildPatch(node, value);
			}
			store.getState().setPreviews(entries);
		},
		[contract, ctx],
	);
	const cancel = useCallback(() => {
		ctx?.fieldPreviewStore?.getState().clearPreviews();
	}, [ctx]);
	const commit = useCallback(
		(value: T) => {
			if (!contract || !ctx) return;
			ctx.fieldPreviewStore?.getState().clearPreviews();
			const cmds = contract.nodes.map(
				(node) =>
					({
						type: "node.update",
						nodeId: node.id,
						kind: node.type,
						patch: contract.buildPatch(node, value),
					}) as CanvasAnyNodeUpdateCommand,
			);
			const first = cmds[0];
			if (!first) return;
			const mergeKey = `field:${fieldId}:${contract.nodes
				.map((n) => n.id)
				.join(",")}`;
			const cmd: CanvasCommand =
				cmds.length === 1 ? first : { type: "batch", commands: cmds };
			if (ctx.commitCoalesced) ctx.commitCoalesced(cmd, mergeKey);
			else ctx.commit(cmd);
		},
		[contract, ctx, fieldId],
	);
	return {
		preview,
		commit,
		cancel,
		enabled: contract !== undefined && ctx !== null,
		mixedLabel: ctx?.t?.("canvas.inspector.mixed", "Mixed") ?? "Mixed",
	};
}

export interface NumberFieldProps {
	label: string;
	value: number;
	step?: number;
	min?: number;
	max?: number;
	dataTestId: string;
	/** Legacy commit path; ignored when {@link contract} is present. */
	onCommit?: (next: number) => void;
	/** §10 field-input contract (B-12): preview + coalesced commit + revert. */
	contract?: FieldContractTarget<number>;
	/** Multi-selection mixed value (B-12): renders an empty "Mixed" field. */
	mixed?: boolean;
}

const clamp = (v: number, min?: number, max?: number): number =>
	Math.min(
		max ?? Number.POSITIVE_INFINITY,
		Math.max(min ?? Number.NEGATIVE_INFINITY, v),
	);

export function NumberField({
	label,
	value,
	step,
	min,
	max,
	dataTestId,
	onCommit,
	contract,
	mixed,
}: NumberFieldProps): React.JSX.Element {
	// Uncontrolled (commit-on-blur), re-keyed on external value changes
	// (drag/nudge/undo) to remount with a fresh defaultValue — but the key is
	// frozen while focused (W3) so an external update mid-edit never steals focus.
	const fk = useFrozenKey(mixed ? "mixed" : String(value));
	const field = useFieldContract(contract, dataTestId);
	const commitValue = (parsed: number): void => {
		if (field.enabled) field.commit(parsed);
		else onCommit?.(parsed);
	};
	return (
		<FieldRow label={label}>
			<Input
				key={fk.key}
				type="number"
				aria-label={label}
				defaultValue={mixed ? "" : value}
				placeholder={mixed ? field.mixedLabel : undefined}
				step={step ?? 1}
				className="h-7.5 text-xs"
				{...(min !== undefined ? { min } : {})}
				{...(max !== undefined ? { max } : {})}
				data-testid={dataTestId}
				onFocus={fk.onFocus}
				onChange={(e) => {
					// §10 transient preview: valid in-progress values render on the
					// canvas via the preview store, never through history.
					const parsed = Number.parseFloat(e.currentTarget.value);
					if (!Number.isNaN(parsed)) field.preview(clamp(parsed, min, max));
				}}
				onKeyDown={(e) => {
					if (e.key === "Enter") {
						e.currentTarget.blur(); // blur commits
					} else if (e.key === "Escape") {
						// §10 revert: restore the pre-edit value and drop the preview.
						// The blur guard (`parsed !== value`) then skips the commit.
						// Stop propagation so the workspace Escape stack stays out of it.
						e.stopPropagation();
						e.currentTarget.value = mixed ? "" : String(value);
						field.cancel();
					} else if (
						e.shiftKey &&
						(e.key === "ArrowUp" || e.key === "ArrowDown")
					) {
						// FR-070: Shift+arrow = 10× step.
						e.preventDefault();
						const current = Number.parseFloat(e.currentTarget.value);
						const base = Number.isNaN(current) ? value : current;
						const delta = (step ?? 1) * 10 * (e.key === "ArrowUp" ? 1 : -1);
						const next = clamp(base + delta, min, max);
						e.currentTarget.value = String(next);
						field.preview(next);
					}
				}}
				onBlur={(e) => {
					fk.onBlur();
					const raw = e.currentTarget.value;
					const parsed = Number.parseFloat(raw);
					if (Number.isNaN(parsed) || (mixed && raw === "")) {
						field.cancel();
						return;
					}
					const next = clamp(parsed, min, max);
					if (mixed || next !== value) commitValue(next);
					else field.cancel();
				}}
			/>
		</FieldRow>
	);
}

export interface TextFieldProps {
	label: string;
	value: string;
	dataTestId: string;
	/** Legacy commit path; ignored when {@link contract} is present. */
	onCommit?: (next: string) => void;
	/** §10 field-input contract (B-12): preview + coalesced commit + revert. */
	contract?: FieldContractTarget<string>;
	/** Multi-selection mixed value (B-12): renders an empty "Mixed" field. */
	mixed?: boolean;
	/** Native tooltip, e.g. flagging an unresolved brand-token value (canvas-m1-013). */
	title?: string;
}

export function TextField({
	label,
	value,
	dataTestId,
	onCommit,
	contract,
	mixed,
	title,
}: TextFieldProps): React.JSX.Element {
	// See NumberField: re-key uncontrolled input on external change, frozen
	// while focused (W3) so typing is never interrupted.
	const fk = useFrozenKey(mixed ? "mixed" : value);
	const field = useFieldContract(contract, dataTestId);
	return (
		<FieldRow label={label} title={title}>
			<Input
				key={fk.key}
				type="text"
				aria-label={label}
				defaultValue={mixed ? "" : value}
				placeholder={mixed ? field.mixedLabel : undefined}
				className="h-7.5 text-xs"
				data-testid={dataTestId}
				onFocus={fk.onFocus}
				onChange={(e) => field.preview(e.currentTarget.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter") {
						e.currentTarget.blur();
					} else if (e.key === "Escape") {
						e.stopPropagation();
						e.currentTarget.value = mixed ? "" : value;
						field.cancel();
					}
				}}
				onBlur={(e) => {
					fk.onBlur();
					const next = e.currentTarget.value;
					if (mixed && next === "") {
						field.cancel();
						return;
					}
					if (mixed || next !== value) {
						if (field.enabled) field.commit(next);
						else onCommit?.(next);
					} else field.cancel();
				}}
			/>
		</FieldRow>
	);
}

export interface ColorFieldProps {
	label: string;
	value: string | undefined;
	dataTestId: string;
	/** Legacy commit path; ignored when {@link contract} is present. */
	onCommit?: (next: string) => void;
	/** §10 field-input contract (B-12): preview + coalesced commit + revert. */
	contract?: FieldContractTarget<string>;
	/** Native tooltip, e.g. flagging an unresolved brand-token value (canvas-m1-013). */
	title?: string;
	/** FR-074: hide the R/G/B numeric inputs for space-constrained hosts. */
	rgb?: boolean;
	/**
	 * FR-074 eyedropper adapter seam. Resolve to a hex color, or `null` when
	 * the user cancelled. Defaults to the platform `EyeDropper` API when the
	 * browser provides it; when neither an adapter nor platform support
	 * exists, no eyedropper button renders (graceful fallback).
	 */
	eyeDropper?: () => Promise<string | null>;
}

/**
 * FR-074 hex parsing. Accepts `rgb`, `rrggbb`, or `rrggbbaa` with or without
 * a leading `#`; returns the normalized lowercase `#…` form or `null`.
 */
export function normalizeHexColor(input: string): string | null {
	const raw = input.trim().replace(/^#/, "").toLowerCase();
	if (/^[0-9a-f]{3}$/.test(raw)) {
		return `#${raw[0]}${raw[0]}${raw[1]}${raw[1]}${raw[2]}${raw[2]}`;
	}
	if (/^[0-9a-f]{6}$/.test(raw) || /^[0-9a-f]{8}$/.test(raw)) return `#${raw}`;
	return null;
}

/** Split a `#rrggbb`/`#rrggbbaa` color into 0-255 channels (+ alpha suffix). */
export function hexColorChannels(
	value: string,
): { r: number; g: number; b: number; alphaSuffix: string } | null {
	if (!/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(value)) return null;
	return {
		r: Number.parseInt(value.slice(1, 3), 16),
		g: Number.parseInt(value.slice(3, 5), 16),
		b: Number.parseInt(value.slice(5, 7), 16),
		alphaSuffix: value.slice(7).toLowerCase(),
	};
}

function channelsToHex(
	r: number,
	g: number,
	b: number,
	alphaSuffix: string,
): string {
	const c = (n: number): string =>
		Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
	return `#${c(r)}${c(g)}${c(b)}${alphaSuffix}`;
}

type EyeDropperCtor = new () => { open(): Promise<{ sRGBHex: string }> };

/** Feature-detected platform eyedropper (Chromium-only API; never a hard dep). */
function platformEyeDropper(): (() => Promise<string | null>) | undefined {
	if (typeof window === "undefined") return undefined;
	const ctor = (window as { EyeDropper?: EyeDropperCtor }).EyeDropper;
	if (!ctor) return undefined;
	return async () => {
		try {
			const result = await new ctor().open();
			return result.sRGBHex;
		} catch {
			// AbortError on user cancel — treated as "no pick".
			return null;
		}
	};
}

export function ColorField({
	label,
	value,
	dataTestId,
	onCommit,
	contract,
	title,
	rgb = true,
	eyeDropper,
}: ColorFieldProps): React.JSX.Element {
	const t = useCanvasT();
	// See NumberField: re-key uncontrolled input on external change, frozen
	// while focused (W3).
	const fk = useFrozenKey(value ?? "#000000");
	const field = useFieldContract(contract, dataTestId);
	const commitValue = (next: string): void => {
		if (next !== value) {
			if (field.enabled) field.commit(next);
			else onCommit?.(next);
		} else field.cancel();
	};
	const channels = hexColorChannels(value ?? "");
	const dropper = eyeDropper ?? platformEyeDropper();
	const channelLabels = {
		r: t("canvas.color.r", "R"),
		g: t("canvas.color.g", "G"),
		b: t("canvas.color.b", "B"),
	} as const;
	return (
		<FieldRow label={label} title={title}>
			<div className="flex flex-col gap-1">
				<div className="flex items-center gap-2">
					<span
						className="size-5 shrink-0 rounded-sm ring-1 ring-border"
						style={{ backgroundColor: value ?? "#000000" }}
						aria-hidden
					/>
					{/* FR-074: explicit editable hex input. */}
					<Input
						key={`hex-${fk.key}`}
						type="text"
						inputMode="text"
						spellCheck={false}
						maxLength={9}
						aria-label={`${label} — ${t("canvas.color.hex", "Hex")}`}
						defaultValue={value ?? "#000000"}
						className="h-7.5 min-w-0 flex-1 font-mono text-xs"
						data-testid={`${dataTestId}-hex`}
						onFocus={fk.onFocus}
						onChange={(e) => {
							const next = normalizeHexColor(e.currentTarget.value);
							if (next) field.preview(next);
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								e.currentTarget.blur();
							} else if (e.key === "Escape") {
								e.stopPropagation();
								e.currentTarget.value = value ?? "#000000";
								field.cancel();
							}
						}}
						onBlur={(e) => {
							fk.onBlur();
							const next = normalizeHexColor(e.currentTarget.value);
							if (next) commitValue(next);
							else {
								e.currentTarget.value = value ?? "#000000";
								field.cancel();
							}
						}}
					/>
					<Input
						key={fk.key}
						type="color"
						aria-label={label}
						defaultValue={channels ? (value ?? "#000000").slice(0, 7) : "#000000"}
						className="h-7.5 w-9 shrink-0 p-0.5"
						data-testid={dataTestId}
						onFocus={fk.onFocus}
						onChange={(e) => field.preview(e.currentTarget.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								e.currentTarget.blur();
							} else if (e.key === "Escape") {
								e.stopPropagation();
								e.currentTarget.value = value ?? "#000000";
								field.cancel();
							}
						}}
						onBlur={(e) => {
							fk.onBlur();
							commitValue(e.currentTarget.value);
						}}
					/>
					{dropper ? (
						<button
							type="button"
							className="flex size-7 shrink-0 items-center justify-center rounded-sm ring-1 ring-border hover:bg-accent"
							aria-label={`${label} — ${t("canvas.color.eyedropper", "Pick color from screen")}`}
							title={t("canvas.color.eyedropper", "Pick color from screen")}
							data-testid={`${dataTestId}-eyedropper`}
							onClick={() => {
								void dropper().then((picked) => {
									if (picked) {
										const next = normalizeHexColor(picked);
										if (next) commitValue(next);
									}
								});
							}}
						>
							<svg
								aria-hidden
								width="12"
								height="12"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
							>
								<path d="m2 22 1-1h3l9-9" />
								<path d="M3 21v-3l9-9" />
								<path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z" />
							</svg>
						</button>
					) : null}
				</div>
				{/* FR-074: RGB channel inputs (0-255), hidden for non-hex values. */}
				{rgb && channels ? (
					<div className="flex items-center gap-1">
						{(["r", "g", "b"] as const).map((channel) => (
							<Input
								key={`${channel}-${fk.key}`}
								type="number"
								min={0}
								max={255}
								step={1}
								aria-label={`${label} — ${channelLabels[channel]}`}
								defaultValue={channels[channel]}
								className="h-6.5 min-w-0 flex-1 px-1 text-xs"
								data-testid={`${dataTestId}-${channel}`}
								onFocus={fk.onFocus}
								onChange={(e) => {
									const n = Number(e.currentTarget.value);
									if (!Number.isFinite(n)) return;
									field.preview(
										channelsToHex(
											channel === "r" ? n : channels.r,
											channel === "g" ? n : channels.g,
											channel === "b" ? n : channels.b,
											channels.alphaSuffix,
										),
									);
								}}
								onKeyDown={(e) => {
									if (e.key === "Enter") {
										e.currentTarget.blur();
									} else if (e.key === "Escape") {
										e.stopPropagation();
										e.currentTarget.value = String(channels[channel]);
										field.cancel();
									}
								}}
								onBlur={(e) => {
									fk.onBlur();
									const n = Number(e.currentTarget.value);
									if (!Number.isFinite(n)) {
										e.currentTarget.value = String(channels[channel]);
										field.cancel();
										return;
									}
									commitValue(
										channelsToHex(
											channel === "r" ? n : channels.r,
											channel === "g" ? n : channels.g,
											channel === "b" ? n : channels.b,
											channels.alphaSuffix,
										),
									);
								}}
							/>
						))}
					</div>
				) : null}
			</div>
		</FieldRow>
	);
}

/** Applies a partial node patch through the editor's `node.update` pipeline. */
export type CommitPatch = (
	node: CanvasNode,
	patch: Record<string, unknown>,
) => void;

/**
 * Returns a stable {@link CommitPatch} bound to the current studio context.
 * Identical to the inspector's former local `commitPatch` — every field
 * mutation flows through `ctx.commit({ type: "node.update", … })`. Discrete
 * controls (switches, selects, buttons) keep using this; continuous fields
 * upgrade to the `contract` prop (§10, B-12).
 */
export function useCommitPatch(): CommitPatch {
	const ctx = useCanvasStores();
	return useCallback<CommitPatch>(
		(targetNode, patch) => {
			const cmd = {
				type: "node.update",
				nodeId: targetNode.id,
				kind: targetNode.type,
				patch,
			} as CanvasAnyNodeUpdateCommand;
			ctx.commit(cmd);
		},
		[ctx],
	);
}

/** Applies a PER-NODE patch across every given node, as one undo entry. */
export type CommitPatchAll = (
	nodes: readonly CanvasNode[],
	build: (node: CanvasNode) => Record<string, unknown>,
	label?: string,
) => void;

/**
 * Multi-node counterpart of {@link useCommitPatch} (FR-070 B-12 multi-kind
 * sections): commits `build(node)` for every node in `nodes` as ONE undo
 * entry — a `commitBatch` when there's more than one node, a plain `commit`
 * otherwise. Continuous fields already get this "one batch across the whole
 * selection" behavior from the `contract` prop (`useFieldContract` below,
 * fed `nodes` instead of a single-node array); this is the same guarantee
 * for DISCRETE controls (selects, switches, buttons) that bypass the field
 * contract, generalizing the pattern `AppearanceSection`'s `patchAll` and
 * `TransformSection`'s `batchPatch` each already established locally.
 */
export function useCommitPatchAll(): CommitPatchAll {
	const ctx = useCanvasStores();
	return useCallback<CommitPatchAll>(
		(nodes, build, label) => {
			const cmds = nodes.map(
				(node) =>
					({
						type: "node.update",
						nodeId: node.id,
						kind: node.type,
						patch: build(node),
					}) as CanvasAnyNodeUpdateCommand,
			);
			const first = cmds[0];
			if (!first) return;
			if (cmds.length === 1) ctx.commit(first);
			else ctx.commitBatch(cmds, label ?? "Update");
		},
		[ctx],
	);
}

/**
 * Shared-value/mixed reduction over a selection (FR-070 multi-editing):
 * displays the FIRST node's value; `mixed` flags when another selected node
 * disagrees — the exact semantics `NumberField`/`TextField`'s `mixed` prop
 * expect. Generalizes the per-file `shared()` helper already duplicated
 * (identically) in `PropertyInspector.tsx` and `transform-section.tsx`;
 * kind-specific sections (rect/ellipse/.../text/image/…) are the third-plus
 * call site, so the shared, generic version lives here for them to reuse.
 * Callers must only invoke this over a NON-EMPTY `nodes` array — every
 * kind-specific section already gates on the selection being non-empty
 * before rendering.
 */
export function sharedFieldValue<T>(
	nodes: readonly CanvasNode[],
	get: (n: CanvasNode) => T,
): { value: T; mixed: boolean } {
	const v = get(nodes[0] as CanvasNode);
	return { value: v, mixed: nodes.some((n) => get(n) !== v) };
}
