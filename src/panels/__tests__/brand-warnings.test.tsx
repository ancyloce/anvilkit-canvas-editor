import {
	type CanvasIR,
	createCanvasIR,
	createGroup,
	createPage,
	createRect,
} from "@anvilkit/canvas-core";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import type { BrandKit } from "../../brand/brand-kit.js";
import { PropertyInspector } from "../PropertyInspector.js";

afterEach(cleanup);

const BRAND_KIT: BrandKit = {
	colors: [{ id: "primary", name: "Primary", value: "#2563eb" }],
	fonts: ["Inter"],
	sourceDefinition: {
		id: "kit1",
		name: "Acme",
		logos: [],
		colors: [{ id: "primary", name: "Primary", value: "#2563eb" }],
		fonts: [{ id: "body", name: "Body", family: "Inter" }],
		typography: [],
		rules: [],
	},
};

function makeIR(): CanvasIR {
	const onBrand = createRect({
		id: "on-brand",
		bounds: { width: 10, height: 10 },
		fill: "#2563eb",
	});
	const offBrand = createRect({
		id: "off-brand",
		bounds: { width: 10, height: 10 },
		fill: "#ff0000",
	});
	const page = createPage({
		id: "p1",
		root: createGroup({ children: [onBrand, offBrand] }),
	});
	return createCanvasIR({ id: "doc1", pages: [page] });
}

function mount(brandKit: BrandKit | undefined, selected: string[]) {
	const h = makeHarness({ ir: makeIR() });
	h.studioCtx.selectionStore.getState().setSelection(selected);
	const view = render(
		<CanvasStudioContext.Provider
			value={{ ...h.studioCtx, brandKit, ir: h.studioCtx.getIR() }}
		>
			<PropertyInspector />
		</CanvasStudioContext.Provider>,
	);
	return view;
}

describe("BrandComplianceWarnings (C-07, FR-142)", () => {
	it("warns passively when the selected fill is off-brand", () => {
		const view = mount(BRAND_KIT, ["off-brand"]);
		const warning = view.getByTestId("brand-warnings");
		expect(warning.textContent).toContain("Off-brand selection");
		// Non-blocking: the inspector's fields render normally alongside.
		expect(view.getByTestId("prop-name")).toBeDefined();
	});

	it("stays silent for an on-brand selection", () => {
		const view = mount(BRAND_KIT, ["on-brand"]);
		expect(view.queryByTestId("brand-warnings")).toBeNull();
	});

	it("stays silent without a full brand-kit definition", () => {
		const view = mount(
			{ colors: [{ name: "Primary", value: "#2563eb" }], fonts: [] },
			["off-brand"],
		);
		expect(view.queryByTestId("brand-warnings")).toBeNull();
	});

	it("dedupes identical issues across a multi-selection", () => {
		const view = mount(BRAND_KIT, ["off-brand", "on-brand"]);
		const warning = view.getByTestId("brand-warnings");
		// one title row + one deduped message row
		expect(warning.children).toHaveLength(2);
	});
});
