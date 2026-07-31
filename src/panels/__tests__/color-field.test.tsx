import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import {
	cancelColor,
	openColor,
	pickColorWithEyedropper,
	setColor,
	setColorChannel,
} from "./_color-test-helpers.js";
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
	it("commits a normalized hex typed into the picker's hex field", async () => {
		const onCommit = vi.fn();
		render(
			<ColorField
				label="Fill"
				value="#111111"
				dataTestId="cf"
				onCommit={onCommit}
			/>,
		);
		await setColor("cf", "ff0000");
		expect(onCommit).toHaveBeenCalledWith("#ff0000");
	});

	it("reverts invalid hex without committing", async () => {
		const onCommit = vi.fn();
		render(
			<ColorField
				label="Fill"
				value="#111111"
				dataTestId="cf"
				onCommit={onCommit}
			/>,
		);
		await setColor("cf", "not-a-color");
		expect(onCommit).not.toHaveBeenCalled();
	});

	it("Escape dismisses without committing", async () => {
		const onCommit = vi.fn();
		render(
			<ColorField
				label="Fill"
				value="#111111"
				dataTestId="cf"
				onCommit={onCommit}
			/>,
		);
		await cancelColor("cf", "ff0000");
		expect(onCommit).not.toHaveBeenCalled();
	});

	it("renders RGB inputs for hex values and commits a channel edit", async () => {
		const onCommit = vi.fn();
		render(
			<ColorField
				label="Fill"
				value="#11aa33"
				dataTestId="cf"
				onCommit={onCommit}
			/>,
		);
		expect(((await openColor("cf")) as HTMLInputElement).value).toBe("#11aa33");
		await setColorChannel("cf", "r", 255);
		expect(onCommit).toHaveBeenCalledWith("#ffaa33");
	});

	it("preserves an alpha suffix through a picker edit", async () => {
		const onCommit = vi.fn();
		render(
			<ColorField
				label="Fill"
				value="#11aa33cc"
				dataTestId="cf"
				onCommit={onCommit}
			/>,
		);
		await setColor("cf", "#11aa00");
		expect(onCommit).toHaveBeenCalledWith("#11aa00cc");
	});

	it("hides RGB inputs for non-hex values and when rgb={false}", async () => {
		const first = render(
			<ColorField
				label="Fill"
				value="brand.primary"
				dataTestId="cf"
				onCommit={vi.fn()}
			/>,
		);
		fireEvent.click(first.getByTestId("cf"));
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
		await openColor("cf2");
		expect(second.queryByTestId("cf2-r")).toBeNull();
	});

	it("shows no eyedropper without an adapter or platform support", async () => {
		const { queryByTestId } = render(
			<ColorField
				label="Fill"
				value="#111111"
				dataTestId="cf"
				onCommit={vi.fn()}
			/>,
		);
		await openColor("cf");
		expect(queryByTestId("cf-eyedropper")).toBeNull();
	});

	it("commits the color resolved by an injected eyedropper adapter", async () => {
		const onCommit = vi.fn();
		render(
			<ColorField
				label="Fill"
				value="#111111"
				dataTestId="cf"
				onCommit={onCommit}
				eyeDropper={() => Promise.resolve("#ABCDEF")}
			/>,
		);
		await pickColorWithEyedropper("cf");
		await waitFor(() => expect(onCommit).toHaveBeenCalledWith("#abcdef"));
	});

	it("a cancelled eyedropper pick commits nothing", async () => {
		const onCommit = vi.fn();
		render(
			<ColorField
				label="Fill"
				value="#111111"
				dataTestId="cf"
				onCommit={onCommit}
				eyeDropper={() => Promise.resolve(null)}
			/>,
		);
		await pickColorWithEyedropper("cf");
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(onCommit).not.toHaveBeenCalled();
	});
});
