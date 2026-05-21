import { createCanvasIR, createPage } from "@anvilkit/canvas-core";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-konva", () => {
	const Group = ({ children }: { children?: ReactNode }) => children ?? null;
	const Leaf = () => null;
	return {
		Stage: Group,
		Layer: Group,
		Group,
		Rect: Leaf,
		Ellipse: Leaf,
		Line: Leaf,
		Path: Leaf,
		Text: Leaf,
		Image: Leaf,
		Transformer: Leaf,
	};
});

vi.mock("use-image", () => ({
	default: () => [null, "loading"],
}));

import { CanvasStudio } from "../index.js";

describe("canvas-editor smoke", () => {
	it("exposes CanvasStudio as a function component", () => {
		expect(typeof CanvasStudio).toBe("function");
		expect(CanvasStudio.name).toBe("CanvasStudio");
	});

	it("renders without throwing for a minimal IR", () => {
		const ir = createCanvasIR({
			pages: [createPage({ id: "p1" })],
			now: () => "2026-01-01T00:00:00.000Z",
		});
		expect(() =>
			render(<CanvasStudio initialIR={ir} activePageId="p1" />),
		).not.toThrow();
	});

	it("renders the empty fallback for an unknown activePageId", () => {
		const ir = createCanvasIR({
			pages: [createPage({ id: "p1" })],
			now: () => "2026-01-01T00:00:00.000Z",
		});
		const { getByTestId } = render(
			<CanvasStudio initialIR={ir} activePageId="missing" />,
		);
		expect(getByTestId("canvas-empty")).toBeTruthy();
	});
});
