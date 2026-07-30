import type {
	CanvasComponentDefinition,
	CanvasIR,
	CanvasNode,
	CanvasResolvedView,
} from "@anvilkit/canvas-core";
import {
	createCanvasIR,
	createFrame,
	createPage,
	createRect,
	createResolvedView,
	encodeResolvedNodeId,
	insertNode,
	resolveCanvasDocument,
} from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import {
	collectHitNames,
	type HitNodeLike,
	instanceScopeTargetAt,
	instanceScopeTargetForResolvedId,
	persistentInstanceIdFor,
	selectionTargetForResolvedId,
} from "../component-selection-policy.js";

/**
 * @file T-SEL-2 (plan 0023 M4-06, AC-007) — a hit inside a nested instance maps
 * to the correct Instance Scope target, and a renderer hit id never escapes as a
 * persistent identifier.
 */

/** Inner Source: a frame with one rect. */
function innerDefinition(): CanvasComponentDefinition {
	return {
		id: "cmp-inner",
		name: "Badge",
		revision: 1,
		properties: [],
		root: {
			...createFrame({ id: "inner-root", bounds: { width: 40, height: 20 } }),
			children: [
				createRect({ id: "inner-dot", bounds: { width: 8, height: 8 } }),
			],
		} as CanvasNode,
	};
}

/** Outer Source: a frame holding a plain rect AND an instance of the inner one. */
function outerDefinition(): CanvasComponentDefinition {
	return {
		id: "cmp-outer",
		name: "Card",
		revision: 1,
		properties: [],
		root: {
			...createFrame({ id: "outer-root", bounds: { width: 200, height: 80 } }),
			children: [
				createRect({ id: "outer-bar", bounds: { width: 100, height: 10 } }),
				{
					type: "component-instance",
					id: "outer-nested",
					componentId: "cmp-inner",
					transform: { x: 20, y: 30, rotation: 0, scaleX: 1, scaleY: 1 },
					bounds: { width: 40, height: 20 },
				} as CanvasNode,
			],
		} as CanvasNode,
	};
}

function nestedDoc(): CanvasIR {
	const page = createPage({ id: "p1" });
	let ir = createCanvasIR({ id: "doc", title: "t", pages: [page] });
	ir = insertNode(ir, {
		parentId: page.root.id,
		node: {
			type: "component-instance",
			id: "inst-1",
			componentId: "cmp-outer",
			transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
			bounds: { width: 200, height: 80 },
		} as CanvasNode,
	});
	ir = insertNode(ir, {
		parentId: page.root.id,
		node: createRect({ id: "plain", bounds: { width: 10, height: 10 } }),
	});
	return {
		...ir,
		components: {
			"cmp-outer": outerDefinition(),
			"cmp-inner": innerDefinition(),
		},
	};
}

function view(): CanvasResolvedView {
	return createResolvedView(resolveCanvasDocument(nestedDoc(), {}));
}

/** A fake stage chain, given names from deepest to outermost. */
function hitChain(...deepestFirst: readonly (string | null)[]): HitNodeLike {
	let node: HitNodeLike | null = null;
	for (const name of [...deepestFirst].reverse()) {
		const parent: HitNodeLike | null = node;
		node = {
			...(name === null ? {} : { name: () => name }),
			getParent: () => parent,
		};
	}
	return node as HitNodeLike;
}

const OUTER_BAR = encodeResolvedNodeId({ segments: ["inst-1", "outer-bar"] });
const NESTED_ROOT = encodeResolvedNodeId({
	segments: ["inst-1", "outer-nested"],
});
const INNER_DOT = encodeResolvedNodeId({
	segments: ["inst-1", "outer-nested", "inner-dot"],
});

describe("collectHitNames", () => {
	it("returns names deepest-first and skips anonymous helpers", () => {
		// `null` stands in for a frame's unnamed background Rect, which must not
		// terminate the walk — otherwise a click on a frame's background would
		// resolve to nothing.
		expect(collectHitNames(hitChain("deep", null, "outer"))).toEqual([
			"deep",
			"outer",
		]);
	});

	it("tolerates a missing target and a nameless chain", () => {
		expect(collectHitNames(null)).toEqual([]);
		expect(collectHitNames(hitChain(null, null))).toEqual([]);
	});
});

describe("selectionTargetForResolvedId — single click collapses to the instance", () => {
	it("maps a virtual node to its OWNING instance root", () => {
		const v = view();
		expect(selectionTargetForResolvedId(v, OUTER_BAR)).toEqual({
			kind: "node",
			nodeId: "inst-1",
		});
		// Even two levels deep: an instance reads as ONE object until asked.
		expect(selectionTargetForResolvedId(v, INNER_DOT)).toEqual({
			kind: "node",
			nodeId: "inst-1",
		});
	});

	it("leaves a plain node as itself", () => {
		expect(selectionTargetForResolvedId(view(), "plain")).toEqual({
			kind: "node",
			nodeId: "plain",
		});
	});

	it("returns null for an id that resolves to nothing", () => {
		expect(selectionTargetForResolvedId(view(), "does-not-exist")).toBeNull();
	});
});

describe("instanceScopeTargetAt — T-SEL-2 nested hit → scope target", () => {
	it("targets the DEEPEST virtual node under the pointer", () => {
		const target = instanceScopeTargetAt(
			view(),
			hitChain(INNER_DOT, NESTED_ROOT, "inst-1"),
			"inst-1",
		);
		expect(target).toEqual({
			kind: "instance-node",
			instanceId: "inst-1",
			resolvedNodeId: INNER_DOT,
			// The DEFINITION-tree id — what a Source-scoped edit or a property
			// binding addresses — not the codec id and not the record's own field.
			sourceNodeId: "inner-dot",
		});
	});

	it("targets an intermediate node when the pointer stopped there", () => {
		const target = instanceScopeTargetAt(
			view(),
			hitChain(OUTER_BAR, "inst-1"),
			"inst-1",
		);
		expect(target?.kind).toBe("instance-node");
		expect(target?.kind === "instance-node" ? target.sourceNodeId : null).toBe(
			"outer-bar",
		);
	});

	it("resolves the instance ROOT to the Source root", () => {
		const target = instanceScopeTargetAt(view(), hitChain("inst-1"), "inst-1");
		expect(target?.kind === "instance-node" ? target.sourceNodeId : null).toBe(
			"outer-root",
		);
	});

	it("resolves a DEEPLY nested hit to the outermost PERSISTENT instance", () => {
		const v = view();
		// The record's own `component.instanceId` here is the nested instance's
		// VIRTUAL id — a codec product that addresses no document node. The policy
		// must climb to the persistent owner instead of trusting it.
		expect(v.getRecord(INNER_DOT)?.component?.instanceId).toBe(NESTED_ROOT);
		expect(persistentInstanceIdFor(v, INNER_DOT)).toBe("inst-1");
		// Which is what keeps a virtual id out of the persistent selection.
		expect(selectionTargetForResolvedId(v, INNER_DOT)).toEqual({
			kind: "node",
			nodeId: "inst-1",
		});
	});

	it("returns null for a plain node's persistent owner", () => {
		expect(persistentInstanceIdFor(view(), "plain")).toBeNull();
	});

	it("never reaches into a DIFFERENT instance's expansion", () => {
		// Same chain, but asked on behalf of another instance id.
		expect(
			instanceScopeTargetAt(view(), hitChain(INNER_DOT), "other-instance"),
		).toBeNull();
	});

	it("returns null for a plain node and for an empty chain", () => {
		const v = view();
		expect(instanceScopeTargetAt(v, hitChain("plain"), "plain")).toBeNull();
		expect(instanceScopeTargetAt(v, null, "inst-1")).toBeNull();
	});
});

describe("instanceScopeTargetForResolvedId", () => {
	it("rejects a plain node — it is not inside any instance", () => {
		expect(
			instanceScopeTargetForResolvedId(view(), "plain", "inst-1"),
		).toBeNull();
	});

	it("carries all three ids a virtual node needs", () => {
		const target = instanceScopeTargetForResolvedId(
			view(),
			NESTED_ROOT,
			"inst-1",
		);
		expect(target).toEqual({
			kind: "instance-node",
			instanceId: "inst-1",
			resolvedNodeId: NESTED_ROOT,
			sourceNodeId: "outer-nested",
		});
	});
});
