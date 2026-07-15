"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

/** Localizable labels for the default fallback (FR-172). */
export interface CanvasErrorBoundaryLabels {
	retry?: string;
	reloadDocument?: string;
	exportRecovery?: string;
	copyErrorId?: string;
}

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
	 * FR-172 "Reload document": shown as a button in the default fallback when
	 * provided. The canvas mount wires this to `replaceDocument(getIR(),
	 * "recovery")`, which resets every editor store around the current IR.
	 * The boundary resets itself after calling it.
	 */
	onReloadDocument?: () => void;
	/**
	 * FR-172 "Export recovery JSON": shown as a button in the default fallback
	 * when provided. The canvas mount wires this to a download of the current
	 * IR so no work is lost even when rendering is wedged.
	 */
	onExportRecovery?: () => void;
	/**
	 * Heading for the default fallback (already localized by the caller). Also
	 * tags the console output.
	 */
	label?: string;
	/** Localized button labels for the default fallback. English defaults. */
	labels?: CanvasErrorBoundaryLabels;
	/**
	 * Clears the error and re-mounts children whenever this value changes — e.g.
	 * pass the active page / panel id so navigating away recovers automatically.
	 */
	resetKey?: unknown;
}

interface CanvasErrorBoundaryState {
	error: Error | null;
	/** FR-172: correlates a user report with host telemetry (see `onError`). */
	errorId: string | null;
}

/** Short, copyable error identifier (FR-172). */
function mintErrorId(): string {
	try {
		return `cnv-${crypto.randomUUID().slice(0, 8)}`;
	} catch {
		return `cnv-${Math.random().toString(36).slice(2, 10)}`;
	}
}

/**
 * Error boundary for the canvas editor (W10). Without it, any render-time throw
 * — a malformed IR, a missing asset, or a bug in a host-supplied panel — unwinds
 * the whole React tree and the user loses the entire editor. Wrapping the panel
 * registry and the stage subtree contains a failure to that region: the rest of
 * the editor keeps working and the user gets a recover affordance instead of a
 * blank screen. Exported so hosts can wrap their own custom panels too.
 *
 * B-15 (FR-172) extends the default fallback with reload-document and
 * export-recovery actions (rendered when the caller wires the handlers) and a
 * copyable error id that also reaches the host `onError` callback via the
 * console log line.
 */
export class CanvasErrorBoundary extends Component<
	CanvasErrorBoundaryProps,
	CanvasErrorBoundaryState
> {
	state: CanvasErrorBoundaryState = { error: null, errorId: null };

	static getDerivedStateFromError(error: Error): CanvasErrorBoundaryState {
		return { error, errorId: mintErrorId() };
	}

	componentDidUpdate(prev: CanvasErrorBoundaryProps): void {
		// Auto-recover when the caller's reset key changes (e.g. page/panel switch).
		if (this.state.error && prev.resetKey !== this.props.resetKey) {
			this.setState({ error: null, errorId: null });
		}
	}

	componentDidCatch(error: Error, info: ErrorInfo): void {
		this.props.onError?.(error, info);
		console.error(
			`[canvas-editor]${this.props.label ? ` ${this.props.label}` : ""} render error (${this.state.errorId ?? "?"})`,
			error,
			info,
		);
	}

	private readonly reset = (): void => {
		this.setState({ error: null, errorId: null });
	};

	private readonly reloadDocument = (): void => {
		this.props.onReloadDocument?.();
		this.reset();
	};

	private readonly copyErrorId = (): void => {
		const id = this.state.errorId;
		if (!id) return;
		void navigator.clipboard?.writeText(id).catch(() => undefined);
	};

	render(): ReactNode {
		const { error, errorId } = this.state;
		if (!error) return this.props.children;
		if (this.props.fallback) return this.props.fallback(error, this.reset);
		const labels = this.props.labels ?? {};
		const buttonClass =
			"rounded-md border border-border px-2 py-1 text-foreground hover:bg-muted";
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
				{errorId ? (
					<p
						data-testid="canvas-error-id"
						className="font-mono text-muted-foreground"
					>
						{errorId}
					</p>
				) : null}
				<div className="flex flex-wrap gap-1.5">
					<button
						type="button"
						data-testid="canvas-error-retry"
						onClick={this.reset}
						className={buttonClass}
					>
						{labels.retry ?? "Try again"}
					</button>
					{this.props.onReloadDocument ? (
						<button
							type="button"
							data-testid="canvas-error-reload"
							onClick={this.reloadDocument}
							className={buttonClass}
						>
							{labels.reloadDocument ?? "Reload document"}
						</button>
					) : null}
					{this.props.onExportRecovery ? (
						<button
							type="button"
							data-testid="canvas-error-export-recovery"
							onClick={this.props.onExportRecovery}
							className={buttonClass}
						>
							{labels.exportRecovery ?? "Export recovery JSON"}
						</button>
					) : null}
					{errorId ? (
						<button
							type="button"
							data-testid="canvas-error-copy-id"
							onClick={this.copyErrorId}
							className={buttonClass}
						>
							{labels.copyErrorId ?? "Copy error ID"}
						</button>
					) : null}
				</div>
			</div>
		);
	}
}
