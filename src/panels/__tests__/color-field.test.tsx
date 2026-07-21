import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ColorField, hexColorChannels, normalizeHexColor } from "../fields.js";

/**
 * FR-074 color entry: explicit editable hex input, RGB channel inputs, alpha
 * suffix preservation, and the optional eyedropper adapter with feature
 * detection + graceful fallback.
 */

afterEach(cleanup);

describe("normalizeHexColor (FR-074)", () => {
	it("normalizes 3/6/8-digit forms with or without '#'", () => {
		expect(normalizeHexColor("f00")).toBe("#ff0000");
		expect(normalizeHexColor("#F00")).toBe("#ff0000");
		expect(normalizeHexColor("11AA33")).toBe("#11aa33");
		expect(normalizeHexColor("#11aa33cc")).toBe("#11aa33cc");
		expect(normalizeHexColor("  #ff0000  ")).toBe("#ff0000");
	});

	it("rejects malformed input", () => {
		expect(normalizeHexColor("red")).toBeNull();
		expect(normalizeHexColor("#ff00")).toBeNull();
		expect(normalizeHexColor("")).toBeNull();
	});
});

describe("hexColorChannels", () => {
	it("splits channels and preserves the alpha suffix", () => {
		expect(hexColorChannels("#11aa33")).toEqual({
			r: 0x11,
			g: 0xaa,
			b: 0x33,
			alphaSuffix: "",
		});
		expect(hexColorChannels("#11aa33cc")?.alphaSuffix).toBe("cc");
		expect(hexColorChannels("red")).toBeNull();
	});
});

describe("ColorField (FR-074)", () => {
	it("commits a normalized hex from the text input on blur", () => {
		const onCommit = vi.fn();
		const { getByTestId } = render(
			<ColorField
				label="Fill"
				value="#111111"
				dataTestId="cf"
				onCommit={onCommit}
			/>,
		);
		const hex = getByTestId("cf-hex") as HTMLInputElement;
		fireEvent.focus(hex);
		fireEvent.change(hex, { target: { value: "ff0000" } });
		fireEvent.blur(hex);
		expect(onCommit).toHaveBeenCalledWith("#ff0000");
	});

	it("reverts invalid hex on blur without committing", () => {
		const onCommit = vi.fn();
		const { getByTestId } = render(
			<ColorField
				label="Fill"
				value="#111111"
				dataTestId="cf"
				onCommit={onCommit}
			/>,
		);
		const hex = getByTestId("cf-hex") as HTMLInputElement;
		fireEvent.focus(hex);
		fireEvent.change(hex, { target: { value: "not-a-color" } });
		fireEvent.blur(hex);
		expect(onCommit).not.toHaveBeenCalled();
		expect(hex.value).toBe("#111111");
	});

	it("Escape restores the pre-edit hex without committing", () => {
		const onCommit = vi.fn();
		const { getByTestId } = render(
			<ColorField
				label="Fill"
				value="#111111"
				dataTestId="cf"
				onCommit={onCommit}
			/>,
		);
		const hex = getByTestId("cf-hex") as HTMLInputElement;
		fireEvent.focus(hex);
		fireEvent.change(hex, { target: { value: "ff0000" } });
		fireEvent.keyDown(hex, { key: "Escape" });
		expect(hex.value).toBe("#111111");
		expect(onCommit).not.toHaveBeenCalled();
	});

	it("renders RGB inputs for hex values and commits a channel edit", () => {
		const onCommit = vi.fn();
		const { getByTestId } = render(
			<ColorField
				label="Fill"
				value="#11aa33"
				dataTestId="cf"
				onCommit={onCommit}
			/>,
		);
		const r = getByTestId("cf-r") as HTMLInputElement;
		expect(r.value).toBe(String(0x11));
		fireEvent.focus(r);
		fireEvent.change(r, { target: { value: "255" } });
		fireEvent.blur(r);
		expect(onCommit).toHaveBeenCalledWith("#ffaa33");
	});

	it("preserves an alpha suffix through an RGB channel edit", () => {
		const onCommit = vi.fn();
		const { getByTestId } = render(
			<ColorField
				label="Fill"
				value="#11aa33cc"
				dataTestId="cf"
				onCommit={onCommit}
			/>,
		);
		const b = getByTestId("cf-b") as HTMLInputElement;
		fireEvent.focus(b);
		fireEvent.change(b, { target: { value: "0" } });
		fireEvent.blur(b);
		expect(onCommit).toHaveBeenCalledWith("#11aa00cc");
	});

	it("hides RGB inputs for non-hex values and when rgb={false}", () => {
		const first = render(
			<ColorField
				label="Fill"
				value="brand.primary"
				dataTestId="cf"
				onCommit={vi.fn()}
			/>,
		);
		expect(first.queryByTestId("cf-r")).toBeNull();
		first.unmount();
		const second = render(
			<ColorField
				label="Fill"
				value="#11aa33"
				dataTestId="cf2"
				rgb={false}
				onCommit={vi.fn()}
			/>,
		);
		expect(second.queryByTestId("cf2-r")).toBeNull();
	});

	it("shows no eyedropper without an adapter or platform support", () => {
		const { queryByTestId } = render(
			<ColorField
				label="Fill"
				value="#111111"
				dataTestId="cf"
				onCommit={vi.fn()}
			/>,
		);
		expect(queryByTestId("cf-eyedropper")).toBeNull();
	});

	it("commits the color resolved by an injected eyedropper adapter", async () => {
		const onCommit = vi.fn();
		const { getByTestId } = render(
			<ColorField
				label="Fill"
				value="#111111"
				dataTestId="cf"
				onCommit={onCommit}
				eyeDropper={() => Promise.resolve("#ABCDEF")}
			/>,
		);
		fireEvent.click(getByTestId("cf-eyedropper"));
		await waitFor(() => expect(onCommit).toHaveBeenCalledWith("#abcdef"));
	});

	it("a cancelled eyedropper pick commits nothing", async () => {
		const onCommit = vi.fn();
		const { getByTestId } = render(
			<ColorField
				label="Fill"
				value="#111111"
				dataTestId="cf"
				onCommit={onCommit}
				eyeDropper={() => Promise.resolve(null)}
			/>,
		);
		fireEvent.click(getByTestId("cf-eyedropper"));
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(onCommit).not.toHaveBeenCalled();
	});
});
