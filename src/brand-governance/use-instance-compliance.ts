"use client";

import type {
	BrandComplianceIssue,
	BrandKitDefinition,
	CanvasIR,
	CanvasNode,
} from "@anvilkit/canvas-core";
import { generateBrandComplianceReport } from "@anvilkit/canvas-core";
import { useMemo } from "react";

/**
 * @file Per-node compliance lookup (plan 0021 T-043).
 *
 * ## The bug this replaces
 *
 * `brand-warnings.tsx` memoized a **whole-document** compliance scan on
 * `[ctx.ir, definition, nodes, t]` and then kept only the selected nodes'
 * issues. `nodes` changes on every selection change, so clicking around a
 * 1,000-node document re-scanned the entire document on every click and threw
 * almost all of the result away.
 *
 * The fix is not a cache behind that call — the caller was asking a different
 * question each time. It is to memoize on **`[ir, brandKit]` only** and expose a
 * per-node lookup, so a selection change is a `Map.get` rather than a scan.
 *
 * `t` is deliberately NOT a dependency: it only affects how an issue is
 * *rendered*, never which issues exist, and including it made a locale change
 * re-scan the document.
 */

export interface InstanceComplianceLookup {
	/** Issues for one node id. Empty array when clean. */
	forNode(nodeId: string): readonly BrandComplianceIssue[];
	/** Issues for a selection, deduplicated by node. */
	forNodes(nodeIds: readonly string[]): readonly BrandComplianceIssue[];
	/**
	 * Worst severity per component definition id (T-044 step 5), for the
	 * Components panel's per-row status. Absent means clean.
	 *
	 * Computed in the SAME pass as the per-node index rather than by a second
	 * walk: the Components panel would otherwise run its own whole-document
	 * scan, which is the exact shape of the bug T-043 removed from the
	 * Inspector.
	 */
	readonly byComponent: ReadonlyMap<string, "warning" | "blocking">;
	/** How many document scans this lookup has performed. Test/diagnostic only. */
	readonly scanCount: number;
}

/**
 * Map every page-level component instance to the local component id it
 * instantiates. External instances have no local definition to roll up to, so
 * they are skipped rather than keyed by their library id.
 */
function localComponentByInstance(ir: CanvasIR): Map<string, string> {
	const out = new Map<string, string>();
	for (const page of ir.pages) {
		const stack: CanvasNode[] = [page.root];
		while (stack.length > 0) {
			const node = stack.pop() as CanvasNode;
			if (node.type === "component-instance" && node.source.kind === "local") {
				out.set(node.id, node.source.componentId);
			}
			const children = (node as { children?: readonly CanvasNode[] }).children;
			if (children) stack.push(...children);
		}
	}
	return out;
}

/**
 * Build a per-node lookup from one document scan.
 *
 * Exported separately from the hook so a test can drive it without React and
 * count scans directly.
 */
export function buildComplianceLookup(
	ir: CanvasIR,
	brandKit: BrandKitDefinition | undefined,
	scan: (
		ir: CanvasIR,
		kit: BrandKitDefinition,
	) => { issues: BrandComplianceIssue[] } = generateBrandComplianceReport,
): InstanceComplianceLookup {
	if (!brandKit) {
		return {
			forNode: () => [],
			forNodes: () => [],
			byComponent: new Map(),
			scanCount: 0,
		};
	}
	const componentByInstance = localComponentByInstance(ir);
	const byNode = new Map<string, BrandComplianceIssue[]>();
	const byComponent = new Map<string, "warning" | "blocking">();
	for (const issue of scan(ir, brandKit).issues) {
		const list = byNode.get(issue.nodeId);
		if (list) list.push(issue);
		else byNode.set(issue.nodeId, [issue]);

		const componentId = componentByInstance.get(issue.instanceId ?? issue.nodeId);
		if (componentId) {
			// Worst-wins: one blocking issue anywhere in a component's instances
			// makes the component blocking, and a later warning must not demote it.
			const severity = issue.severity === "blocking" ? "blocking" : "warning";
			if (severity === "blocking" || !byComponent.has(componentId)) {
				byComponent.set(componentId, severity);
			}
		}
	}
	return {
		byComponent,
		forNode: (nodeId) => byNode.get(nodeId) ?? [],
		forNodes: (nodeIds) => {
			const out: BrandComplianceIssue[] = [];
			// Deduplicate node ids so a repeated id in a selection cannot double
			// every one of its issues.
			for (const nodeId of new Set(nodeIds)) {
				out.push(...(byNode.get(nodeId) ?? []));
			}
			return out;
		},
		scanCount: 1,
	};
}

/**
 * Memoized per-node compliance for the current document.
 *
 * Recomputes only when the document or the Brand Kit changes — never on
 * selection.
 */
const SHARED = new WeakMap<
	CanvasIR,
	WeakMap<BrandKitDefinition, InstanceComplianceLookup>
>();

/**
 * The lookup for `(ir, brandKit)`, shared across every component that asks.
 *
 * Two surfaces now want it — the Inspector and the Components panel — and a
 * plain `useMemo` in each would scan the document twice per change. Keyed on
 * object identity, so a new document or a new kit is a miss by construction and
 * a stale result is not representable; both keys are weak, so nothing here
 * outlives the document it describes.
 */
export function getComplianceLookup(
	ir: CanvasIR,
	brandKit: BrandKitDefinition | undefined,
): InstanceComplianceLookup {
	if (!brandKit) return buildComplianceLookup(ir, undefined);
	let byKit = SHARED.get(ir);
	if (!byKit) {
		byKit = new WeakMap();
		SHARED.set(ir, byKit);
	}
	const hit = byKit.get(brandKit);
	if (hit) return hit;
	const built = buildComplianceLookup(ir, brandKit);
	byKit.set(brandKit, built);
	return built;
}

export function useInstanceCompliance(
	ir: CanvasIR,
	brandKit: BrandKitDefinition | undefined,
): InstanceComplianceLookup {
	return useMemo(
		() => getComplianceLookup(ir, brandKit),
		// Exactly two dependencies. Adding `nodes` here is the regression this
		// module exists to prevent; `use-instance-compliance.test.ts` fails if it
		// comes back.
		[ir, brandKit],
	);
}
