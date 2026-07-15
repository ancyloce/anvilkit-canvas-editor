import type { CanvasEditorActions } from "../../actions/editor-actions.js";
import type { CanvasStudioStableValue } from "../../context/canvas-studio-context.js";

/**
 * @file Workspace shortcut registry (A-04, PRD 0012 FR-040/§7.5).
 *
 * OWNERSHIP DECISION (PRD 0012 v2): keyboard shortcuts belong to
 * `CanvasWorkspace` — installed by default with the shell, disabled wholesale
 * via `shortcuts={false}`, extended via host bindings. Headless
 * `<CanvasStudio>` embeds keep their existing contract: no global keymap,
 * only the stage-scoped editing keys. The registry listener sits on the
 * WORKSPACE ROOT element (never `window`) and ignores events a lower layer
 * (e.g. the stage-scoped keyboard) already handled via `preventDefault`.
 */

export interface CanvasShortcutCombo {
	/** `KeyboardEvent.key`, compared case-insensitively for letters. */
	key: string;
	/**
	 * When set, match `KeyboardEvent.code` instead of `key` — required for
	 * Shift+digit combos, whose `key` is layout-dependent ("!" on US for
	 * Shift+1) while `code` stays "Digit1".
	 */
	code?: string;
	/** Requires Ctrl (Windows/Linux) or Cmd (macOS). */
	ctrlOrMeta?: boolean;
	shift?: boolean;
	alt?: boolean;
}

export interface CanvasShortcutRunContext {
	stores: CanvasStudioStableValue;
	actions: CanvasEditorActions;
}

export interface CanvasShortcutBinding {
	/** Stable action id (also the dedupe key when hosts override). */
	id: string;
	combos: readonly CanvasShortcutCombo[];
	/** `canvas.shortcut.*` message key + inline English fallback (FR-042). */
	labelKey: string;
	label: string;
	/** Grouping bucket for the shortcut-help dialog (FR-042). */
	category: "edit" | "view" | "tools" | (string & {});
	run(ctx: CanvasShortcutRunContext): void;
}

export interface CanvasShortcutOptions {
	/**
	 * Host bindings appended after the built-ins (FR-042 host-provided
	 * entries). A host binding with an id matching a built-in REPLACES it.
	 */
	extraBindings?: readonly CanvasShortcutBinding[];
}

export type CanvasShortcutPlatform = "mac" | "other";

export function detectShortcutPlatform(
	nav:
		| { platform?: string; userAgent?: string }
		| undefined = typeof navigator === "undefined" ? undefined : navigator,
): CanvasShortcutPlatform {
	const probe = `${nav?.platform ?? ""} ${nav?.userAgent ?? ""}`;
	return /mac|iphone|ipad|ipod/i.test(probe) ? "mac" : "other";
}

/** Exact-modifier combo match (⌘Z must NOT fire for ⌘⇧Z). */
export function matchesCombo(
	e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">,
	combo: CanvasShortcutCombo,
): boolean {
	if (combo.code !== undefined) {
		if ((e as { code?: string }).code !== combo.code) return false;
	} else if (e.key.toLowerCase() !== combo.key.toLowerCase()) {
		return false;
	}
	const wantsCtrlOrMeta = combo.ctrlOrMeta === true;
	if ((e.metaKey || e.ctrlKey) !== wantsCtrlOrMeta) return false;
	if (e.shiftKey !== (combo.shift === true)) return false;
	if (e.altKey !== (combo.alt === true)) return false;
	return true;
}

const MAC_KEY_GLYPHS: Record<string, string> = {
	delete: "⌫",
	backspace: "⌫",
	escape: "⎋",
};

/** Platform-aware display label — generated, never hand-translated (§8.7). */
export function formatShortcut(
	combo: CanvasShortcutCombo,
	platform: CanvasShortcutPlatform,
): string {
	const keyLower = combo.key.toLowerCase();
	if (platform === "mac") {
		const glyphKey =
			MAC_KEY_GLYPHS[keyLower] ??
			(combo.key.length === 1 ? combo.key.toUpperCase() : combo.key);
		return [
			combo.alt ? "⌥" : "",
			combo.shift ? "⇧" : "",
			combo.ctrlOrMeta ? "⌘" : "",
			glyphKey,
		].join("");
	}
	const parts: string[] = [];
	if (combo.ctrlOrMeta) parts.push("Ctrl");
	if (combo.alt) parts.push("Alt");
	if (combo.shift) parts.push("Shift");
	parts.push(combo.key.length === 1 ? combo.key.toUpperCase() : combo.key);
	return parts.join("+");
}

function undoRedo(ctx: CanvasShortcutRunContext, redo: boolean): void {
	const history = ctx.stores.historyStore.getState();
	if (redo ? !history.canRedo() : !history.canUndo()) return;
	const ir = ctx.stores.getIR();
	const next = redo ? history.redo(ir) : history.undo(ir);
	ctx.stores.sceneStore?.getState().setIR(next);
}

/**
 * The built-in FR-040 bindings shipped by A-04. Later Phase-1a tasks extend
 * this list in place: clipboard (A-05), zoom/view (A-07), tools (A-10).
 * NOTE: Lock is `Ctrl/Cmd+Shift+L` — plain `Ctrl+L` is reserved by browsers
 * for address-bar focus and cannot be intercepted reliably (PRD FR-040 note).
 */
export function createCoreShortcutBindings(): CanvasShortcutBinding[] {
	return [
		{
			id: "undo",
			combos: [{ key: "z", ctrlOrMeta: true }],
			labelKey: "canvas.shortcut.undo",
			label: "Undo",
			category: "edit",
			run: (ctx) => undoRedo(ctx, false),
		},
		{
			id: "redo",
			combos: [
				{ key: "z", ctrlOrMeta: true, shift: true },
				{ key: "y", ctrlOrMeta: true },
			],
			labelKey: "canvas.shortcut.redo",
			label: "Redo",
			category: "edit",
			run: (ctx) => undoRedo(ctx, true),
		},
		{
			id: "copy",
			combos: [{ key: "c", ctrlOrMeta: true }],
			labelKey: "canvas.shortcut.copy",
			label: "Copy",
			category: "edit",
			run: (ctx) => {
				void ctx.actions.copySelection();
			},
		},
		{
			id: "cut",
			combos: [{ key: "x", ctrlOrMeta: true }],
			labelKey: "canvas.shortcut.cut",
			label: "Cut",
			category: "edit",
			run: (ctx) => {
				void ctx.actions.cutSelection();
			},
		},
		{
			id: "paste",
			combos: [{ key: "v", ctrlOrMeta: true }],
			labelKey: "canvas.shortcut.paste",
			label: "Paste",
			category: "edit",
			run: (ctx) => {
				void ctx.actions.paste();
			},
		},
		{
			id: "duplicate",
			combos: [{ key: "d", ctrlOrMeta: true }],
			labelKey: "canvas.shortcut.duplicate",
			label: "Duplicate",
			category: "edit",
			run: (ctx) => {
				ctx.actions.duplicateSelection();
			},
		},
		{
			id: "delete",
			combos: [{ key: "Delete" }, { key: "Backspace" }],
			labelKey: "canvas.shortcut.delete",
			label: "Delete selection",
			category: "edit",
			run: (ctx) => {
				ctx.actions.deleteSelection();
			},
		},
		{
			id: "group",
			combos: [{ key: "g", ctrlOrMeta: true }],
			labelKey: "canvas.shortcut.group",
			label: "Group selection",
			category: "edit",
			run: (ctx) => {
				ctx.actions.groupSelection();
			},
		},
		{
			id: "ungroup",
			combos: [{ key: "g", ctrlOrMeta: true, shift: true }],
			labelKey: "canvas.shortcut.ungroup",
			label: "Ungroup selection",
			category: "edit",
			run: (ctx) => {
				ctx.actions.ungroupSelection();
			},
		},
		{
			id: "zoom-in",
			combos: [
				{ key: "=", ctrlOrMeta: true },
				{ key: "+", ctrlOrMeta: true, shift: true },
			],
			labelKey: "canvas.shortcut.zoomIn",
			label: "Zoom in",
			category: "view",
			run: (ctx) => {
				ctx.actions.zoomIn();
			},
		},
		{
			id: "zoom-out",
			combos: [{ key: "-", ctrlOrMeta: true }],
			labelKey: "canvas.shortcut.zoomOut",
			label: "Zoom out",
			category: "view",
			run: (ctx) => {
				ctx.actions.zoomOut();
			},
		},
		{
			id: "zoom-fit",
			combos: [{ key: "1", code: "Digit1", shift: true }],
			labelKey: "canvas.shortcut.zoomToFit",
			label: "Zoom to fit",
			category: "view",
			run: (ctx) => {
				ctx.actions.zoomToFit();
			},
		},
		{
			id: "zoom-selection",
			combos: [{ key: "2", code: "Digit2", shift: true }],
			labelKey: "canvas.shortcut.zoomToSelection",
			label: "Zoom to selection",
			category: "view",
			run: (ctx) => {
				ctx.actions.zoomToSelection();
			},
		},
		{
			id: "zoom-actual",
			combos: [{ key: "0", code: "Digit0", shift: true }],
			labelKey: "canvas.shortcut.actualSize",
			label: "Actual size",
			category: "view",
			run: (ctx) => {
				ctx.actions.resetZoom();
			},
		},
		{
			id: "cancel",
			combos: [{ key: "Escape" }],
			labelKey: "canvas.shortcut.cancel",
			label: "Cancel",
			category: "edit",
			run: (ctx) => {
				ctx.actions.cancel();
			},
		},
		{
			id: "tool-select",
			combos: [{ key: "v" }],
			labelKey: "canvas.tool.select",
			label: "Select",
			category: "tools",
			run: (ctx) => {
				ctx.stores.toolStore.getState().setActiveTool("select");
			},
		},
		{
			id: "tool-hand",
			combos: [{ key: "h" }],
			labelKey: "canvas.tool.hand",
			label: "Hand",
			category: "tools",
			run: (ctx) => {
				ctx.stores.toolStore.getState().setActiveTool("hand");
			},
		},
		{
			id: "tool-frame",
			combos: [{ key: "f" }],
			labelKey: "canvas.tool.frame",
			label: "Frame",
			category: "tools",
			run: (ctx) => {
				ctx.stores.toolStore.getState().setActiveTool("frame");
			},
		},
		{
			id: "tool-rect",
			combos: [{ key: "r" }],
			labelKey: "canvas.tool.rect",
			label: "Rectangle",
			category: "tools",
			run: (ctx) => {
				ctx.stores.toolStore.getState().setActiveTool("rect");
			},
		},
		{
			id: "tool-ellipse",
			combos: [{ key: "o" }],
			labelKey: "canvas.tool.ellipse",
			label: "Ellipse",
			category: "tools",
			run: (ctx) => {
				ctx.stores.toolStore.getState().setActiveTool("ellipse");
			},
		},
		{
			id: "tool-line",
			combos: [{ key: "l" }],
			labelKey: "canvas.tool.line",
			label: "Line",
			category: "tools",
			run: (ctx) => {
				ctx.stores.toolStore.getState().setActiveTool("line");
			},
		},
		{
			id: "tool-path",
			combos: [{ key: "p" }],
			labelKey: "canvas.tool.path",
			label: "Pen",
			category: "tools",
			run: (ctx) => {
				ctx.stores.toolStore.getState().setActiveTool("path");
			},
		},
		{
			id: "tool-text",
			combos: [{ key: "t" }],
			labelKey: "canvas.tool.text",
			label: "Text",
			category: "tools",
			run: (ctx) => {
				ctx.stores.toolStore.getState().setActiveTool("text");
			},
		},
		{
			id: "tool-image",
			combos: [{ key: "i" }],
			labelKey: "canvas.tool.image",
			label: "Image",
			category: "tools",
			run: (ctx) => {
				ctx.stores.toolStore.getState().setActiveTool("image");
			},
		},
		{
			id: "lock",
			combos: [{ key: "l", ctrlOrMeta: true, shift: true }],
			labelKey: "canvas.shortcut.lock",
			label: "Lock / unlock selection",
			category: "edit",
			run: (ctx) => {
				ctx.actions.toggleLockSelection();
			},
		},
	];
}

/** Built-ins merged with host bindings (host id wins over a built-in id). */
export function resolveShortcutBindings(
	options?: CanvasShortcutOptions,
): CanvasShortcutBinding[] {
	const core = createCoreShortcutBindings();
	const extra = options?.extraBindings ?? [];
	const overridden = new Set(extra.map((b) => b.id));
	return [...core.filter((b) => !overridden.has(b.id)), ...extra];
}
