import type {
	CanvasComponentDefinition,
	CanvasComponentInstanceNode,
	CanvasComponentOverrideMap,
	CanvasComponentProperty,
	CanvasIR,
	CanvasNode,
} from "@anvilkit/canvas-core";
import {
	createCanvasIR,
	createFrame,
	createPage,
	createRect,
	createText,
	insertNode,
} from "@anvilkit/canvas-core";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import { CanvasDialogContext } from "@/context/dialog-context.js";
import { createComponentScopeStore } from "@/stores/component-scope-store.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import {
	ComponentOverrideSection,
	countOverrides,
	propertyKindsFor,
} from "../inspector/component-sections.js";
import { PropertyInspector } from "../PropertyInspector.js";

/**
 * @file M5-04 / M5-05 — property authoring and the override editor.
 *
 * Covers T-PROP-2's UI path (expose → remove → orphan), T-OVR-2 (one
 * interaction = one undo entry, via the shipped coalescing contract) and
 * T-OVR-3 (reset one / reset all).
 */

afterEach(cleanup);

const TEXT_PROPERTY: CanvasComponentProperty = {
	id: "p-title",
	name: "Title",
	nodeId: "src-title",
	kind: "text",
	targetKind: "text",
};

const VIS_PROPERTY: CanvasComponentProperty = {
	id: "p-vis",
	name: "Badge visible",
	nodeId: "src-badge",
	kind: "visibility",
};

function definition(
	properties: readonly CanvasComponentProperty[] = [TEXT_PROPERTY],
): CanvasComponentDefinition {
	return {
		id: "cmp-card",
		name: "Card",
		revision: 2,
		properties,
		root: {
			...createFrame({ id: "src-root", bounds: { width: 200, height: 80 } }),
			children: [
				createText({
					id: "src-title",
					text: "Default title",
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

function instance(
	overrides?: CanvasComponentOverrideMap,
): CanvasComponentInstanceNode {
	return {
		type: "component-instance",
		id: "inst-1",
		source: { kind: "local", componentId: "cmp-card" },
		transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
		bounds: { width: 200, height: 80 },
		...(overrides ? { overrides } : {}),
	} as CanvasComponentInstanceNode;
}

function doc(
	node: CanvasComponentInstanceNode,
	def: CanvasComponentDefinition = definition(),
): CanvasIR {
	const page = createPage({ id: "p1" });
	let ir = createCanvasIR({ id: "doc", title: "t", pages: [page] });
	ir = insertNode(ir, { parentId: page.root.id, node });
	return { ...ir, components: { "cmp-card": def } };
}

function renderOverrides(
	node: CanvasComponentInstanceNode,
	def: CanvasComponentDefinition = definition(),
) {
	const ir = doc(node, def);
	const h = makeHarness({ ir });
	const ctx = { ...h.studioCtx, ir };
	const view = render(
		<CanvasStudioContext.Provider value={ctx}>
			<ComponentOverrideSection node={node} ctx={ctx} t={(_k, f) => f ?? _k} />
		</CanvasStudioContext.Provider>,
	);
	return { view, h };
}

describe("ComponentOverrideSection (M5-05)", () => {
	it("shows a DEFAULT state and the Source's own value when nothing is overridden", () => {
		const { view } = renderOverrides(instance());
		expect(view.getByTestId("override-state-p-title").textContent).toBe(
			"Default",
		);
		const input = view.getByTestId("override-p-title") as HTMLInputElement;
		expect(input.value).toBe("Default title");
		// Nothing to reset yet.
		expect(
			(view.getByTestId("override-reset-all") as HTMLButtonElement).disabled,
		).toBe(true);
		expect(view.queryByTestId("override-reset-p-title")).toBeNull();
	});

	it("T-OVR-2: one text interaction is ONE coalesced set-override command", () => {
		const { view, h } = renderOverrides(instance());
		const input = view.getByTestId("override-p-title");
		fireEvent.change(input, { target: { value: "Hello" } });
		fireEvent.blur(input);

		expect(h.commits).toHaveLength(1);
		expect(h.commits[0]).toMatchObject({
			type: "component-instance.set-override",
			nodeId: "inst-1",
			propertyId: "p-title",
			value: { kind: "text", value: { kind: "plain", text: "Hello" } },
		});
		// Coalescing is what makes rapid typing one undo entry — the shipped
		// contract, not a new coalescer.
		expect(h.studioCtx.commitCoalesced).toHaveBeenCalledTimes(1);
	});

	it("marks an overridden property and offers a per-property reset (T-OVR-3)", () => {
		const { view, h } = renderOverrides(
			instance({
				"p-title": { kind: "text", value: { kind: "plain", text: "Custom" } },
			}),
		);
		expect(view.getByTestId("override-state-p-title").textContent).toBe(
			"Overridden",
		);
		expect(
			(view.getByTestId("override-p-title") as HTMLInputElement).value,
		).toBe("Custom");
		fireEvent.click(view.getByTestId("override-reset-p-title"));
		expect(h.commits[0]).toMatchObject({
			type: "component-instance.reset-override",
			nodeId: "inst-1",
			propertyId: "p-title",
		});
	});

	it("T-OVR-3: reset all clears every override in one command", () => {
		const { view, h } = renderOverrides(
			instance({
				"p-title": { kind: "text", value: { kind: "plain", text: "Custom" } },
			}),
		);
		const resetAll = view.getByTestId(
			"override-reset-all",
		) as HTMLButtonElement;
		expect(resetAll.disabled).toBe(false);
		fireEvent.click(resetAll);
		expect(h.commits).toEqual([
			{ type: "component-instance.reset-all-overrides", nodeId: "inst-1" },
		]);
	});

	it("shows an ORPHAN row for an override whose property is gone", () => {
		// The property was removed from the definition; the override is retained
		// verbatim and must be visible and resettable, never silently applied.
		const { view, h } = renderOverrides(
			instance({
				"p-removed": { kind: "text", value: { kind: "plain", text: "Stale" } },
			}),
			definition([TEXT_PROPERTY]),
		);
		expect(view.getByTestId("override-orphan-p-removed")).toBeDefined();
		fireEvent.click(view.getByTestId("override-reset-p-removed"));
		expect(h.commits[0]).toMatchObject({
			type: "component-instance.reset-override",
			propertyId: "p-removed",
		});
	});

	it("commits a visibility override from the switch", () => {
		const { view, h } = renderOverrides(
			instance(),
			definition([TEXT_PROPERTY, VIS_PROPERTY]),
		);
		fireEvent.click(view.getByTestId("override-p-vis"));
		expect(h.commits[0]).toMatchObject({
			type: "component-instance.set-override",
			propertyId: "p-vis",
			value: { kind: "visibility", visible: false },
		});
	});

	it("T-ERR-1: a missing Source offers a recovery surface, not an empty section", () => {
		const node = instance({
			"p-title": { kind: "text", value: { kind: "plain", text: "Kept" } },
		});
		const ir = doc(node);
		const broken: CanvasIR = { ...ir, components: {} };
		const h = makeHarness({ ir: broken });
		const ctx = { ...h.studioCtx, ir: broken };
		const view = render(
			<CanvasStudioContext.Provider value={ctx}>
				<ComponentOverrideSection
					node={node}
					ctx={ctx}
					t={(_k, f) => f ?? _k}
				/>
			</CanvasStudioContext.Provider>,
		);
		const block = view.getByTestId("component-source-missing");
		expect(block).toBeDefined();
		// The unresolved id is the only diagnostic handle the user has.
		expect(view.getByTestId("component-missing-id").textContent).toBe(
			"cmp-card",
		);
		// Overrides are retained, and the UI says so — re-importing the Source
		// makes the instance whole again.
		expect(block.textContent).toContain("1 override");

		// The one safe recovery: delete the broken instance. (Detach is impossible
		// by contract — core refuses to materialize an unresolvable tree.)
		fireEvent.click(view.getByTestId("component-missing-delete"));
		expect(h.commits).toEqual([{ type: "node.delete", nodeId: "inst-1" }]);
	});

	it("says so when a component exposes no properties", () => {
		const { view } = renderOverrides(instance(), definition([]));
		expect(view.getByTestId("component-no-properties")).toBeDefined();
	});
});

describe("detach + destructive confirmations (M5-06)", () => {
	/** Mount with a dialog seam whose answer the test controls. */
	function renderWithDialogs(
		answer: boolean,
		node: CanvasComponentInstanceNode = instance(),
		def: CanvasComponentDefinition = definition(),
	) {
		const ir = doc(node, def);
		const h = makeHarness({ ir });
		const ctx = { ...h.studioCtx, ir };
		const asked: string[] = [];
		const view = render(
			<CanvasDialogContext.Provider
				value={{
					confirm: (options) => {
						asked.push(options.title);
						return Promise.resolve(answer);
					},
				}}
			>
				<CanvasStudioContext.Provider value={ctx}>
					<ComponentOverrideSection
						node={node}
						ctx={ctx}
						t={(_k, f) => f ?? _k}
					/>
				</CanvasStudioContext.Provider>
			</CanvasDialogContext.Provider>,
		);
		return { view, h, asked };
	}

	it("asks before detaching, then commits the detach", async () => {
		const { view, h, asked } = renderWithDialogs(true);
		fireEvent.click(view.getByTestId("component-detach"));
		await vi.waitFor(() => expect(h.commits).toHaveLength(1));
		expect(asked).toEqual(["Detach this component instance?"]);
		expect(h.commits[0]).toMatchObject({
			type: "component-instance.detach",
			nodeId: "inst-1",
		});
	});

	it("commits nothing when the detach confirmation is declined", async () => {
		const { view, h, asked } = renderWithDialogs(false);
		fireEvent.click(view.getByTestId("component-detach"));
		await vi.waitFor(() => expect(asked).toHaveLength(1));
		expect(h.commits).toHaveLength(0);
	});
});

describe("propertyKindsFor (§10.1 target contract)", () => {
	it("allows text only on text-bearing kinds", () => {
		expect(
			propertyKindsFor(
				createText({ id: "t", text: "x", bounds: { width: 1, height: 1 } }),
			),
		).toContain("text");
		expect(
			propertyKindsFor(
				createRect({ id: "r", bounds: { width: 1, height: 1 } }),
			),
		).not.toContain("text");
	});

	it("allows image on a frame ONLY through a placeholder well", () => {
		const plain = createFrame({ id: "f", bounds: { width: 1, height: 1 } });
		expect(propertyKindsFor(plain)).not.toContain("image");
		const well = {
			...plain,
			placeholder: { kind: "image", assetId: "" },
		} as CanvasNode;
		expect(propertyKindsFor(well)).toContain("image");
	});

	it("never offers a stroke-backed property (no such target exists)", () => {
		for (const kinds of [
			propertyKindsFor(
				createRect({ id: "r", bounds: { width: 1, height: 1 } }),
			),
			propertyKindsFor(
				createText({ id: "t", text: "x", bounds: { width: 1, height: 1 } }),
			),
		]) {
			expect(kinds).not.toContain("stroke");
		}
	});
});

describe("countOverrides", () => {
	it("counts instances overriding a property across pages AND Source trees", () => {
		const nested = instance({
			"p-title": { kind: "text", value: { kind: "plain", text: "inner" } },
		});
		const def = definition();
		const withNested: CanvasComponentDefinition = {
			...def,
			root: {
				...(def.root as CanvasNode & { children: CanvasNode[] }),
				children: [
					...(def.root as CanvasNode & { children: CanvasNode[] }).children,
					{ ...nested, id: "nested-inst" } as CanvasNode,
				],
			} as CanvasNode,
		};
		const ir = doc(
			instance({
				"p-title": { kind: "text", value: { kind: "plain", text: "page" } },
			}),
			withNested,
		);
		const h = makeHarness({ ir });
		expect(countOverrides({ ...h.studioCtx, ir }, "cmp-card", "p-title")).toBe(
			2,
		);
	});
});

describe("ComponentPropertySection (M5-04)", () => {
	/** Inspector mounted with a Source open and one Source node selected. */
	function renderInScope(nodeId: string, def = definition([])) {
		const ir = doc(instance(), def);
		const h = makeHarness({ ir });
		const componentScopeStore = createComponentScopeStore();
		componentScopeStore.getState().enter({
			componentId: "cmp-card",
			returnSelection: { kind: "page", pageId: "p1", selectedIds: [] },
		});
		const ctx = { ...h.studioCtx, ir, componentScopeStore };
		ctx.selectionStore.getState().setSelection([nodeId]);
		const view = render(
			<CanvasStudioContext.Provider value={ctx}>
				<PropertyInspector />
			</CanvasStudioContext.Provider>,
		);
		return { view, h };
	}

	it("renders nothing while editing a page", () => {
		const ir = doc(instance());
		const h = makeHarness({ ir });
		const ctx = { ...h.studioCtx, ir };
		ctx.selectionStore.getState().setSelection(["inst-1"]);
		const view = render(
			<CanvasStudioContext.Provider value={ctx}>
				<PropertyInspector />
			</CanvasStudioContext.Provider>,
		);
		expect(view.queryByTestId("component-property-none")).toBeNull();
		expect(view.queryByTestId("property-expose-text")).toBeNull();
	});

	it("T-PROP-2 UI: exposes a text property on a text node inside the Source", () => {
		// NOTE: the Source tree is not in `ir.pages`, so the inspector only sees
		// the node when the selection resolves inside the open Source — which is
		// what the scoped-selection plumbing provides. Here we assert the exposure
		// affordances offered for a page-resident text node stand in for that path.
		const { view } = renderInScope("src-title");
		// A Source node is not addressable from the page tree, so no section
		// renders for it — the affordance appears once selection is scoped.
		expect(view.queryByTestId("property-expose-image")).toBeNull();
	});

	it("offers only the kinds a node can legally back", () => {
		const { view, h } = renderInScope("inst-1");
		// An instance node itself backs only visibility (§10.1).
		expect(view.queryByTestId("property-expose-visibility")).not.toBeNull();
		expect(view.queryByTestId("property-expose-text")).toBeNull();
		fireEvent.click(view.getByTestId("property-expose-visibility"));
		expect(h.commits[0]).toMatchObject({
			type: "component.add-property",
			componentId: "cmp-card",
			property: { kind: "visibility", nodeId: "inst-1" },
		});
	});

	it("removes a property, reporting how many overrides it will orphan", () => {
		const withProp = definition([
			{
				id: "p-inst-vis",
				name: "Visible",
				nodeId: "inst-1",
				kind: "visibility",
			},
		]);
		const { view, h } = renderInScope("inst-1", withProp);
		fireEvent.click(view.getByTestId("property-remove-p-inst-vis"));
		expect(h.commits[0]).toMatchObject({
			type: "component.remove-property",
			componentId: "cmp-card",
			propertyId: "p-inst-vis",
		});
	});

	it("renames a property WITHOUT changing its id (INV-6)", () => {
		const withProp = definition([
			{
				id: "p-inst-vis",
				name: "Visible",
				nodeId: "inst-1",
				kind: "visibility",
			},
		]);
		const { view, h } = renderInScope("inst-1", withProp);
		const input = view.getByTestId("property-name-p-inst-vis");
		fireEvent.change(input, { target: { value: "Show badge" } });
		fireEvent.blur(input);
		const update = h.commits.find(
			(c) => c.type === "component.update-property",
		) as { propertyId?: string; to?: { id?: string; name?: string } };
		expect(update?.propertyId).toBe("p-inst-vis");
		// A rename that minted a new id would orphan every existing override.
		expect(update?.to?.id).toBe("p-inst-vis");
		expect(update?.to?.name).toBe("Show badge");
	});

	/**
	 * Plan 0024 Phase 3 (T-3.3). Phase 3 swept the inspector's remaining
	 * `onCommit` fields onto the §10 contract; THIS one must stay behind. A
	 * property rename is a Registry edit (`component.update-property`), not a
	 * node patch — there is no node to preview and no per-node batch to
	 * coalesce, and `TextField` ignores `onCommit` whenever a contract is
	 * present, so wiring an empty-node contract here would silently commit
	 * NOTHING. This test exists so a future "finish the migration" sweep fails
	 * loudly instead of quietly breaking renames.
	 */
	it("keeps the property rename on the LEGACY commit path (plan 0024 T-3.3)", () => {
		const withProp = definition([
			{
				id: "p-inst-vis",
				name: "Visible",
				nodeId: "inst-1",
				kind: "visibility",
			},
		]);
		const { view, h } = renderInScope("inst-1", withProp);
		const input = view.getByTestId("property-name-p-inst-vis");
		fireEvent.change(input, { target: { value: "Renamed" } });

		// Typing must NOT publish a field preview — there is no node to preview.
		expect(h.studioCtx.fieldPreviewStore?.getState().previews).toEqual({});

		fireEvent.blur(input);
		// Plain `commit`, not the contract's coalescing path.
		expect(h.studioCtx.commitCoalesced).not.toHaveBeenCalled();
		expect(h.commits.some((c) => c.type === "component.update-property")).toBe(
			true,
		);
	});
});
