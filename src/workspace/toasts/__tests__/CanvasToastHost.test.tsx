import {
	type CanvasIR,
	createCanvasIR,
	createGroup,
	createPage,
	createRect,
} from "@anvilkit/canvas-core";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
	type CanvasEditorActions,
	useCanvasActions,
} from "@/actions/editor-actions.js";
import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import { useCanvasToaster } from "@/context/toast-context.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import { CanvasToastHost } from "../CanvasToastHost.js";

afterEach(cleanup);

const FIXED_TS = "2026-05-20T00:00:00.000Z";

function fixtureIR(): CanvasIR {
	const page = createPage({ id: "p1" });
	page.root = createGroup({
		id: "p1-root",
		bounds: page.root.bounds,
		children: [
			{
				...createRect({ id: "locked1", bounds: { width: 10, height: 10 } }),
				locked: true,
			},
		],
	});
	return createCanvasIR({ id: "ir", pages: [page], now: () => FIXED_TS });
}

function ToasterProbe({
	capture,
}: {
	capture: (fns: {
		toast: ReturnType<typeof useCanvasToaster>;
		actions: CanvasEditorActions;
	}) => void;
}) {
	const toast = useCanvasToaster();
	const actions = useCanvasActions();
	useEffect(() => {
		capture({ toast, actions });
	}, [actions, capture, toast]);
	return null;
}

describe("CanvasToastHost (A-09)", () => {
	it("provides a live toaster: adds render in the viewport", async () => {
		const h = makeHarness({ ir: fixtureIR() });
		let captured:
			| Parameters<React.ComponentProps<typeof ToasterProbe>["capture"]>[0]
			| null = null;
		render(
			<CanvasStudioContext.Provider value={h.studioCtx}>
				<CanvasToastHost>
					<ToasterProbe
						capture={(fns) => {
							captured = fns;
						}}
					/>
				</CanvasToastHost>
			</CanvasStudioContext.Provider>,
		);
		act(() => {
			captured?.toast.add({ title: "Hello toast", type: "info" });
		});
		await waitFor(() => {
			expect(screen.getByText("Hello toast")).toBeTruthy();
		});
	});

	it("deleteSelection on a locked-only selection fires the warning toast", async () => {
		const h = makeHarness({ ir: fixtureIR() });
		let captured: { actions: CanvasEditorActions } | null = null;
		render(
			<CanvasStudioContext.Provider value={h.studioCtx}>
				<CanvasToastHost>
					<ToasterProbe
						capture={(fns) => {
							captured = fns;
						}}
					/>
				</CanvasToastHost>
			</CanvasStudioContext.Provider>,
		);
		h.studioCtx.selectionStore.getState().setSelection(["locked1"]);
		act(() => {
			captured?.actions.deleteSelection();
		});
		await waitFor(() => {
			expect(screen.getByText("Locked layers weren't deleted")).toBeTruthy();
		});
		// Nothing was committed.
		expect(h.commits).toHaveLength(0);
	});

	it("without a host, the toaster is a silent no-op (headless contract)", () => {
		const h = makeHarness({ ir: fixtureIR() });
		let actions: CanvasEditorActions | null = null;
		function Probe() {
			actions = useCanvasActions();
			return null;
		}
		render(
			<CanvasStudioContext.Provider value={h.studioCtx}>
				<Probe />
			</CanvasStudioContext.Provider>,
		);
		h.studioCtx.selectionStore.getState().setSelection(["locked1"]);
		expect(() =>
			(actions as CanvasEditorActions | null)?.deleteSelection(),
		).not.toThrow();
	});
});
