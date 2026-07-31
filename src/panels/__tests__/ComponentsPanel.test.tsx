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
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import { CanvasDialogContext } from "@/context/dialog-context.js";
import { createFieldPreviewStore } from "@/stores/field-preview-store.js";
import { createResolvedDocumentStore } from "@/stores/resolved-document-store.js";
import { createSceneStore } from "@/stores/scene-store.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import { ComponentsPanel } from "../ComponentsPanel.js";

/**
 * @file M5-02 read surface — the Components dock lists document-local Sources
 * with usage counts, search, empty states, and per-row problem states.
 */

afterEach(cleanup);

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
		transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
		bounds: { width: 80, height: 40 },
	}) as CanvasNode;

interface DocOptions {
	readonly registry?: Record<string, CanvasComponentDefinition>;
	readonly instances?: readonly CanvasNode[];
}

function doc(options: DocOptions = {}): CanvasIR {
	const page = createPage({ id: "p1" });
	let ir = createCanvasIR({ id: "doc", title: "t", pages: [page] });
	for (const node of options.instances ?? []) {
		ir = insertNode(ir, { parentId: page.root.id, node });
	}
	return options.registry ? { ...ir, components: options.registry } : ir;
}

/** Mount with a live resolution, so `componentIssues` reach the rows. */
function renderPanel(ir: CanvasIR, search?: string) {
	const h = makeHarness({ ir });
	const sceneStore = createSceneStore({ initialIR: ir });
	const fieldPreviewStore = createFieldPreviewStore();
	const resolvedDocumentStore = createResolvedDocumentStore({
		sceneStore,
		fieldPreviewStore,
	});
	const disconnect = resolvedDocumentStore.connect();
	const view = render(
		<CanvasStudioContext.Provider
			value={{ ...h.studioCtx, ir, resolvedDocumentStore }}
		>
			<ComponentsPanel {...(search === undefined ? {} : { search })} />
		</CanvasStudioContext.Provider>,
	);
	return { view, disconnect };
}

describe("ComponentsPanel", () => {
	it("renders an empty state for a document with no Registry", () => {
		const { view, disconnect } = renderPanel(doc());
		try {
			expect(view.getByTestId("components-panel-empty")).toBeDefined();
		} finally {
			disconnect();
		}
	});

	it("lists Sources sorted by name, not by Registry insertion order", () => {
		const { view, disconnect } = renderPanel(
			doc({
				registry: {
					"cmp-z": definition("cmp-z", "Zebra card"),
					"cmp-a": definition("cmp-a", "Alpha card"),
				},
			}),
		);
		try {
			const rows = Array.from(
				view.container.querySelectorAll("[data-testid^='component-row-']"),
			).map((el) => el.getAttribute("data-testid"));
			expect(rows).toEqual(["component-row-cmp-a", "component-row-cmp-z"]);
		} finally {
			disconnect();
		}
	});

	it("counts page instances and reports unused Sources", () => {
		const { view, disconnect } = renderPanel(
			doc({
				registry: {
					"cmp-used": definition("cmp-used", "Used"),
					"cmp-idle": definition("cmp-idle", "Idle"),
				},
				instances: [
					instanceNode("i1", "cmp-used"),
					instanceNode("i2", "cmp-used"),
				],
			}),
		);
		try {
			expect(view.getByTestId("component-row-cmp-used").textContent).toContain(
				"Used 2×",
			);
			expect(view.getByTestId("component-row-cmp-idle").textContent).toContain(
				"Not used yet",
			);
		} finally {
			disconnect();
		}
	});

	it("distinguishes a NESTED dependency from a page usage", () => {
		// `outer` embeds `inner`, and only `outer` is placed on the page.
		const inner = definition("cmp-inner", "Inner");
		const outer = definition("cmp-outer", "Outer", [
			instanceNode("nested-1", "cmp-inner"),
		]);
		const { view, disconnect } = renderPanel(
			doc({
				registry: { "cmp-inner": inner, "cmp-outer": outer },
				instances: [instanceNode("i1", "cmp-outer")],
			}),
		);
		try {
			const innerRow = view.getByTestId("component-row-cmp-inner").textContent;
			// Zero PAGE instances, but it is not "unused" — it is nested in one.
			expect(innerRow).toContain("nested in 1");
			expect(innerRow).not.toContain("Not used yet");
		} finally {
			disconnect();
		}
	});

	it("filters by name and shows a no-match state", () => {
		const registry = {
			"cmp-a": definition("cmp-a", "Alpha card"),
			"cmp-b": definition("cmp-b", "Beta banner"),
		};
		const hit = renderPanel(doc({ registry }), "alpha");
		try {
			expect(hit.view.queryByTestId("component-row-cmp-a")).not.toBeNull();
			expect(hit.view.queryByTestId("component-row-cmp-b")).toBeNull();
		} finally {
			hit.disconnect();
		}
		cleanup();

		const miss = renderPanel(doc({ registry }), "zzz");
		try {
			expect(miss.view.getByTestId("components-panel-no-match")).toBeDefined();
		} finally {
			miss.disconnect();
		}
	});

	it("flags a circular reference in text, not by colour alone", () => {
		// a → b → a: a hostile/corrupt document, reachable via import.
		const a = definition("cmp-a", "Aye", [instanceNode("n-a", "cmp-b")]);
		const b = definition("cmp-b", "Bee", [instanceNode("n-b", "cmp-a")]);
		const { view, disconnect } = renderPanel(
			doc({ registry: { "cmp-a": a, "cmp-b": b } }),
		);
		try {
			const row = view.getByTestId("component-row-cmp-a");
			expect(row.getAttribute("data-problem")).toBe("cycle");
			// NFR-004: the state is spelled out, so it survives greyscale and SR.
			expect(row.textContent).toContain("Circular reference");
		} finally {
			disconnect();
		}
	});

	it("inserts an instance on click, centred on the page and selected", () => {
		const ir = doc({ registry: { "cmp-a": definition("cmp-a", "Alpha") } });
		const h = makeHarness({ ir });
		const view = render(
			<CanvasStudioContext.Provider value={{ ...h.studioCtx, ir }}>
				<ComponentsPanel />
			</CanvasStudioContext.Provider>,
		);
		fireEvent.click(view.getByTestId("component-insert-cmp-a"));

		const insert = h.commits.find(
			(c) => c.type === "component-instance.insert",
		) as { componentId?: string; transform?: { x: number; y: number } };
		expect(insert?.componentId).toBe("cmp-a");
		// Page is 1080×1080 by default and the Source root is 80×40.
		expect(insert?.transform?.x).toBe((1080 - 80) / 2);
		expect(insert?.transform?.y).toBe((1080 - 40) / 2);
	});

	it("refuses to insert a Source that is in a cycle", () => {
		const a = definition("cmp-a", "Aye", [instanceNode("n-a", "cmp-b")]);
		const b = definition("cmp-b", "Bee", [instanceNode("n-b", "cmp-a")]);
		const ir = doc({ registry: { "cmp-a": a, "cmp-b": b } });
		const h = makeHarness({ ir });
		const view = render(
			<CanvasStudioContext.Provider value={{ ...h.studioCtx, ir }}>
				<ComponentsPanel />
			</CanvasStudioContext.Provider>,
		);
		// A cyclic Source resolves to a placeholder, so inserting it would place a
		// knowingly broken instance.
		const button = view.getByTestId(
			"component-insert-cmp-a",
		) as HTMLButtonElement;
		expect(button.disabled).toBe(true);
		fireEvent.click(button);
		expect(h.commits).toHaveLength(0);
	});

	it("creates a component from the selection, or explains why it cannot", () => {
		const ir = doc({ instances: [] });
		const h = makeHarness({ ir });
		// M6-07: creation is behind the `localComponents` flag.
		const enabled = { ...h.studioCtx, ir, localComponentsEnabled: true };
		const view = render(
			<CanvasStudioContext.Provider value={enabled}>
				<ComponentsPanel />
			</CanvasStudioContext.Provider>,
		);
		// Nothing selected → the affordance is disabled rather than failing on use.
		expect(
			(view.getByTestId("components-create") as HTMLButtonElement).disabled,
		).toBe(true);

		h.studioCtx.selectionStore.getState().setSelection(["n1"]);
		cleanup();
		const view2 = render(
			<CanvasStudioContext.Provider value={enabled}>
				<ComponentsPanel />
			</CanvasStudioContext.Provider>,
		);
		fireEvent.click(view2.getByTestId("components-create"));
		const create = h.commits.find((c) => c.type === "component.create") as {
			mode?: string;
			selectedNodeIds?: string[];
		};
		expect(create?.mode).toBe("from-selection");
		expect(create?.selectedNodeIds).toEqual(["n1"]);
	});

	/**
	 * M6-07 / PRD §19 rollback: the flag gates AUTHORING only. With it off a
	 * document's existing components must stay fully usable — anything else would
	 * make disabling the flag destructive.
	 */
	it("hides only CREATION when localComponents is off, keeping the rest usable", () => {
		const ir = doc({
			registry: { "cmp-a": definition("cmp-a", "Alpha") },
			instances: [instanceNode("i1", "cmp-a")],
		});
		const h = makeHarness({ ir });
		h.studioCtx.selectionStore.getState().setSelection(["i1"]);
		const view = render(
			<CanvasStudioContext.Provider value={{ ...h.studioCtx, ir }}>
				<ComponentsPanel />
			</CanvasStudioContext.Provider>,
		);
		// Creation is gone…
		expect(view.queryByTestId("components-create")).toBeNull();
		// …and everything a document already contains still works.
		expect(view.queryByTestId("component-row-cmp-a")).not.toBeNull();
		expect(
			(view.getByTestId("component-insert-cmp-a") as HTMLButtonElement)
				.disabled,
		).toBe(false);
		expect(view.queryByTestId("component-rename-start-cmp-a")).not.toBeNull();
		expect(view.queryByTestId("component-duplicate-cmp-a")).not.toBeNull();
		expect(view.queryByTestId("component-delete-cmp-a")).not.toBeNull();
		fireEvent.click(view.getByTestId("component-insert-cmp-a"));
		expect(h.commits.some((c) => c.type === "component-instance.insert")).toBe(
			true,
		);
	});

	it("renames inline on Enter and abandons on Escape", () => {
		const ir = doc({ registry: { "cmp-a": definition("cmp-a", "Alpha") } });
		const h = makeHarness({ ir });
		const view = render(
			<CanvasStudioContext.Provider value={{ ...h.studioCtx, ir }}>
				<ComponentsPanel />
			</CanvasStudioContext.Provider>,
		);
		fireEvent.click(view.getByTestId("component-rename-start-cmp-a"));
		const input = view.getByTestId("component-rename-cmp-a");
		fireEvent.keyDown(input, { key: "Escape" });
		expect(h.commits.some((c) => c.type === "component.rename")).toBe(false);

		fireEvent.click(view.getByTestId("component-rename-start-cmp-a"));
		const input2 = view.getByTestId("component-rename-cmp-a");
		fireEvent.change(input2, { target: { value: "Renamed" } });
		fireEvent.keyDown(input2, { key: "Enter" });
		const rename = h.commits.find((c) => c.type === "component.rename") as {
			to?: string;
			from?: string;
		};
		expect(rename?.to).toBe("Renamed");
		expect(rename?.from).toBe("Alpha");
	});

	it("duplicates a Source under a fresh id without creating an instance", () => {
		const ir = doc({ registry: { "cmp-a": definition("cmp-a", "Alpha") } });
		const h = makeHarness({ ir });
		const view = render(
			<CanvasStudioContext.Provider value={{ ...h.studioCtx, ir }}>
				<ComponentsPanel />
			</CanvasStudioContext.Provider>,
		);
		fireEvent.click(view.getByTestId("component-duplicate-cmp-a"));
		const dup = h.commits.find((c) => c.type === "component.duplicate") as {
			componentId?: string;
			newComponentId?: string;
		};
		expect(dup?.componentId).toBe("cmp-a");
		expect(dup?.newComponentId).toBeTruthy();
		expect(dup?.newComponentId).not.toBe("cmp-a");
		// A duplicate is a new SOURCE, not a new placement.
		expect(h.commits.some((c) => c.type === "component-instance.insert")).toBe(
			false,
		);
	});

	it("deletes an unreferenced Source but blocks a referenced one", () => {
		const unreferenced = doc({
			registry: { "cmp-a": definition("cmp-a", "Alpha") },
		});
		const h1 = makeHarness({ ir: unreferenced });
		const v1 = render(
			<CanvasStudioContext.Provider
				value={{ ...h1.studioCtx, ir: unreferenced }}
			>
				<ComponentsPanel />
			</CanvasStudioContext.Provider>,
		);
		fireEvent.click(v1.getByTestId("component-delete-cmp-a"));
		expect(h1.commits.map((c) => c.type)).toEqual(["component.delete"]);
		cleanup();

		const referenced = doc({
			registry: { "cmp-a": definition("cmp-a", "Alpha") },
			instances: [instanceNode("i1", "cmp-a")],
		});
		const h2 = makeHarness({ ir: referenced });
		const v2 = render(
			<CanvasStudioContext.Provider value={{ ...h2.studioCtx, ir: referenced }}>
				<ComponentsPanel />
			</CanvasStudioContext.Provider>,
		);
		fireEvent.click(v2.getByTestId("component-delete-cmp-a"));
		// LC-DELETE: a referenced Source is never silently detached. No command at
		// all until the M5-06 dialog offers "detach all and delete".
		expect(h2.commits).toHaveLength(0);
	});

	it("escalates a referenced delete to a confirmed detach-all (M5-06)", async () => {
		const ir = doc({
			registry: { "cmp-a": definition("cmp-a", "Alpha") },
			instances: [instanceNode("i1", "cmp-a"), instanceNode("i2", "cmp-a")],
		});
		const h = makeHarness({ ir });
		const asked: string[] = [];
		const view = render(
			<CanvasDialogContext.Provider
				value={{
					confirm: (options) => {
						asked.push(options.title);
						return Promise.resolve(true);
					},
				}}
			>
				<CanvasStudioContext.Provider value={{ ...h.studioCtx, ir }}>
					<ComponentsPanel />
				</CanvasStudioContext.Provider>
			</CanvasDialogContext.Provider>,
		);
		fireEvent.click(view.getByTestId("component-delete-cmp-a"));
		await vi.waitFor(() => expect(h.commits).toHaveLength(1));
		// The prompt names how much is being detached, and the result is ONE
		// atomic batch rather than a silent per-instance sweep.
		expect(asked[0]).toContain("2");
		expect(h.commits[0]).toMatchObject({ type: "batch" });
	});

	it("commits nothing when the referenced delete is declined", async () => {
		const ir = doc({
			registry: { "cmp-a": definition("cmp-a", "Alpha") },
			instances: [instanceNode("i1", "cmp-a")],
		});
		const h = makeHarness({ ir });
		let asked = 0;
		const view = render(
			<CanvasDialogContext.Provider
				value={{
					confirm: () => {
						asked += 1;
						return Promise.resolve(false);
					},
				}}
			>
				<CanvasStudioContext.Provider value={{ ...h.studioCtx, ir }}>
					<ComponentsPanel />
				</CanvasStudioContext.Provider>
			</CanvasDialogContext.Provider>,
		);
		fireEvent.click(view.getByTestId("component-delete-cmp-a"));
		await vi.waitFor(() => expect(asked).toBe(1));
		expect(h.commits).toHaveLength(0);
	});

	it("surfaces a resolution diagnostic for a dangling reference", () => {
		// An instance whose componentId is absent from the Registry: the row for
		// the PRESENT component stays clean, and the resolver reports the miss.
		const { view, disconnect } = renderPanel(
			doc({
				registry: { "cmp-a": definition("cmp-a", "Alpha") },
				instances: [instanceNode("i1", "cmp-ghost")],
			}),
		);
		try {
			// The panel lists only real Registry members — a dangling id is not a
			// Source, so it gets no row.
			expect(view.queryByTestId("component-row-cmp-ghost")).toBeNull();
			expect(view.queryByTestId("component-row-cmp-a")).not.toBeNull();
		} finally {
			disconnect();
		}
	});
});
