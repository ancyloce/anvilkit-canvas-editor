import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";

import type { CanvasComponentProvider } from "../../component-libraries/component-provider.js";
import { CanvasStudioContext } from "../../context/canvas-studio-context.js";
import { ComponentsSourceSwitcher } from "../library/ComponentsSourceSwitcher.js";

/**
 * T-020 — the Local/Libraries source switch.
 *
 * The behaviour worth pinning is the DEGRADATION: with no Provider or with the
 * rollout flag off, the tab strip must not appear at all. A disabled tab would
 * advertise a feature the host has not wired.
 */
afterEach(cleanup);

const provider: CanvasComponentProvider = {
	search: () =>
		Promise.resolve({
			entries: [
				{
					ref: {
						kind: "library",
						libraryId: "acme",
						componentId: "button",
						version: "1.0.0",
						integrity: `sha256-${"b".repeat(43)}`,
					},
					name: "button",
				},
			],
		}),
	getEnvelope: () => Promise.resolve(null),
};

function mount(
	overrides: {
		componentProvider?: CanvasComponentProvider;
		externalComponentsEnabled?: boolean;
	} = {},
) {
	const h = makeHarness({});
	return render(
		<CanvasStudioContext.Provider value={{ ...h.studioCtx, ...overrides }}>
			<ComponentsSourceSwitcher />
		</CanvasStudioContext.Provider>,
	);
}

describe("ComponentsSourceSwitcher — degradation", () => {
	it("renders the bare local panel when no Provider is wired", () => {
		mount({ externalComponentsEnabled: true });
		expect(screen.queryByTestId("components-source-switcher")).toBeNull();
		expect(screen.getByTestId("components-panel")).toBeTruthy();
	});

	it("renders the bare local panel when the rollout flag is OFF", () => {
		// A Provider alone must not surface the feature: the flag is the rollout
		// control, and honouring only the Provider would ship it early.
		mount({ componentProvider: provider, externalComponentsEnabled: false });
		expect(screen.queryByTestId("components-source-switcher")).toBeNull();
		expect(screen.getByTestId("components-panel")).toBeTruthy();
	});

	it("shows the source tabs when BOTH are present", () => {
		mount({ componentProvider: provider, externalComponentsEnabled: true });
		expect(screen.getByTestId("components-source-switcher")).toBeTruthy();
		expect(screen.getByTestId("components-source-local")).toBeTruthy();
		expect(screen.getByTestId("components-source-libraries")).toBeTruthy();
	});
});

describe("ComponentsSourceSwitcher — switching", () => {
	it("starts on Local", () => {
		mount({ componentProvider: provider, externalComponentsEnabled: true });
		expect(
			screen
				.getByTestId("components-source-local")
				.getAttribute("aria-selected"),
		).toBe("true");
		expect(screen.getByTestId("components-panel")).toBeTruthy();
		expect(screen.queryByTestId("libraries-panel")).toBeNull();
	});

	it("switches to Libraries and back", async () => {
		mount({ componentProvider: provider, externalComponentsEnabled: true });

		await userEvent.click(screen.getByTestId("components-source-libraries"));
		await waitFor(() =>
			expect(screen.getByTestId("libraries-panel")).toBeTruthy(),
		);
		expect(screen.queryByTestId("components-panel")).toBeNull();
		expect(
			screen
				.getByTestId("components-source-libraries")
				.getAttribute("aria-selected"),
		).toBe("true");

		await userEvent.click(screen.getByTestId("components-source-local"));
		await waitFor(() =>
			expect(screen.getByTestId("components-panel")).toBeTruthy(),
		);
		expect(screen.queryByTestId("libraries-panel")).toBeNull();
	});

	it("exposes the tabs with proper roles", () => {
		mount({ componentProvider: provider, externalComponentsEnabled: true });
		const tablist = screen.getByRole("tablist");
		expect(tablist.getAttribute("aria-label")).toBeTruthy();
		expect(screen.getAllByRole("tab")).toHaveLength(2);
	});
});
