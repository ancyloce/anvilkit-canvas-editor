"use client";

import { useSyncExternalStore } from "react";
import { useCanvasStudio } from "../context/canvas-studio-context.js";
import {
	addPage,
	deletePage,
	duplicateCurrentPage,
	switchToPage,
} from "./page-actions.js";

const ROW_HEIGHT = 32;
const PADDING_X = 8;
const TAB_GAP = 4;
const TAB_HEIGHT = 24;

const styles = {
	root: {
		display: "flex",
		alignItems: "center",
		gap: TAB_GAP,
		height: ROW_HEIGHT,
		padding: `0 ${PADDING_X}px`,
		borderBottom: "1px solid #e5e7eb",
		background: "#f9fafb",
		fontFamily:
			"ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
		fontSize: 12,
		userSelect: "none",
	} as const,
	tab: {
		height: TAB_HEIGHT,
		padding: `0 ${PADDING_X}px`,
		display: "inline-flex",
		alignItems: "center",
		background: "transparent",
		border: "1px solid #d1d5db",
		borderRadius: 4,
		cursor: "pointer",
		color: "#374151",
		font: "inherit",
	} as const,
	tabActive: {
		background: "#ffffff",
		borderColor: "#3b82f6",
		color: "#1f2937",
		boxShadow: "0 0 0 1px #3b82f6 inset",
	} as const,
	actions: {
		marginLeft: "auto",
		display: "inline-flex",
		gap: TAB_GAP,
	} as const,
	actionButton: {
		height: TAB_HEIGHT,
		minWidth: TAB_HEIGHT,
		padding: `0 ${PADDING_X}px`,
		background: "#ffffff",
		border: "1px solid #d1d5db",
		borderRadius: 4,
		cursor: "pointer",
		color: "#374151",
		font: "inherit",
	} as const,
	actionButtonDisabled: {
		opacity: 0.4,
		cursor: "not-allowed",
	} as const,
} as const;

function tabLabel(name: string | undefined, id: string): string {
	if (name && name.length > 0) return name;
	return id.length > 6 ? id.slice(0, 6) : id;
}

export interface PageNavigatorProps {
	/** Optional id for the root element — useful for hosts that want to anchor styles. */
	id?: string;
}

export function PageNavigator({
	id,
}: PageNavigatorProps): React.JSX.Element | null {
	const ctx = useCanvasStudio();
	const activePageId = useSyncExternalStore(
		ctx.pagesStore.subscribe,
		() => ctx.pagesStore.getState().activePageId,
		() => ctx.pagesStore.getState().activePageId,
	);
	const pages = ctx.ir.pages;
	if (pages.length === 0) return null;
	const deleteDisabled = pages.length <= 1;

	return (
		<div
			data-testid="page-navigator"
			style={styles.root}
			{...(id !== undefined ? { id } : {})}
		>
			{pages.map((p) => {
				const isActive = p.id === activePageId;
				const tabStyle = isActive
					? { ...styles.tab, ...styles.tabActive }
					: styles.tab;
				return (
					<button
						type="button"
						key={p.id}
						data-page-id={p.id}
						data-active={isActive ? "true" : "false"}
						data-testid={`page-tab-${p.id}`}
						style={tabStyle}
						onClick={() => switchToPage(ctx, p.id)}
					>
						{tabLabel(p.name, p.id)}
					</button>
				);
			})}
			<div style={styles.actions}>
				<button
					type="button"
					data-testid="page-add"
					style={styles.actionButton}
					onClick={() => addPage(ctx)}
					aria-label="Add page"
					title="Add page"
				>
					+
				</button>
				<button
					type="button"
					data-testid="page-duplicate"
					style={styles.actionButton}
					onClick={() => duplicateCurrentPage(ctx)}
					title="Duplicate page"
				>
					Duplicate
				</button>
				<button
					type="button"
					data-testid="page-delete"
					style={
						deleteDisabled
							? { ...styles.actionButton, ...styles.actionButtonDisabled }
							: styles.actionButton
					}
					disabled={deleteDisabled}
					onClick={() => deletePage(ctx, activePageId)}
					title={deleteDisabled ? "Cannot delete the only page" : "Delete page"}
				>
					Delete
				</button>
			</div>
		</div>
	);
}
