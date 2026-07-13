import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CanvasT } from "../../context/canvas-studio-context.js";
import {
	TokenAwareColorField,
	TokenAwareFontField,
} from "../token-aware-fields.js";

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

	it("renders a plain literal TextField when the brand kit has no fonts", () => {
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
		expect(getByTestId("test-font")).toBeDefined();
		expect(queryByTestId("test-font-use-token")).toBeNull();
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
