"use client";

import { createContext, use } from "react";

export interface CanvasConfirmOptions {
	title: string;
	description?: string;
	confirmLabel?: string;
	cancelLabel?: string;
	/** Style the confirm action as destructive (FR-171 delete flows). */
	destructive?: boolean;
}

/**
 * Minimal dialog seam (B-05, FR-171), mirroring the toaster: the action
 * layer and panels depend on THIS interface; the workspace shell provides a
 * real modal implementation (`CanvasDialogHost`). Headless `<CanvasStudio>`
 * embeds have none and fall back to auto-confirm — the pre-dialog behavior,
 * so no flow ever deadlocks waiting for UI that isn't mounted.
 */
export interface CanvasDialogs {
	confirm(options: CanvasConfirmOptions): Promise<boolean>;
}

export const AUTO_CONFIRM_DIALOGS: CanvasDialogs = {
	confirm: () => Promise.resolve(true),
};

export const CanvasDialogContext = createContext<CanvasDialogs | null>(null);

/** Null-tolerant: resolves to auto-confirm outside a dialog host. */
export function useCanvasDialogs(): CanvasDialogs {
	return use(CanvasDialogContext) ?? AUTO_CONFIRM_DIALOGS;
}
