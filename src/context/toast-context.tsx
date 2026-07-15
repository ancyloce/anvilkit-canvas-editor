"use client";

import { createContext, use } from "react";

export type CanvasToastType =
	| "success"
	| "info"
	| "warning"
	| "error"
	| "loading";

export interface CanvasToastInput {
	title: string;
	description?: string;
	type?: CanvasToastType;
}

/**
 * Minimal toast seam the ACTION LAYER can depend on (A-09). Lives in
 * `context/` (interaction-core) with no UI-primitive dependency so
 * `actions/` can fire feedback without importing workspace chrome. The
 * workspace shell provides a real implementation (`CanvasToastHost`, backed
 * by `@anvilkit/ui/toast`); headless `<CanvasStudio>` embeds have none and
 * fall back to a silent no-op — feedback is a shell concern.
 */
export interface CanvasToaster {
	add(input: CanvasToastInput): void;
}

export const NOOP_CANVAS_TOASTER: CanvasToaster = {
	add() {
		/* headless: no toast host mounted */
	},
};

export const CanvasToastContext = createContext<CanvasToaster | null>(null);

/** Null-tolerant: resolves to the no-op toaster outside a toast host. */
export function useCanvasToaster(): CanvasToaster {
	return use(CanvasToastContext) ?? NOOP_CANVAS_TOASTER;
}
