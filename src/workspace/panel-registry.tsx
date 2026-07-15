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
import { useCanvasT } from "../context/canvas-studio-context.js";
import { BrandPanel } from "../panels/BrandPanel.js";
import { ElementsPanel } from "../panels/ElementsPanel.js";
import { LayerPanel } from "../panels/LayerPanel.js";
import { TemplatesPanel } from "../panels/TemplatesPanel.js";
import type { DockId } from "./dock-ids.js";
import { UploadsPanel } from "./uploads/UploadsPanel.js";

export interface CanvasPanelContext {
	/** Current Tab Panel search query (from the workspace UI store). */
	readonly search: string;
}

interface PanelDescriptorBase {
	readonly id: DockId;
	/** i18n key resolved by the `TabPanel` (`t(titleKey, title)`). Optional so
	 * host-supplied descriptors can still pass a plain `title`. */
	readonly titleKey?: string;
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

/** Stub-panel body. A component (not inline JSX) so it can resolve the localized
 * message via `useCanvasT` — the stub `render` runs inside the `TabPanel`, which
 * mounts under the editor context. */
function StubBody({
	id,
	messageKey,
	message,
}: {
	id: DockId;
	messageKey: string;
	message: string;
}): React.JSX.Element {
	const t = useCanvasT();
	return (
		<div
			data-testid={`panel-stub-${id}`}
			className="p-4 text-xs text-muted-foreground italic"
		>
			{t(messageKey, message)}
		</div>
	);
}

/**
 * "Coming soon" panel body. NOTE (M0-08): the `ai` and `text` stub entries
 * below stay registered so host registry overrides and the `DockId` union
 * remain stable, but their tabs are HIDDEN from the default rail
 * (`HIDDEN_DOCK_IDS` in `dock-ids.ts`) until the features exist. `uploads`
 * remains visible — it is filled by the asset-upload work in the next
 * milestone (PRD 0012 FR-091/092).
 */
function stubPanel(
	id: DockId,
	titleKey: string,
	title: string,
	messageKey: string,
	message: string,
): BuiltinPanelDescriptor {
	return {
		kind: "builtin",
		id,
		titleKey,
		title,
		render: () => (
			<StubBody id={id} messageKey={messageKey} message={message} />
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
		titleKey: "canvas.panel.elements",
		title: "Elements",
		searchable: true,
		render: ({ search }) => <ElementsPanel search={search} />,
	},
	brand: {
		kind: "builtin",
		id: "brand",
		titleKey: "canvas.panel.brandKit",
		title: "Brand kit",
		render: () => <BrandPanel />,
	},
	layers: {
		kind: "builtin",
		id: "layers",
		titleKey: "canvas.panel.layers",
		title: "Layers",
		render: () => <LayerPanel />,
	},
	templates: {
		kind: "builtin",
		id: "templates",
		titleKey: "canvas.panel.templates",
		title: "Templates",
		render: () => <TemplatesPanel />,
	},
	ai: stubPanel(
		"ai",
		"canvas.panel.ai",
		"AI",
		"canvas.panel.aiSoon",
		"AI tools coming soon.",
	),
	text: stubPanel(
		"text",
		"canvas.panel.text",
		"Text",
		"canvas.panel.textSoon",
		"Text presets coming soon.",
	),
	uploads: {
		kind: "builtin",
		id: "uploads",
		titleKey: "canvas.panel.uploads",
		title: "Uploads",
		render: () => <UploadsPanel />,
	},
};

/** Merge host overrides over the defaults (override wins per dock id). */
export function createCanvasPanelRegistry(
	overrides?: CanvasPanelRegistry,
): CanvasPanelRegistry {
	return { ...defaultCanvasPanelRegistry, ...overrides };
}
