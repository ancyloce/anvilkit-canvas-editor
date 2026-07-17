/**
 * @file §11.1 clipboard adapter contract (PRD 0012). The editor owns
 * selection collection, payload validation/versioning, paste offsetting, and
 * the single-undo-entry command batch (`clipboard-actions.ts`); a
 * host-supplied adapter can override HOW text reaches the platform clipboard
 * (e.g. an Electron/native bridge where the Web Clipboard API isn't
 * available or isn't the right transport). Falls back to
 * `system-clipboard.ts`'s `navigator.clipboard` wrapper when absent — same
 * signatures, same "never throw, degrade to false/null" contract.
 */

export interface CanvasClipboardAdapter {
	/** Read clipboard text, or `null` when unavailable/denied — never throws. */
	read(): Promise<string | null>;
	/** Write clipboard text; resolves `false` on failure — never throws. */
	write(text: string): Promise<boolean>;
}
