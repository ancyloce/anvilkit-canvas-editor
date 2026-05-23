import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ToolRail } from "../ToolRail.js";
import {
	makeTestStudioContext,
	TestStudioProvider,
} from "./test-studio-context.js";

// RTL auto-cleanup is OFF in this preset — unmount between renders explicitly.
afterEach(cleanup);

describe("ToolRail", () => {
	it("renders a button per tool with the default testid scheme", () => {
		const ctx = makeTestStudioContext();
		const { container } = render(
			<TestStudioProvider value={ctx}>
				<ToolRail data-testid="tool-rail" />
			</TestStudioProvider>,
		);
		expect(container.querySelector("[data-testid='tool-rail']")).not.toBeNull();
		expect(
			container.querySelector("[data-testid='tool-rail-select']"),
		).not.toBeNull();
		expect(
			container.querySelector("[data-testid='tool-rail-hand']"),
		).not.toBeNull();
	});

	it("marks the active tool and switches tools on click", () => {
		const ctx = makeTestStudioContext();
		const { container } = render(
			<TestStudioProvider value={ctx}>
				<ToolRail />
			</TestStudioProvider>,
		);
		const select = container.querySelector(
			"[data-testid='tool-rail-select']",
		) as HTMLElement;
		const rect = container.querySelector(
			"[data-testid='tool-rail-rect']",
		) as HTMLElement;
		// Default tool is "select".
		expect(select.getAttribute("data-active")).toBe("true");
		expect(rect.getAttribute("data-active")).toBe("false");
		fireEvent.click(rect);
		expect(ctx.toolStore.getState().activeTool).toBe("rect");
		expect(rect.getAttribute("data-active")).toBe("true");
		expect(select.getAttribute("data-active")).toBe("false");
	});

	it("honors a custom tool subset and testid builder", () => {
		const ctx = makeTestStudioContext();
		const { container } = render(
			<TestStudioProvider value={ctx}>
				<ToolRail
					tools={[
						{ id: "select", label: "Select", icon: () => null },
						{ id: "hand", label: "Hand", icon: () => null },
					]}
					toolTestId={(id) => `host-tool-${id}`}
				/>
			</TestStudioProvider>,
		);
		expect(
			container.querySelector("[data-testid='host-tool-select']"),
		).not.toBeNull();
		expect(
			container.querySelector("[data-testid='host-tool-hand']"),
		).not.toBeNull();
		// Tools not in the subset are absent.
		expect(
			container.querySelector("[data-testid='host-tool-rect']"),
		).toBeNull();
	});
});
