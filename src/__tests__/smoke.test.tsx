import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-konva", () => {
	const Group = ({ children }: { children?: ReactNode }) => children ?? null;
	const Leaf = () => null;
	return {
		Stage: Group,
		Layer: Group,
		Text: Leaf,
	};
});

import { CanvasStudio } from "../index.js";

describe("canvas-editor smoke", () => {
	it("exposes CanvasStudio as a function component", () => {
		expect(typeof CanvasStudio).toBe("function");
		expect(CanvasStudio.name).toBe("CanvasStudio");
	});

	it("renders without throwing when react-konva is mocked", () => {
		expect(() => render(<CanvasStudio pageId="test" />)).not.toThrow();
	});
});
