import type {
	CanvasComponentDefinition,
	CanvasIR,
	CanvasNode,
} from "@anvilkit/canvas-core";
import {
	createCanvasIR,
	createComponentInstance,
	createFrame,
	createPage,
	createRect,
	createText,
	insertNode,
} from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import {
	type CanvasComponentEvent,
	hashComponentId,
} from "@/context/component-events.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import {
	createComponentFromSelectionImpl,
	deleteComponentImpl,
	detachComponentInstanceImpl,
	insertComponentInstanceImpl,
	renameComponentImpl,
} from "../component-actions.js";

/**
 * @file M6-08 host analytics seam (PRD §12).
 *
 * Two things are under test: that the editor EMITS the specified events, and —
 * the one that actually matters for privacy — that no payload can carry document
 * content. The second is asserted by planting recognisable secrets in the
 * document and scanning every emitted event.
 */

const SECRET_TEXT = "CONFIDENTIAL-CAMPAIGN-COPY";
const SECRET_NAME = "Project Bluebird Teaser";
const SECRET_ASSET = "https://cdn.example.com/private/leak.png";

let counter = 0;
const ids = {
	componentId: () => `cmp-new-${++counter}`,
	propertyId: () => `prop-new-${++counter}`,
	sourceNodeId: () => `node-new-${++counter}`,
};

function definition(id = "cmp-a"): CanvasComponentDefinition {
	return {
		id,
		name: SECRET_NAME,
		revision: 1,
		properties: [],
		root: {
			...createFrame({ id: `${id}-root`, bounds: { width: 80, height: 40 } }),
			children: [
				createText({
					id: `${id}-text`,
					text: SECRET_TEXT,
					bounds: { width: 40, height: 20 },
				}),
			],
		} as CanvasNode,
	};
}

const instanceNode = (id: string, componentId = "cmp-a"): CanvasNode =>
	createComponentInstance({
		id,
		componentId,
		bounds: { width: 80, height: 40 },
	});

function doc(
	registry: Record<string, CanvasComponentDefinition>,
	nodes: readonly CanvasNode[] = [],
): CanvasIR {
	const page = createPage({ id: "p1" });
	let ir = createCanvasIR({ id: "doc", title: SECRET_NAME, pages: [page] });
	for (const node of nodes) {
		ir = insertNode(ir, { parentId: page.root.id, node });
	}
	return {
		...ir,
		components: registry,
		assets: { a1: { id: "a1", uri: SECRET_ASSET } },
	};
}

/** A context that records every emitted event. */
function ctxFor(ir: CanvasIR) {
	const h = makeHarness({ ir });
	const events: CanvasComponentEvent[] = [];
	return {
		h,
		events,
		ctx: {
			...h.studioCtx,
			ir,
			onComponentEvent: (event: CanvasComponentEvent) => events.push(event),
		},
	};
}

describe("PRD §12 component events are emitted", () => {
	it("created — with the source kind, node count and layout flag", () => {
		const rect = createRect({ id: "r1", bounds: { width: 10, height: 10 } });
		const { ctx, events } = ctxFor(doc({}, [rect]));
		ctx.selectionStore.getState().setSelection(["r1"]);
		createComponentFromSelectionImpl(ctx, { ids });

		const created = events.find((e) => e.type === "canvas.component.created");
		expect(created).toBeDefined();
		expect(created).toMatchObject({ sourceKind: "reuse-container" });
	});

	it("instance_inserted — with HASHED ids, never raw ones", () => {
		const { ctx, events } = ctxFor(doc({ "cmp-a": definition() }));
		insertComponentInstanceImpl(ctx, "cmp-a", { ids });

		const inserted = events.find(
			(e) => e.type === "canvas.component.instance_inserted",
		);
		expect(inserted).toMatchObject({
			componentIdHash: hashComponentId("cmp-a"),
			pageIdHash: hashComponentId("p1"),
			insertionMethod: "panel-click",
		});
		// The raw ids must NOT appear anywhere in the payload.
		expect(JSON.stringify(inserted)).not.toContain("cmp-a");
		expect(JSON.stringify(inserted)).not.toContain("p1");
	});

	it("source_edited — a rename reports how many instances it affects", () => {
		const { ctx, events } = ctxFor(
			doc({ "cmp-a": definition() }, [instanceNode("i1"), instanceNode("i2")]),
		);
		renameComponentImpl(ctx, "cmp-a", "Renamed");
		expect(
			events.find((e) => e.type === "canvas.component.source_edited"),
		).toMatchObject({ operation: "renamed", affectedInstanceCount: 2 });
	});

	it("delete_attempted — blocked, then detached-and-deleted", () => {
		const ir = doc({ "cmp-a": definition() }, [instanceNode("i1")]);
		const { ctx, events } = ctxFor(ir);

		deleteComponentImpl(ctx, "cmp-a", { ids });
		expect(
			events.find((e) => e.type === "canvas.component.delete_attempted"),
		).toMatchObject({ dependentCount: 1, outcome: "blocked" });

		deleteComponentImpl(ctx, "cmp-a", { ids, detachAll: true });
		const outcomes = events
			.filter((e) => e.type === "canvas.component.delete_attempted")
			.map((e) => (e as { outcome: string }).outcome);
		expect(outcomes).toEqual(["blocked", "detached-and-deleted"]);
	});

	it("delete_attempted — an unreferenced delete reports zero dependents", () => {
		const { ctx, events } = ctxFor(doc({ "cmp-a": definition() }));
		deleteComponentImpl(ctx, "cmp-a", { ids });
		expect(
			events.find((e) => e.type === "canvas.component.delete_attempted"),
		).toMatchObject({ dependentCount: 0, outcome: "deleted" });
	});

	it("detached — reports node count and nesting depth", () => {
		const inner = definition("cmp-inner");
		const outer: CanvasComponentDefinition = {
			...definition("cmp-outer"),
			root: {
				...createFrame({
					id: "outer-root",
					bounds: { width: 80, height: 40 },
				}),
				children: [instanceNode("outer-nested", "cmp-inner")],
			} as CanvasNode,
		};
		const { ctx, events } = ctxFor(
			doc({ "cmp-inner": inner, "cmp-outer": outer }, [
				instanceNode("i1", "cmp-outer"),
			]),
		);
		detachComponentInstanceImpl(ctx, "i1", { ids });
		const detached = events.find((e) => e.type === "canvas.component.detached");
		expect(detached).toBeDefined();
		// Two levels: the outer instance and the nested one inside its Source.
		expect(detached).toMatchObject({ nestedDepth: 2 });
	});

	it("emits nothing when the host wired no observer", () => {
		const ir = doc({ "cmp-a": definition() });
		const h = makeHarness({ ir });
		// No `onComponentEvent`: the seam must be entirely optional.
		expect(() =>
			insertComponentInstanceImpl({ ...h.studioCtx, ir }, "cmp-a", { ids }),
		).not.toThrow();
	});
});

describe("the privacy contract holds by construction (PRD §12)", () => {
	it("NO emitted event carries text, a component name, an asset URI, or a raw id", () => {
		const rect = createRect({ id: "r1", bounds: { width: 10, height: 10 } });
		const ir = doc({ "cmp-a": definition() }, [instanceNode("i1"), rect]);
		const { ctx, events } = ctxFor(ir);

		// Exercise every emitting path in one document.
		ctx.selectionStore.getState().setSelection(["r1"]);
		createComponentFromSelectionImpl(ctx, { ids });
		insertComponentInstanceImpl(ctx, "cmp-a", { ids });
		renameComponentImpl(ctx, "cmp-a", "Another Secret Name");
		detachComponentInstanceImpl(ctx, "i1", { ids });
		deleteComponentImpl(ctx, "cmp-a", { ids });

		expect(events.length).toBeGreaterThan(3);
		const serialized = JSON.stringify(events);
		for (const secret of [
			SECRET_TEXT,
			SECRET_NAME,
			SECRET_ASSET,
			"Another Secret Name",
		]) {
			expect(serialized, `leaked: ${secret}`).not.toContain(secret);
		}
		// Raw document ids are hashed too — a component id is often the product
		// name and a page id identifies the customer's artwork.
		expect(serialized).not.toContain('"cmp-a"');
		expect(serialized).not.toContain('"p1"');
	});
});

describe("hashComponentId", () => {
	it("is stable, so a host can correlate events within a session", () => {
		expect(hashComponentId("cmp-a")).toBe(hashComponentId("cmp-a"));
	});

	it("separates different ids", () => {
		expect(hashComponentId("cmp-a")).not.toBe(hashComponentId("cmp-b"));
	});

	it("never returns the input", () => {
		for (const id of ["cmp-a", "", "Project Bluebird", "a".repeat(200)]) {
			expect(hashComponentId(id)).not.toBe(id);
			expect(hashComponentId(id).length).toBeGreaterThan(0);
		}
	});
});
