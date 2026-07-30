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
import { describe, expect, it, vi } from "vitest";
import { createComponentScopeStore } from "@/stores/component-scope-store.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import {
	commandComponentLocation,
	enterComponentSourceImpl,
	exitAllComponentSourcesImpl,
	exitComponentSourceImpl,
	redoWithScopeImpl,
	undoWithScopeImpl,
} from "../component-actions.js";
import { withComponentLocation } from "../scoped-commit.js";

/**
 * @file M5-03 — Source scope navigation and T-SCOPE-2 cross-scope undo.
 *
 * Navigation is never a document command, so every assertion here also checks
 * that nothing was committed.
 */

function definition(id: string, name: string): CanvasComponentDefinition {
	return {
		id,
		name,
		revision: 1,
		properties: [],
		root: {
			...createFrame({ id: `${id}-root`, bounds: { width: 80, height: 40 } }),
			children: [
				createRect({ id: `${id}-body`, bounds: { width: 20, height: 20 } }),
			],
		} as CanvasNode,
	};
}

function doc(): CanvasIR {
	const page = createPage({ id: "p1" });
	let ir = createCanvasIR({ id: "doc", title: "t", pages: [page] });
	ir = insertNode(ir, {
		parentId: page.root.id,
		node: createRect({ id: "r1", bounds: { width: 10, height: 10 } }),
	});
	return {
		...ir,
		components: {
			"cmp-a": definition("cmp-a", "Alpha"),
			"cmp-b": definition("cmp-b", "Beta"),
		},
	};
}

function ctxFor(ir: CanvasIR = doc()) {
	const h = makeHarness({ ir });
	const componentScopeStore = createComponentScopeStore();
	return {
		h,
		scope: componentScopeStore,
		ctx: { ...h.studioCtx, ir, componentScopeStore },
	};
}

describe("enter / exit component source", () => {
	it("enters a Source, clearing the page selection, committing nothing", () => {
		const { h, ctx, scope } = ctxFor();
		ctx.selectionStore.getState().setSelection(["r1"]);

		expect(enterComponentSourceImpl(ctx, "cmp-a")).toBeNull();
		expect(scope.getState().activeFrame()?.componentId).toBe("cmp-a");
		// A page-node selection means nothing inside a different tree.
		expect(ctx.selectionStore.getState().selectedIds).toEqual([]);
		expect(h.commits).toHaveLength(0);
	});

	it("restores the return selection on exit", () => {
		const { ctx } = ctxFor();
		ctx.selectionStore.getState().setSelection(["r1"]);
		enterComponentSourceImpl(ctx, "cmp-a");
		expect(exitComponentSourceImpl(ctx)).toBe("cmp-a");
		expect(ctx.selectionStore.getState().selectedIds).toEqual(["r1"]);
	});

	it("drops a return selection whose node no longer exists", () => {
		const { ctx } = ctxFor();
		ctx.selectionStore.getState().setSelection(["r1", "deleted-while-inside"]);
		enterComponentSourceImpl(ctx, "cmp-a");
		exitComponentSourceImpl(ctx);
		// Restoring a stale id would put a phantom in the selection.
		expect(ctx.selectionStore.getState().selectedIds).toEqual(["r1"]);
	});

	it("refuses an unknown component id", () => {
		const { ctx, scope } = ctxFor();
		expect(enterComponentSourceImpl(ctx, "cmp-ghost")).toBe("missing");
		expect(scope.getState().stack).toHaveLength(0);
	});

	it("refuses re-entering an already-open component (the DAG rule)", () => {
		const { ctx } = ctxFor();
		enterComponentSourceImpl(ctx, "cmp-a");
		enterComponentSourceImpl(ctx, "cmp-b");
		expect(enterComponentSourceImpl(ctx, "cmp-a")).toBe("already-open");
	});

	it("exitAll collapses the stack back to the originating page", () => {
		const { ctx, scope } = ctxFor();
		ctx.selectionStore.getState().setSelection(["r1"]);
		enterComponentSourceImpl(ctx, "cmp-a");
		enterComponentSourceImpl(ctx, "cmp-b");
		expect(exitAllComponentSourcesImpl(ctx)).toBe(true);
		expect(scope.getState().stack).toEqual([]);
		expect(ctx.selectionStore.getState().selectedIds).toEqual(["r1"]);
	});
});

describe("commandComponentLocation", () => {
	it("reads a component location off a command", () => {
		expect(
			commandComponentLocation({
				type: "node.move",
				location: { kind: "component", id: "cmp-a" },
			} as never),
		).toBe("cmp-a");
	});

	it("ignores a page location and a missing one", () => {
		expect(
			commandComponentLocation({
				type: "node.move",
				location: { kind: "page", id: "p1" },
			} as never),
		).toBeNull();
		expect(commandComponentLocation({ type: "node.move" } as never)).toBeNull();
		expect(commandComponentLocation(undefined)).toBeNull();
	});

	it("finds a location nested inside a batch", () => {
		expect(
			commandComponentLocation({
				type: "batch",
				commands: [
					{ type: "node.move" },
					{ type: "node.resize", location: { kind: "component", id: "cmp-b" } },
				],
			} as never),
		).toBe("cmp-b");
	});
});

describe("withComponentLocation (M5-03 stamping)", () => {
	it("stamps a location-aware command", () => {
		const stamped = withComponentLocation(
			{ type: "node.move", nodeId: "n1" } as never,
			"cmp-a",
		);
		expect(stamped).toMatchObject({
			type: "node.move",
			location: { kind: "component", id: "cmp-a" },
		});
	});

	it("leaves document-level commands untouched, by identity", () => {
		// Page / asset / Registry commands are document-level by design: pointing
		// them into a definition tree would be a corruption, not a scoping.
		for (const cmd of [
			{ type: "page.create" },
			{ type: "asset.put" },
			{ type: "component.rename" },
			{ type: "component.delete" },
		]) {
			expect(withComponentLocation(cmd as never, "cmp-a")).toBe(cmd);
		}
	});

	it("never overrides an explicit location", () => {
		const explicit = {
			type: "node.move",
			location: { kind: "component", id: "cmp-other" },
		};
		expect(withComponentLocation(explicit as never, "cmp-a")).toBe(explicit);
	});

	it("stamps through a batch and shares untouched sub-commands", () => {
		const page = { type: "page.rename" };
		const batch = {
			type: "batch",
			commands: [page, { type: "node.delete", nodeId: "n1" }],
		};
		const stamped = withComponentLocation(batch as never, "cmp-a") as {
			commands: readonly unknown[];
		};
		expect(stamped).not.toBe(batch);
		// The page command is reference-identical: nothing is cloned needlessly.
		expect(stamped.commands[0]).toBe(page);
		expect(stamped.commands[1]).toMatchObject({
			location: { kind: "component", id: "cmp-a" },
		});
	});

	it("returns a batch by identity when nothing inside it needed stamping", () => {
		const batch = { type: "batch", commands: [{ type: "page.rename" }] };
		expect(withComponentLocation(batch as never, "cmp-a")).toBe(batch);
	});
});

describe("T-SCOPE-2 cross-scope undo", () => {
	/** A context whose undo/redo are spies, with a seeded history. */
	function undoCtx(past: readonly unknown[], future: readonly unknown[] = []) {
		const base = ctxFor();
		const undo = vi.fn();
		const redo = vi.fn();
		const historyStore = {
			...base.ctx.historyStore,
			getState: () => ({ ...base.ctx.historyStore.getState(), past, future }),
		};
		return {
			...base,
			undo,
			redo,
			ctx: {
				...base.ctx,
				historyStore,
				undo,
				redo,
			} as typeof base.ctx,
		};
	}

	it("pushes the owning Source frame before applying a component-scoped undo", () => {
		const { ctx, scope, undo } = undoCtx([
			{ type: "node.move", location: { kind: "component", id: "cmp-a" } },
		]);
		expect(undoWithScopeImpl(ctx)).toBe(true);
		// Without this the document would change inside a tree that is not on
		// screen and the user would see nothing happen.
		expect(scope.getState().activeFrame()?.componentId).toBe("cmp-a");
		expect(undo).toHaveBeenCalledTimes(1);
	});

	it("leaves the scope alone for a page-scoped undo", () => {
		const { ctx, scope, undo } = undoCtx([{ type: "node.move" }]);
		expect(undoWithScopeImpl(ctx)).toBe(true);
		expect(scope.getState().stack).toEqual([]);
		expect(undo).toHaveBeenCalledTimes(1);
	});

	it("pops back to an OUTER frame rather than rejecting as already-open", () => {
		const { ctx, scope, undo } = undoCtx([
			{ type: "node.move", location: { kind: "component", id: "cmp-a" } },
		]);
		enterComponentSourceImpl(ctx, "cmp-a");
		enterComponentSourceImpl(ctx, "cmp-b");
		expect(scope.getState().stack).toHaveLength(2);

		undoWithScopeImpl(ctx);
		// cmp-a is already on the stack, so entering it would be refused; popping
		// to it is what actually makes the edit visible.
		expect(scope.getState().activeFrame()?.componentId).toBe("cmp-a");
		expect(undo).toHaveBeenCalledTimes(1);
	});

	it("stays put when the owning component no longer exists", () => {
		const { ctx, scope, undo } = undoCtx([
			{ type: "node.move", location: { kind: "component", id: "cmp-gone" } },
		]);
		expect(undoWithScopeImpl(ctx)).toBe(true);
		// The entry may be exactly the one that restores it, so the undo proceeds.
		expect(scope.getState().stack).toEqual([]);
		expect(undo).toHaveBeenCalledTimes(1);
	});

	it("does nothing with an empty history", () => {
		const { ctx, undo } = undoCtx([]);
		expect(undoWithScopeImpl(ctx)).toBe(false);
		expect(undo).not.toHaveBeenCalled();
	});

	it("redo navigates the same way", () => {
		const { ctx, scope, redo } = undoCtx(
			[],
			[{ type: "node.resize", location: { kind: "component", id: "cmp-b" } }],
		);
		expect(redoWithScopeImpl(ctx)).toBe(true);
		expect(scope.getState().activeFrame()?.componentId).toBe("cmp-b");
		expect(redo).toHaveBeenCalledTimes(1);
	});
});
