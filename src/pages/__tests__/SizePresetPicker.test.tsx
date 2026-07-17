import { CANVAS_SIZE_PRESETS } from "@anvilkit/canvas-core";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SizePresetPicker } from "../SizePresetPicker.js";

afterEach(cleanup);

describe("SizePresetPicker", () => {
	it("lists every preset in CANVAS_SIZE_PRESETS", () => {
		const { getByTestId } = render(<SizePresetPicker />);
		for (const preset of CANVAS_SIZE_PRESETS) {
			expect(getByTestId(`size-preset-${preset.id}`)).toBeInTheDocument();
		}
	});

	it("shows each preset's label and dimensions", () => {
		const { getByTestId } = render(<SizePresetPicker />);
		const igPost = getByTestId("size-preset-instagram-post");
		expect(igPost.textContent).toContain("Instagram Post");
		expect(igPost.textContent).toContain("1080×1080");
	});

	it("calls onSelect with the chosen preset and does nothing else", () => {
		const onSelect = vi.fn();
		const { getByTestId } = render(<SizePresetPicker onSelect={onSelect} />);
		fireEvent.click(getByTestId("size-preset-youtube-thumbnail"));
		expect(onSelect).toHaveBeenCalledTimes(1);
		expect(onSelect).toHaveBeenCalledWith(
			expect.objectContaining({ id: "youtube-thumbnail" }),
		);
	});

	it("does not throw when onSelect is omitted", () => {
		const { getByTestId } = render(<SizePresetPicker />);
		expect(() =>
			fireEvent.click(getByTestId("size-preset-facebook-post")),
		).not.toThrow();
	});
});
