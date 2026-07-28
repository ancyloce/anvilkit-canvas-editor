"use client";

import * as React from "react";
import { useSyncExternalStore } from "react";
import {
	useCanvasStudio,
	useCanvasT,
} from "../context/canvas-studio-context.js";

// Visually hidden but exposed to assistive tech (the canonical sr-only clip).
const srOnly = {
	position: "absolute",
	width: 1,
	height: 1,
	padding: 0,
	margin: -1,
	overflow: "hidden",
	clip: "rect(0 0 0 0)",
	whiteSpace: "nowrap",
	border: 0,
} as const;

const noopSubscribe = () => () => undefined;

/**
 * T-M4-08 a11y: a polite live region describing the single selected node's
 * Auto Layout situation in LOCALIZED words, never raw enum values — an Auto
 * Layout frame announces direction + child count; a Flow child announces
 * "item N of M" (flow order from the resolved view) plus any non-default
 * sizing modes; an Absolute child announces its positioning. Because the text
 * derives from the resolved document, a keyboard/drag reorder or a sizing
 * change re-announces automatically — while diagnostics are deliberately
 * NEVER announced (they fire during preview and would flood the region).
 */
export function LayoutAnnouncer(): React.JSX.Element | null {
	const ctx = useCanvasStudio();
	const t = useCanvasT();
	const selectedIds = useSyncExternalStore(
		ctx.selectionStore.subscribe,
		() => ctx.selectionStore.getState().selectedIds,
		() => ctx.selectionStore.getState().selectedIds,
	);
	const resolvedStore = ctx.resolvedDocumentStore;
	const view = useSyncExternalStore(
		resolvedStore ? resolvedStore.subscribe : noopSubscribe,
		() => resolvedStore?.getState().view,
		() => undefined,
	);

	let message = "";
	const id = selectedIds.length === 1 ? selectedIds[0] : undefined;
	const record = id && view ? view.getRecord(id) : undefined;
	if (record && view) {
		const node = record.node;
		const name = node.name ?? node.id;
		const directionWord = (d: "horizontal" | "vertical") =>
			d === "horizontal"
				? t("canvas.inspector.layoutHorizontal", "Horizontal")
				: t("canvas.inspector.layoutVertical", "Vertical");
		if (node.type === "frame" && node.autoLayout) {
			message = t(
				"canvas.a11y.layoutFrameSummary",
				"{name}: {direction} auto layout, {count} items",
			)
				.replace("{name}", name)
				.replace("{direction}", directionWord(node.autoLayout.direction))
				.replace("{count}", String(node.children.length));
		} else if (record.parentId) {
			const parentRecord = view.getRecord(record.parentId);
			const parentNode = parentRecord?.node;
			if (parentNode?.type === "frame" && parentNode.autoLayout) {
				if (node.layoutItem?.positioning === "absolute") {
					message = `${name}: ${t("canvas.inspector.layoutAbsolute", "Absolute")}`;
				} else {
					const siblings = view
						.getChildren(record.parentId)
						.filter((s) => s.node.layoutItem?.positioning !== "absolute");
					const index = siblings.findIndex((s) => s.id === record.id) + 1;
					message = t(
						"canvas.a11y.layoutItemPosition",
						"{name}: item {index} of {count}, {direction}",
					)
						.replace("{name}", name)
						.replace("{index}", String(index))
						.replace("{count}", String(siblings.length))
						.replace(
							"{direction}",
							directionWord(parentNode.autoLayout.direction),
						);
					const sizingWord = (s: "fixed" | "hug" | "fill") =>
						s === "hug"
							? t("canvas.inspector.layoutSizingHug", "Hug contents")
							: s === "fill"
								? t("canvas.inspector.layoutSizingFill", "Fill container")
								: t("canvas.inspector.layoutSizingFixed", "Fixed");
					const w = node.layoutItem?.widthSizing ?? "fixed";
					const h = node.layoutItem?.heightSizing ?? "fixed";
					if (w !== "fixed" || h !== "fixed") {
						message += `, ${t(
							"canvas.a11y.layoutItemSizing",
							"{width} width, {height} height",
						)
							.replace("{width}", sizingWord(w))
							.replace("{height}", sizingWord(h))}`;
					}
				}
			}
		}
	}

	return (
		<div
			data-testid="layout-announcer"
			role="status"
			aria-live="polite"
			aria-atomic="true"
			style={srOnly}
		>
			{message}
		</div>
	);
}
