"use client";

/**
 * @file Tab Panel registry for the Canva-shell.
 *
 * Maps each {@link DockId} to a descriptor the `TabPanel` knows how to render.
 * Four descriptor kinds cover the required extensibility (PRD §1.3.4):
 * - `builtin` — a local component (layers / brand / elements are wired today)
 * - `plugin`  — a host/plugin-supplied React node
 * - `remote`  — async data; the `TabPanel` renders loading/error/empty/data
 * - `search`  — categorized + searchable content
 *
 * Hosts extend or replace entries via {@link createCanvasPanelRegistry}.
 */

import type { ReactNode } from "react";
import { BrandPanel } from "../panels/BrandPanel.js";
import { ElementsPanel } from "../panels/ElementsPanel.js";
import { LayerPanel } from "../panels/LayerPanel.js";
import type { DockId } from "./dock-ids.js";

export interface CanvasPanelContext {
	/** Current Tab Panel search query (from the workspace UI store). */
	readonly search: string;
}

interface PanelDescriptorBase {
	readonly id: DockId;
	readonly title: string;
	/** Show the Tab Panel search box for this panel. */
	readonly searchable?: boolean;
}

export interface BuiltinPanelDescriptor extends PanelDescriptorBase {
	readonly kind: "builtin";
	readonly render: (ctx: CanvasPanelContext) => ReactNode;
}

export interface PluginPanelDescriptor extends PanelDescriptorBase {
	readonly kind: "plugin";
	/** Host/plugin-rendered panel body. */
	readonly slot: ReactNode;
}

export interface RemotePanelDescriptor<T = unknown>
	extends PanelDescriptorBase {
	readonly kind: "remote";
	/** Fetch the data; the `TabPanel` handles loading/error/empty states. */
	readonly load: (ctx: CanvasPanelContext) => Promise<T>;
	readonly render: (data: T, ctx: CanvasPanelContext) => ReactNode;
	/** Treat the result as the empty state (e.g. an empty array). */
	readonly isEmpty?: (data: T) => boolean;
}

export interface SearchPanelDescriptor extends PanelDescriptorBase {
	readonly kind: "search";
	readonly categories?: readonly string[];
	readonly render: (
		ctx: CanvasPanelContext & { category: string },
	) => ReactNode;
}

export type CanvasPanelDescriptor =
	| BuiltinPanelDescriptor
	| PluginPanelDescriptor
	| RemotePanelDescriptor
	| SearchPanelDescriptor;

export type CanvasPanelRegistry = Partial<
	Record<DockId, CanvasPanelDescriptor>
>;

function stubPanel(
	id: DockId,
	title: string,
	message: string,
): BuiltinPanelDescriptor {
	return {
		kind: "builtin",
		id,
		title,
		render: () => (
			<div
				data-testid={`panel-stub-${id}`}
				className="p-4 text-xs text-muted-foreground italic"
			>
				{message}
			</div>
		),
	};
}

/**
 * Built-in panels wired to existing components (layers / brand / elements);
 * the rest are registration stubs awaiting their own content (PRD §1.3.4).
 */
export const defaultCanvasPanelRegistry: CanvasPanelRegistry = {
	elements: {
		kind: "builtin",
		id: "elements",
		title: "Elements",
		searchable: true,
		render: ({ search }) => <ElementsPanel search={search} />,
	},
	brand: {
		kind: "builtin",
		id: "brand",
		title: "Brand kit",
		render: () => <BrandPanel />,
	},
	layers: {
		kind: "builtin",
		id: "layers",
		title: "Layers",
		render: () => <LayerPanel />,
	},
	templates: stubPanel("templates", "Templates", "Templates coming soon."),
	ai: stubPanel("ai", "AI", "AI tools coming soon."),
	text: stubPanel("text", "Text", "Text presets coming soon."),
	uploads: stubPanel("uploads", "Uploads", "Upload assets coming soon."),
};

/** Merge host overrides over the defaults (override wins per dock id). */
export function createCanvasPanelRegistry(
	overrides?: CanvasPanelRegistry,
): CanvasPanelRegistry {
	return { ...defaultCanvasPanelRegistry, ...overrides };
}
