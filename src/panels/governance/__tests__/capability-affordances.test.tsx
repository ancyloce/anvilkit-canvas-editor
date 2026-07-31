import type { CanvasIR } from "@anvilkit/canvas-core";
import {
	createCanvasIR,
	createComponentInstance,
	createGroup,
	createPage,
	createRect,
} from "@anvilkit/canvas-core";
import type { CanvasBrandPolicyContext } from "@anvilkit/canvas-core/brand-governance";
import { cleanup, render } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";

import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import { PropertyInspector } from "@/panels/PropertyInspector.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";

/**
 * T-040 steps 1 and 4 — denied affordances, and a capability change mid-session.
 *
 * These assert PRESENTATION. The enforcement they mirror is core's
 * `governance-bypass` suite; if this file were deleted the document would still
 * be protected, which is the T-040 DoD ("UI hiding never used as the only
 * enforcement").
 */

afterEach(cleanup);

const DEFINITION = {
	id: "card",
	name: "Card",
	revision: 1,
	root: createGroup({
		id: "card-root",
		children: [
			createRect({ id: "card-inner", bounds: { width: 4, height: 4 } }),
		],
	}),
	properties: [],
};

function makeIR(): CanvasIR {
	const instance = createComponentInstance({
		id: "inst-1",
		componentId: "card",
		bounds: { width: 10, height: 10 },
	});
	return {
		...createCanvasIR({
			id: "doc",
			pages: [
				createPage({
					id: "p1",
					root: createGroup({ id: "p1-root", children: [instance] }),
				}),
			],
		}),
		components: { card: DEFINITION },
	} as CanvasIR;
}

function context(
	capabilities: Partial<CanvasBrandPolicyContext["capabilities"]> = {},
	policyRevision?: string,
): CanvasBrandPolicyContext {
	return {
		enforcement: "blocking",
		capabilities: {
			canEditOverrides: true,
			canChangeVariant: true,
			canDetach: true,
			canFlatten: true,
			canInsertExternalComponents: true,
			canUpdateComponents: true,
			...capabilities,
		},
		...(policyRevision !== undefined ? { policyRevision } : {}),
	};
}

function mount(brandGovernance: CanvasBrandPolicyContext | undefined) {
	const h = makeHarness({ ir: makeIR() });
	h.studioCtx.selectionStore.getState().setSelection(["inst-1"]);
	const value = {
		...h.studioCtx,
		ir: h.studioCtx.getIR(),
		...(brandGovernance ? { brandGovernance } : {}),
	};
	const view = render(
		<CanvasStudioContext.Provider value={value}>
			<PropertyInspector />
		</CanvasStudioContext.Provider>,
	);
	return { view, value };
}

describe("capability-gated affordances (T-040)", () => {
	it("an ungoverned host keeps Detach enabled", () => {
		// The pre-M4 behaviour every existing embedder relies on.
		const { view } = mount(undefined);
		expect(
			(view.getByTestId("component-detach") as HTMLButtonElement).disabled,
		).toBe(false);
	});

	it("disables Detach when the capability snapshot denies it", () => {
		const { view } = mount(context({ canDetach: false }));
		const button = view.getByTestId("component-detach") as HTMLButtonElement;
		expect(button.disabled).toBe(true);
		// Disabled WITH a reason: a control that just stops working reads as a bug.
		expect(button.getAttribute("title")).toContain("may not be detached");
	});

	it('enforcement "off" leaves every affordance alone', () => {
		const ctx = {
			...context({ canDetach: false }),
			enforcement: "off" as const,
		};
		const { view } = mount(ctx);
		expect(
			(view.getByTestId("component-detach") as HTMLButtonElement).disabled,
		).toBe(false);
	});

	it("a capability withdrawn mid-session updates the UI (T-040 step 4)", () => {
		const h = makeHarness({ ir: makeIR() });
		h.studioCtx.selectionStore.getState().setSelection(["inst-1"]);
		const render1 = render(
			<CanvasStudioContext.Provider
				value={{
					...h.studioCtx,
					ir: h.studioCtx.getIR(),
					brandGovernance: context({}, "rev-1"),
				}}
			>
				<PropertyInspector />
			</CanvasStudioContext.Provider>,
		);
		expect(
			(render1.getByTestId("component-detach") as HTMLButtonElement).disabled,
		).toBe(false);

		render1.rerender(
			<CanvasStudioContext.Provider
				value={{
					...h.studioCtx,
					ir: h.studioCtx.getIR(),
					brandGovernance: context({ canDetach: false }, "rev-2"),
				}}
			>
				<PropertyInspector />
			</CanvasStudioContext.Provider>,
		);
		// No remount, no document change — only the host's snapshot moved.
		expect(
			(render1.getByTestId("component-detach") as HTMLButtonElement).disabled,
		).toBe(true);
	});
});
