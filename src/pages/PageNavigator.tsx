"use client";

import {
	type KeyboardEvent as ReactKeyboardEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { useCanvasStudio } from "../context/canvas-studio-context.js";
import { usePageThumbnails } from "../perf/page-thumbnails.js";
import {
	addPage,
	deletePage,
	duplicateCurrentPage,
	renamePage,
	reorderPage,
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
	tablist: {
		display: "inline-flex",
		alignItems: "center",
		gap: TAB_GAP,
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
		border: "1px solid #3b82f6",
		color: "#1f2937",
		boxShadow: "0 0 0 1px #3b82f6 inset",
	} as const,
	thumb: {
		height: TAB_HEIGHT - 8,
		width: "auto",
		maxWidth: 32,
		marginRight: 4,
		borderRadius: 2,
		objectFit: "contain",
		verticalAlign: "middle",
	} as const,
	renameInput: {
		height: TAB_HEIGHT - 4,
		padding: `0 ${PADDING_X / 2}px`,
		background: "#ffffff",
		border: "1px solid #3b82f6",
		borderRadius: 4,
		color: "#1f2937",
		font: "inherit",
		minWidth: 80,
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
	// I2-5 off-screen tiling: cached bitmap previews of non-active pages.
	const thumbnails = usePageThumbnails({
		pages,
		activePageId,
		assets: ctx.ir.assets,
	});

	const [renamingPageId, setRenamingPageId] = useState<string | null>(null);
	const [renamingValue, setRenamingValue] = useState("");
	const renameInputRef = useRef<HTMLInputElement | null>(null);

	useEffect(() => {
		if (renamingPageId !== null) renameInputRef.current?.focus();
	}, [renamingPageId]);

	// Bail out of rename mode if the page being renamed disappears (e.g. it was
	// deleted by another action). Otherwise the input would commit a name onto
	// a stale id.
	useEffect(() => {
		if (renamingPageId === null) return;
		if (!pages.some((p) => p.id === renamingPageId)) {
			setRenamingPageId(null);
			setRenamingValue("");
		}
	}, [renamingPageId, pages]);

	const commitRename = useCallback(() => {
		if (renamingPageId === null) return;
		renamePage(ctx, renamingPageId, renamingValue.trim());
		setRenamingPageId(null);
		setRenamingValue("");
	}, [ctx, renamingPageId, renamingValue]);

	const cancelRename = useCallback(() => {
		setRenamingPageId(null);
		setRenamingValue("");
	}, []);

	const onRenameKeyDown = useCallback(
		(e: ReactKeyboardEvent<HTMLInputElement>) => {
			if (e.key === "Enter") {
				e.preventDefault();
				commitRename();
			} else if (e.key === "Escape") {
				e.preventDefault();
				cancelRename();
			}
		},
		[commitRename, cancelRename],
	);

	if (pages.length === 0) return null;
	const deleteDisabled = pages.length <= 1;
	const activeIndex = pages.findIndex((p) => p.id === activePageId);
	const reorderLeftDisabled = activeIndex <= 0;
	const reorderRightDisabled =
		activeIndex < 0 || activeIndex >= pages.length - 1;

	return (
		<div
			data-testid="page-navigator"
			style={styles.root}
			{...(id !== undefined ? { id } : {})}
		>
			<div
				role="tablist"
				aria-label="Artboards"
				data-testid="page-tablist"
				style={styles.tablist}
			>
				{pages.map((p) => {
					const isActive = p.id === activePageId;
					const isRenaming = p.id === renamingPageId;
					const tabStyle = isActive
						? { ...styles.tab, ...styles.tabActive }
						: styles.tab;
					if (isRenaming) {
						return (
							<input
								key={p.id}
								ref={renameInputRef}
								type="text"
								data-page-id={p.id}
								data-testid={`page-rename-input-${p.id}`}
								style={styles.renameInput}
								value={renamingValue}
								onChange={(e) => setRenamingValue(e.target.value)}
								onKeyDown={onRenameKeyDown}
								onBlur={commitRename}
								aria-label={`Rename page ${tabLabel(p.name, p.id)}`}
							/>
						);
					}
					return (
						<button
							type="button"
							key={p.id}
							role="tab"
							aria-selected={isActive}
							data-page-id={p.id}
							data-active={isActive ? "true" : "false"}
							data-testid={`page-tab-${p.id}`}
							style={tabStyle}
							onClick={() => switchToPage(ctx, p.id)}
							onDoubleClick={() => {
								setRenamingPageId(p.id);
								setRenamingValue(p.name ?? "");
							}}
						>
							{thumbnails.has(p.id) ? (
								<img
									src={thumbnails.get(p.id)}
									alt=""
									data-testid={`page-thumb-${p.id}`}
									style={styles.thumb}
								/>
							) : null}
							{tabLabel(p.name, p.id)}
						</button>
					);
				})}
			</div>
			<div style={styles.actions}>
				<button
					type="button"
					data-testid="page-reorder-left"
					style={
						reorderLeftDisabled
							? { ...styles.actionButton, ...styles.actionButtonDisabled }
							: styles.actionButton
					}
					disabled={reorderLeftDisabled}
					onClick={() => reorderPage(ctx, activePageId, activeIndex - 1)}
					aria-label="Move page left"
					title="Move page left"
				>
					{"←"}
				</button>
				<button
					type="button"
					data-testid="page-reorder-right"
					style={
						reorderRightDisabled
							? { ...styles.actionButton, ...styles.actionButtonDisabled }
							: styles.actionButton
					}
					disabled={reorderRightDisabled}
					onClick={() => reorderPage(ctx, activePageId, activeIndex + 1)}
					aria-label="Move page right"
					title="Move page right"
				>
					{"→"}
				</button>
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
