"use client";

import { Button } from "@anvilkit/ui/button";
import { cn } from "@anvilkit/ui/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";
import * as React from "react";
import { lazy, type ReactNode, useEffect, useMemo, useRef } from "react";
import { ToolAnnouncer } from "@/a11y/ToolAnnouncer.js";
import type { CanvasErrorDetailsInfo } from "@/CanvasErrorBoundary.js";
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
import {
	useInspectorCollapsed,
	usePanelOpen,
	usePanelWidth,
} from "../state/hooks.js";
import {
	COLLAPSE_INSPECTOR_QUERY,
	OVERLAY_PANEL_QUERY,
	useMediaQuery,
} from "../state/use-media-query.js";
import {
	RecentTemplatesBridge,
	WorkspaceUiStoreProvider,
} from "../state/WorkspaceUiStoreProvider.js";
import {
	type CanvasWorkspaceState,
	PANEL_WIDTH_DEFAULT,
	PANEL_WIDTH_MAX,
	PANEL_WIDTH_MIN,
} from "../state/workspace-ui-store.js";
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

// FR-171 error-details dialog (B-15): CODE-SPLIT (PRD 0012 constraint
// 20.15), same as every other dialog-class surface — the chunk loads only
// when "View details" is actually clicked, not with the editor bundle.
const ErrorDetailsDialog = lazy(
	() => import("../dialogs/ErrorDetailsDialog.js"),
);

/**
 * FR-171 composition seam: `<CanvasErrorBoundary>` is a leaf module (see
 * `scripts/check-layering.mjs`) and cannot import `workspace/dialogs/`
 * itself, so the shell supplies the actual dialog here and threads it down
 * through `<CanvasStudio renderErrorDetails>`. Always wired — see the
 * `renderErrorDetails` omission from {@link CanvasWorkspaceProps} below.
 */
function renderErrorDetails(info: CanvasErrorDetailsInfo): ReactNode {
	return (
		<ErrorDetailsDialog
			error={info.error}
			errorId={info.errorId}
			componentStack={info.componentStack}
			onClose={info.onClose}
			{...(info.onReloadDocument
				? { onReloadDocument: info.onReloadDocument }
				: {})}
			{...(info.onExportRecovery
				? { onExportRecovery: info.onExportRecovery }
				: {})}
			{...(info.onCopyErrorId ? { onCopyErrorId: info.onCopyErrorId } : {})}
		/>
	);
}

export interface CanvasWorkspaceProps
	extends Omit<CanvasStudioProps, "renderShell" | "renderErrorDetails"> {
	/** Namespaces the persisted UI slice. Pass a per-design id to isolate state. */
	storeId?: string;
	/**
	 * PRD §11.1 seed for a FRESH workspace mount (no prior `localStorage` value
	 * for `storeId`). An existing persisted layout always wins over this seed
	 * for the persisted fields (`activeDockId`/`inspectorCollapsed`/
	 * `panelWidth`/`recentTemplateIds`) — see
	 * `workspace/state/workspace-ui-store.ts`'s
	 * `CreateWorkspaceUiStoreOptions.initialWorkspaceState` for the full
	 * precedence rule. Read only on first render, like `storeId`.
	 */
	initialWorkspaceState?: Partial<CanvasWorkspaceState>;
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
	initialWorkspaceState,
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
			renderErrorDetails={renderErrorDetails}
			renderShell={(stage) => (
				<WorkspaceUiStoreProvider
					storeId={storeId}
					initialWorkspaceState={initialWorkspaceState}
				>
					<RecentTemplatesBridge>
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
										shortcuts={shortcuts}
										plugins={headerPlugins}
										shareSlot={shareSlot}
									/>
									<WorkspaceBody
										stage={stage}
										dockItems={dockItems}
										registry={registry}
										inspector={inspector}
										toolStrip={toolStrip}
										elementActions={elementActions}
									/>
								</div>
							</CanvasDialogHost>
						</CanvasToastHost>
					</RecentTemplatesBridge>
				</WorkspaceUiStoreProvider>
			)}
		/>
	);
}

/**
 * The dockable middle band (B-14, FR-130/132): Panel Dock · resizable Tab
 * Panel · canvas · inspector. Runs INSIDE the workspace UI store provider so
 * it can read layout state. Desktop docks the Tab Panel as a grid column
 * whose width is persisted and drag-resizable; ≤768px the panel floats over
 * the canvas as a dismissable overlay; crossing ≤1024px auto-collapses the
 * inspector (the user can re-expand it).
 */
function WorkspaceBody({
	stage,
	dockItems,
	registry,
	inspector,
	toolStrip,
	elementActions,
}: {
	stage: ReactNode;
	dockItems?: readonly DockItem[];
	registry: CanvasPanelRegistry;
	inspector: boolean;
	toolStrip: boolean;
	elementActions?: ElementActions;
}): React.JSX.Element {
	const [panelWidth] = usePanelWidth();
	const [panelOpen, setPanelOpen] = usePanelOpen();
	const overlay = useMediaQuery(OVERLAY_PANEL_QUERY);
	const narrow = useMediaQuery(COLLAPSE_INSPECTOR_QUERY);
	const [, setInspectorCollapsed] = useInspectorCollapsed();
	const t = useCanvasT();

	// Auto-collapse the inspector when ENTERING the narrow range; expanding
	// again is the user's call (no auto-expand on widen).
	useEffect(() => {
		if (narrow) setInspectorCollapsed(true);
	}, [narrow, setInspectorCollapsed]);

	const canvasSection = (
		<section className="relative flex min-h-0 min-w-0 flex-col bg-neutral-200 dark:bg-neutral-800">
			<CanvasAreaContextMenu>
				<CanvasDropZone>
					{/* Fixed overlays — float over the canvas, never shift it. */}
					{toolStrip ? <ToolStrip /> : null}
					<CanvasToolbar />
					<PagesCanvas stage={stage} elementActions={elementActions} />
					<WorkspaceFooter className="absolute inset-x-0 bottom-0 z-20 border-t border-border bg-card/95 backdrop-blur" />
					{overlay && panelOpen ? (
						<>
							<Button
								type="button"
								variant="ghost"
								aria-label={t("canvas.panel.closeOverlay", "Close panel")}
								data-testid="panel-overlay-backdrop"
								className="absolute inset-0 z-30 h-auto w-auto rounded-none bg-black/20 hover:bg-black/20"
								onClick={() => setPanelOpen(false)}
							/>
							<div
								data-testid="panel-overlay"
								className="absolute inset-y-0 left-0 z-40 flex w-[min(85vw,320px)] flex-col border-r border-border bg-card shadow-xl"
							>
								<TabPanel registry={registry} />
							</div>
						</>
					) : null}
				</CanvasDropZone>
			</CanvasAreaContextMenu>
		</section>
	);

	if (overlay) {
		return (
			<div
				data-testid="workspace-body"
				data-layout="overlay"
				className="grid min-h-0 grid-cols-[auto_minmax(0,1fr)_auto]"
			>
				<PanelDock items={dockItems} />
				{canvasSection}
				{inspector ? <WorkspaceInspector /> : null}
			</div>
		);
	}
	return (
		<div
			data-testid="workspace-body"
			data-layout="docked"
			className="grid min-h-0 grid-cols-[auto_var(--ak-panel-width)_auto_minmax(0,1fr)_auto]"
			style={{ "--ak-panel-width": `${panelWidth}px` } as React.CSSProperties}
		>
			<PanelDock items={dockItems} />
			<TabPanel registry={registry} />
			<PanelResizeHandle />
			{canvasSection}
			{inspector ? <WorkspaceInspector /> : null}
		</div>
	);
}

/** Keyboard step for the panel-resize separator (arrow keys). */
const PANEL_RESIZE_STEP = 16;

/**
 * Drag handle between the Tab Panel and the canvas (B-14, FR-130). Pointer
 * drag resizes; arrow keys nudge (a11y `role="separator"`); double-click
 * restores the default width. The store clamps to
 * [{@link PANEL_WIDTH_MIN}, {@link PANEL_WIDTH_MAX}].
 */
function PanelResizeHandle(): React.JSX.Element {
	const [width, setWidth] = usePanelWidth();
	const t = useCanvasT();
	const drag = useRef<{ startX: number; startWidth: number } | null>(null);
	return (
		<div
			role="separator"
			aria-orientation="vertical"
			aria-label={t("canvas.workspace.resizePanel", "Resize panel")}
			aria-valuenow={width}
			aria-valuemin={PANEL_WIDTH_MIN}
			aria-valuemax={PANEL_WIDTH_MAX}
			tabIndex={0}
			data-testid="panel-resize-handle"
			className="h-full w-1.5 cursor-col-resize border-r border-border bg-transparent outline-none transition-colors hover:bg-primary/30 focus-visible:bg-primary/40"
			onPointerDown={(e) => {
				drag.current = { startX: e.clientX, startWidth: width };
				e.currentTarget.setPointerCapture(e.pointerId);
			}}
			onPointerMove={(e) => {
				if (!drag.current) return;
				setWidth(drag.current.startWidth + (e.clientX - drag.current.startX));
			}}
			onPointerUp={(e) => {
				drag.current = null;
				e.currentTarget.releasePointerCapture(e.pointerId);
			}}
			onDoubleClick={() => setWidth(PANEL_WIDTH_DEFAULT)}
			onKeyDown={(e) => {
				if (e.key === "ArrowLeft") {
					e.preventDefault();
					setWidth(width - PANEL_RESIZE_STEP);
				} else if (e.key === "ArrowRight") {
					e.preventDefault();
					setWidth(width + PANEL_RESIZE_STEP);
				}
			}}
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
