"use client";

import type {
	CanvasAnyNodeUpdateCommand,
	CanvasCommand,
	CanvasNode,
	CanvasPage,
} from "@anvilkit/canvas-core";
import { use, useCallback, useEffect, useRef } from "react";
import type { PagePreviewPatch } from "../stores/field-preview-store.js";
import { fieldInteractionKind } from "../perf/interaction-performance.js";
import {
	CanvasStudioContext,
	CanvasStudioStableContext,
} from "./canvas-studio-context.js";

/**
 * @file §10 field-input contract engine (B-12, PRD 0012 FR-070).
 *
 * Moved here from `panels/fields.tsx` by plan 0024 Phase 1. The engine depends
 * on nothing but the studio context, yet living under `panels/` (rank 3) put it
 * out of reach of `tools/` (rank 1, interaction-core) — see
 * `scripts/check-layering.mjs`. That is not a cosmetic placement problem: it is
 * why `RichTextToolbar` grew a PARALLEL live-editing mechanism (committing to
 * history on every pointer move with a merge key) instead of previewing like
 * every other continuous control. Hosting the engine in `context/`, alongside
 * the context it reads, makes the one implementation reachable from both
 * domains. `panels/fields.tsx` re-exports it, so every existing import path and
 * the public `FieldContractTarget` export are unchanged.
 */

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
	/**
	 * Command-builder seam (T-M4-02): when present, commit dispatches this
	 * command per node instead of wrapping `buildPatch` in a `node.update` —
	 * the vehicle for `frame.set-layout` Inspector fields. Preview always
	 * flows through `buildPatch` + the preview store regardless, and commit
	 * still runs through the same coalescing pipeline; this hook only swaps
	 * what command is built.
	 */
	buildCommand?: (node: CanvasNode, value: T) => CanvasCommand;
}

/**
 * Page-level contract (plan 0024 Phase 2): the artboard's own properties —
 * size, background — which no `node.update` can express.
 *
 * `buildCommand` is REQUIRED here, unlike the node contract. There is no
 * generic `page.update`: each property has its own command (`page.resize`,
 * `page.set-background`, …), so there is nothing to synthesise a default from.
 * Build both functions from ONE derivation of the next value — see
 * `pageFieldContract` in `PropertyInspector` — or preview and commit can
 * silently disagree and the canvas will lie mid-drag.
 */
export interface FieldPageContract<T> {
	page: CanvasPage;
	buildPatch: (page: CanvasPage, value: T) => PagePreviewPatch;
	buildCommand: (page: CanvasPage, value: T) => CanvasCommand;
}

/**
 * Either target. Deliberately NOT folded into `FieldContractTarget` itself:
 * neither `nodes` nor `page` is a literal type, so TypeScript cannot use them
 * to discriminate a bare object literal, and every one of the ~65 existing
 * `contract={{ nodes, buildPatch }}` literals would lose contextual typing on
 * `buildPatch`'s parameters (TS7006). Keeping the two named types separate and
 * uniting them only where a VARIABLE is passed preserves inference on both
 * sides — page fields take their own prop and get full inference from a
 * single, non-union contextual type.
 */
export type AnyFieldContract<T> = FieldContractTarget<T> | FieldPageContract<T>;

/** Per-field tuning for {@link useFieldContract}. */
export interface FieldContractOptions {
	/**
	 * Whether consecutive commits from this field fold into ONE history entry
	 * (default `true`).
	 *
	 * Coalescing is what makes a CONTINUOUS control (drag a slider, hold an
	 * arrow key) land a single undo step instead of one per frame. A DISCRETE
	 * control has no such stream: each pick is a deliberate, separate act, so
	 * folding two picks inside the merge window silently destroys the
	 * intermediate state the user might want back. Discrete fields
	 * (`SelectControl`) pass `false`.
	 */
	coalesce?: boolean;
}

/**
 * Internal contract engine shared by every field kind: preview publishes
 * per-node patches to the `fieldPreviewStore`; commit clears the preview and
 * applies the same patches as one coalesced history entry (a `batch` for
 * multi-selection); cancel just clears the preview. All no-ops without a
 * `contract` target.
 *
 * Accepts either target shape (plan 0024 Phase 2). A page contract previews
 * through `setPagePreviews` and commits its own single command; everything
 * else — coalescing, revert, the `enabled`/`mixedLabel` surface — is identical,
 * which is the point of routing both through one engine.
 */
export function useFieldContract<T>(
	contract: AnyFieldContract<T> | undefined,
	fieldId: string,
	options?: FieldContractOptions,
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
	const coalesce = options?.coalesce ?? true;
	// Does THIS field own the preview currently in the store? `setPreviews`
	// replaces the whole map, so at most one field is ever mid-edit — but "a
	// preview exists" is not "this field published it", and the lifecycle clear
	// below must not wipe a preview some other field owns.
	const previewing = useRef(false);
	const previewStore = ctx?.fieldPreviewStore;
	// The nodes/page this field currently edits. Keyed on IDs rather than on the
	// `contract` object: nearly every call site builds that object inline, so its
	// identity changes on every render and a dependency on it would cancel the
	// very preview in flight.
	const targetKey = contract
		? "page" in contract
			? `page:${contract.page.id}`
			: contract.nodes.map((n) => n.id).join(",")
		: "";
	const interactionKind = fieldInteractionKind(fieldId);
	// The ONLY thing that used to clear a preview was an explicit commit/cancel
	// on the field itself, so any interruption — unmount, a selection change that
	// never fires the input's blur, a peer deleting the edited node — stranded
	// the patch in the store. `withPreviews` keeps merging a stranded patch into
	// every resolution, which for a PAGE preview leaves the whole artboard (and
	// the grid extent and guide insets) rendering a value the document does not
	// have, with no way back short of a reload. This cleanup fires on unmount AND
	// whenever the edited target changes, which covers both.
	useEffect(
		() => () => {
			if (!previewing.current) return;
			previewing.current = false;
			previewStore?.getState().clearPreviews();
			ctx?.interactionPerformance?.end(interactionKind);
		},
		[ctx, interactionKind, previewStore, targetKey],
	);
	const preview = useCallback(
		(value: T) => {
			const store = ctx?.fieldPreviewStore;
			if (!contract || !store) return;
			ctx.interactionPerformance?.begin(
				interactionKind,
				ctx.resolvedDocumentStore?.getState().resolved.records.size ?? 0,
			);
			if ("page" in contract) {
				store.getState().setPagePreviews({
					[contract.page.id]: contract.buildPatch(contract.page, value),
				});
				previewing.current = true;
				return;
			}
			const entries: Record<string, Record<string, unknown>> = {};
			for (const node of contract.nodes) {
				entries[node.id] = contract.buildPatch(node, value);
			}
			store.getState().setPreviews(entries);
			previewing.current = true;
		},
		[contract, ctx, interactionKind],
	);
	const cancel = useCallback(() => {
		previewing.current = false;
		ctx?.fieldPreviewStore?.getState().clearPreviews();
		ctx?.interactionPerformance?.end(interactionKind);
	}, [ctx, interactionKind]);
	const commit = useCallback(
		(value: T) => {
			if (!contract || !ctx) return;
			previewing.current = false;
			ctx.fieldPreviewStore?.getState().clearPreviews();
			ctx.interactionPerformance?.end(interactionKind);
			if ("page" in contract) {
				const cmd = contract.buildCommand(contract.page, value);
				const mergeKey = `field:${fieldId}:${contract.page.id}`;
				if (coalesce && ctx.commitCoalesced) ctx.commitCoalesced(cmd, mergeKey);
				else ctx.commit(cmd);
				return;
			}
			const cmds = contract.nodes.map(
				(node): CanvasCommand =>
					contract.buildCommand
						? contract.buildCommand(node, value)
						: ({
								type: "node.update",
								nodeId: node.id,
								kind: node.type,
								patch: contract.buildPatch(node, value),
							} as CanvasAnyNodeUpdateCommand),
			);
			const first = cmds[0];
			if (!first) return;
			const mergeKey = `field:${fieldId}:${contract.nodes
				.map((n) => n.id)
				.join(",")}`;
			const cmd: CanvasCommand =
				cmds.length === 1 ? first : { type: "batch", commands: cmds };
			if (coalesce && ctx.commitCoalesced) ctx.commitCoalesced(cmd, mergeKey);
			else ctx.commit(cmd);
		},
		[coalesce, contract, ctx, fieldId, interactionKind],
	);
	return {
		preview,
		commit,
		cancel,
		enabled: contract !== undefined && ctx !== null,
		mixedLabel: ctx?.t?.("canvas.inspector.mixed", "Mixed") ?? "Mixed",
	};
}
