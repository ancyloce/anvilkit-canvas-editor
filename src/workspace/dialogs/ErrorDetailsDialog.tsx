"use client";

import { Button } from "@anvilkit/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@anvilkit/ui/dialog";
import { useCanvasT } from "../../context/canvas-studio-context.js";

export interface ErrorDetailsDialogProps {
	error: Error;
	errorId: string | null;
	/** React's component stack, captured by `componentDidCatch` (may lag one render). */
	componentStack: string | null;
	onClose: () => void;
	/** Reuses `CanvasErrorBoundary`'s own reload handler verbatim — omit to hide the action. */
	onReloadDocument?: () => void;
	/** Reuses `CanvasErrorBoundary`'s own export handler verbatim — omit to hide the action. */
	onExportRecovery?: () => void;
	/** Reuses `CanvasErrorBoundary`'s own copy-id handler verbatim — omit to hide the action. */
	onCopyErrorId?: () => void;
}

/**
 * FR-171 "Error details" dialog: the full-detail counterpart to
 * `CanvasErrorBoundary`'s always-visible inline summary (FR-172). Opened
 * ONLY from the boundary's "View details" action, which itself only renders
 * while the boundary holds an active error — there is no route to this
 * dialog with nothing to show. Every action here delegates to the exact
 * handler the boundary already exposes; this component adds no new
 * recovery logic of its own. Stack traces use the native `<details>`
 * disclosure (no accordion/collapsible primitive exists in `@anvilkit/ui`)
 * so expand/collapse is keyboard-operable for free. Lazy-loaded like every
 * dialog-class surface (constraint 20.15).
 */
export default function ErrorDetailsDialog({
	error,
	errorId,
	componentStack,
	onClose,
	onReloadDocument,
	onExportRecovery,
	onCopyErrorId,
}: ErrorDetailsDialogProps): React.JSX.Element {
	const t = useCanvasT();
	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent data-testid="canvas-error-details-dialog">
				<DialogHeader>
					<DialogTitle>
						{t("canvas.error.detailsTitle", "Error details")}
					</DialogTitle>
				</DialogHeader>
				<div className="flex max-h-96 flex-col gap-3 overflow-y-auto text-xs">
					{errorId ? (
						<div className="flex flex-wrap items-center gap-2">
							<span className="font-medium text-muted-foreground">
								{t("canvas.error.idLabel", "Error ID")}
							</span>
							<span data-testid="canvas-error-details-id" className="font-mono">
								{errorId}
							</span>
							{onCopyErrorId ? (
								<Button
									type="button"
									size="sm"
									variant="outline"
									data-testid="canvas-error-details-copy-id"
									onClick={onCopyErrorId}
								>
									{t("canvas.error.copyErrorId", "Copy error ID")}
								</Button>
							) : null}
						</div>
					) : null}
					<div className="flex flex-col gap-1">
						<span className="font-medium text-muted-foreground">
							{t("canvas.error.messageLabel", "Message")}
						</span>
						<p
							data-testid="canvas-error-details-message"
							className="break-words rounded border border-border bg-muted p-2 font-mono"
						>
							{error.message}
						</p>
					</div>
					{error.stack ? (
						<details data-testid="canvas-error-details-stack">
							<summary className="cursor-pointer font-medium text-muted-foreground">
								{t("canvas.error.stackTrace", "Stack trace")}
							</summary>
							<pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words rounded border border-border bg-muted p-2 font-mono">
								{error.stack}
							</pre>
						</details>
					) : null}
					{componentStack ? (
						<details data-testid="canvas-error-details-component-stack">
							<summary className="cursor-pointer font-medium text-muted-foreground">
								{t("canvas.error.componentStack", "Component stack")}
							</summary>
							<pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words rounded border border-border bg-muted p-2 font-mono">
								{componentStack}
							</pre>
						</details>
					) : null}
				</div>
				<DialogFooter>
					{onReloadDocument ? (
						<Button
							type="button"
							variant="outline"
							data-testid="canvas-error-details-reload"
							onClick={onReloadDocument}
						>
							{t("canvas.error.reloadDocument", "Reload document")}
						</Button>
					) : null}
					{onExportRecovery ? (
						<Button
							type="button"
							variant="outline"
							data-testid="canvas-error-details-export-recovery"
							onClick={onExportRecovery}
						>
							{t("canvas.error.exportRecovery", "Export recovery JSON")}
						</Button>
					) : null}
					<Button
						type="button"
						data-testid="canvas-error-details-close"
						onClick={onClose}
					>
						{t("canvas.dialog.close", "Close")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
