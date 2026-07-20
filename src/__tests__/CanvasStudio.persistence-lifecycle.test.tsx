import {
	createCanvasIR,
	createGroup,
	createPage,
	createRect,
} from "@anvilkit/canvas-core";
import { act, render } from "@testing-library/react";
import { type ReactNode, useEffect, useRef } from "react";
import { describe, expect, it, vi } from "vitest";

/**
 * FR-160 component-level lifecycle regressions: the unmount cleanup's final
 * flush must survive the `dispose()` issued in the same cleanup, and
 * `beforeunload` must warn without pretending the browser will await an async
 * save (best-effort persistence goes through the optional synchronous
 * `saveOnUnload` capability instead).
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

import { CanvasStudio, useCanvasStudio } from "../index.js";
import type {
	CanvasSaveInput,
	CanvasUnloadSaveInput,
} from "../persistence/types.js";

function fixtureIR() {
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
	return createCanvasIR({
		id: "doc-1",
		pages: [page],
		now: () => "2026-05-20T00:00:00.000Z",
	});
}

/** Commits one node.move (exactly once) so the document is dirty. */
function DirtyProbe(): null {
	const ctx = useCanvasStudio();
	const done = useRef(false);
	useEffect(() => {
		if (done.current) return;
		done.current = true;
		ctx.commit({
			type: "node.move",
			nodeId: "r1",
			from: { x: 0, y: 0 },
			to: { x: 5, y: 0 },
		});
	}, [ctx]);
	return null;
}

describe("FR-160 persistence lifecycle", () => {
	it("unmount flushes exactly once and disposal does not abort that flush", async () => {
		const inputs: CanvasSaveInput[] = [];
		const adapter = {
			save: vi.fn(async (input: CanvasSaveInput) => {
				inputs.push(input);
				return {};
			}),
		};
		const { unmount } = render(
			<CanvasStudio
				initialIR={fixtureIR()}
				initialActivePageId="p1"
				persistenceAdapter={adapter}
				autoSave={false}
			>
				<DirtyProbe />
			</CanvasStudio>,
		);
		await act(async () => { /* flush effects */ });
		expect(adapter.save).not.toHaveBeenCalled();

		unmount();

		expect(adapter.save).toHaveBeenCalledTimes(1);
		expect(inputs[0]?.signal.aborted).toBe(false);
		await act(async () => { /* flush effects */ });
	});

	it("clean unmount does not call the adapter at all", async () => {
		const adapter = { save: vi.fn(async () => ({})) };
		const { unmount } = render(
			<CanvasStudio
				initialIR={fixtureIR()}
				initialActivePageId="p1"
				persistenceAdapter={adapter}
				autoSave={false}
			/>,
		);
		await act(async () => { /* flush effects */ });
		unmount();
		expect(adapter.save).not.toHaveBeenCalled();
	});

	it("beforeunload while dirty warns and uses saveOnUnload — never the async save path", async () => {
		const unloadInputs: CanvasUnloadSaveInput[] = [];
		const adapter = {
			save: vi.fn(async () => ({})),
			saveOnUnload: vi.fn((input: CanvasUnloadSaveInput) => {
				unloadInputs.push(input);
			}),
		};
		const { unmount } = render(
			<CanvasStudio
				initialIR={fixtureIR()}
				initialActivePageId="p1"
				persistenceAdapter={adapter}
				autoSave={false}
			>
				<DirtyProbe />
			</CanvasStudio>,
		);
		await act(async () => { /* flush effects */ });

		const event = new Event("beforeunload", { cancelable: true });
		act(() => {
			window.dispatchEvent(event);
		});

		expect(event.defaultPrevented).toBe(true);
		expect(adapter.saveOnUnload).toHaveBeenCalledTimes(1);
		expect(unloadInputs[0]?.documentId).toBe("doc-1");
		expect(unloadInputs[0]?.ir.pages[0]?.id).toBe("p1");
		expect(typeof unloadInputs[0]?.revision).toBe("number");
		// The warn path must not fire an async save the browser would discard.
		expect(adapter.save).not.toHaveBeenCalled();
		unmount();
	});

	it("beforeunload while clean neither warns nor calls saveOnUnload", async () => {
		const adapter = {
			save: vi.fn(async () => ({})),
			saveOnUnload: vi.fn(),
		};
		const { unmount } = render(
			<CanvasStudio
				initialIR={fixtureIR()}
				initialActivePageId="p1"
				persistenceAdapter={adapter}
				autoSave={false}
			/>,
		);
		await act(async () => { /* flush effects */ });

		const event = new Event("beforeunload", { cancelable: true });
		act(() => {
			window.dispatchEvent(event);
		});

		expect(event.defaultPrevented).toBe(false);
		expect(adapter.saveOnUnload).not.toHaveBeenCalled();
		unmount();
	});
});
