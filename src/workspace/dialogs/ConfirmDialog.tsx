"use client";

import { Button } from "@anvilkit/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@anvilkit/ui/dialog";
import { useCanvasT } from "../../context/canvas-studio-context.js";
import type { CanvasConfirmOptions } from "../../context/dialog-context.js";

export interface ConfirmDialogProps {
	request: CanvasConfirmOptions;
	onClose: (confirmed: boolean) => void;
}

/**
 * The workspace's standard confirm dialog (B-05, FR-171), built on
 * `@anvilkit/ui/dialog` (Base UI: focus trap, Escape-close, backdrop).
 * Loaded LAZILY by `CanvasDialogHost` — dialog-class UI is code-split per
 * PRD 0012 constraint 20.15.
 */
export default function ConfirmDialog({
	request,
	onClose,
}: ConfirmDialogProps): React.JSX.Element {
	const t = useCanvasT();
	return (
		<Dialog open onOpenChange={(open) => !open && onClose(false)}>
			<DialogContent data-testid="canvas-confirm-dialog">
				<DialogHeader>
					<DialogTitle>{request.title}</DialogTitle>
					{request.description !== undefined ? (
						<DialogDescription>{request.description}</DialogDescription>
					) : null}
				</DialogHeader>
				<DialogFooter>
					<Button
						type="button"
						variant="outline"
						data-testid="canvas-confirm-cancel"
						onClick={() => onClose(false)}
					>
						{request.cancelLabel ?? t("canvas.dialog.cancel", "Cancel")}
					</Button>
					<Button
						type="button"
						variant={request.destructive ? "destructive" : "default"}
						data-testid="canvas-confirm-accept"
						onClick={() => onClose(true)}
					>
						{request.confirmLabel ?? t("canvas.dialog.confirm", "Confirm")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
