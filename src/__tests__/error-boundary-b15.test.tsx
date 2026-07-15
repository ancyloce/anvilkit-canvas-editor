import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasErrorBoundary } from "../CanvasErrorBoundary.js";

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
