import {
	type CanvasIR,
	createCanvasIR,
	createGroup,
	createPage,
	createRect,
} from "@anvilkit/canvas-core";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import type { BrandKit } from "../../brand/brand-kit.js";
import { BrandPanel } from "../BrandPanel.js";

afterEach(cleanup);

function makeIR(): CanvasIR {
	const rect = createRect({
		id: "r1",
		bounds: { width: 10, height: 10 },
		fill: "#2563eb",
	});
	const page = createPage({
		id: "p1",
		root: createGroup({ children: [rect] }),
	});
	return createCanvasIR({ id: "doc1", pages: [page] });
}

function renderPanel(brandKit?: BrandKit, ir?: CanvasIR) {
	const h = makeHarness({ ir });
	const view = render(
		<CanvasStudioContext.Provider value={{ ...h.studioCtx, brandKit }}>
			<BrandPanel />
		</CanvasStudioContext.Provider>,
	);
	return { h, view };
}

describe("BrandPanel", () => {
	it("renders an empty state (FR-173) when no brand kit is configured", () => {
		const { view } = renderPanel();
		expect(view.getByTestId("brand-section")).toBeDefined();
		expect(view.getByTestId("brand-empty-state")).toBeDefined();
		expect(view.queryByTestId("brand-palette")).toBeNull();
		expect(view.queryByTestId("brand-fonts")).toBeNull();
	});

	it("renders colors/fonts but no compliance UI without a sourceDefinition", () => {
		const { view } = renderPanel({
			colors: [{ name: "Primary", value: "#2563eb" }],
			fonts: ["Inter"],
		});
		expect(view.getByTestId("brand-palette")).toBeDefined();
		expect(view.queryByTestId("brand-check-compliance")).toBeNull();
	});

	it("checks compliance and shows per-action counts and apply buttons", () => {
		const brandKit: BrandKit = {
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
		const { view } = renderPanel(brandKit, makeIR());

		fireEvent.click(view.getByTestId("brand-check-compliance"));

		expect(view.getByTestId("brand-apply-actions")).toBeDefined();
		// The one rect's fill (#2563eb) matches the brand color -> applyBrandColors
		// affects 1 node, so its Apply button is enabled; the other three actions
		// affect 0 nodes, so theirs stay disabled.
		expect(
			(view.getByTestId("brand-apply-colors") as HTMLButtonElement).disabled,
		).toBe(false);
		expect(
			(view.getByTestId("brand-apply-fonts") as HTMLButtonElement).disabled,
		).toBe(true);
		expect(view.getByTestId("brand-compliance-report")).toBeDefined();
	});

	it("applying an action commits its command and clears the preview", () => {
		const brandKit: BrandKit = {
			colors: [{ id: "primary", name: "Primary", value: "#2563eb" }],
			fonts: ["Inter"],
			sourceDefinition: {
				id: "kit1",
				name: "Acme",
				logos: [],
				colors: [{ id: "primary", name: "Primary", value: "#2563eb" }],
				fonts: [],
				typography: [],
				rules: [],
			},
		};
		const { h, view } = renderPanel(brandKit, makeIR());

		fireEvent.click(view.getByTestId("brand-check-compliance"));
		fireEvent.click(view.getByTestId("brand-apply-colors"));

		expect(h.studioCtx.commit).toHaveBeenCalledTimes(1);
		expect(view.queryByTestId("brand-apply-actions")).toBeNull();
	});
});
