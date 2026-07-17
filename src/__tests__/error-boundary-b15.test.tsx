import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { lazy, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	CanvasErrorBoundary,
	type CanvasErrorDetailsInfo,
} from "../CanvasErrorBoundary.js";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

function Bomb({ defused = false }: { defused?: boolean }): React.JSX.Element {
	if (!defused) throw new Error("kaboom");
	return <div data-testid="defused" />;
}

/** Suppress React's expected error-boundary console noise per render. */
function quietConsole(): void {
	vi.spyOn(console, "error").mockImplementation(() => undefined);
}

// FR-171: `CanvasErrorBoundary` is a leaf module (see check-layering.mjs's
// module doc) and cannot import dialog-class UI itself — real composition
// roots (`CanvasWorkspace`, `TabPanel`) supply `renderErrorDetails` with
// their own lazy-loaded `ErrorDetailsDialog`. Mirrored here so these tests
// exercise the same seam instead of a component-internal import.
const ErrorDetailsDialog = lazy(
	() => import("../workspace/dialogs/ErrorDetailsDialog.js"),
);

function renderErrorDetails(info: CanvasErrorDetailsInfo): React.ReactNode {
	return (
		<ErrorDetailsDialog
			error={info.error}
			errorId={info.errorId}
			componentStack={info.componentStack}
			onClose={info.onClose}
			{...(info.onReloadDocument
				? { onReloadDocument: info.onReloadDocument }
				: {})}
			{...(info.onExportRecovery
				? { onExportRecovery: info.onExportRecovery }
				: {})}
			{...(info.onCopyErrorId ? { onCopyErrorId: info.onCopyErrorId } : {})}
		/>
	);
}

describe("CanvasErrorBoundary FR-172 extensions (B-15)", () => {
	it("shows a copyable error id and calls the host onError", () => {
		quietConsole();
		const onError = vi.fn();
		render(
			<CanvasErrorBoundary onError={onError}>
				<Bomb />
			</CanvasErrorBoundary>,
		);
		expect(onError).toHaveBeenCalledTimes(1);
		expect((onError.mock.calls[0]?.[0] as Error | undefined)?.message).toBe(
			"kaboom",
		);
		const id = screen.getByTestId("canvas-error-id").textContent ?? "";
		expect(id).toMatch(/^cnv-[a-z0-9-]{8}$/);
		const writeText = vi.fn(() => Promise.resolve());
		vi.stubGlobal("navigator", {
			...navigator,
			clipboard: { writeText },
		});
		fireEvent.click(screen.getByTestId("canvas-error-copy-id"));
		expect(writeText).toHaveBeenCalledWith(id);
		vi.unstubAllGlobals();
	});

	it("reload-document calls the handler and resets the boundary", () => {
		quietConsole();
		const onReloadDocument = vi.fn();
		function Harness(): React.JSX.Element {
			const [defused, setDefused] = useState(false);
			return (
				<CanvasErrorBoundary
					onReloadDocument={() => {
						onReloadDocument();
						setDefused(true);
					}}
				>
					<Bomb defused={defused} />
				</CanvasErrorBoundary>
			);
		}
		render(<Harness />);
		fireEvent.click(screen.getByTestId("canvas-error-reload"));
		expect(onReloadDocument).toHaveBeenCalledTimes(1);
		expect(screen.getByTestId("defused")).toBeTruthy();
		expect(screen.queryByTestId("canvas-error-boundary")).toBeNull();
	});

	it("export-recovery calls the handler without resetting", () => {
		quietConsole();
		const onExportRecovery = vi.fn();
		render(
			<CanvasErrorBoundary onExportRecovery={onExportRecovery}>
				<Bomb />
			</CanvasErrorBoundary>,
		);
		fireEvent.click(screen.getByTestId("canvas-error-export-recovery"));
		expect(onExportRecovery).toHaveBeenCalledTimes(1);
		// The user may want to export AND then retry — the error UI stays up.
		expect(screen.getByTestId("canvas-error-boundary")).toBeTruthy();
	});

	it("hides reload/export buttons when the handlers are not wired", () => {
		quietConsole();
		render(
			<CanvasErrorBoundary>
				<Bomb />
			</CanvasErrorBoundary>,
		);
		expect(screen.queryByTestId("canvas-error-reload")).toBeNull();
		expect(screen.queryByTestId("canvas-error-export-recovery")).toBeNull();
		expect(screen.getByTestId("canvas-error-retry")).toBeTruthy();
	});

	it("renders localized labels", () => {
		quietConsole();
		render(
			<CanvasErrorBoundary
				onReloadDocument={() => undefined}
				labels={{ retry: "再试一次", reloadDocument: "重新加载文档" }}
			>
				<Bomb />
			</CanvasErrorBoundary>,
		);
		expect(screen.getByTestId("canvas-error-retry").textContent).toBe(
			"再试一次",
		);
		expect(screen.getByTestId("canvas-error-reload").textContent).toBe(
			"重新加载文档",
		);
	});
});

describe("CanvasErrorBoundary FR-171 error-details dialog", () => {
	it("has no 'View details' trigger when there is no error (never a dead entry)", () => {
		render(
			<CanvasErrorBoundary renderErrorDetails={renderErrorDetails}>
				<Bomb defused />
			</CanvasErrorBoundary>,
		);
		expect(screen.queryByTestId("canvas-error-view-details")).toBeNull();
		expect(screen.queryByTestId("canvas-error-details-dialog")).toBeNull();
	});

	it("has no 'View details' trigger when no ancestor supplied renderErrorDetails", () => {
		// Composition seam (see check-layering.mjs): a headless mount with no
		// workspace-rank ancestor to compose the dialog just doesn't get the
		// trigger — not a dead button pointing nowhere.
		quietConsole();
		render(
			<CanvasErrorBoundary>
				<Bomb />
			</CanvasErrorBoundary>,
		);
		expect(screen.queryByTestId("canvas-error-view-details")).toBeNull();
	});

	it("is not mounted until 'View details' is clicked (code-split chunk)", async () => {
		quietConsole();
		render(
			<CanvasErrorBoundary renderErrorDetails={renderErrorDetails}>
				<Bomb />
			</CanvasErrorBoundary>,
		);
		expect(screen.queryByTestId("canvas-error-details-dialog")).toBeNull();
		fireEvent.click(screen.getByTestId("canvas-error-view-details"));
		// The dialog chunk is code-split — it appears after the lazy import.
		expect(
			await screen.findByTestId("canvas-error-details-dialog"),
		).toBeTruthy();
	});

	it("shows the full message, the error id, and a stack trace disclosure", async () => {
		quietConsole();
		render(
			<CanvasErrorBoundary renderErrorDetails={renderErrorDetails}>
				<Bomb />
			</CanvasErrorBoundary>,
		);
		const boundaryId = screen.getByTestId("canvas-error-id").textContent;
		fireEvent.click(screen.getByTestId("canvas-error-view-details"));
		await screen.findByTestId("canvas-error-details-dialog");
		expect(screen.getByTestId("canvas-error-details-message").textContent).toBe(
			"kaboom",
		);
		expect(screen.getByTestId("canvas-error-details-id").textContent).toBe(
			boundaryId,
		);
		// jsdom populates Error#stack for thrown errors.
		expect(screen.getByTestId("canvas-error-details-stack")).toBeTruthy();
	});

	it("copy-id in the dialog reuses the boundary's own copy handler", async () => {
		quietConsole();
		render(
			<CanvasErrorBoundary renderErrorDetails={renderErrorDetails}>
				<Bomb />
			</CanvasErrorBoundary>,
		);
		const id = screen.getByTestId("canvas-error-id").textContent ?? "";
		fireEvent.click(screen.getByTestId("canvas-error-view-details"));
		await screen.findByTestId("canvas-error-details-dialog");
		const writeText = vi.fn(() => Promise.resolve());
		vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
		fireEvent.click(screen.getByTestId("canvas-error-details-copy-id"));
		expect(writeText).toHaveBeenCalledWith(id);
		vi.unstubAllGlobals();
	});

	it("reload in the dialog calls the same handler and closes both the dialog and the boundary", async () => {
		quietConsole();
		const onReloadDocument = vi.fn();
		function Harness(): React.JSX.Element {
			const [defused, setDefused] = useState(false);
			return (
				<CanvasErrorBoundary
					renderErrorDetails={renderErrorDetails}
					onReloadDocument={() => {
						onReloadDocument();
						setDefused(true);
					}}
				>
					<Bomb defused={defused} />
				</CanvasErrorBoundary>
			);
		}
		render(<Harness />);
		fireEvent.click(screen.getByTestId("canvas-error-view-details"));
		await screen.findByTestId("canvas-error-details-dialog");
		fireEvent.click(screen.getByTestId("canvas-error-details-reload"));
		expect(onReloadDocument).toHaveBeenCalledTimes(1);
		expect(screen.getByTestId("defused")).toBeTruthy();
		expect(screen.queryByTestId("canvas-error-boundary")).toBeNull();
		expect(screen.queryByTestId("canvas-error-details-dialog")).toBeNull();
	});

	it("export-recovery in the dialog calls the same handler without closing anything", async () => {
		quietConsole();
		const onExportRecovery = vi.fn();
		render(
			<CanvasErrorBoundary
				renderErrorDetails={renderErrorDetails}
				onExportRecovery={onExportRecovery}
			>
				<Bomb />
			</CanvasErrorBoundary>,
		);
		fireEvent.click(screen.getByTestId("canvas-error-view-details"));
		await screen.findByTestId("canvas-error-details-dialog");
		fireEvent.click(screen.getByTestId("canvas-error-details-export-recovery"));
		expect(onExportRecovery).toHaveBeenCalledTimes(1);
		expect(screen.getByTestId("canvas-error-boundary")).toBeTruthy();
		expect(screen.getByTestId("canvas-error-details-dialog")).toBeTruthy();
	});

	it("hides reload/export/copy actions in the dialog when the handlers/id are absent", async () => {
		quietConsole();
		render(
			<CanvasErrorBoundary
				renderErrorDetails={renderErrorDetails}
				fallback={undefined}
			>
				<Bomb />
			</CanvasErrorBoundary>,
		);
		fireEvent.click(screen.getByTestId("canvas-error-view-details"));
		await screen.findByTestId("canvas-error-details-dialog");
		expect(screen.queryByTestId("canvas-error-details-reload")).toBeNull();
		expect(
			screen.queryByTestId("canvas-error-details-export-recovery"),
		).toBeNull();
	});

	it("the close button in the dialog closes only the dialog, leaving the boundary up", async () => {
		quietConsole();
		render(
			<CanvasErrorBoundary renderErrorDetails={renderErrorDetails}>
				<Bomb />
			</CanvasErrorBoundary>,
		);
		fireEvent.click(screen.getByTestId("canvas-error-view-details"));
		await screen.findByTestId("canvas-error-details-dialog");
		fireEvent.click(screen.getByTestId("canvas-error-details-close"));
		expect(screen.queryByTestId("canvas-error-details-dialog")).toBeNull();
		expect(screen.getByTestId("canvas-error-boundary")).toBeTruthy();
	});
});
