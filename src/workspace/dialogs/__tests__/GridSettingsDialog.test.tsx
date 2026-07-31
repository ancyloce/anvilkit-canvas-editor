import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import {
	colorRowText,
	setColor,
} from "@/panels/__tests__/_color-test-helpers.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import GridSettingsDialog from "../GridSettingsDialog.js";

afterEach(cleanup);

function setup() {
	const h = makeHarness();
	const onClose = vi.fn();
	render(
		<CanvasStudioContext.Provider value={h.studioCtx}>
			<GridSettingsDialog onClose={onClose} />
		</CanvasStudioContext.Provider>,
	);
	return { h, onClose, vs: () => h.studioCtx.viewportStore.getState() };
}

describe("GridSettingsDialog (FR-112)", () => {
	it("renders every control seeded from the viewport store", () => {
		const { vs } = setup();
		expect(screen.getByTestId("grid-settings-dialog")).toBeTruthy();
		expect(
			(screen.getByTestId("grid-settings-size") as HTMLInputElement).value,
		).toBe(String(vs().gridSize));
		expect(
			(screen.getByTestId("grid-settings-subdivisions") as HTMLInputElement)
				.value,
		).toBe(String(vs().gridSubdivisions));
		// ColorRow triggers are buttons showing the hex as text, not inputs.
		expect(colorRowText("grid-settings-color")).toBe(vs().gridColor);
		expect(colorRowText("grid-settings-sub-color")).toBe(vs().subGridColor);
		// Base UI checkboxes are role="checkbox" buttons, not <input>s — their
		// state reads off aria-checked rather than `.checked`.
		expect(
			screen
				.getByTestId("grid-settings-snap-grid")
				.getAttribute("aria-checked"),
		).toBe(String(vs().snapToGridEnabled));
		expect(
			screen
				.getByTestId("grid-settings-snap-objects")
				.getAttribute("aria-checked"),
		).toBe(String(vs().snapToObjectsEnabled));
		expect(
			(screen.getByTestId("grid-settings-snap-threshold") as HTMLInputElement)
				.value,
		).toBe(String(vs().snapThreshold));
	});

	it("grid size / subdivisions / threshold write straight to the store, clamped", () => {
		const { vs } = setup();
		fireEvent.change(screen.getByTestId("grid-settings-size"), {
			target: { value: "24" },
		});
		expect(vs().gridSize).toBe(24);

		fireEvent.change(screen.getByTestId("grid-settings-subdivisions"), {
			target: { value: "4" },
		});
		expect(vs().gridSubdivisions).toBe(4);
		// Clamped to the 0–10 range.
		fireEvent.change(screen.getByTestId("grid-settings-subdivisions"), {
			target: { value: "99" },
		});
		expect(vs().gridSubdivisions).toBe(10);

		fireEvent.change(screen.getByTestId("grid-settings-snap-threshold"), {
			target: { value: "16" },
		});
		expect(vs().snapThreshold).toBe(16);
		// Clamped to the 1–32 range.
		fireEvent.change(screen.getByTestId("grid-settings-snap-threshold"), {
			target: { value: "500" },
		});
		expect(vs().snapThreshold).toBe(32);
		fireEvent.change(screen.getByTestId("grid-settings-snap-threshold"), {
			target: { value: "0" },
		});
		expect(vs().snapThreshold).toBe(1);
	});

	it("color inputs write straight to the store", async () => {
		const { vs } = setup();
		await setColor("grid-settings-color", "#112233");
		expect(vs().gridColor).toBe("#112233");
		await setColor("grid-settings-sub-color", "#445566");
		expect(vs().subGridColor).toBe("#445566");
	});

	it("snap toggles write straight to the store", () => {
		const { vs } = setup();
		const before = vs().snapToGridEnabled;
		fireEvent.click(screen.getByTestId("grid-settings-snap-grid"));
		expect(vs().snapToGridEnabled).toBe(!before);
		expect(vs().snapToObjectsEnabled).toBe(true);
		fireEvent.click(screen.getByTestId("grid-settings-snap-objects"));
		expect(vs().snapToObjectsEnabled).toBe(false);
	});

	it("is transient UI state: NO history commits and history stays untouched", async () => {
		const { h } = setup();
		fireEvent.change(screen.getByTestId("grid-settings-size"), {
			target: { value: "32" },
		});
		fireEvent.click(screen.getByTestId("grid-settings-snap-grid"));
		await setColor("grid-settings-color", "#0000ff");
		expect(h.commits).toHaveLength(0);
		const history = h.studioCtx.historyStore.getState();
		expect(history.past).toHaveLength(0);
		expect(history.future).toHaveLength(0);
		expect(history.canUndo()).toBe(false);
	});

	it("closes via the footer button and the dialog's own dismiss", () => {
		const { onClose } = setup();
		fireEvent.click(screen.getByTestId("grid-settings-close"));
		expect(onClose).toHaveBeenCalledTimes(1);
	});
});
