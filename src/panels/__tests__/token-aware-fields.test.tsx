import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CanvasT } from "../../context/canvas-studio-context.js";
import { DEFAULT_FONT_CATALOG } from "../../text/default-font-catalog.js";
import { createFontCatalog } from "../../text/font-catalog.js";
import {
	TokenAwareColorField,
	TokenAwareFontField,
} from "../token-aware-fields.js";
import {
	fontGroupLabels,
	fontTriggerText,
	openFontPicker,
} from "./_font-picker-test-helpers.js";

afterEach(cleanup);

const t: CanvasT = (_key, fallback) => fallback ?? _key;

const COLORS = [
	{ id: "primary", name: "Primary", value: "#2563eb" },
	{ id: "accent", name: "Accent", value: "#f59e0b" },
];

describe("TokenAwareColorField", () => {
	it("renders a plain literal ColorField when the brand kit has no colors", () => {
		const onCommit = vi.fn();
		const { getByTestId, queryByTestId } = render(
			<TokenAwareColorField
				label="Fill"
				rawValue="#111111"
				resolvedValue="#111111"
				unresolved={false}
				colors={[]}
				dataTestId="test-fill"
				onCommit={onCommit}
				t={t}
			/>,
		);
		expect(getByTestId("test-fill")).toBeDefined();
		expect(queryByTestId("test-fill-use-token")).toBeNull();
	});

	it("shows a 'use brand color' action for a literal value when colors exist", () => {
		const onCommit = vi.fn();
		const { getByTestId } = render(
			<TokenAwareColorField
				label="Fill"
				rawValue="#111111"
				resolvedValue="#111111"
				unresolved={false}
				colors={COLORS}
				dataTestId="test-fill"
				onCommit={onCommit}
				t={t}
			/>,
		);
		fireEvent.click(getByTestId("test-fill-use-token"));
		expect(onCommit).toHaveBeenCalledWith({
			type: "brand-token",
			tokenType: "color",
			id: "primary",
		});
	});

	it("renders the token picker (not the literal input) for a token-backed value", () => {
		const onCommit = vi.fn();
		const { getByTestId, queryByTestId } = render(
			<TokenAwareColorField
				label="Fill"
				rawValue={{ type: "brand-token", tokenType: "color", id: "accent" }}
				resolvedValue="#f59e0b"
				unresolved={false}
				colors={COLORS}
				dataTestId="test-fill"
				onCommit={onCommit}
				t={t}
			/>,
		);
		expect(getByTestId("test-fill").textContent).toContain("Accent");
		expect(queryByTestId("prop-token-unresolved-badge")).toBeNull();
	});

	it("shows the unresolved badge for a dangling token", () => {
		const onCommit = vi.fn();
		const { getByTestId } = render(
			<TokenAwareColorField
				label="Fill"
				rawValue={{ type: "brand-token", tokenType: "color", id: "missing" }}
				resolvedValue={undefined}
				unresolved={true}
				colors={COLORS}
				dataTestId="test-fill"
				onCommit={onCommit}
				t={t}
			/>,
		);
		expect(getByTestId("prop-token-unresolved-badge")).toBeDefined();
	});

	it("detaches a token to its resolved literal value", () => {
		const onCommit = vi.fn();
		const { getByTestId } = render(
			<TokenAwareColorField
				label="Fill"
				rawValue={{ type: "brand-token", tokenType: "color", id: "accent" }}
				resolvedValue="#f59e0b"
				unresolved={false}
				colors={COLORS}
				dataTestId="test-fill"
				onCommit={onCommit}
				t={t}
			/>,
		);
		fireEvent.click(getByTestId("test-fill-detach"));
		expect(onCommit).toHaveBeenCalledWith("#f59e0b");
	});
});

describe("TokenAwareFontField", () => {
	const FONTS = ["Inter", "Poppins"];

	it("renders the catalog picker (not a text box) when the brand kit has no fonts", () => {
		const onCommit = vi.fn();
		const { getByTestId, queryByTestId } = render(
			<TokenAwareFontField
				label="Font"
				rawValue="Georgia"
				resolvedValue="Georgia"
				unresolved={false}
				fonts={[]}
				dataTestId="test-font"
				onCommit={onCommit}
				t={t}
			/>,
		);
		// `cp2-004`: same test id, different control — the picker's trigger is a
		// button, and the free-text `<input>` it replaced is gone.
		expect(getByTestId("test-font").tagName).toBe("BUTTON");
		expect(queryByTestId("test-font-use-token")).toBeNull();
		// The off-catalog value the document holds is still the displayed one.
		expect(DEFAULT_FONT_CATALOG.get("Georgia")).toBeUndefined();
		expect(fontTriggerText("test-font")).toBe("Georgia");
	});

	it("reads Mixed for a multi-selection whose families differ", () => {
		render(
			<TokenAwareFontField
				label="Font"
				rawValue="Georgia"
				resolvedValue="Georgia"
				unresolved={false}
				fonts={[]}
				dataTestId="test-font"
				mixed
				onCommit={vi.fn()}
				t={t}
			/>,
		);
		expect(fontTriggerText("test-font")).toBe("Mixed");
	});

	it("reads Mixed on the brand-token picker too", () => {
		render(
			<TokenAwareFontField
				label="Font"
				rawValue={{ type: "brand-token", tokenType: "font", id: "inter" }}
				resolvedValue="Inter"
				unresolved={false}
				fonts={FONTS}
				dataTestId="test-font"
				mixed
				onCommit={vi.fn()}
				t={t}
			/>,
		);
		expect(screen.getByTestId("test-font").textContent).toContain("Mixed");
		expect(screen.getByTestId("test-font").textContent).not.toContain("Inter");
	});

	it("takes an explicit catalog for a mount with no studio ancestor", async () => {
		render(
			<TokenAwareFontField
				label="Font"
				rawValue=""
				resolvedValue=""
				unresolved={false}
				fonts={[]}
				dataTestId="test-font"
				catalog={createFontCatalog(
					[
						{
							family: "Acme Host Sans",
							category: "sans",
							weights: [400],
							source: { kind: "files", files: [] },
							license: "LicenseRef-acme",
						},
					],
					{ origin: "host" },
				)}
				onCommit={vi.fn()}
				t={t}
			/>,
		);
		const popup = await openFontPicker("test-font");
		const options = Array.from(
			popup.querySelectorAll<HTMLElement>('[role="option"]'),
		).map((option) => option.textContent);
		// An OVERRIDE, not a merge: inside a `<CanvasStudio>` the field reads the
		// studio's already-resolved catalog (`cp2-007`), which is where the
		// default + host merge happens and happens once. Asserted end to end in
		// `inspector/__tests__/text-font-field.test.tsx`.
		expect(options).toEqual(["Acme Host Sans"]);
	});

	it("pins brand-kit families first, whether or not the catalog knows them", async () => {
		render(
			<TokenAwareFontField
				label="Font"
				rawValue="Georgia"
				resolvedValue="Georgia"
				unresolved={false}
				// "Lora" IS a default catalog family; "Acme Grotesk" is not — the two
				// halves of the brand tier (re-stamped record vs synthesised one).
				fonts={["Acme Grotesk", "Lora"]}
				dataTestId="test-font"
				onCommit={vi.fn()}
				t={t}
			/>,
		);
		const popup = await openFontPicker("test-font");
		expect(fontGroupLabels(popup)).toEqual(["Brand", "All fonts"]);
		const options = Array.from(
			popup.querySelectorAll<HTMLElement>('[role="option"]'),
		).map((option) => option.textContent);
		expect(options.slice(0, 2)).toEqual(["Acme Grotesk", "Lora"]);
		expect(options.filter((label) => label === "Lora")).toHaveLength(1);
	});

	it("passes recent families through to the picker (cp2-005 slot)", async () => {
		render(
			<TokenAwareFontField
				label="Font"
				rawValue="Georgia"
				resolvedValue="Georgia"
				unresolved={false}
				fonts={[]}
				dataTestId="test-font"
				recentFamilies={["Lora"]}
				onCommit={vi.fn()}
				t={t}
			/>,
		);
		const popup = await openFontPicker("test-font");
		expect(fontGroupLabels(popup)).toEqual(["Recent", "All fonts"]);
	});

	it("flags an unresolved token on the picker row", () => {
		const { container } = render(
			<TokenAwareFontField
				label="Font"
				rawValue={{ type: "brand-token", tokenType: "font", id: "gone" }}
				resolvedValue={undefined}
				unresolved={true}
				fonts={[]}
				dataTestId="test-font"
				onCommit={vi.fn()}
				t={t}
			/>,
		);
		expect(container.querySelector("label")?.title).toBe(
			"Unresolved brand token — showing fallback",
		);
	});

	it("renders the token picker for a token-backed font, keyed by slug", () => {
		const onCommit = vi.fn();
		const { getByTestId } = render(
			<TokenAwareFontField
				label="Font"
				rawValue={{ type: "brand-token", tokenType: "font", id: "inter" }}
				resolvedValue="Inter"
				unresolved={false}
				fonts={FONTS}
				dataTestId="test-font"
				onCommit={onCommit}
				t={t}
			/>,
		);
		expect(getByTestId("test-font").textContent).toContain("Inter");
	});

	it("uses the slug of the first font when attaching a token from a literal value", () => {
		const onCommit = vi.fn();
		const { getByTestId } = render(
			<TokenAwareFontField
				label="Font"
				rawValue="Georgia"
				resolvedValue="Georgia"
				unresolved={false}
				fonts={FONTS}
				dataTestId="test-font"
				onCommit={onCommit}
				t={t}
			/>,
		);
		fireEvent.click(getByTestId("test-font-use-token"));
		expect(onCommit).toHaveBeenCalledWith({
			type: "brand-token",
			tokenType: "font",
			id: "inter",
		});
	});
});
