import { createCanvasIR, createPage } from "@anvilkit/canvas-core";
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-konva", () => {
	const Group = ({ children }: { children?: ReactNode }) => children ?? null;
	const Leaf = () => null;
	return {
		Stage: ({ children }: { children?: ReactNode }) => (
			<div data-testid="stage">{children}</div>
		),
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

vi.mock("use-image", () => ({ default: () => [null, "loading"] }));

import { CanvasEditor } from "../CanvasEditor.js";

afterEach(cleanup);

function ir() {
	return createCanvasIR({
		title: "Demo",
		pages: [createPage({ id: "p1", name: "Page 1" })],
		now: () => "2026-01-01T00:00:00.000Z",
	});
}

describe("CanvasEditor shell", () => {
	it("renders the 4-column shell around the stage (not the legacy bare layout)", () => {
		const { container } = render(
			<CanvasEditor initialIR={ir()} initialActivePageId="p1" />,
		);
		expect(
			container.querySelector("[data-testid='canvas-editor-root']"),
		).not.toBeNull();
		// Chrome columns.
		expect(
			container.querySelector("[role='toolbar'][aria-label='Tools']"),
		).not.toBeNull();
		expect(
			container.querySelector("[data-testid='editor-context-panel']"),
		).not.toBeNull();
		expect(
			container.querySelector("[data-testid='editor-stage-bar']"),
		).not.toBeNull();
		expect(
			container.querySelector("[data-testid='property-inspector']"),
		).not.toBeNull();
		expect(
			container.querySelector("[data-testid='editor-zoom']"),
		).not.toBeNull();
		// The Konva stage is slotted into the centre column.
		expect(container.querySelector("[data-testid='stage']")).not.toBeNull();
		// Shell mode replaces the legacy bare layout.
		expect(
			container.querySelector("[data-testid='canvas-studio-root']"),
		).toBeNull();
	});

	it("forwards a custom tool testid scheme and renders host children", () => {
		const { container } = render(
			<CanvasEditor
				initialIR={ir()}
				initialActivePageId="p1"
				toolTestId={(id) => `host-tool-${id}`}
			>
				<div data-testid="host-extra">extra</div>
			</CanvasEditor>,
		);
		expect(
			container.querySelector("[data-testid='host-tool-select']"),
		).not.toBeNull();
		expect(
			container.querySelector("[data-testid='host-extra']"),
		).not.toBeNull();
	});
});
