"use client";

import {
	type CanvasNode,
	type CanvasResolvedNodeRecord,
	type CanvasResolvedView,
	isContainerNode,
	localComponentIdOf,
} from "@anvilkit/canvas-core";
import * as React from "react";
import { useSyncExternalStore } from "react";
import {
	useCanvasStudio,
	useCanvasT,
} from "../context/canvas-studio-context.js";
import { selectionTargetForResolvedId } from "../selection/component-selection-policy.js";
import {
	type FocusNavKey,
	nextFocusId,
	nextResolvedFocusId,
} from "./keyboard-actions.js";

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

const NAV_KEYS = new Set<string>([
	"ArrowDown",
	"ArrowUp",
	"ArrowLeft",
	"ArrowRight",
	"Enter",
	"Escape",
]);

const itemDomId = (nodeId: string) => `ak-scene-item-${nodeId}`;

interface FlatItem {
	node: CanvasNode;
	level: number;
	/**
	 * The id to focus/select this row by. For a plain node it IS `node.id`; for a
	 * VIRTUAL node it is the resolved (codec) id, because that is the only handle
	 * the resolved tree offers — and `node.id` on a virtual record is not a
	 * document node id at all (plan 0023 M5-07).
	 */
	id: string;
	/** True when this row is a component's virtual node rather than a page node. */
	virtual: boolean;
	/**
	 * Set when this row is the ROOT of a resolved instance — i.e. the row a user
	 * lands on when they reach the component itself.
	 *
	 * Needed because a successfully expanded instance's record carries the
	 * COMPOSED root (a frame or group from the definition), so its `node.type` is
	 * `"frame"`, not `"component-instance"`: without provenance the row would
	 * announce "frame" and a screen-reader user could not tell they were on a
	 * component at all. Only the DEGRADED case keeps the instance node itself.
	 */
	instanceOfComponentId?: string;
}

function flatten(nodes: readonly CanvasNode[], level = 1): FlatItem[] {
	const out: FlatItem[] = [];
	for (const node of nodes) {
		out.push({ node, level, id: node.id, virtual: false });
		if (isContainerNode(node)) {
			out.push(...flatten(node.children, level + 1));
		}
	}
	return out;
}

/**
 * T-M3-09: flatten from the RESOLVED tree, so traversal order follows the
 * resolved flow order (`childIds`) by construction rather than by the
 * coincidence that v1 flow order equals document order — which is what makes
 * future flow-reversal work (RTL, ordering features) safe here. Labels and
 * announcements still read the SOURCE node.
 */
function flattenResolved(
	view: CanvasResolvedView,
	records: readonly CanvasResolvedNodeRecord[],
	level = 1,
): FlatItem[] {
	const out: FlatItem[] = [];
	for (const record of records) {
		const origin = record.component;
		out.push({
			node: record.node,
			level,
			// Address the row by its RESOLVED id: a virtual node's `node.id` is codec
			// output, and for a plain node the two are identical anyway.
			id: record.id,
			virtual: origin !== undefined,
			// The instance root is the record whose provenance names ITSELF as the
			// instance it came from.
			...(origin && origin.instanceId === record.id
				? { instanceOfComponentId: origin.componentId }
				: {}),
		});
		const children = view.getChildren(record.id);
		if (children.length > 0) {
			out.push(...flattenResolved(view, children, level + 1));
		}
	}
	return out;
}

const NOOP_SUBSCRIBE = () => () => undefined;

/**
 * Off-canvas screen-reader proxy for the scene (a11y): a visually-hidden
 * `role="tree"` mirror of the active page's nodes. Konva renders to `<canvas>`
 * (invisible to assistive tech), so this exposes a real, focusable DOM tree —
 * arrow keys move roving focus (via {@link nextFocusId}), Enter selects. Mounted
 * inside `<CanvasStudio>`.
 */
export function SceneAccessibilityTree(): React.JSX.Element {
	const ctx = useCanvasStudio();
	const t = useCanvasT();
	const focusedId = useSyncExternalStore(
		ctx.focusStore.subscribe,
		() => ctx.focusStore.getState().focusedId,
		() => ctx.focusStore.getState().focusedId,
	);
	const selectedIds = useSyncExternalStore(
		ctx.selectionStore.subscribe,
		() => ctx.selectionStore.getState().selectedIds,
		() => ctx.selectionStore.getState().selectedIds,
	);

	// T-M3-09: build from the resolved view when the store is present; the raw
	// walk stays as the storeless fallback (partial test contexts).
	const resolvedView = useSyncExternalStore(
		ctx.resolvedDocumentStore
			? ctx.resolvedDocumentStore.subscribe
			: NOOP_SUBSCRIBE,
		() => ctx.resolvedDocumentStore?.getState().view,
		() => undefined,
	);
	const page = ctx.ir.pages.find((p) => p.id === ctx.activePageId);
	const items = page
		? resolvedView
			? flattenResolved(resolvedView, resolvedView.getChildren(page.root.id))
			: flatten(page.root.children)
		: [];
	// O(1) membership per row instead of scanning `selectedIds` for every item.
	const selectedSet = new Set(selectedIds);

	const labelFor = (item: FlatItem): string => {
		const { node } = item;
		const base =
			node.name && node.name.length > 0
				? node.name
				: (ctx.kindInspectors?.[node.type]?.label ?? node.type);
		// Plan 0023 M5-07: announce WHICH component a row belongs to, following the
		// shipped missing-ASSET suffix precedent below rather than a new shape.
		// Two distinct cases: an EXPANDED instance root (provenance names the
		// component; the node itself is the composed frame/group) and a DEGRADED
		// one (the record is still the `component-instance` node).
		const componentId =
			item.instanceOfComponentId ??
			(node.type === "component-instance"
				? localComponentIdOf(node.source)
				: undefined);
		if (componentId !== undefined) {
			const definition = ctx.ir.components?.[componentId];
			return definition
				? `${base} — ${definition.name}`
				: `${base} — ${t("canvas.component.missing", "Missing component")}`;
		}
		if (node.type === "image" || node.type === "svg") {
			// FR-095 accessible description: a broken asset reference must be
			// perceivable without sight of the canvas placeholder chrome.
			if (ctx.ir.assets[node.assetId] === undefined) {
				return `${base} — ${t("canvas.a11y.missingAsset", "missing asset")}`;
			}
			// §12 alt-text: announce the image's alternative text when set.
			if (node.alt && node.alt.trim().length > 0) {
				return `${base} — ${node.alt.trim()}`;
			}
		}
		return base;
	};

	const onItemKeyDown = (
		e: React.KeyboardEvent<HTMLButtonElement>,
		nodeId: string,
	): void => {
		if (!NAV_KEYS.has(e.key)) return;
		e.preventDefault();
		if (e.key === "Enter") {
			// Plan 0023 M5-07: map the focused id through the M4-06 policy instead of
			// assuming it names a persistent node. A virtual node collapses to its
			// owning instance, so a codec id can never reach `selectedIds`.
			const target = resolvedView
				? selectionTargetForResolvedId(resolvedView, nodeId)
				: null;
			if (target) ctx.selectionStore.getState().setTargets([target]);
			else ctx.selectionStore.getState().setSelection([nodeId]);
			return;
		}
		// Navigate the ids the tree ACTUALLY rendered (resolved reading order) when
		// a resolution exists; the raw page walk stays the storeless fallback.
		const next = resolvedView
			? nextResolvedFocusId(
					items.map((item) => item.id),
					nodeId,
					e.key as FocusNavKey,
				)
			: page
				? nextFocusId({ root: page.root }, nodeId, e.key as FocusNavKey)
				: null;
		ctx.focusStore.getState().setFocus(next);
		if (next) {
			document.getElementById(itemDomId(next))?.focus();
		}
	};

	return (
		// A roving-tabindex tree of buttons is the canonical canvas-a11y proxy:
		// Konva renders to <canvas>, so there are no real DOM nodes to expose.
		<div
			role="tree"
			aria-label={t("canvas.a11y.sceneTree", "Canvas objects")}
			style={srOnly}
		>
			{items.map((item, index) => {
				const { node, level, id, virtual } = item;
				const isFocused = focusedId ? id === focusedId : index === 0;
				return (
					<button
						key={id}
						id={itemDomId(id)}
						type="button"
						role="treeitem"
						aria-level={level}
						// A virtual node's row reflects the selection of the instance that
						// owns it — that is what `selectedIds` carries (M4-04).
						aria-selected={selectedSet.has(virtual ? node.id : id)}
						data-virtual={virtual ? "true" : undefined}
						tabIndex={isFocused ? 0 : -1}
						onFocus={() => ctx.focusStore.getState().setFocus(id)}
						onClick={() => {
							const target = resolvedView
								? selectionTargetForResolvedId(resolvedView, id)
								: null;
							if (target) ctx.selectionStore.getState().setTargets([target]);
							else ctx.selectionStore.getState().setSelection([id]);
						}}
						onKeyDown={(e) => onItemKeyDown(e, id)}
					>
						{labelFor(item)}
					</button>
				);
			})}
		</div>
	);
}
