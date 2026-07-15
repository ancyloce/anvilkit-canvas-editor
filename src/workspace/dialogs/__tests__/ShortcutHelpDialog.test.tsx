import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ShortcutHelpDialog from "../ShortcutHelpDialog.js";

afterEach(cleanup);

describe("ShortcutHelpDialog (B-18, FR-042 / AC-004)", () => {
	it("lists registry bindings grouped by category with generated key labels", () => {
		render(<ShortcutHelpDialog onClose={() => undefined} />);
		expect(screen.getByTestId("shortcut-help-dialog")).toBeTruthy();
		// Category headings from the built-in buckets.
		expect(screen.getByText("Editing")).toBeTruthy();
		expect(screen.getByText("Tools")).toBeTruthy();
		// A known binding renders its label and a PLATFORM-GENERATED key label
		// (jsdom reports a non-mac platform → Ctrl+Z, never hand-written text).
		const undoRow = screen.getByTestId("shortcut-help-row-undo");
		expect(undoRow.textContent).toContain("Undo");
		expect(undoRow.textContent).toContain("Ctrl+Z");
	});

	it("search filters rows and shows the empty state", () => {
		render(<ShortcutHelpDialog onClose={() => undefined} />);
		const search = screen.getByTestId("shortcut-help-search");
		fireEvent.change(search, { target: { value: "undo" } });
		expect(screen.getByTestId("shortcut-help-row-undo")).toBeTruthy();
		expect(screen.queryByTestId("shortcut-help-row-copy")).toBeNull();
		fireEvent.change(search, { target: { value: "zzz-no-match" } });
		expect(screen.getByTestId("shortcut-help-empty")).toBeTruthy();
	});

	it("includes host-provided bindings registered through the options", () => {
		render(
			<ShortcutHelpDialog
				options={{
					extraBindings: [
						{
							id: "host-action",
							combos: [{ key: "k", ctrlOrMeta: true }],
							labelKey: "canvas.shortcut.hostAction",
							label: "Host action",
							category: "host",
							run: () => undefined,
						},
					],
				}}
				onClose={() => undefined}
			/>,
		);
		const row = screen.getByTestId("shortcut-help-row-host-action");
		expect(row.textContent).toContain("Host action");
		expect(row.textContent).toContain("Ctrl+K");
		// Custom categories append after the built-ins.
		expect(screen.getByText("host")).toBeTruthy();
	});

	it("closes via the close button", () => {
		const onClose = vi.fn();
		render(<ShortcutHelpDialog onClose={onClose} />);
		fireEvent.click(screen.getByTestId("shortcut-help-close"));
		expect(onClose).toHaveBeenCalledTimes(1);
	});
});
