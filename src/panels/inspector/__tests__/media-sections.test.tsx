import {
	type CanvasFrameNode,
	type CanvasImageNode,
	type CanvasIR,
	createCanvasIR,
	createFrame,
	createGroup,
	createImage,
	createPage,
} from "@anvilkit/canvas-core";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	CanvasStudioContext,
	type CanvasStudioContextValue,
} from "@/context/canvas-studio-context.js";
import type { CommitPatchAll } from "@/panels/fields.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import { renderFrameFields, renderImageFields } from "../media-sections.js";

afterEach(cleanup);

/**
 * Same Base UI Select interaction gap `stroke-section.test.tsx` documents: a
 * plain click on an option never reaches the selection handler in jsdom —
 * it needs a real pointer down+up first.
 */
async function selectOption(
	triggerTestId: string,
	optionName: string,
): Promise<void> {
	fireEvent.click(screen.getByTestId(triggerTestId));
	const option = await screen.findByRole("option", { name: optionName });
	fireEvent.pointerDown(option, { pointerId: 1, button: 0 });
	fireEvent.pointerUp(option, { pointerId: 1, button: 0 });
	fireEvent.click(option);
}

function lastPatch(
	commitPatchAll: ReturnType<typeof vi.fn>,
): Record<string, unknown> {
	const calls = commitPatchAll.mock.calls as [
		unknown[],
		(n: unknown) => Record<string, unknown>,
	][];
	const build = calls[calls.length - 1]?.[1];
	if (!build) throw new Error("commitPatchAll was never called");
	return build(undefined);
}

function ImageHost({
	node,
	ctx,
	commitPatchAll,
}: {
	node: CanvasImageNode;
	ctx: CanvasStudioContextValue;
	commitPatchAll: CommitPatchAll;
}): React.JSX.Element {
	return (
		<>{renderImageFields([node], ctx, commitPatchAll, (_k, f) => f ?? "")}</>
	);
}

function FrameHost({
	frame,
	ctx,
	commitPatchAll,
}: {
	frame: CanvasFrameNode;
	ctx: CanvasStudioContextValue;
	commitPatchAll: CommitPatchAll;
}): React.JSX.Element {
	const brandKit = { colors: [], fonts: [] };
	// FillAndShadowFields (the frame's background section) reads brand kit via
	// useBrandKit() → React context, not the `ctx` prop — a real provider is
	// required, unlike ImageHost above which never renders that section.
	return (
		<CanvasStudioContext.Provider value={ctx}>
			{renderFrameFields(
				[frame],
				ctx,
				commitPatchAll,
				brandKit,
				(_k, f) => f ?? "",
			)}
		</CanvasStudioContext.Provider>
	);
}

describe("renderImageFields — fit mode (FR-094)", () => {
	it("selecting a fit mode commits fitMode via commitPatchAll", async () => {
		const h = makeHarness();
		const node = createImage({
			id: "img1",
			assetId: "a1",
			bounds: { width: 100, height: 100 },
		});
		const commitPatchAll = vi.fn();
		render(
			<ImageHost
				node={node}
				ctx={h.studioCtx}
				commitPatchAll={commitPatchAll}
			/>,
		);
		await selectOption("prop-fit-mode", "fit");
		await waitFor(() => expect(commitPatchAll).toHaveBeenCalledTimes(1));
		expect(lastPatch(commitPatchAll)).toEqual({ fitMode: "fit" });
	});

	it("selecting 'stretch' clears fitMode (the schema default) rather than storing it", async () => {
		const h = makeHarness();
		const node = {
			...createImage({
				id: "img1",
				assetId: "a1",
				bounds: { width: 100, height: 100 },
			}),
			fitMode: "fit" as const,
		};
		const commitPatchAll = vi.fn();
		render(
			<ImageHost
				node={node}
				ctx={h.studioCtx}
				commitPatchAll={commitPatchAll}
			/>,
		);
		await selectOption("prop-fit-mode", "stretch");
		await waitFor(() => expect(commitPatchAll).toHaveBeenCalledTimes(1));
		expect(lastPatch(commitPatchAll)).toEqual({ fitMode: undefined });
	});
});

describe("renderImageFields — replace and crop (FR-093/FR-094)", () => {
	it("Replace image invokes the host's picker (pickAndReplaceImage → ctx.pickAsset)", async () => {
		const h = makeHarness();
		const node = createImage({
			id: "img1",
			assetId: "asset-old",
			bounds: { width: 100, height: 100 },
		});
		render(
			<ImageHost node={node} ctx={h.studioCtx} commitPatchAll={vi.fn()} />,
		);
		fireEvent.click(screen.getByTestId("prop-image-replace"));
		await waitFor(() => expect(h.studioCtx.pickAsset).toHaveBeenCalledTimes(1));
	});

	it("Crop image opens the crop editor for this node", () => {
		const node = createImage({
			id: "img1",
			assetId: "a1",
			bounds: { width: 100, height: 100 },
		});
		const page = createPage({
			id: "p1",
			root: createGroup({ children: [node] }),
		});
		const ir: CanvasIR = createCanvasIR({ id: "ir-1", pages: [page] });
		const h = makeHarness({ ir });
		render(
			<ImageHost node={node} ctx={h.studioCtx} commitPatchAll={vi.fn()} />,
		);
		fireEvent.click(screen.getByTestId("prop-crop-begin"));
		expect(h.studioCtx.cropStore?.getState().cropNodeId).toBe("img1");
	});

	it("Clear crop is absent without a crop, appears with one, and clears it on click", () => {
		const h = makeHarness();
		const cropped = createImage({
			id: "img1",
			assetId: "a1",
			bounds: { width: 100, height: 100 },
			crop: { x: 0, y: 0, width: 50, height: 50 },
		});
		const commitPatchAll = vi.fn();
		render(
			<ImageHost
				node={cropped}
				ctx={h.studioCtx}
				commitPatchAll={commitPatchAll}
			/>,
		);
		fireEvent.click(screen.getByTestId("prop-crop-clear"));
		expect(commitPatchAll).toHaveBeenCalledTimes(1);
		expect(lastPatch(commitPatchAll)).toEqual({ crop: undefined });
	});

	it("Clear crop button is absent when the node has no crop", () => {
		const h = makeHarness();
		const node = createImage({
			id: "img1",
			assetId: "a1",
			bounds: { width: 100, height: 100 },
		});
		render(
			<ImageHost node={node} ctx={h.studioCtx} commitPatchAll={vi.fn()} />,
		);
		expect(screen.queryByTestId("prop-crop-clear")).toBeNull();
	});
});

describe("renderImageFields — adjustment presets (FR-100/101)", () => {
	it("selecting the 'mono' preset commits its normalized adjustment values", async () => {
		const h = makeHarness();
		const node = createImage({
			id: "img1",
			assetId: "a1",
			bounds: { width: 100, height: 100 },
		});
		const commitPatchAll = vi.fn();
		render(
			<ImageHost
				node={node}
				ctx={h.studioCtx}
				commitPatchAll={commitPatchAll}
			/>,
		);
		await selectOption("prop-adjust-preset", "mono");
		await waitFor(() => expect(commitPatchAll).toHaveBeenCalledTimes(1));
		expect(lastPatch(commitPatchAll)).toEqual({
			adjustments: { grayscale: 1 },
		});
	});
});

describe("renderFrameFields — image well (FR-093)", () => {
	it("toggling the well switch on adds a placeholder; off removes it", () => {
		const h = makeHarness();
		const frame = createFrame({ id: "f1", bounds: { width: 40, height: 40 } });
		const commitPatchAll = vi.fn();
		render(
			<FrameHost
				frame={frame}
				ctx={h.studioCtx}
				commitPatchAll={commitPatchAll}
			/>,
		);
		fireEvent.click(screen.getByTestId("prop-frame-well"));
		expect(commitPatchAll).toHaveBeenCalledTimes(1);
		expect(lastPatch(commitPatchAll)).toEqual({
			placeholder: { kind: "image" },
		});
	});

	it("Add image (empty well) invokes replaceFrameImage → ctx.pickAsset", async () => {
		const h = makeHarness();
		const well = createFrame({
			id: "f1",
			bounds: { width: 40, height: 40 },
			placeholder: { kind: "image" },
		});
		render(
			<FrameHost frame={well} ctx={h.studioCtx} commitPatchAll={vi.fn()} />,
		);
		expect(screen.getByTestId("prop-frame-replace").textContent).toContain(
			"Add image",
		);
		fireEvent.click(screen.getByTestId("prop-frame-replace"));
		await waitFor(() => expect(h.studioCtx.pickAsset).toHaveBeenCalledTimes(1));
	});

	it("a plain (non-well) frame shows neither the well button nor a replace button gated on fill", () => {
		const h = makeHarness();
		const frame = createFrame({ id: "f1", bounds: { width: 40, height: 40 } });
		render(
			<FrameHost frame={frame} ctx={h.studioCtx} commitPatchAll={vi.fn()} />,
		);
		expect(screen.queryByTestId("prop-frame-replace")).toBeNull();
	});
});
