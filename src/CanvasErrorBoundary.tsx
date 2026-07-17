"use client";

import { Component, type ErrorInfo, type ReactNode, Suspense } from "react";

/** Localizable labels for the default fallback (FR-172). */
export interface CanvasErrorBoundaryLabels {
	retry?: string;
	reloadDocument?: string;
	exportRecovery?: string;
	copyErrorId?: string;
	/** FR-171 "View details": opens the full error-details dialog. */
	viewDetails?: string;
}

/**
 * FR-171: everything a caller-supplied `renderErrorDetails` needs to render
 * the full error-details dialog. `CanvasErrorBoundary` is a leaf module (see
 * this file's module doc below) — it cannot import the dialog itself, so it
 * hands this bundle to whichever ancestor CAN legally reach dialog-class UI.
 */
export interface CanvasErrorDetailsInfo {
	error: Error;
	errorId: string | null;
	/** React's component stack, captured by `componentDidCatch` (may lag one render). */
	componentStack: string | null;
	/** Closes the details dialog only — the inline boundary fallback stays up. */
	onClose: () => void;
	/** Present only when the boundary itself received `onReloadDocument`. */
	onReloadDocument?: () => void;
	/** Present only when the boundary itself received `onExportRecovery`. */
	onExportRecovery?: () => void;
	/** Present only while an error id exists. */
	onCopyErrorId?: () => void;
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
	/**
	 * FR-171 "View details": renders the full error-details dialog when the
	 * boundary's "View details" action is triggered. `CanvasErrorBoundary` is
	 * a leaf module (see this file's module doc) and cannot import dialog-class
	 * UI itself, so the actual dialog is composed by whichever ancestor CAN
	 * legally reach it (e.g. `<CanvasWorkspace>` / `<TabPanel>`, which import
	 * `ErrorDetailsDialog` and hand it down through this prop). Omit it and the
	 * "View details" button itself is hidden — there is nothing dead to click
	 * (e.g. a headless `<CanvasStudio>` mounted without `<CanvasWorkspace>`'s
	 * shell has no dialog surface to open one into).
	 */
	renderErrorDetails?: (info: CanvasErrorDetailsInfo) => ReactNode;
}

interface CanvasErrorBoundaryState {
	error: Error | null;
	/** FR-172: correlates a user report with host telemetry (see `onError`). */
	errorId: string | null;
	/**
	 * React's component stack (FR-171 detail dialog). `getDerivedStateFromError`
	 * doesn't receive it, so it starts null and is filled in by
	 * `componentDidCatch` one render later.
	 */
	componentStack: string | null;
	/** FR-171: the full-detail error dialog is open. */
	detailsOpen: boolean;
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
	state: CanvasErrorBoundaryState = {
		error: null,
		errorId: null,
		componentStack: null,
		detailsOpen: false,
	};

	static getDerivedStateFromError(error: Error): CanvasErrorBoundaryState {
		return {
			error,
			errorId: mintErrorId(),
			componentStack: null,
			detailsOpen: false,
		};
	}

	componentDidUpdate(prev: CanvasErrorBoundaryProps): void {
		// Auto-recover when the caller's reset key changes (e.g. page/panel switch).
		if (this.state.error && prev.resetKey !== this.props.resetKey) {
			this.setState({
				error: null,
				errorId: null,
				componentStack: null,
				detailsOpen: false,
			});
		}
	}

	componentDidCatch(error: Error, info: ErrorInfo): void {
		this.props.onError?.(error, info);
		this.setState({ componentStack: info.componentStack ?? null });
		console.error(
			`[canvas-editor]${this.props.label ? ` ${this.props.label}` : ""} render error (${this.state.errorId ?? "?"})`,
			error,
			info,
		);
	}

	private readonly reset = (): void => {
		this.setState({
			error: null,
			errorId: null,
			componentStack: null,
			detailsOpen: false,
		});
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

	/** FR-171: opens the full error-details dialog. Only reachable from the
	 * fallback UI below, which itself only renders while an error is active —
	 * there is no route to the dialog with nothing to show. */
	private readonly openDetails = (): void => {
		this.setState({ detailsOpen: true });
	};

	private readonly closeDetails = (): void => {
		this.setState({ detailsOpen: false });
	};

	render(): ReactNode {
		const { error, errorId, componentStack, detailsOpen } = this.state;
		if (!error) return this.props.children;
		if (this.props.fallback) return this.props.fallback(error, this.reset);
		const labels = this.props.labels ?? {};
		const buttonClass =
			"rounded-md border border-border px-2 py-1 text-foreground hover:bg-muted";
		return (
			<>
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
						{/* FR-171: full-detail dialog. Always alongside the inline summary
						    above (never a replacement for it), and — since this button only
						    exists inside the `!error` early-return above — never reachable
						    with nothing to show. Hidden entirely when no ancestor supplied
						    `renderErrorDetails` (see this component's module doc): there is
						    no dead trigger, it just doesn't exist. */}
						{this.props.renderErrorDetails ? (
							<button
								type="button"
								data-testid="canvas-error-view-details"
								onClick={this.openDetails}
								className={buttonClass}
							>
								{labels.viewDetails ?? "View details"}
							</button>
						) : null}
					</div>
				</div>
				{detailsOpen && this.props.renderErrorDetails ? (
					<Suspense fallback={null}>
						{this.props.renderErrorDetails({
							error,
							errorId,
							componentStack,
							onClose: this.closeDetails,
							...(this.props.onReloadDocument
								? { onReloadDocument: this.reloadDocument }
								: {}),
							...(this.props.onExportRecovery
								? { onExportRecovery: this.props.onExportRecovery }
								: {}),
							...(errorId ? { onCopyErrorId: this.copyErrorId } : {}),
						})}
					</Suspense>
				) : null}
			</>
		);
	}
}
