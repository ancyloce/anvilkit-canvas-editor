"use client";

import type {
	CanvasAnyNodeUpdateCommand,
	CanvasCommand,
	CanvasNode,
} from "@anvilkit/canvas-core";
import { use, useCallback } from "react";
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
