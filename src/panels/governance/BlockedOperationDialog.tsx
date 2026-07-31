"use client";

import { Button } from "@anvilkit/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@anvilkit/ui/dialog";
// Required binding: this package builds CLASSIC JSX, so `dist` throws
// "React is not defined" without it and typecheck does not catch it.
import * as React from "react";
import { useRef } from "react";

import type { BlockedOperationCode } from "../../brand-governance/effective-policy-context.js";
import { blockedOperationMessage } from "../../brand-governance/effective-policy-context.js";
import type { CanvasT } from "../../context/canvas-studio-context.js";

/**
 * @file Blocked-operation explanation (plan 0021 T-040).
 *
 * ## What this dialog is allowed to say
 *
 * The stable deny code, localized. Nothing else. `CanvasPolicyDecision.detail`
 * is documented as log-only and can name a provider, a library or an
 * administrator — rendering it would turn every denial into an information
 * disclosure about the host's governance setup, to a user who by definition is
 * not trusted with that operation. `blocked-operation-dialog.test.tsx` asserts
 * a decision carrying a hostile `detail` never reaches the DOM.
 *
 * ## Why there is no approval flow
 *
 * T-040 step 3 is explicit: an optional host deep link, never an approval
 * inbox. The editor has no idea who grants an exception or how; a host that
 * knows can wire {@link BlockedOperationDialogProps.onDeepLink} and own that
 * workflow. Without one the dialog just explains and dismisses.
 */

export interface BlockedOperationDialogProps {
	/** Stable deny code — never a message string. */
	code: BlockedOperationCode;
	/**
	 * Optional host escape hatch. When present a "Learn more" action is offered
	 * and the host receives the same stable code; the editor never renders a
	 * URL of its own.
	 */
	onDeepLink?: (code: BlockedOperationCode) => void;
	onClose: () => void;
	t: CanvasT;
}

export function BlockedOperationDialog({
	code,
	onDeepLink,
	onClose,
	t,
}: BlockedOperationDialogProps): React.JSX.Element {
	const dismissRef = useRef<HTMLButtonElement | null>(null);
	const { key, fallback } = blockedOperationMessage(code);

	return (
		<Dialog
			open
			onOpenChange={(open: boolean) => {
				if (!open) onClose();
			}}
		>
			<DialogContent
				// A11Y (T-040): focus lands on the dismiss action — the safe default
				// and the only always-present control. Left to the popup's own
				// autofocus it would land on whichever child is first, today the
				// optional deep link, i.e. the one action that leaves the editor.
				// Declared rather than done in an effect, so it cannot race the
				// popup's own focus management.
				initialFocus={dismissRef}
				className="max-w-sm"
				data-testid="blocked-operation-dialog"
				// The code is exposed as data, not as text: a test (and a host's
				// telemetry) can key on it without anyone parsing localized copy.
				data-policy-code={code}
			>
				<DialogHeader>
					<DialogTitle>
						{t("canvas.governance.blockedTitle", "Not allowed here")}
					</DialogTitle>
				</DialogHeader>
				<p
					className="text-sm text-muted-foreground"
					data-testid="blocked-operation-reason"
				>
					{t(key, fallback)}
				</p>
				<DialogFooter>
					{onDeepLink ? (
						<Button
							variant="ghost"
							size="sm"
							data-testid="blocked-operation-learn-more"
							onClick={() => onDeepLink(code)}
						>
							{t("canvas.governance.blockedLearnMore", "Learn more")}
						</Button>
					) : null}
					<Button
						ref={dismissRef}
						size="sm"
						data-testid="blocked-operation-dismiss"
						onClick={onClose}
					>
						{t("canvas.governance.blockedDismiss", "OK")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
