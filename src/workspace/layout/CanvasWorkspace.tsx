"use client";

import { Button } from "@anvilkit/ui/button";
import { cn } from "@anvilkit/ui/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { type ReactNode, useMemo, useRef } from "react";
import { ToolAnnouncer } from "@/a11y/ToolAnnouncer.js";
import { useCanvasT } from "@/context/canvas-studio-context.js";
import { PropertyInspector } from "@/panels/PropertyInspector.js";
// CanvasStudio's relative path (not @/): CanvasStudioProps surfaces in the
// emitted .d.ts and rslib rewrites alias paths only in .js, not declarations.
import { CanvasStudio, type CanvasStudioProps } from "../../CanvasStudio.js";
// Relative (not @/): this type also surfaces in the emitted .d.ts.
import type { CanvasHeaderPlugin } from "../../header/types.js";
import { CanvasDialogHost } from "../dialogs/CanvasDialogHost.js";
import { CanvasAreaContextMenu } from "../menus/CanvasAreaContextMenu.js";
import {
	type CanvasPanelRegistry,
	createCanvasPanelRegistry,
} from "../panel-registry.js";
// Relative (not @/): CanvasShortcutOptions surfaces in the emitted .d.ts.
import type { CanvasShortcutOptions } from "../shortcuts/shortcut-registry.js";
import { WorkspaceShortcutLayer } from "../shortcuts/WorkspaceShortcutLayer.js";
import { useInspectorCollapsed } from "../state/hooks.js";
import { WorkspaceUiStoreProvider } from "../state/WorkspaceUiStoreProvider.js";
import { CanvasToastHost } from "../toasts/CanvasToastHost.js";
import { ToolStrip } from "../toolstrip/ToolStrip.js";
import { CanvasDropZone } from "../uploads/CanvasDropZone.js";
import type { DockItem } from "../workspace-config.js";
import { CanvasToolbar } from "./CanvasToolbar.js";
import type { ElementActions } from "./ElementControls.js";
import { PagesCanvas } from "./PagesCanvas.js";
import { PanelDock } from "./PanelDock.js";
import { TabPanel } from "./TabPanel.js";
import { WorkspaceFooter } from "./WorkspaceFooter.js";
import { WorkspaceHeader } from "./WorkspaceHeader.js";

export interface CanvasWorkspaceProps
	extends Omit<CanvasStudioProps, "renderShell"> {
	/** Namespaces the persisted UI slice. Pass a per-design id to isolate state. */
	storeId?: string;
	/** Header back action (hidden when omitted). */
	onBack?: () => void;
	/** Controlled document title (defaults to `ir.title`). */
	title?: string;
	/** Commit a rename; makes the header name click-to-edit when provided. */
	onTitleChange?: (next: string) => void;
	/** Collaborator avatars slot, rendered in the header. */
	avatarsSlot?: ReactNode;
	/**
	 * Header plugins rendered in the header's right cluster. Pass the built-in
	 * export popover via {@link createCanvasExportPlugin}.
	 */
	headerPlugins?: readonly CanvasHeaderPlugin[];
	/** Share / Export / Publish slot, rendered in the header. */
	shareSlot?: ReactNode;
	/** Panel Dock entries, in order. Defaults to {@link DockItem}[] config. */
	dockItems?: readonly DockItem[];
	/** Tab Panel registry overrides merged over the defaults. */
	panels?: CanvasPanelRegistry;
	/** Render the right `PropertyInspector` column. Defaults to `true`. */
	inspector?: boolean;
	/** Optional host handlers for the Element Controls "more" menu (§2). */
	elementActions?: ElementActions;
	/**
	 * Workspace shortcut registry (A-04, FR-040). Default `true` — the shell
	 * installs the built-in bindings on its root element. `false` disables
	 * every workspace shortcut; an options object extends/overrides bindings.
	 * Headless `<CanvasStudio>` embeds are unaffected either way (they never
	 * mount this registry).
	 */
	shortcuts?: boolean | CanvasShortcutOptions;
	/**
	 * The floating tool strip (B-06, FR-010). Default `true`; `false` hides it
	 * (hosts with their own tool chrome keep the pre-M2 canvas untouched).
	 */
	toolStrip?: boolean;
}

/**
 * The Canva-style editor shell: full-width Header · Aside (Panel Dock + Tab
 * Panel) · Canvas (dynamic Toolbar + Page with floating Element Controls) ·
 * full-width Footer. Composed over the headless `<CanvasStudio>` via its
 * `renderShell` seam; UI state lives in a per-instance Zustand store provided
 * here. This is the editor's single top-level shell.
 */
export function CanvasWorkspace({
	storeId = "default",
	onBack,
	title,
	onTitleChange,
	avatarsSlot,
	headerPlugins,
	shareSlot,
	dockItems,
	panels,
	inspector = true,
	elementActions,
	shortcuts = true,
	toolStrip = true,
	...studioProps
}: CanvasWorkspaceProps): React.JSX.Element {
	const registry = useMemo(() => createCanvasPanelRegistry(panels), [panels]);
	const rootRef = useRef<HTMLDivElement | null>(null);

	return (
		<CanvasStudio
			{...studioProps}
			renderShell={(stage) => (
				<WorkspaceUiStoreProvider storeId={storeId}>
					<CanvasToastHost>
						<CanvasDialogHost>
							<div
								ref={rootRef}
								data-ak-canvas-editor=""
								data-testid="canvas-workspace-root"
								className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-background text-foreground"
							>
								{shortcuts !== false ? (
									<WorkspaceShortcutLayer
										rootRef={rootRef}
										options={shortcuts === true ? undefined : shortcuts}
									/>
								) : null}
								<ToolAnnouncer />
								<WorkspaceHeader
									onBack={onBack}
									title={title}
									onTitleChange={onTitleChange}
									avatarsSlot={avatarsSlot}
									plugins={headerPlugins}
									shareSlot={shareSlot}
								/>
								<div className="grid min-h-0 grid-cols-[auto_280px_minmax(0,1fr)_auto]">
									<PanelDock items={dockItems} />
									<TabPanel registry={registry} />
									{/* Main canvas: a neutral gray surface (theme-adaptive — light
							    gray in light mode, charcoal in dark) so the white pages pop.
							    Holds the floating toolbar, the scrollable multi-page stack
							    (PagesCanvas owns the viewport + fit-on-entry zoom), and the
							    footer pinned inside it. */}
									<section className="relative flex min-h-0 min-w-0 flex-col bg-neutral-200 dark:bg-neutral-800">
										<CanvasAreaContextMenu>
											<CanvasDropZone>
												{/* Fixed overlays — float over the canvas, never shift it. */}
												{toolStrip ? <ToolStrip /> : null}
												<CanvasToolbar />
												<PagesCanvas
													stage={stage}
													elementActions={elementActions}
												/>
												<WorkspaceFooter className="absolute inset-x-0 bottom-0 z-20 border-t border-border bg-card/95 backdrop-blur" />
											</CanvasDropZone>
										</CanvasAreaContextMenu>
									</section>
									{inspector ? <WorkspaceInspector /> : null}
								</div>
							</div>
						</CanvasDialogHost>
					</CanvasToastHost>
				</WorkspaceUiStoreProvider>
			)}
		/>
	);
}

/**
 * Right inspector column. Collapsible via the workspace UI store — collapsed,
 * it shrinks to a toggle strip so `PropertyInspector` can be reopened.
 */
function WorkspaceInspector(): React.JSX.Element {
	const [collapsed, setCollapsed] = useInspectorCollapsed();
	const t = useCanvasT();
	return (
		<aside
			data-testid="workspace-inspector"
			data-collapsed={collapsed ? "true" : "false"}
			className={cn(
				"flex h-full min-h-0 flex-col border-l border-border bg-card",
				collapsed ? "w-9" : "w-[300px]",
			)}
		>
			<div className="flex h-11 shrink-0 items-center justify-end border-b border-border px-1.5">
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					data-testid="workspace-inspector-toggle"
					aria-label={
						collapsed
							? t("canvas.inspector.expand", "Expand inspector")
							: t("canvas.inspector.collapse", "Collapse inspector")
					}
					aria-expanded={!collapsed}
					title={
						collapsed
							? t("canvas.inspector.expandShort", "Expand")
							: t("canvas.inspector.collapseShort", "Collapse")
					}
					onClick={() => setCollapsed(!collapsed)}
				>
					{collapsed ? (
						<ChevronLeft aria-hidden />
					) : (
						<ChevronRight aria-hidden />
					)}
				</Button>
			</div>
			{collapsed ? null : (
				<div className="min-h-0 flex-1 overflow-y-auto">
					<PropertyInspector />
				</div>
			)}
		</aside>
	);
}
