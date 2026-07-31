import type {
	CanvasComponentDefinition,
	CanvasIR,
	CanvasNode,
} from "@anvilkit/canvas-core";
import {
	createCanvasIR,
	createFrame,
	createPage,
	createRect,
	insertNode,
} from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import {
	componentReferenceCountsImpl,
	createComponentFromSelectionImpl,
	deleteComponentImpl,
	detachComponentInstanceImpl,
	duplicateComponentImpl,
	insertComponentInstanceImpl,
	listComponentsImpl,
	renameComponentImpl,
} from "../component-actions.js";

/**
 * @file M5-02 action layer — every component mutation the UI performs, with the
 * guards that must hold even when a caller ignores them.
 *
 * Ids are injected so assertions can name them; production callers get UUIDs.
 */

let counter = 0;
const ids = {
	componentId: () => `cmp-new-${++counter}`,
	propertyId: () => `prop-new-${++counter}`,
	sourceNodeId: () => `node-new-${++counter}`,
};

function definition(
	id: string,
	name: string,
	children: readonly CanvasNode[] = [],
): CanvasComponentDefinition {
	return {
		id,
		name,
		revision: 1,
		properties: [],
		root: {
			...createFrame({ id: `${id}-root`, bounds: { width: 80, height: 40 } }),
			children: [
				createRect({ id: `${id}-body`, bounds: { width: 20, height: 20 } }),
				...children,
			],
		} as CanvasNode,
	};
}

const instanceNode = (id: string, componentId: string): CanvasNode =>
	({
		type: "component-instance",
		id,
		source: { kind: "local", componentId },
		transform: { x: 5, y: 7, rotation: 0, scaleX: 1, scaleY: 1 },
		bounds: { width: 80, height: 40 },
	}) as CanvasNode;

interface DocOptions {
	readonly registry?: Record<string, CanvasComponentDefinition>;
	readonly nodes?: readonly CanvasNode[];
}

function doc(options: DocOptions = {}): CanvasIR {
	const page = createPage({ id: "p1" });
	let ir = createCanvasIR({ id: "doc", title: "t", pages: [page] });
	for (const node of options.nodes ?? []) {
		ir = insertNode(ir, { parentId: page.root.id, node });
	}
	return options.registry ? { ...ir, components: options.registry } : ir;
}

/** Harness whose `getIR` returns the fixture (the harness commit is record-only). */
function ctxFor(ir: CanvasIR) {
	const h = makeHarness({ ir });
	return { h, ctx: { ...h.studioCtx, ir } };
}

describe("createComponentFromSelectionImpl", () => {
	it("builds one from-selection command and selects the new instance", () => {
		const rect = createRect({ id: "r1", bounds: { width: 10, height: 10 } });
		const { h, ctx } = ctxFor(doc({ nodes: [rect] }));
		ctx.selectionStore.getState().setSelection(["r1"]);

		const componentId = createComponentFromSelectionImpl(ctx, { ids });
		expect(componentId).toBe("cmp-new-1");
		const cmd = h.commits[0] as {
			type?: string;
			mode?: string;
			firstInstanceId?: string;
		};
		expect(cmd.type).toBe("component.create");
		expect(cmd.mode).toBe("from-selection");
		// Selection follows the instance that replaced the selection — the
		// group/paste/duplicate convention.
		expect(ctx.selectionStore.getState().selectedIds).toEqual([
			cmd.firstInstanceId,
		]);
	});

	it("refuses an empty selection", () => {
		const { h, ctx } = ctxFor(doc());
		expect(createComponentFromSelectionImpl(ctx, { ids })).toBeNull();
		expect(h.commits).toHaveLength(0);
	});

	it("refuses when any selected node is locked", () => {
		const locked = {
			...createRect({ id: "r1", bounds: { width: 10, height: 10 } }),
			locked: true,
		} as CanvasNode;
		const { h, ctx } = ctxFor(doc({ nodes: [locked] }));
		ctx.selectionStore.getState().setSelection(["r1"]);
		// The command layer would reject the batch anyway; refusing up front keeps
		// the selection intact instead of half-applying.
		expect(createComponentFromSelectionImpl(ctx, { ids })).toBeNull();
		expect(h.commits).toHaveLength(0);
		expect(ctx.selectionStore.getState().selectedIds).toEqual(["r1"]);
	});
});

describe("insertComponentInstanceImpl", () => {
	it("centres the instance on the page at the Source root's size", () => {
		const { h, ctx } = ctxFor(
			doc({ registry: { "cmp-a": definition("cmp-a", "Alpha") } }),
		);
		const instanceId = insertComponentInstanceImpl(ctx, "cmp-a", { ids });
		const cmd = h.commits[0] as {
			type?: string;
			bounds?: { width: number; height: number };
			transform?: { x: number; y: number };
		};
		expect(cmd.type).toBe("component-instance.insert");
		expect(cmd.bounds).toEqual({ width: 80, height: 40 });
		expect(cmd.transform).toEqual({ x: 500, y: 520 });
		expect(ctx.selectionStore.getState().selectedIds).toEqual([instanceId]);
	});

	it("refuses an unknown componentId rather than creating a broken reference", () => {
		const { h, ctx } = ctxFor(doc());
		expect(insertComponentInstanceImpl(ctx, "cmp-ghost", { ids })).toBeNull();
		expect(h.commits).toHaveLength(0);
	});
});

describe("renameComponentImpl", () => {
	it("commits a rename carrying the prior name", () => {
		const { h, ctx } = ctxFor(
			doc({ registry: { "cmp-a": definition("cmp-a", "Alpha") } }),
		);
		expect(renameComponentImpl(ctx, "cmp-a", "  Beta  ")).toBe(true);
		expect(h.commits[0]).toMatchObject({
			type: "component.rename",
			from: "Alpha",
			to: "Beta",
		});
	});

	it("no-ops on a blank or unchanged name", () => {
		const { h, ctx } = ctxFor(
			doc({ registry: { "cmp-a": definition("cmp-a", "Alpha") } }),
		);
		expect(renameComponentImpl(ctx, "cmp-a", "   ")).toBe(false);
		expect(renameComponentImpl(ctx, "cmp-a", "Alpha")).toBe(false);
		expect(h.commits).toHaveLength(0);
	});
});

describe("duplicateComponentImpl", () => {
	it("allocates a fresh component id", () => {
		const { h, ctx } = ctxFor(
			doc({ registry: { "cmp-a": definition("cmp-a", "Alpha") } }),
		);
		const newId = duplicateComponentImpl(ctx, "cmp-a", { ids });
		expect(newId).toMatch(/^cmp-new-/);
		expect(h.commits[0]).toMatchObject({
			type: "component.duplicate",
			componentId: "cmp-a",
			newComponentId: newId,
		});
	});
});

describe("componentReferenceCountsImpl + deleteComponentImpl", () => {
	it("counts page instances and Source dependencies separately", () => {
		const inner = definition("cmp-inner", "Inner");
		const outer = definition("cmp-outer", "Outer", [
			instanceNode("nested-1", "cmp-inner"),
		]);
		const { ctx } = ctxFor(
			doc({
				registry: { "cmp-inner": inner, "cmp-outer": outer },
				nodes: [instanceNode("i1", "cmp-outer")],
			}),
		);
		expect(componentReferenceCountsImpl(ctx, "cmp-inner")).toEqual({
			pageInstances: 0,
			sourceDependencies: 1,
			total: 1,
		});
		expect(componentReferenceCountsImpl(ctx, "cmp-outer")).toEqual({
			pageInstances: 1,
			sourceDependencies: 0,
			total: 1,
		});
	});

	it("deletes an unreferenced Source with a plain guarded delete", () => {
		const { h, ctx } = ctxFor(
			doc({ registry: { "cmp-a": definition("cmp-a", "Alpha") } }),
		);
		expect(deleteComponentImpl(ctx, "cmp-a", { ids })).toBe(true);
		expect(h.commits.map((c) => c.type)).toEqual(["component.delete"]);
	});

	it("refuses a referenced Source unless detachAll is explicit", () => {
		const ir = doc({
			registry: { "cmp-a": definition("cmp-a", "Alpha") },
			nodes: [instanceNode("i1", "cmp-a")],
		});
		const { h, ctx } = ctxFor(ir);
		expect(deleteComponentImpl(ctx, "cmp-a", { ids })).toBe(false);
		expect(h.commits).toHaveLength(0);

		// With the explicit opt-in it becomes ONE atomic batch: detach every
		// instance, then delete (LC-DELETE).
		expect(deleteComponentImpl(ctx, "cmp-a", { ids, detachAll: true })).toBe(
			true,
		);
		// ONE history entry — a single `batch`, not a nested batch-in-batch and not
		// a run of separate commits.
		expect(h.commits).toHaveLength(1);
		const batch = h.commits[0] as {
			type?: string;
			commands?: readonly { type?: string }[];
		};
		expect(batch.type).toBe("batch");
		const inner = (batch.commands ?? []).map((c) => c.type);
		expect(inner).toContain("component-instance.detach");
		// The guarded delete is LAST: every reference is gone by the time it runs.
		expect(inner.at(-1)).toBe("component.delete");
	});
});

describe("detachComponentInstanceImpl", () => {
	it("materializes an instance and keeps it selected by its own id", () => {
		const { h, ctx } = ctxFor(
			doc({
				registry: { "cmp-a": definition("cmp-a", "Alpha") },
				nodes: [instanceNode("i1", "cmp-a")],
			}),
		);
		expect(detachComponentInstanceImpl(ctx, "i1", { ids })).toBe(true);
		expect(h.commits[0]).toMatchObject({
			type: "component-instance.detach",
			nodeId: "i1",
		});
		// The materialized root keeps the instance id, so selection survives.
		expect(ctx.selectionStore.getState().selectedIds).toEqual(["i1"]);
	});

	it("refuses a node that is not an instance", () => {
		const rect = createRect({ id: "r1", bounds: { width: 10, height: 10 } });
		const { h, ctx } = ctxFor(doc({ nodes: [rect] }));
		expect(detachComponentInstanceImpl(ctx, "r1", { ids })).toBe(false);
		expect(h.commits).toHaveLength(0);
	});

	it("refuses an instance whose Source is missing (unsafe resolution)", () => {
		const { h, ctx } = ctxFor(
			doc({ nodes: [instanceNode("i1", "cmp-ghost")] }),
		);
		// Core rejects such a batch atomically rather than emitting a partially
		// materialized tree, so the UI must not report success.
		expect(detachComponentInstanceImpl(ctx, "i1", { ids })).toBe(false);
		expect(h.commits).toHaveLength(0);
	});
});

describe("listComponentsImpl", () => {
	it("sorts by name with a stable id tiebreak", () => {
		const { ctx } = ctxFor(
			doc({
				registry: {
					"cmp-z": definition("cmp-z", "Alpha"),
					"cmp-a": definition("cmp-a", "Alpha"),
					"cmp-m": definition("cmp-m", "Beta"),
				},
			}),
		);
		expect(listComponentsImpl(ctx).map((d) => d.id)).toEqual([
			"cmp-a",
			"cmp-z",
			"cmp-m",
		]);
	});

	it("returns nothing for a document with no Registry", () => {
		const { ctx } = ctxFor(doc());
		expect(listComponentsImpl(ctx)).toEqual([]);
	});
});
