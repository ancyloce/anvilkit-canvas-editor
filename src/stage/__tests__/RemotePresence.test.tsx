import {
	createCanvasIR,
	createPage,
	createRect,
	insertNode,
} from "@anvilkit/canvas-core";
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

type ElementCall = { type: string; props: Record<string, unknown> };
const calls: ElementCall[] = [];

vi.mock("react-konva", () => {
	const component = (type: string) =>
		({ children, ...props }: Record<string, unknown> & { children?: ReactNode }) => {
			calls.push({ type, props });
			return <div data-konva={type}>{children}</div>;
		};
	return {
		Group: component("Group"),
		Line: component("Line"),
		Rect: component("Rect"),
		Text: component("Text"),
	};
});

import { CanvasPresenceContext } from "../../collab/useCanvasPresence.js";
import { CanvasStudioContext } from "../../context/canvas-studio-context.js";
import { makeHarness } from "../../tools/__tests__/_tool-test-helpers.js";
import { RemoteCursors } from "../RemoteCursors.js";
import { RemoteSelections } from "../RemoteSelections.js";

afterEach(() => {
	cleanup();
	calls.length = 0;
});

describe("remote presence overlays", () => {
	it("renders page-space cursors and active-page selection outlines at screen-stable weight", () => {
		const page = createPage({ id: "page-1" });
		let ir = createCanvasIR({ id: "document-1", pages: [page] });
		ir = insertNode(ir, {
			parentId: page.root.id,
			node: createRect({
				id: "node-1",
				bounds: { width: 80, height: 40 },
				transform: { x: 30, y: 50 },
			}),
		});
		const h = makeHarness({ ir });
		h.studioCtx.viewportStore.getState().setZoom(2);
		const source = {
			onPeerChange(callback: (peers: readonly never[]) => void) {
				callback([
					{
						peer: { id: "peer-1", displayName: "Avery", color: "#7c3aed" },
						cursor: { x: 12, y: 24 },
						selection: { nodeIds: ["node-1"] },
					},
				] as never[]);
				return () => undefined;
			},
		};
		render(
			<CanvasStudioContext.Provider
				value={{ ...h.studioCtx, ir, activePageId: "page-1" }}
			>
				<CanvasPresenceContext.Provider value={source}>
					<RemoteCursors />
					<RemoteSelections />
				</CanvasPresenceContext.Provider>
			</CanvasStudioContext.Provider>,
		);

		const cursor = calls.find(
			(call) => call.type === "Group" && call.props.name === "remote-cursor-peer-1",
		);
		expect(cursor?.props).toMatchObject({ x: 12, y: 24, scaleX: 0.5, scaleY: 0.5 });
		const selection = calls.find(
			(call) =>
				call.type === "Rect" &&
				call.props.name === "remote-selection-peer-1-node-1",
		);
		expect(selection?.props).toMatchObject({
			x: 30,
			y: 50,
			width: 80,
			height: 40,
			strokeWidth: 1,
		});
	});
});
