import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import {
	CanvasToastContext,
	type CanvasToastInput,
} from "@/context/toast-context.js";
import { createSaveStatusStore } from "@/stores/save-status-store.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import { WorkspaceUiStoreProvider } from "../../state/WorkspaceUiStoreProvider.js";
import { WorkspaceHeader } from "../WorkspaceHeader.js";

afterEach(cleanup);

function setup(withPersistence = true) {
	const h = makeHarness();
	const saveStatusStore = createSaveStatusStore();
	if (withPersistence) {
		h.studioCtx.saveStatusStore = saveStatusStore;
		h.studioCtx.save = vi.fn(() => Promise.resolve(true));
	}
	render(
		<CanvasStudioContext.Provider value={h.studioCtx}>
			{/* The header reads workspace UI state (restore layout, B-14). */}
			<WorkspaceUiStoreProvider storeId="header-save-test">
				<WorkspaceHeader />
			</WorkspaceUiStoreProvider>
		</CanvasStudioContext.Provider>,
	);
	return { h, saveStatusStore };
}

describe("WorkspaceHeader save status + zoom (B-07)", () => {
	it("renders the live save state and retries on click when failed", () => {
		const { h, saveStatusStore } = setup();
		const pill = screen.getByTestId("workspace-save-status");
		expect(pill.getAttribute("data-status")).toBe("clean");
		act(() => {
			saveStatusStore.getState().recordError("boom");
		});
		expect(
			screen.getByTestId("workspace-save-status").getAttribute("data-status"),
		).toBe("error");
		fireEvent.click(screen.getByTestId("workspace-save-status"));
		expect(h.studioCtx.save).toHaveBeenCalledTimes(1);
	});

	it("hides the indicator without a persistence adapter", () => {
		setup(false);
		expect(screen.queryByTestId("workspace-save-status")).toBeNull();
	});

	it("header zoom controls drive the viewport store", () => {
		const { h } = setup();
		fireEvent.click(screen.getByTestId("workspace-header-zoom-in"));
		expect(h.studioCtx.viewportStore.getState().zoom).toBe(1.25);
		fireEvent.click(screen.getByTestId("workspace-header-zoom-out"));
		expect(h.studioCtx.viewportStore.getState().zoom).toBe(1);
		expect(screen.getByTestId("workspace-header-zoom").textContent).toContain(
			"100%",
		);
	});

	it("renders the more menu trigger", () => {
		setup();
		expect(screen.getByTestId("workspace-more-menu")).toBeTruthy();
	});

	it("shows the active page size (FR-003)", () => {
		setup();
		const label = screen.getByTestId("workspace-header-page-size");
		// Default page is 1080 × 1080 px.
		expect(label.textContent).toContain("1,080");
		expect(label.textContent).toContain("×");
		expect(label.textContent).toContain("px");
	});
});

describe("WorkspaceHeader save failure/recovery toast (FR-170)", () => {
	function setupWithToaster() {
		const h = makeHarness();
		const saveStatusStore = createSaveStatusStore();
		h.studioCtx.saveStatusStore = saveStatusStore;
		h.studioCtx.save = vi.fn(() => Promise.resolve(true));
		const toasts: CanvasToastInput[] = [];
		render(
			<CanvasStudioContext.Provider value={h.studioCtx}>
				<CanvasToastContext.Provider
					value={{ add: (input) => toasts.push(input) }}
				>
					<WorkspaceUiStoreProvider storeId="header-save-toast-test">
						<WorkspaceHeader />
					</WorkspaceUiStoreProvider>
				</CanvasToastContext.Provider>
			</CanvasStudioContext.Provider>,
		);
		return { h, saveStatusStore, toasts };
	}

	it("fires an error toast once when a save enters the error state", () => {
		const { saveStatusStore, toasts } = setupWithToaster();
		act(() => {
			saveStatusStore.getState().recordError("boom");
		});
		expect(toasts).toHaveLength(1);
		expect(toasts[0]?.type).toBe("error");
		expect(toasts[0]?.title).toBe("Couldn't save your changes");
	});

	it("does not repeat the error toast across retries that keep landing back on error", () => {
		const { saveStatusStore, toasts } = setupWithToaster();
		act(() => {
			saveStatusStore.getState().recordError("boom");
		});
		act(() => {
			saveStatusStore.getState().setStatus("saving");
		});
		act(() => {
			saveStatusStore.getState().recordError("boom again");
		});
		expect(toasts).toHaveLength(1);
	});

	it("fires a recovery toast once the save succeeds after a prior failure", () => {
		const { saveStatusStore, toasts } = setupWithToaster();
		act(() => {
			saveStatusStore.getState().recordError("boom");
		});
		act(() => {
			saveStatusStore.getState().setStatus("saving");
		});
		act(() => {
			saveStatusStore.getState().recordSaved("2026-07-16T00:00:00.000Z");
		});
		expect(toasts).toHaveLength(2);
		expect(toasts[1]?.type).toBe("success");
		expect(toasts[1]?.title).toBe("Changes saved");
	});

	it("does not toast a routine successful autosave with no prior failure", () => {
		const { saveStatusStore, toasts } = setupWithToaster();
		act(() => {
			saveStatusStore.getState().setStatus("dirty");
		});
		act(() => {
			saveStatusStore.getState().setStatus("saving");
		});
		act(() => {
			saveStatusStore.getState().recordSaved("2026-07-16T00:00:00.000Z");
		});
		expect(toasts).toHaveLength(0);
	});
});

describe("WorkspaceHeader undo/redo empty states (B-15, FR-173)", () => {
	it("titles the disabled buttons with nothing-to-undo/redo hints", () => {
		setup(false);
		const undo = screen.getByTestId("workspace-undo");
		const redo = screen.getByTestId("workspace-redo");
		expect(undo.hasAttribute("disabled")).toBe(true);
		expect(undo.getAttribute("title")).toBe("Nothing to undo");
		expect(redo.getAttribute("title")).toBe("Nothing to redo");
		// The accessible name stays the action, not the state.
		expect(undo.getAttribute("aria-label")).toBe("Undo");
	});
});
