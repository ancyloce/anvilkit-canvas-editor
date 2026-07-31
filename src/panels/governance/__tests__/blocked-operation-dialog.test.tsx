import { cleanup, render } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

/** Biome forbids an empty inline block; one named no-op keeps every call site clean. */
const noop = (): void => undefined;

import type { CanvasT } from "@/context/canvas-studio-context.js";
import { BlockedOperationDialog } from "../BlockedOperationDialog.js";

/**
 * T-040 — the dialog explains a block. What it must NOT do is leak how the
 * host's governance is configured.
 */

// The preset sets `globals: false`, so RTL's auto-cleanup is off and a second
// render would find the first one's DOM.
afterEach(cleanup);

const t: CanvasT = (_key, fallback) => fallback ?? "";

describe("BlockedOperationDialog", () => {
	it("renders the copy for the stable code and exposes the code as data", () => {
		const view = render(
			<BlockedOperationDialog
				code="structure-locked"
				onClose={noop}
				t={t}
			/>,
		);
		const dialog = view.getByTestId("blocked-operation-dialog");
		expect(dialog.getAttribute("data-policy-code")).toBe("structure-locked");
		expect(view.getByTestId("blocked-operation-reason").textContent).toBe(
			"This component's structure is locked.",
		);
	});

	it("NEVER renders the decision's log-only detail", () => {
		// The dialog's whole input is a code, so a hostile `detail` has no path to
		// the DOM by construction. This asserts that construction, because the
		// tempting "just show error.message" fix would reintroduce it.
		const view = render(
			<BlockedOperationDialog
				code="property-not-editable"
				onClose={noop}
				t={t}
			/>,
		);
		const text = view.getByTestId("blocked-operation-dialog").textContent ?? "";
		expect(text).not.toContain("acme-internal-library");
		expect(text).not.toContain("@");
		expect(text).not.toContain("http");
	});

	it("uses a localized string, not the raw code, as the visible copy", () => {
		const view = render(
			<BlockedOperationDialog code="detach-denied" onClose={noop} t={t} />,
		);
		expect(view.getByTestId("blocked-operation-reason").textContent).not.toBe(
			"detach-denied",
		);
	});

	it("moves focus to dismiss, NOT to the deep link (A11Y)", async () => {
		// The case `initialFocus` exists for. Without it the popup focuses the
		// first tabbable child, which once a host wires a deep link is "Learn
		// more" — the one action that navigates away from the editor. Focus is
		// applied after mount, hence the wait.
		const view = render(
			<BlockedOperationDialog
				code="flatten-denied"
				onDeepLink={noop}
				onClose={noop}
				t={t}
			/>,
		);
		const dismiss = view.getByTestId("blocked-operation-dismiss");
		await vi.waitFor(() => {
			expect(document.activeElement).toBe(dismiss);
		});
		expect(document.activeElement).not.toBe(
			view.getByTestId("blocked-operation-learn-more"),
		);
	});

	it("offers no deep link unless the host wired one", () => {
		const view = render(
			<BlockedOperationDialog
				code="token-not-allowed"
				onClose={noop}
				t={t}
			/>,
		);
		expect(view.queryByTestId("blocked-operation-learn-more")).toBeNull();
	});

	it("hands the host the STABLE code, never the copy", () => {
		const onDeepLink = vi.fn();
		const view = render(
			<BlockedOperationDialog
				code="variant-change-denied"
				onDeepLink={onDeepLink}
				onClose={noop}
				t={t}
			/>,
		);
		view.getByTestId("blocked-operation-learn-more").click();
		expect(onDeepLink).toHaveBeenCalledWith("variant-change-denied");
	});

	it("dismisses", () => {
		const onClose = vi.fn();
		const view = render(
			<BlockedOperationDialog
				code="capability-denied"
				onClose={onClose}
				t={t}
			/>,
		);
		view.getByTestId("blocked-operation-dismiss").click();
		expect(onClose).toHaveBeenCalled();
	});
});
