import type {
	CanvasComponentCompatibilityReport,
	CanvasComponentVariantSet,
} from "@anvilkit/canvas-core";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CanvasT } from "../../context/canvas-studio-context.js";
import { UpdateComponentDialog } from "../library/UpdateComponentDialog.js";
import { VariantControls } from "../library/VariantControls.js";

/**
 * T-027 / T-031 / T-032 — variant controls and the change dialog.
 *
 * `globals: false` in the vitest preset means RTL auto-cleanup is OFF.
 */
afterEach(cleanup);

const t: CanvasT = ((_key: string, fallback?: string) =>
	fallback ?? _key) as CanvasT;

/** Named rather than an inline `() => {}`, which Biome flags as an empty block. */
function noop(): void {
	return undefined;
}

/** 2x2 axis space with only 3 of 4 combinations declared — genuinely sparse. */
const SET: CanvasComponentVariantSet = {
	axes: [
		{ id: "size", values: [{ id: "sm" }, { id: "lg" }], defaultValueId: "sm" },
		{
			id: "tone",
			values: [{ id: "brand" }, { id: "neutral" }],
			defaultValueId: "neutral",
		},
	],
	variants: [
		{ id: "a", selection: { size: "sm", tone: "neutral" } },
		{ id: "b", selection: { size: "sm", tone: "brand" } },
		{ id: "c", selection: { size: "lg", tone: "neutral" } },
		// `lg` + `brand` deliberately absent.
	],
	defaultVariantId: "a",
};

describe("VariantControls (T-027)", () => {
	it("renders one group per axis", () => {
		render(
			<VariantControls
				set={SET}
				selection={undefined}
				onChange={noop}
				t={t}
			/>,
		);
		expect(screen.getByTestId("variant-axis-size")).toBeTruthy();
		expect(screen.getByTestId("variant-axis-tone")).toBeTruthy();
		expect(screen.getAllByRole("radiogroup")).toHaveLength(2);
	});

	it("marks the current value, filling unset axes from their defaults", () => {
		render(
			<VariantControls
				set={SET}
				selection={{ tone: "brand" }}
				onChange={noop}
				t={t}
			/>,
		);
		expect(
			screen
				.getByTestId("variant-value-tone-brand")
				.getAttribute("aria-checked"),
		).toBe("true");
		// `size` was not persisted, so its axis default is shown as current.
		expect(
			screen.getByTestId("variant-value-size-sm").getAttribute("aria-checked"),
		).toBe("true");
	});

	it("marks an unavailable combination relative to the OTHER axes", () => {
		// With tone=neutral, size=lg exists. Availability is not a property of a
		// value alone.
		const { unmount } = render(
			<VariantControls
				set={SET}
				selection={{ tone: "neutral" }}
				onChange={noop}
				t={t}
			/>,
		);
		expect(
			screen
				.getByTestId("variant-value-size-lg")
				.getAttribute("data-available"),
		).toBe("true");
		unmount();

		// With tone=brand, size=lg does NOT exist.
		render(
			<VariantControls
				set={SET}
				selection={{ tone: "brand" }}
				onChange={noop}
				t={t}
			/>,
		);
		expect(
			screen
				.getByTestId("variant-value-size-lg")
				.getAttribute("data-available"),
		).toBe("false");
	});

	it("conveys unavailability by TEXT and ICON, not colour alone (DoD)", () => {
		render(
			<VariantControls
				set={SET}
				selection={{ tone: "brand" }}
				onChange={noop}
				t={t}
			/>,
		);
		const option = screen.getByTestId("variant-value-size-lg");
		// A marker character in the label…
		expect(option.textContent).toContain("✕");
		// …a title…
		expect(option.getAttribute("title")).toBeTruthy();
		// …and screen-reader text.
		expect(option.textContent).toContain("not available");
	});

	it("keeps unavailable options FOCUSABLE via aria-disabled", () => {
		// `disabled` would remove them from the tab order, so a keyboard user
		// could not discover that the combination does not exist.
		render(
			<VariantControls
				set={SET}
				selection={{ tone: "brand" }}
				onChange={noop}
				t={t}
			/>,
		);
		const option = screen.getByTestId("variant-value-size-lg");
		expect(option.getAttribute("aria-disabled")).toBe("true");
		expect(option.hasAttribute("disabled")).toBe(false);
	});

	it("does not emit a change for an unavailable option", async () => {
		const onChange = vi.fn();
		render(
			<VariantControls
				set={SET}
				selection={{ tone: "brand" }}
				onChange={onChange}
				t={t}
			/>,
		);
		await userEvent.click(screen.getByTestId("variant-value-size-lg"));
		expect(onChange).not.toHaveBeenCalled();
	});

	it("emits a PARTIAL selection, preserving unrelated axes", async () => {
		const onChange = vi.fn();
		render(
			<VariantControls
				set={SET}
				selection={{ tone: "brand" }}
				onChange={onChange}
				t={t}
			/>,
		);
		await userEvent.click(screen.getByTestId("variant-value-tone-neutral"));
		expect(onChange).toHaveBeenCalledWith({ tone: "neutral" });
	});

	it("warns when a selection would orphan an override", () => {
		render(
			<VariantControls
				set={SET}
				selection={{ tone: "neutral" }}
				onChange={noop}
				orphanWarning={(next) => next.size === "lg"}
				t={t}
			/>,
		);
		const option = screen.getByTestId("variant-value-size-lg");
		expect(option.textContent).toContain("⚠");
		expect(option.getAttribute("title")).toContain("no longer apply");
	});
});

describe("UpdateComponentDialog (T-031, T-032)", () => {
	const report = (
		overrides: Partial<CanvasComponentCompatibilityReport> = {},
	): CanvasComponentCompatibilityReport => ({
		classification: "review-required",
		properties: [
			{ fromPropertyId: "kept", toPropertyId: "kept", kind: "exact" },
			{ fromPropertyId: "lost", kind: "orphaned" },
		],
		variants: [],
		dependencies: [],
		addedPropertyIds: [],
		...overrides,
	});

	function mount(
		props: Partial<React.ComponentProps<typeof UpdateComponentDialog>> = {},
	) {
		const onConfirm = vi.fn();
		const onCancel = vi.fn();
		render(
			<UpdateComponentDialog
				verb="update"
				report={report()}
				affectedInstanceCount={1}
				fromVersion="1.0.0"
				toVersion="2.0.0"
				onConfirm={onConfirm}
				onCancel={onCancel}
				t={t}
				{...props}
			/>,
		);
		return { onConfirm, onCancel };
	}

	it("shows the classification and both version strings", () => {
		mount();
		expect(
			screen.getByTestId("change-classification-review-required"),
		).toBeTruthy();
		expect(screen.getByTestId("change-versions").textContent).toContain(
			"1.0.0",
		);
		expect(screen.getByTestId("change-versions").textContent).toContain(
			"2.0.0",
		);
	});

	it("separates preserved from orphaned overrides and names them", () => {
		mount();
		expect(screen.getByTestId("outcome-preserved").textContent).toContain(
			"kept",
		);
		expect(screen.getByTestId("outcome-orphaned").textContent).toContain(
			"lost",
		);
	});

	it("shows blocked overrides distinctly", () => {
		mount({
			report: report({
				classification: "incompatible",
				properties: [{ fromPropertyId: "typed", kind: "blocked" }],
			}),
		});
		expect(screen.getByTestId("outcome-blocked").textContent).toContain(
			"typed",
		);
	});

	it("CANCEL is inert — it only reports the choice", async () => {
		const { onCancel, onConfirm } = mount();
		await userEvent.click(screen.getByTestId("change-cancel"));
		expect(onCancel).toHaveBeenCalledTimes(1);
		expect(onConfirm).not.toHaveBeenCalled();
	});

	it("Escape cancels", async () => {
		const { onCancel } = mount();
		await userEvent.keyboard("{Escape}");
		expect(onCancel).toHaveBeenCalled();
	});

	it("offers an all-instances scope only when more than one is affected", () => {
		const { unmount } = render(
			<UpdateComponentDialog
				verb="update"
				report={report()}
				affectedInstanceCount={1}
				fromVersion="1"
				toVersion="2"
				onConfirm={noop}
				onCancel={noop}
				t={t}
			/>,
		);
		expect(screen.queryByTestId("change-confirm-all")).toBeNull();
		unmount();

		mount({ affectedInstanceCount: 4 });
		expect(screen.getByTestId("change-confirm-all").textContent).toContain("4");
	});

	it("reports the chosen scope", async () => {
		const { onConfirm } = mount({ affectedInstanceCount: 3 });
		await userEvent.click(screen.getByTestId("change-confirm-all"));
		expect(onConfirm).toHaveBeenCalledWith("all");
	});

	it("focuses the primary action on open", () => {
		mount();
		expect(document.activeElement).toBe(screen.getByTestId("change-confirm"));
	});

	it("is a labelled modal dialog", () => {
		mount();
		const dialog = screen.getByTestId("component-update-dialog");
		expect(dialog.getAttribute("role")).toBe("dialog");
		expect(dialog.getAttribute("aria-modal")).toBe("true");
		expect(dialog.getAttribute("aria-labelledby")).toBeTruthy();
	});

	it("renders release notes only when a URL is supplied", () => {
		const { unmount } = render(
			<UpdateComponentDialog
				verb="update"
				report={report()}
				affectedInstanceCount={1}
				fromVersion="1"
				toVersion="2"
				onConfirm={noop}
				onCancel={noop}
				t={t}
			/>,
		);
		expect(screen.queryByTestId("change-release-notes")).toBeNull();
		unmount();

		mount({ releaseNotesUrl: "https://example.com/notes" });
		const link = screen.getByTestId("change-release-notes");
		expect(link.getAttribute("href")).toBe("https://example.com/notes");
		// An external link must not hand the opener over.
		expect(link.getAttribute("rel")).toContain("noopener");
	});

	it("swap uses the swap wording", () => {
		mount({ verb: "swap" });
		expect(screen.getByTestId("component-swap-dialog")).toBeTruthy();
		expect(screen.getByTestId("change-confirm").textContent).toContain("Swap");
	});
});
