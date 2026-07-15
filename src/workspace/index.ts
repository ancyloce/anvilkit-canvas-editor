export { DOCK_IDS, type DockId } from "./dock-ids.js";
export * from "./layout/index.js";
export {
	type BuiltinPanelDescriptor,
	type CanvasPanelContext,
	type CanvasPanelDescriptor,
	type CanvasPanelRegistry,
	createCanvasPanelRegistry,
	defaultCanvasPanelRegistry,
	type PluginPanelDescriptor,
	type RemotePanelDescriptor,
	type SearchPanelDescriptor,
} from "./panel-registry.js";
// Workspace shortcut registry (A-04, FR-040): binding/combo types + platform
// label helpers for hosts extending `<CanvasWorkspace shortcuts>`.
export {
	type CanvasShortcutBinding,
	type CanvasShortcutCombo,
	type CanvasShortcutOptions,
	type CanvasShortcutPlatform,
	type CanvasShortcutRunContext,
	createCoreShortcutBindings,
	detectShortcutPlatform,
	formatShortcut,
	resolveShortcutBindings,
} from "./shortcuts/shortcut-registry.js";
export * from "./state/index.js";
export { DOCK_ITEMS, type DockItem } from "./workspace-config.js";
