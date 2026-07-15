"use client";

import {
	createToastManager,
	ToastProvider,
	Toasts,
	ToastViewport,
} from "@anvilkit/ui/toast";
import { type ReactNode, useMemo } from "react";
import {
	CanvasToastContext,
	type CanvasToaster,
	type CanvasToastInput,
} from "../../context/toast-context.js";

/**
 * Workspace toast host (A-09): mounts the `@anvilkit/ui/toast` primitive
 * (Base UI manager + viewport) and provides the editor's {@link CanvasToaster}
 * seam so the action layer and panels can fire feedback. One manager per
 * workspace instance — multiple editors on a page don't share stacks.
 * The full FR-170 surface (queueing policies, loading toasts) lands in B-05.
 */
export function CanvasToastHost({
	children,
}: {
	children: ReactNode;
}): React.JSX.Element {
	const manager = useMemo(() => createToastManager(), []);
	const toaster = useMemo<CanvasToaster>(
		() => ({
			add(input: CanvasToastInput) {
				manager.add({
					title: input.title,
					...(input.description !== undefined
						? { description: input.description }
						: {}),
					...(input.type !== undefined ? { type: input.type } : {}),
				});
			},
		}),
		[manager],
	);
	return (
		<CanvasToastContext.Provider value={toaster}>
			<ToastProvider toastManager={manager}>
				{children}
				<ToastViewport data-testid="canvas-toast-viewport">
					<Toasts />
				</ToastViewport>
			</ToastProvider>
		</CanvasToastContext.Provider>
	);
}
