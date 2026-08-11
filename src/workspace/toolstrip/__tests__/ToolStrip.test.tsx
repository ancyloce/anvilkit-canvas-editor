import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { TOOL_RAIL_ITEMS } from "@/chrome/icons.js";
import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import type { BuiltinToolId } from "@/stores/tool-store.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import { defaultToolRegistry } from "@/tools/tool-registry.js";
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

/**
 * cp3-009 — the rail is now the ONLY surface for the built-in drawing tools.
 *
 * The Elements panel's flat tool grid is gone, so "reachable" is no longer a
 * property two surfaces share: if a built-in id is missing from the rail it is
 * unreachable by pointer anywhere in the product. These tests are the
 * package-local half of that guarantee (the E2E half is
 * `apps/studio/e2e/canvas/grid-toolstrip-upload.spec.ts`'s "every built-in tool
 * activates from the rail").
 */
describe("ToolStrip built-in coverage (cp3-009)", () => {
	/**
	 * Every {@link BuiltinToolId}, written out rather than derived from
	 * `TOOL_RAIL_ITEMS` — deriving the expectation from the same constant the
	 * implementation reads would assert nothing. The `satisfies` clause plus the
	 * exhaustiveness alias below make a 15th built-in a TYPE error here, so a
	 * new tool cannot be added to the union and silently skip the rail.
	 */
	const ALL_BUILTIN_TOOL_IDS = [
		"select",
		"text",
		"rich-text",
		"frame",
		"rect",
		"ellipse",
		"polygon",
		"star",
		"line",
		"path",
		"image",
		"hand",
		"ai-image",
		"ai-brush",
	] as const satisfies readonly BuiltinToolId[];

	/** Compile-time: no `BuiltinToolId` is missing from the list above. */
	type _EveryBuiltinListed =
		Exclude<
			BuiltinToolId & string,
			(typeof ALL_BUILTIN_TOOL_IDS)[number]
		> extends never
			? true
			: ["missing built-in tool id in ALL_BUILTIN_TOOL_IDS"];

	it("renders a rail button for every built-in tool id", () => {
		setup();
		for (const id of ALL_BUILTIN_TOOL_IDS) {
			expect(screen.getByTestId(`tool-strip-${id}`)).toBeTruthy();
		}
		// …and exactly those: the rail is the built-ins, no more, no fewer.
		const railIds = Array.from(
			screen
				.getByTestId("tool-strip")
				.querySelectorAll("[data-testid^='tool-strip-']"),
		).map((el) => el.getAttribute("data-testid"));
		expect(railIds).toEqual(
			ALL_BUILTIN_TOOL_IDS.map((id) => `tool-strip-${id}`),
		);
	});

	it("rail order is TOOL_RAIL_ITEMS order", () => {
		expect(TOOL_RAIL_ITEMS.map((item) => item.id)).toEqual([
			...ALL_BUILTIN_TOOL_IDS,
		]);
	});

	it("every built-in activates on click", () => {
		const h = setup();
		for (const id of ALL_BUILTIN_TOOL_IDS) {
			fireEvent.click(screen.getByTestId(`tool-strip-${id}`));
			expect(h.studioCtx.toolStore.getState().activeTool).toBe(id);
			expect(
				screen.getByTestId(`tool-strip-${id}`).getAttribute("data-active"),
			).toBe("true");
		}
	});
});

describe("ToolStrip disabled/loading states (FR-011)", () => {
	it("the image tool is enabled by default (lightweight test contexts)", () => {
		setup();
		expect(
			(screen.getByTestId("tool-strip-image") as HTMLButtonElement).disabled,
		).toBe(false);
	});

	/**
	 * cp1-004 relaxed this gate and cp3-009 inherits the relaxed behaviour:
	 * `hasImagePicker = Boolean(effectiveAssetPicker) || Boolean(onPickAsset)`
	 * (`CanvasStudio.tsx`), and `effectiveAssetPicker` falls back to the
	 * zero-config local picker. So a bare `<CanvasStudio>` reports `true` and the
	 * Image tool is NOT hidden — only `disableLocalAssetFallback` with no host
	 * adapter still produces `false`. The three states are pinned here so the
	 * "image is gated" deliverable is checked against what the code does now.
	 */
	it("the image tool is enabled when hasImagePicker is explicitly true", () => {
		const h = makeHarness();
		h.studioCtx.hasImagePicker = true;
		render(
			<CanvasStudioContext.Provider value={h.studioCtx}>
				<ToolStrip />
			</CanvasStudioContext.Provider>,
		);
		const button = screen.getByTestId("tool-strip-image") as HTMLButtonElement;
		expect(button.disabled).toBe(false);
		fireEvent.click(button);
		expect(h.studioCtx.toolStore.getState().activeTool).toBe("image");
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

	/**
	 * The AI tools are built-ins, so they are rail entries with no provider
	 * gate of their own today — exactly as the deleted Elements-panel grid
	 * rendered them. `cp5-*` may add a provider gate later; until then "gating
	 * still honoured" means "unchanged", and this pins the unchanged state so
	 * an accidental hide is a failing test rather than a silent capability loss.
	 */
	it("keeps ai-image/ai-brush visible and activatable with no AI provider wired", () => {
		const h = setup();
		for (const id of ["ai-image", "ai-brush"] as const) {
			const button = screen.getByTestId(
				`tool-strip-${id}`,
			) as HTMLButtonElement;
			expect(button.disabled).toBe(false);
			fireEvent.click(button);
			expect(h.studioCtx.toolStore.getState().activeTool).toBe(id);
		}
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

	/**
	 * cp3-009 / ADR 0008 decision 4 condition 2: the overflow is now the ONLY
	 * default surface for an extension tool, so its gating has to work there —
	 * the deleted Elements-panel grid never honoured `disabled` at all.
	 */
	it("honours an extension tool's disabled probe in the overflow", async () => {
		const h = makeHarness();
		h.studioCtx.toolRegistry = {
			...defaultToolRegistry,
			"my-off-tool": {
				id: "my-off-tool",
				cursor: "crosshair",
				label: "Disabled extension tool",
				disabled: () => true,
			},
		};
		render(
			<CanvasStudioContext.Provider value={h.studioCtx}>
				<ToolStrip />
			</CanvasStudioContext.Provider>,
		);
		const user = userEvent.setup({ pointerEventsCheck: 0 });
		await user.click(screen.getByTestId("tool-strip-more"));
		const item = await screen.findByTestId("tool-strip-more-my-off-tool");
		expect(item.getAttribute("data-disabled")).toBe("");
		fireEvent.click(item);
		expect(h.studioCtx.toolStore.getState().activeTool).not.toBe("my-off-tool");
	});

	it("an enabled extension tool activates from the overflow", async () => {
		const { h, user } = setupWithExtension();
		await user.click(screen.getByTestId("tool-strip-more"));
		const item = await screen.findByTestId("tool-strip-more-my-ext-tool");
		expect(item.getAttribute("data-disabled")).toBeNull();
		fireEvent.click(item);
		expect(h.studioCtx.toolStore.getState().activeTool).toBe("my-ext-tool");
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
