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
 * M0-02 dependency gate for plan 0023 (Local Components): a document
 * declaring a capability this build does not implement must not mount for
 * editing — it mounts as a read-only preview whose mutating commits are
 * blocked at the pipeline choke point (AC-010). Plan 0023 relies on this
 * exact seam for `components.local.v1` gating (LC-COMPAT-002).
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
		Shape: makeMock("Shape"),
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

interface ProbeResult {
	readOnly?: boolean;
	movedX?: number;
}

/** Records the context's read-only flag, then attempts one node.move. */
function CommitProbe({ out }: { out: ProbeResult }): null {
	const ctx = useCanvasStudio();
	const done = useRef(false);
	useEffect(() => {
		if (done.current) return;
		done.current = true;
		out.readOnly = ctx.documentReadOnly;
		const next = ctx.commit({
			type: "node.move",
			nodeId: "r1",
			from: { x: 0, y: 0 },
			to: { x: 5, y: 0 },
		});
		const root = next.pages[0]?.root as {
			children?: readonly { transform?: { x?: number } }[];
		};
		out.movedX = root.children?.[0]?.transform?.x;
	}, [ctx, out]);
	return null;
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("unsupported-capability documents do not mount for editing (AC-010)", () => {
	it("blocks commits and exposes documentReadOnly on the context", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const out: ProbeResult = {};
		const { unmount } = render(
			<CanvasStudio
				initialIR={fixtureIR(["layout.auto.v1", "test.future.v9"])}
				initialActivePageId="p1"
				autoSave={false}
			>
				<CommitProbe out={out} />
			</CanvasStudio>,
		);
		await act(() => Promise.resolve());

		expect(out.readOnly).toBe(true);
		// The commit returned the document unchanged: r1 never moved.
		expect(out.movedX).toBe(0);
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("read-only preview"),
		);
		unmount();
	});

	it("keeps a document without unknown capabilities fully editable", async () => {
		const out: ProbeResult = {};
		const { unmount } = render(
			<CanvasStudio
				initialIR={fixtureIR()}
				initialActivePageId="p1"
				autoSave={false}
			>
				<CommitProbe out={out} />
			</CanvasStudio>,
		);
		await act(() => Promise.resolve());

		expect(out.readOnly).toBe(false);
		expect(out.movedX).toBe(5);
		unmount();
	});
});
