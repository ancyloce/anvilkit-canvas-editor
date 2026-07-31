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
	createText,
	encodeResolvedNodeId,
	insertNode,
} from "@anvilkit/canvas-core";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import { createFieldPreviewStore } from "@/stores/field-preview-store.js";
import { createResolvedDocumentStore } from "@/stores/resolved-document-store.js";
import { createSceneStore } from "@/stores/scene-store.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import { SceneAccessibilityTree } from "../SceneAccessibilityTree.js";

/**
 * @file T-A11Y-1 (plan 0023 M5-07, D-4, NFR-004) — a component's VIRTUAL nodes
 * are reachable by keyboard, announced, and selectable, and the tree stays axe
 * clean with them present.
 */

afterEach(cleanup);

function definition(): CanvasComponentDefinition {
	return {
		id: "cmp-card",
		name: "Promo card",
		revision: 1,
		properties: [],
		root: {
			...createFrame({ id: "src-root", bounds: { width: 200, height: 80 } }),
			children: [
				createText({
					id: "src-title",
					text: "Headline",
					bounds: { width: 120, height: 20 },
				}),
				createRect({
					id: "src-badge",
					bounds: { width: 20, height: 20 },
					fill: "#ff0000",
				}),
			],
		} as CanvasNode,
	};
}

const instanceNode = (id: string, componentId = "cmp-card"): CanvasNode =>
	({
		type: "component-instance",
		id,
		source: { kind: "local", componentId },
		transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
		bounds: { width: 200, height: 80 },
	}) as CanvasNode;

function doc(
	nodes: readonly CanvasNode[],
	registry: Record<string, CanvasComponentDefinition> | undefined = {
		"cmp-card": definition(),
	},
): CanvasIR {
	const page = createPage({ id: "p1" });
	let ir = createCanvasIR({ id: "doc", title: "t", pages: [page] });
	for (const node of nodes) {
		ir = insertNode(ir, { parentId: page.root.id, node });
	}
	return registry ? { ...ir, components: registry } : ir;
}

function mount(ir: CanvasIR) {
	const h = makeHarness({ ir });
	const sceneStore = createSceneStore({ initialIR: ir });
	const fieldPreviewStore = createFieldPreviewStore();
	const resolvedDocumentStore = createResolvedDocumentStore({
		sceneStore,
		fieldPreviewStore,
	});
	const disconnect = resolvedDocumentStore.connect();
	const ctx = { ...h.studioCtx, ir, resolvedDocumentStore };
	const view = render(
		<CanvasStudioContext.Provider value={ctx}>
			<SceneAccessibilityTree />
		</CanvasStudioContext.Provider>,
	);
	return { view, ctx, h, disconnect };
}

const TITLE_ID = encodeResolvedNodeId({ segments: ["inst-1", "src-title"] });

describe("SceneAccessibilityTree — components (T-A11Y-1)", () => {
	it("exposes virtual nodes as tree items keyed by their RESOLVED id", () => {
		const { view, disconnect } = mount(doc([instanceNode("inst-1")]));
		try {
			const items = Array.from(
				view.container.querySelectorAll('[role="treeitem"]'),
			);
			const ids = items.map((el) => el.id);
			// Konva renders to <canvas>, so this proxy is the ONLY thing AT can see —
			// if the expansion is absent here it is unreachable, full stop.
			expect(ids).toContain(`ak-scene-item-${TITLE_ID}`);
			// The virtual rows are marked as such for styling/telemetry without
			// leaking the codec id into any document-facing field.
			expect(
				items.filter((el) => el.getAttribute("data-virtual") === "true").length,
			).toBeGreaterThan(0);
		} finally {
			disconnect();
		}
	});

	it("roving focus reaches a virtual node with the arrow keys", () => {
		const { view, ctx, disconnect } = mount(doc([instanceNode("inst-1")]));
		try {
			const first = view.container.querySelector(
				'[role="treeitem"]',
			) as HTMLElement;
			fireEvent.focus(first);
			// Walk forward until focus lands inside the expansion.
			const seen: string[] = [];
			for (let i = 0; i < 8; i += 1) {
				const focused = ctx.focusStore.getState().focusedId;
				if (focused) seen.push(focused);
				if (focused === TITLE_ID) break;
				const el = document.getElementById(`ak-scene-item-${focused}`);
				if (!el) break;
				fireEvent.keyDown(el, { key: "ArrowDown" });
			}
			expect(seen).toContain(TITLE_ID);
		} finally {
			disconnect();
		}
	});

	it("Enter on a virtual node selects the OWNING instance, never the codec id", () => {
		const { view, ctx, disconnect } = mount(doc([instanceNode("inst-1")]));
		try {
			const el = view.container.querySelector(
				`#ak-scene-item-${CSS.escape(TITLE_ID)}`,
			) as HTMLElement;
			expect(el).not.toBeNull();
			fireEvent.keyDown(el, { key: "Enter" });

			const selection = ctx.selectionStore.getState();
			// A virtual id in `selectedIds` would be addressable by no command.
			expect(selection.selectedIds).toEqual(["inst-1"]);
			expect(selection.targets).toEqual([{ kind: "node", nodeId: "inst-1" }]);
		} finally {
			disconnect();
		}
	});

	it("clicking a virtual row selects the owning instance too", () => {
		const { view, ctx, disconnect } = mount(doc([instanceNode("inst-1")]));
		try {
			const el = view.container.querySelector(
				`#ak-scene-item-${CSS.escape(TITLE_ID)}`,
			) as HTMLElement;
			fireEvent.click(el);
			expect(ctx.selectionStore.getState().selectedIds).toEqual(["inst-1"]);
		} finally {
			disconnect();
		}
	});

	it("announces the component name on an expanded instance row", () => {
		const { view, disconnect } = mount(doc([instanceNode("inst-1")]));
		try {
			// The instance's own row carries the definition name, so a screen-reader
			// user knows WHICH component they are on.
			const row = view.container.querySelector("#ak-scene-item-inst-1");
			expect(row?.textContent).toContain("Promo card");
		} finally {
			disconnect();
		}
	});

	it("T-ERR-1: announces a missing Source instead of a bare kind name", () => {
		const { view, disconnect } = mount(
			doc([instanceNode("inst-1", "cmp-ghost")], {}),
		);
		try {
			const row = view.container.querySelector("#ak-scene-item-inst-1");
			// Follows the shipped missing-ASSET suffix precedent rather than a new
			// shape, and is perceivable without seeing the on-stage placeholder.
			expect(row?.textContent).toContain("Missing component");
		} finally {
			disconnect();
		}
	});

	it("stays axe clean with a component expansion present", async () => {
		const { view, disconnect } = mount(doc([instanceNode("inst-1")]));
		try {
			const results = await axe(view.container);
			expect(results.violations).toHaveLength(0);
		} finally {
			disconnect();
		}
	});
});
