import {
	type CanvasIR,
	type CanvasNodeUpdateCommand,
	createCanvasIR,
	createPage,
	createPath,
} from "@anvilkit/canvas-core";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

type ElementCall = { type: string; props: Record<string, unknown> };
const calls: ElementCall[] = [];

function makeMock(type: string) {
	return (props: Record<string, unknown>) => {
		calls.push({ type, props });
		const { children } = props as { children?: ReactNode };
		return <div data-testid={type}>{children}</div>;
	};
}

vi.mock("react-konva", () => ({
	Path: makeMock("Path"),
	Line: makeMock("Line"),
	Rect: makeMock("Rect"),
	Circle: makeMock("Circle"),
}));

import {
	CanvasStudioContext,
	type CanvasStudioContextValue,
} from "../../context/canvas-studio-context.js";
import { makeHarness } from "../../tools/__tests__/_tool-test-helpers.js";
import { PathEditOverlay } from "../PathEditOverlay.js";

function pathIR(d = "M 0 0 L 10 0"): CanvasIR {
	const page = createPage({ id: "p1" });
	page.root.children = [
		createPath({ id: "path-a", bounds: { width: 10, height: 10 }, d }),
	];
	return createCanvasIR({ id: "ir", pages: [page] });
}

function mount(ctx: CanvasStudioContextValue) {
	return render(
		<CanvasStudioContext.Provider value={ctx}>
			<PathEditOverlay />
		</CanvasStudioContext.Provider>,
	);
}

function reset() {
	const { beforeEach } = import.meta.vitest!;
	beforeEach(() => {
		calls.length = 0;
	});
}

describe("PathEditOverlay", () => {
	reset();

	it("renders nothing when no path is being edited", () => {
		const h = makeHarness({ ir: pathIR() });
		mount(h.studioCtx);
		expect(calls).toHaveLength(0);
	});

	it("renders an anchor handle per on-curve point", () => {
		const h = makeHarness({ ir: pathIR() });
		h.studioCtx.pathEditStore?.getState().begin("path-a");
		mount(h.studioCtx);
		// Two on-curve points (M 0 0, L 10 0) → two Rect anchor handles.
		expect(calls.filter((c) => c.type === "Rect")).toHaveLength(2);
	});

	it("commits a node.update with the moved point on drag end", () => {
		const h = makeHarness({ ir: pathIR() });
		h.studioCtx.pathEditStore?.getState().begin("path-a");
		mount(h.studioCtx);
		// Find the start anchor handle (world 0,0) and drag it to (5,5).
		const start = calls.find(
			(c) => c.type === "Rect" && c.props.x === 0 && c.props.y === 0,
		);
		expect(start).toBeDefined();
		const onDragMove = start?.props.onDragMove as (e: unknown) => void;
		const onDragEnd = start?.props.onDragEnd as () => void;
		onDragMove({ target: { x: () => 5, y: () => 5 } });
		onDragEnd();
		expect(h.commits).toHaveLength(1);
		const cmd = h.commits[0] as CanvasNodeUpdateCommand<"path">;
		expect(cmd.type).toBe("node.update");
		expect((cmd.patch as { d?: string }).d).toBe("M 5 5 L 10 0");
	});
});
