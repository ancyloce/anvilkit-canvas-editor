/**
 * Async system-clipboard adapter (A-05, FR-021). `navigator.clipboard` needs
 * a secure context and user permission; every failure mode (missing API,
 * permission denied, Safari's transient-activation rules) degrades SILENTLY
 * to `false`/`null` so callers fall back to the internal clipboard store —
 * clipboard trouble must never break copy/paste.
 */

function clipboardOrNull(): Clipboard | null {
	const nav = (globalThis as { navigator?: Navigator }).navigator;
	return nav?.clipboard ?? null;
}

export async function writeSystemClipboard(text: string): Promise<boolean> {
	const clipboard = clipboardOrNull();
	if (!clipboard || typeof clipboard.writeText !== "function") return false;
	try {
		await clipboard.writeText(text);
		return true;
	} catch {
		return false;
	}
}

export async function readSystemClipboard(): Promise<string | null> {
	const clipboard = clipboardOrNull();
	if (!clipboard || typeof clipboard.readText !== "function") return null;
	try {
		return await clipboard.readText();
	} catch {
		return null;
	}
}
