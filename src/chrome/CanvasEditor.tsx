"use client";

import type { ReactNode } from "react";
import { ToolAnnouncer } from "../a11y/ToolAnnouncer.js";
import { CanvasStudio, type CanvasStudioProps } from "../CanvasStudio.js";
import { PageNavigator } from "../pages/PageNavigator.js";
import { PropertyInspector } from "../panels/PropertyInspector.js";
import type { ToolId } from "../stores/tool-store.js";
import { EditorContextPanel } from "./EditorContextPanel.js";
import { EditorStageBar } from "./EditorStageBar.js";
import { FloatingSelectionToolbar } from "./FloatingSelectionToolbar.js";
import type { ToolDescriptor } from "./icons.js";
import { ToolRail } from "./ToolRail.js";
import { ZoomControl } from "./ZoomControl.js";

export interface CanvasEditorProps
	extends Omit<
		CanvasStudioProps,
		"renderShell" | "hidePageNavigator" | "children"
	> {
	/** Right-aligned stage-bar actions (e.g. Share / Export / Publish). */
	stageBarActions?: ReactNode;
	/** Collaborator avatars rendered in the stage bar. */
	avatarsSlot?: ReactNode;
	/** Tool-rail tools, in order. Defaults to the full drawing-tool set. */
	tools?: readonly ToolDescriptor[];
	/** Builds each tool button's `data-testid` (e.g. `host-tool-${id}`). */
	toolTestId?: (id: ToolId) => string;
	/** `data-testid` for the tool-rail container. */
	toolRailTestId?: string;
	/** Show the page-tab strip below the stage. Defaults to true. */
	showPageNavigator?: boolean;
	/**
	 * Extra host UI rendered (visually hidden) inside the editor context. Use
	 * for host-owned controls that should stay out of the reference chrome —
	 * e.g. an offscreen machine-readable scene readout for E2E. Resolves
	 * `useCanvasStudio()` like any provider child.
	 */
	children?: ReactNode;
}

/**
 * The full reference editor shell (the "Plume" `.editor` layout): a 4-column
 * grid of tool rail · context panel · stage · inspector, with the stage bar,
 * floating selection toolbar, and zoom pill composed around the live
 * `<CanvasStudio>` stage. Backward-compatible sugar over
 * `CanvasStudio.renderShell` — every chrome piece resolves `useCanvasStudio()`
 * because it renders inside the studio's provider.
 */
export function CanvasEditor({
	stageBarActions,
	avatarsSlot,
	tools,
	toolTestId,
	toolRailTestId,
	showPageNavigator = true,
	children,
	...studioProps
}: CanvasEditorProps): React.JSX.Element {
	return (
		<CanvasStudio
			{...studioProps}
			renderShell={(stage) => (
				<div
					data-ak-canvas-editor=""
					data-testid="canvas-editor-root"
					className="grid h-full min-h-0 grid-cols-[64px_240px_minmax(0,1fr)_280px] overflow-hidden bg-background text-foreground"
				>
					<ToolAnnouncer />
					<ToolRail
						tools={tools}
						toolTestId={toolTestId}
						data-testid={toolRailTestId}
					/>
					<EditorContextPanel />
					<section className="flex min-h-0 min-w-0 flex-col bg-muted">
						<EditorStageBar
							actions={stageBarActions}
							avatarsSlot={avatarsSlot}
						/>
						<div className="relative grid min-h-0 flex-1 place-items-center overflow-hidden p-7">
							<FloatingSelectionToolbar />
							{stage}
							<ZoomControl />
						</div>
						{showPageNavigator ? <PageNavigator /> : null}
					</section>
					<aside className="flex h-full flex-col overflow-hidden border-l border-border bg-card">
						<PropertyInspector />
					</aside>
					{children ? (
						<div className="sr-only" data-testid="canvas-editor-host-slot">
							{children}
						</div>
					) : null}
				</div>
			)}
		/>
	);
}
