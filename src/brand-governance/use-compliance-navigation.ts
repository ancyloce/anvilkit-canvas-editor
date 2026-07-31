"use client";

import type { BrandComplianceIssue, CanvasIR } from "@anvilkit/canvas-core";
import { findNode, findNodeInSubtree } from "@anvilkit/canvas-core";
import { useCallback } from "react";

import { useCanvasStudio } from "../context/canvas-studio-context.js";

/**
 * @file Issue → target resolution and the jump itself (plan 0021 T-044).
 *
 * ## Structural ids only — never the message
 *
 * Resolution reads `pageId`, `nodeId`, `instanceId`, `sourceNodeId`,
 * `propertyId` and `variantId`. It never reads display text, and there is no
 * display text to read: `BrandComplianceIssue` deliberately has no `message`
 * field (T-041 step 5), so copy is derived from `code` at render time. That is
 * what keeps navigation working identically in all four locales — a lookup
 * keyed on a localized string silently stops resolving the moment someone
 * switches language, and the failure looks like a data bug rather than an i18n
 * one. `compliance-navigation.test.ts` asserts a target resolves the same way
 * under a `t` that returns garbage.
 *
 * ## Three target classes, and an honest fourth
 *
 * A page node, a page-level instance (optionally down to a virtual node inside
 * its resolved Source), and a Component Source definition — reached through the
 * Components panel, because a Source is not on any page and selecting "into" it
 * is a scope change rather than a selection. The fourth is `unavailable`: an
 * issue whose node exists in neither place. Reporting that plainly beats
 * silently doing nothing, which reads to the user as a broken row.
 */

export type ComplianceNavigationTarget =
	| {
			readonly kind: "node";
			readonly pageId: string;
			readonly nodeId: string;
			/** Page-level instance the issue belongs to, when it is inside one. */
			readonly instanceId?: string;
			/** Virtual node inside the resolved Source (OD-08: not selectable directly). */
			readonly sourceNodeId?: string;
			readonly propertyId?: string;
			readonly variantId?: string;
	  }
	| {
			readonly kind: "component";
			readonly componentId: string;
			readonly propertyId?: string;
			readonly variantId?: string;
	  }
	| { readonly kind: "unavailable" };

/** Copy `k` from `issue` onto `into` only when it is present (INV-10 omit-empty). */
function withOptional<T extends Record<string, unknown>>(
	into: T,
	issue: BrandComplianceIssue,
): T {
	const out: Record<string, unknown> = { ...into };
	if (issue.propertyId !== undefined) out.propertyId = issue.propertyId;
	if (issue.variantId !== undefined) out.variantId = issue.variantId;
	return out as T;
}

/**
 * Resolve one issue to a navigable target.
 *
 * Pure and React-free so the resolution table can be tested directly.
 */
export function resolveComplianceTarget(
	ir: CanvasIR,
	issue: BrandComplianceIssue,
): ComplianceNavigationTarget {
	// The page-level instance is the selectable thing when the issue is about a
	// virtual node inside a resolved Source: virtual ids are derived from a
	// resolution and change whenever the Source or variant does, so selecting
	// one would break on the very next edit.
	const anchorId = issue.instanceId ?? issue.nodeId;
	const found = findNode(ir, anchorId);
	if (found) {
		const base = {
			kind: "node" as const,
			pageId: found.page.id,
			nodeId: found.node.id,
			...(issue.instanceId !== undefined
				? { instanceId: issue.instanceId }
				: {}),
			...(issue.sourceNodeId !== undefined
				? { sourceNodeId: issue.sourceNodeId }
				: issue.instanceId !== undefined && issue.nodeId !== issue.instanceId
					? // The issue named a node that is not the instance itself, so the
						// node IS the virtual one even if the scanner did not label it.
						{ sourceNodeId: issue.nodeId }
					: {}),
		};
		return withOptional(base, issue);
	}

	// Not on a page. A Component Source definition is the documented fallback
	// (T-044 step 2) — it is reachable, just not by selecting a page node.
	for (const [componentId, definition] of Object.entries(ir.components ?? {})) {
		if (
			componentId === anchorId ||
			findNodeInSubtree(definition.root, anchorId)
		) {
			return withOptional({ kind: "component" as const, componentId }, issue);
		}
	}
	return { kind: "unavailable" };
}

export interface ComplianceNavigation {
	resolve(issue: BrandComplianceIssue): ComplianceNavigationTarget;
	/**
	 * Perform the jump. Returns the target it acted on so a caller can move
	 * focus, or announce why it could not (A11Y requirement of T-044).
	 */
	navigate(issue: BrandComplianceIssue): ComplianceNavigationTarget;
}

/**
 * Navigate from a compliance issue to the thing it is about.
 *
 * The jump is page activation + selection — never a document command. Looking
 * at a problem must not be an undoable edit.
 */
export function useComplianceNavigation(): ComplianceNavigation {
	const ctx = useCanvasStudio();
	const resolve = useCallback(
		(issue: BrandComplianceIssue) => resolveComplianceTarget(ctx.ir, issue),
		[ctx.ir],
	);
	const navigate = useCallback(
		(issue: BrandComplianceIssue): ComplianceNavigationTarget => {
			const target = resolve(issue);
			if (target.kind === "node") {
				const pages = ctx.pagesStore.getState();
				if (pages.activePageId !== target.pageId) {
					pages.setActivePageId(target.pageId);
				}
				ctx.selectionStore.getState().setSelection([target.nodeId]);
			}
			// A `component` target is handled by the caller opening the Components
			// panel: entering a Source is a scope push, and pushing scope from a
			// report row would yank the user out of the document they are reading.
			return target;
		},
		[ctx.pagesStore, ctx.selectionStore, resolve],
	);
	return { resolve, navigate };
}
