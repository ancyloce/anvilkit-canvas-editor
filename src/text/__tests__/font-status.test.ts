import { afterEach, describe, expect, it, vi } from "vitest";
import {
	observeFontFamily,
	resetFontStatusesForTests,
} from "../font-status.js";

afterEach(() => {
	resetFontStatusesForTests();
	vi.unstubAllGlobals();
});

describe("observeFontFamily (FR-083 font loading states)", () => {
	it("treats generic families as loaded without observing", () => {
		expect(observeFontFamily("sans-serif")).toBe("loaded");
		expect(observeFontFamily(undefined)).toBe("loaded");
	});

	it("reports fallback (never crashes) when the Font Loading API is absent", () => {
		// jsdom has no document.fonts.load — the hard no-crash requirement.
		expect(observeFontFamily("Some Custom Font")).toBe("fallback");
	});

	it("reports loaded when the family is already available", () => {
		vi.stubGlobal("document", {
			fonts: {
				check: () => true,
				load: () => Promise.resolve([{}]),
			},
		});
		expect(observeFontFamily("Inter")).toBe("loaded");
	});

	it("reports loading while a real font resolves, then settles to loaded", async () => {
		let resolveLoad: (faces: unknown[]) => void = () => undefined;
		vi.stubGlobal("document", {
			fonts: {
				check: () => false,
				load: () =>
					new Promise((resolve) => {
						resolveLoad = resolve as (faces: unknown[]) => void;
					}),
			},
		});
		expect(observeFontFamily("Pending Font")).toBe("loading");
		resolveLoad([{}]);
		await Promise.resolve();
		await Promise.resolve();
		expect(observeFontFamily("Pending Font")).toBe("loaded");
	});

	it("reports error when the load rejects", async () => {
		vi.stubGlobal("document", {
			fonts: {
				check: () => false,
				load: () => Promise.reject(new Error("network")),
			},
		});
		expect(observeFontFamily("Broken Font")).toBe("loading");
		await Promise.resolve();
		await Promise.resolve();
		expect(observeFontFamily("Broken Font")).toBe("error");
	});
});
