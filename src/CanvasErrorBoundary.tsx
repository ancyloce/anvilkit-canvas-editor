"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

export interface CanvasErrorBoundaryProps {
	children: ReactNode;
	/**
	 * Custom fallback. Receives the thrown error and a `reset` callback that
	 * re-mounts the children. When omitted, a minimal inline message renders.
	 */
	fallback?: (error: Error, reset: () => void) => ReactNode;
	/** Reported when a child throws — wire to host telemetry/logging. */
	onError?: (error: Error, info: ErrorInfo) => void;
	/**
	 * Heading for the default fallback (already localized by the caller). Also
	 * tags the console output.
	 */
	label?: string;
	/**
	 * Clears the error and re-mounts children whenever this value changes — e.g.
	 * pass the active page / panel id so navigating away recovers automatically.
	 */
	resetKey?: unknown;
}

interface CanvasErrorBoundaryState {
	error: Error | null;
}

/**
 * Error boundary for the canvas editor (W10). Without it, any render-time throw
 * — a malformed IR, a missing asset, or a bug in a host-supplied panel — unwinds
 * the whole React tree and the user loses the entire editor. Wrapping the panel
 * registry and the stage subtree contains a failure to that region: the rest of
 * the editor keeps working and the user gets a recover affordance instead of a
 * blank screen. Exported so hosts can wrap their own custom panels too.
 */
export class CanvasErrorBoundary extends Component<
	CanvasErrorBoundaryProps,
	CanvasErrorBoundaryState
> {
	state: CanvasErrorBoundaryState = { error: null };

	static getDerivedStateFromError(error: Error): CanvasErrorBoundaryState {
		return { error };
	}

	componentDidUpdate(prev: CanvasErrorBoundaryProps): void {
		// Auto-recover when the caller's reset key changes (e.g. page/panel switch).
		if (this.state.error && prev.resetKey !== this.props.resetKey) {
			this.setState({ error: null });
		}
	}

	componentDidCatch(error: Error, info: ErrorInfo): void {
		this.props.onError?.(error, info);
		console.error(
			`[canvas-editor]${this.props.label ? ` ${this.props.label}` : ""} render error`,
			error,
			info,
		);
	}

	private readonly reset = (): void => {
		this.setState({ error: null });
	};

	render(): ReactNode {
		const { error } = this.state;
		if (!error) return this.props.children;
		if (this.props.fallback) return this.props.fallback(error, this.reset);
		return (
			<div
				role="alert"
				data-testid="canvas-error-boundary"
				className="flex h-full min-h-0 flex-col items-start gap-2 p-4 text-xs text-destructive"
			>
				<p className="font-medium">
					{this.props.label ?? "Something went wrong."}
				</p>
				<p className="break-words text-muted-foreground">{error.message}</p>
				<button
					type="button"
					onClick={this.reset}
					className="rounded-md border border-border px-2 py-1 text-foreground hover:bg-muted"
				>
					Try again
				</button>
			</div>
		);
	}
}
