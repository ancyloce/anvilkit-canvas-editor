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
export * from "./state/index.js";
export { DOCK_ITEMS, type DockItem } from "./workspace-config.js";
