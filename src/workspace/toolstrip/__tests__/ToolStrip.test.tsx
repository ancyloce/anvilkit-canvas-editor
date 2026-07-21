import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import { defaultToolRegistry } from "@/tools/tool-registry.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import { ToolStrip, type ToolStripProps } from "../ToolStrip.js";

afterEach(cleanup);

function setup() {
	const h = makeHarness();
	render(
		<CanvasStudioContext.Provider value={h.studioCtx}>
			<ToolStrip />
		</CanvasStudioContext.Provider>,
	);
	return h;
}

describe("ToolStrip (B-06, FR-010/011)", () => {
	it("renders a button per registry tool with shortcut tooltips", () => {
		setup();
		const ids = [
			"select",
			"hand",
			"frame",
			"rect",
			"ellipse",
			"line",
			"path",
			"text",
			"image",
		];
		for (const id of ids) {
			expect(screen.getByTestId(`tool-strip-${id}`)).toBeTruthy();
		}
		const rect = screen.getByTestId("tool-strip-rect");
		expect(rect.getAttribute("title")).toContain("R");
		expect(rect.getAttribute("aria-keyshortcuts")).toBe("R");
	});

	it("clicking a tool activates it and reflects the active state", () => {
		const h = setup();
		fireEvent.click(screen.getByTestId("tool-strip-rect"));
		expect(h.studioCtx.toolStore.getState().activeTool).toBe("rect");
		expect(
			screen.getByTestId("tool-strip-rect").getAttribute("aria-pressed"),
		).toBe("true");
		expect(
			screen.getByTestId("tool-strip-select").getAttribute("aria-pressed"),
		).toBe("false");
	});
});

describe("ToolStrip disabled/loading states (FR-011)", () => {
	it("the image tool is enabled by default (lightweight test contexts)", () => {
		setup();
		expect(
			(screen.getByTestId("tool-strip-image") as HTMLButtonElement).disabled,
		).toBe(false);
	});

	it("disables the image tool when hasImagePicker is explicitly false", () => {
		const h = makeHarness();
		h.studioCtx.hasImagePicker = false;
		render(
			<CanvasStudioContext.Provider value={h.studioCtx}>
				<ToolStrip />
			</CanvasStudioContext.Provider>,
		);
		const button = screen.getByTestId("tool-strip-image") as HTMLButtonElement;
		expect(button.disabled).toBe(true);
		fireEvent.click(button);
		expect(h.studioCtx.toolStore.getState().activeTool).not.toBe("image");
	});

	it("does not disable other tools when hasImagePicker is false", () => {
		const h = makeHarness();
		h.studioCtx.hasImagePicker = false;
		render(
			<CanvasStudioContext.Provider value={h.studioCtx}>
				<ToolStrip />
			</CanvasStudioContext.Provider>,
		);
		expect(
			(screen.getByTestId("tool-strip-rect") as HTMLButtonElement).disabled,
		).toBe(false);
	});

	it("shows ai-image/ai-brush as loading while an AI job is pending", () => {
		const h = makeHarness();
		render(
			<CanvasStudioContext.Provider value={h.studioCtx}>
				<ToolStrip />
			</CanvasStudioContext.Provider>,
		);
		expect(
			screen.getByTestId("tool-strip-ai-image").getAttribute("data-loading"),
		).toBe("false");
		act(() => {
			h.studioCtx.aiJobStore
				.getState()
				.register("job-1", { nodeId: "n1", abort: () => undefined });
		});
		expect(
			screen.getByTestId("tool-strip-ai-image").getAttribute("data-loading"),
		).toBe("true");
		expect(
			screen.getByTestId("tool-strip-ai-brush").getAttribute("data-loading"),
		).toBe("true");
		// Unrelated tools never show as loading.
		expect(
			screen.getByTestId("tool-strip-rect").getAttribute("data-loading"),
		).toBe("false");
	});

	it("stops showing loading once the job completes", () => {
		const h = makeHarness();
		h.studioCtx.aiJobStore
			.getState()
			.register("job-1", { nodeId: "n1", abort: () => undefined });
		render(
			<CanvasStudioContext.Provider value={h.studioCtx}>
				<ToolStrip />
			</CanvasStudioContext.Provider>,
		);
		expect(
			screen.getByTestId("tool-strip-ai-image").getAttribute("data-loading"),
		).toBe("true");
		act(() => {
			h.studioCtx.aiJobStore.getState().complete("job-1");
		});
		expect(
			screen.getByTestId("tool-strip-ai-image").getAttribute("data-loading"),
		).toBe("false");
	});
});

describe("ToolStrip extensibility (FR-010)", () => {
	function extensionRegistry() {
		return {
			...defaultToolRegistry,
			"my-ext-tool": {
				id: "my-ext-tool",
				cursor: "crosshair",
				label: "My extension tool",
			},
		};
	}

	function setupWithExtension(props?: ToolStripProps) {
		const h = makeHarness();
		h.studioCtx.toolRegistry = extensionRegistry();
		render(
			<CanvasStudioContext.Provider value={h.studioCtx}>
				<ToolStrip {...props} />
			</CanvasStudioContext.Provider>,
		);
		const user = userEvent.setup({ pointerEventsCheck: 0 });
		return { h, user };
	}

	it("hides the More-tools overflow when no extension tools exist", () => {
		setup();
		expect(screen.queryByTestId("tool-strip-more")).toBeNull();
	});

	it("an extension tool appears in the More-tools overflow and activates on click", async () => {
		const { h, user } = setupWithExtension();
		expect(screen.queryByTestId("tool-strip-my-ext-tool")).toBeNull();
		await user.click(screen.getByTestId("tool-strip-more"));
		const item = await screen.findByTestId("tool-strip-more-my-ext-tool");
		expect(item.textContent).toContain("My extension tool");
		fireEvent.click(item);
		expect(h.studioCtx.toolStore.getState().activeTool).toBe("my-ext-tool");
	});

	it("overflow trigger reflects an active extension tool and is keyboard reachable", async () => {
		const { h, user } = setupWithExtension();
		act(() => {
			h.studioCtx.toolStore.getState().setActiveTool("my-ext-tool");
		});
		const trigger = screen.getByTestId("tool-strip-more");
		expect(trigger.getAttribute("data-active")).toBe("true");
		// Keyboard activation: the trigger is a focusable element that opens on
		// Enter (Base UI menu semantics).
		trigger.focus();
		await user.keyboard("{Enter}");
		expect(
			await screen.findByTestId("tool-strip-more-my-ext-tool"),
		).toBeTruthy();
	});

	it("items filters and reorders the rail; a promoted extension tool leaves the overflow", () => {
		setupWithExtension({ items: ["my-ext-tool", "select"] });
		const strip = screen.getByTestId("tool-strip");
		const railIds = Array.from(
			strip.querySelectorAll("[data-testid^='tool-strip-']"),
		)
			.map((el) => el.getAttribute("data-testid"))
			.filter((id) => id !== "tool-strip-more");
		expect(railIds).toEqual(["tool-strip-my-ext-tool", "tool-strip-select"]);
		// The promoted tool was the only extension tool → no overflow left.
		expect(screen.queryByTestId("tool-strip-more")).toBeNull();
	});

	it("renderer replaces the default strip entirely", () => {
		setupWithExtension({
			renderer: ({ descriptors, activeToolId }) => (
				<div data-testid="my-custom-strip">
					{descriptors.length}:{activeToolId}
				</div>
			),
		});
		expect(screen.queryByTestId("tool-strip")).toBeNull();
		const custom = screen.getByTestId("my-custom-strip");
		// Built-ins + the extension tool flow into the custom renderer.
		expect(custom.textContent).toContain("select");
	});
});
