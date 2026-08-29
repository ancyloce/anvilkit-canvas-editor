import {
	type CanvasIR,
	createCanvasIR,
	createGroup,
	createPage,
	createRect,
} from "@anvilkit/canvas-core";
import { act, cleanup, render } from "@testing-library/react";
import { type ReactNode, useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

vi.mock("use-image", () => ({ default: () => [null, "loading"] }));
vi.mock("../render/rasterize-page.js", () => ({
	rasterizePage: vi.fn(async ({ page }: { page: { id: string } }) => ({
		url: `data:thumb/${page.id}`,
		mimeType: "image/png",
	})),
}));

import {
	CanvasStudio,
	type CanvasStudioContextValue,
	useCanvasStudio,
} from "../index.js";
import { isCanvasDocumentWriteAllowed } from "../collaboration.js";

function fixtureIR(): CanvasIR {
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
	return createCanvasIR({ id: "doc-1", pages: [page] });
}

function authorization(
	role: "owner" | "editor" | "commenter" | "viewer",
): boolean {
	return isCanvasDocumentWriteAllowed({
		subjectId: "user-1",
		grants: [
			{
				subjectId: "user-1",
				role,
				scope: { kind: "document", id: "doc-1" },
			},
		],
	}, "doc-1");
}

function Capture({ out }: { out: { current?: CanvasStudioContextValue } }) {
	const ctx = useCanvasStudio();
	useEffect(() => {
		out.current = ctx;
	}, [ctx, out]);
	return null;
}

function movedX(ctx: CanvasStudioContextValue): number | undefined {
	const root = ctx.getIR().pages[0]?.root as {
		children?: readonly { transform?: { x?: number } }[];
	};
	return root.children?.[0]?.transform?.x;
}

afterEach(cleanup);

describe("CanvasStudio authorization enforcement", () => {
	it.each(["commenter", "viewer"] as const)(
		"blocks every command-pipeline variant for a %s",
		async (role) => {
			const out: { current?: CanvasStudioContextValue } = {};
			render(
				<CanvasStudio
					initialIR={fixtureIR()}
					canWrite={authorization(role)}
				>
					<Capture out={out} />
				</CanvasStudio>,
			);
			await act(() => Promise.resolve());
			const ctx = out.current as CanvasStudioContextValue;
			expect(ctx.documentReadOnly).toBe(true);
			const command = {
				type: "node.move" as const,
				nodeId: "r1",
				from: { x: 0, y: 0 },
				to: { x: 5, y: 0 },
			};
			act(() => {
				ctx.commit(command);
				ctx.commitCoalesced?.(command, "move-r1");
				ctx.commitBatch([command]);
			});
			expect(movedX(ctx)).toBe(0);
		},
	);

	it("allows editor writes, then blocks stale undo after a role downgrade", async () => {
		const out: { current?: CanvasStudioContextValue } = {};
		const view = render(
			<CanvasStudio
				initialIR={fixtureIR()}
				canWrite={authorization("editor")}
			>
				<Capture out={out} />
			</CanvasStudio>,
		);
		await act(() => Promise.resolve());
		act(() => {
			out.current?.commit({
				type: "node.move",
				nodeId: "r1",
				from: { x: 0, y: 0 },
				to: { x: 5, y: 0 },
			});
		});
		expect(movedX(out.current as CanvasStudioContextValue)).toBe(5);

		view.rerender(
			<CanvasStudio
				initialIR={fixtureIR()}
				canWrite={authorization("commenter")}
			>
				<Capture out={out} />
			</CanvasStudio>,
		);
		await act(() => Promise.resolve());
		act(() => {
			out.current?.undo();
		});
		expect(movedX(out.current as CanvasStudioContextValue)).toBe(5);
	});
});
