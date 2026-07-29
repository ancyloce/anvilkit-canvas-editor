import {
	type CanvasIR,
	createCanvasIR,
	createGroup,
	createPage,
	createRect,
} from "@anvilkit/canvas-core";
import { act, render } from "@testing-library/react";
import { type ReactNode, useEffect, useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Review 0022 P2-2/P2-4: AC-010 read-only must be VISIBLE, not only enforced.
 * A document declaring an unsupported capability shows the read-only status
 * strip (both render paths share the composition point), and the flag stays
 * excluded from the stable context half so `useCanvasStores()` consumers get
 * a compile error instead of a silently-undefined read.
 */

function makeMock(type: string) {
	return (props: Record<string, unknown>) => {
		const { children } = props as { children?: ReactNode };
		return <div data-testid={type.toLowerCase()}>{children}</div>;
	};
}

vi.mock("react-konva", () => {
	type StageProps = { children?: ReactNode; ref?: { current: object | null } };
	const Stage = (props: StageProps) => {
		if (props.ref && "current" in props.ref) {
			const container = document.createElement("div");
			props.ref.current = {
				destroy: vi.fn(),
				on: vi.fn(),
				off: vi.fn(),
				container: () => container,
				getPointerPosition: () => null,
			};
		}
		return <div data-testid="stage">{props.children}</div>;
	};
	return {
		Stage,
		Layer: makeMock("Layer"),
		Group: makeMock("Group"),
		Rect: makeMock("Rect"),
		Ellipse: makeMock("Ellipse"),
		Line: makeMock("Line"),
		Path: makeMock("Path"),
		Text: makeMock("Text"),
		Image: makeMock("Image"),
		Label: makeMock("Label"),
		Tag: makeMock("Tag"),
		Transformer: makeMock("Transformer"),
	};
});

vi.mock("use-image", () => ({
	default: () => [null, "loading"],
}));

vi.mock("../render/rasterize-page.js", () => ({
	rasterizePage: vi.fn(async ({ page }: { page: { id: string } }) => ({
		url: `data:thumb/${page.id}`,
		mimeType: "image/png",
	})),
}));

import { CanvasStudio, useCanvasStores, useCanvasStudio } from "../index.js";

function fixtureIR(requiredCapabilities?: readonly string[]): CanvasIR {
	const page = createPage({ id: "p1" });
	page.root = createGroup({
		id: "root",
		bounds: page.root.bounds,
		children: [
			createRect({
				id: "r1",
				transform: { x: 0 },
				bounds: { width: 10, height: 10 },
			}),
		],
	});
	const ir = createCanvasIR({
		id: "doc-1",
		pages: [page],
		now: () => "2026-05-20T00:00:00.000Z",
	});
	if (!requiredCapabilities) return ir;
	return {
		...ir,
		compatibility: {
			schemaVersion: "3",
			minReaderSchemaVersion: "3",
			requiredCapabilities,
		},
	} as CanvasIR;
}

/** P2-4: the stable half must not (appear to) carry the live flag. */
function StableProbe({ out }: { out: { stableFlag?: unknown } }): null {
	const stores = useCanvasStores();
	const done = useRef(false);
	useEffect(() => {
		if (done.current) return;
		done.current = true;
		// @ts-expect-error documentReadOnly is live per-commit state, excluded
		// from CanvasStudioStableValue (review 0022 P2-4) — read it via the
		// full useCanvasStudio() context instead.
		out.stableFlag = stores.documentReadOnly;
	}, [stores, out]);
	return null;
}

/**
 * P2-3: seeds an undo entry through the direct-store bypass the review
 * records (the guarded commit path can never build history on a read-only
 * document), then proves `ctx.undo()` is blocked by the guard rather than by
 * empty-history coincidence.
 */
function UndoGuardProbe({ out }: { out: { undoWasNoOp?: boolean } }): null {
	const ctx = useCanvasStudio();
	const done = useRef(false);
	useEffect(() => {
		if (done.current) return;
		done.current = true;
		const current = ctx.getIR();
		ctx.historyStore.getState().commit(current, {
			type: "node.move",
			nodeId: "r1",
			from: { x: 0, y: 0 },
			to: { x: 5, y: 0 },
		});
		out.undoWasNoOp = ctx.undo() === current;
	}, [ctx, out]);
	return null;
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("read-only affordance (review 0022 P2-2)", () => {
	it("shows the status strip for a document with an unsupported capability", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const { getByTestId, unmount } = render(
			<CanvasStudio
				initialIR={fixtureIR(["layout.auto.v1", "test.future.v9"])}
				initialActivePageId="p1"
				autoSave={false}
			/>,
		);
		await act(() => Promise.resolve());

		const banner = getByTestId("canvas-readonly-banner");
		expect(banner.getAttribute("role")).toBe("status");
		expect(banner.textContent).toContain("Editing is disabled");
		warn.mockRestore();
		unmount();
	});

	it("renders no strip for a fully supported document", async () => {
		const { queryByTestId, unmount } = render(
			<CanvasStudio
				initialIR={fixtureIR()}
				initialActivePageId="p1"
				autoSave={false}
			/>,
		);
		await act(() => Promise.resolve());

		expect(queryByTestId("canvas-readonly-banner")).toBeNull();
		unmount();
	});

	it("blocks undo on a read-only document even with seeded history (P2-3)", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const out: { undoWasNoOp?: boolean } = {};
		const { unmount } = render(
			<CanvasStudio
				initialIR={fixtureIR(["test.future.v9"])}
				initialActivePageId="p1"
				autoSave={false}
			>
				<UndoGuardProbe out={out} />
			</CanvasStudio>,
		);
		await act(() => Promise.resolve());

		expect(out.undoWasNoOp).toBe(true);
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("read-only preview"),
		);
		unmount();
	});

	it("keeps documentReadOnly off the stable context half (P2-4)", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const out: { stableFlag?: unknown } = {};
		const { unmount } = render(
			<CanvasStudio
				initialIR={fixtureIR(["test.future.v9"])}
				initialActivePageId="p1"
				autoSave={false}
			>
				<StableProbe out={out} />
			</CanvasStudio>,
		);
		await act(() => Promise.resolve());

		// The runtime object mirrors the type: the stable half carries no flag
		// even while the document IS read-only.
		expect(out.stableFlag).toBeUndefined();
		warn.mockRestore();
		unmount();
	});
});
