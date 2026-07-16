"use client";

import type {
	CanvasNodeUpdateCommand,
	CanvasRichTextNode,
	CanvasTextNode,
	RichTextParagraph,
	RichTextSpan,
} from "@anvilkit/canvas-core";
import { findNode, resolveSpanStyle } from "@anvilkit/canvas-core";
import {
	type KeyboardEvent,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import type { BrandKit } from "../brand/brand-kit.js";
import {
	resolveFillForDisplay,
	resolveFontFamilyForDisplay,
} from "../brand/resolve-brand-token.js";
import { useCanvasStudio } from "../context/canvas-studio-context.js";
import { useCanvasBrandKit } from "../stage/CanvasBrandKitContext.js";
import { DEFAULT_RICH_TEXT_STYLE } from "../text/rich-text-style.js";

type EditableNode = CanvasTextNode | CanvasRichTextNode;

/** A paragraph's text, as the flat single-span line the textarea shows. */
function flattenRichText(node: CanvasRichTextNode): string {
	return node.paragraphs
		.map((p) => p.spans.map((s) => s.text).join(""))
		.join("\n");
}

function spanStyleWithoutText(
	span: RichTextSpan | undefined,
): Omit<RichTextSpan, "text"> {
	if (!span) return {};
	const { text: _text, ...rest } = span;
	return rest;
}

/**
 * Split edited text back into paragraphs on newlines. Per-span selection is
 * out of scope for MVP (deliverable note), so each edited paragraph collapses
 * to a single span that inherits its SOURCE paragraph's align/lineHeight and
 * first span's style — the source paragraph at the same index when it existed,
 * or the original's last paragraph for any newly-typed lines beyond it.
 */
function rebuildRichTextParagraphs(
	original: CanvasRichTextNode,
	newText: string,
): RichTextParagraph[] {
	const lastOriginal = original.paragraphs[original.paragraphs.length - 1];
	return newText.split("\n").map((lineText, i) => {
		const source = original.paragraphs[i] ?? lastOriginal;
		const style = spanStyleWithoutText(source?.spans[0]);
		return {
			...(source?.align !== undefined ? { align: source.align } : {}),
			...(source?.lineHeight !== undefined
				? { lineHeight: source.lineHeight }
				: {}),
			spans: [{ ...style, text: lineText }],
		};
	});
}

/**
 * Font/color to display in the overlay — resolved through the rich-text
 * defaults for a rich-text node (its style lives per-span, not on the node).
 * `fontFamily`/`fill` may be a brand-token ref; resolve it against `brandKit`
 * the same way the stage does, degrading to `undefined` (the browser/DOM
 * default) rather than handing a `BrandTokenRef` object to a CSS style prop.
 */
function resolveOverlayStyle(
	node: EditableNode,
	brandKit: BrandKit,
): {
	fontFamily: string | undefined;
	fontSize: number;
	color: string | undefined;
} {
	if (node.type === "text") {
		const fill = resolveFillForDisplay(node.fill, brandKit).value;
		return {
			fontFamily: resolveFontFamilyForDisplay(node.fontFamily, brandKit).value,
			fontSize: node.fontSize,
			color: typeof fill === "string" ? fill : undefined,
		};
	}
	const resolved = resolveSpanStyle(
		node.paragraphs[0]?.spans[0] ?? { text: "" },
		DEFAULT_RICH_TEXT_STYLE,
	);
	const fill = resolveFillForDisplay(resolved.fill, brandKit).value;
	return {
		fontFamily: resolveFontFamilyForDisplay(resolved.fontFamily, brandKit)
			.value,
		fontSize: resolved.fontSize,
		color: typeof fill === "string" ? fill : undefined,
	};
}

export function TextEditorOverlay(): React.JSX.Element | null {
	const { editingStore, stage, getIR, commit, viewportStore } =
		useCanvasStudio();
	const brandKit = useCanvasBrandKit();
	const editingNodeId = useSyncExternalStore(
		editingStore.subscribe,
		() => editingStore.getState().editingNodeId,
		() => editingStore.getState().editingNodeId,
	);
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const [draftText, setDraftText] = useState("");
	const editingNodeRef = useRef<EditableNode | null>(null);

	const ir = getIR();
	// Container-aware: the editing node may be nested inside a frame, not just
	// a top-level child of the page root, so this can't be a shallow
	// `page.root.children.find(...)` — findNode already walks the full tree
	// (same helper PropertyInspector uses for the selected node).
	const editingNode = editingNodeId
		? (findNode(ir, editingNodeId)?.node ?? null)
		: null;
	const isTextNode = editingNode !== null && editingNode.type === "text";
	const isRichTextNode =
		editingNode !== null && editingNode.type === "rich-text";

	useEffect(() => {
		if (isTextNode) {
			const textNode = editingNode as CanvasTextNode;
			editingNodeRef.current = textNode;
			setDraftText(textNode.text);
			requestAnimationFrame(() => {
				textareaRef.current?.focus();
				textareaRef.current?.select();
			});
		} else if (isRichTextNode) {
			const richTextNode = editingNode as CanvasRichTextNode;
			editingNodeRef.current = richTextNode;
			setDraftText(flattenRichText(richTextNode));
			requestAnimationFrame(() => {
				textareaRef.current?.focus();
				textareaRef.current?.select();
			});
		} else {
			editingNodeRef.current = null;
		}
	}, [editingNodeId, isTextNode, isRichTextNode, editingNode]);

	if (
		!editingNodeId ||
		!editingNode ||
		(editingNode.type !== "text" && editingNode.type !== "rich-text") ||
		!stage
	) {
		return null;
	}

	// Call `container()` AS A METHOD on the stage — Konva's `container()`
	// delegates to `this.getContainer()`, so an unbound `const fn =
	// stage.container; fn()` crashes ("reading 'getContainer'") against a real
	// Konva stage (fake test stages use a `this`-less function, so tests pass).
	const container =
		typeof stage.container === "function" ? stage.container() : null;
	const rect = container?.getBoundingClientRect?.();
	const vp = viewportStore.getState();
	const left = (rect?.left ?? 0) + editingNode.transform.x * vp.zoom + vp.panX;
	const top = (rect?.top ?? 0) + editingNode.transform.y * vp.zoom + vp.panY;
	const overlayStyle = resolveOverlayStyle(editingNode, brandKit);

	const commitAndClose = () => {
		const original = editingNodeRef.current;
		// Read the live DOM value rather than React state — state updates from
		// `onChange` may not have re-rendered before `onBlur` fires.
		const newText = textareaRef.current?.value ?? draftText;
		// FR-080 empty-node cleanup: a text/rich-text node left with no content
		// (whitespace-only) is removed rather than persisted as an invisible
		// empty box — one undo entry. Locked nodes are protected by the commit
		// pipeline (the delete no-ops).
		if (
			(original?.type === "text" || original?.type === "rich-text") &&
			newText.trim().length === 0
		) {
			commit({ type: "node.delete", nodeId: editingNodeId });
			editingStore.getState().clearEditing();
			return;
		}
		if (original?.type === "text") {
			if (newText !== original.text) {
				const cmd: CanvasNodeUpdateCommand<"text"> = {
					type: "node.update",
					nodeId: editingNodeId,
					kind: "text",
					patch: { text: newText },
				};
				commit(cmd);
			}
		} else if (original?.type === "rich-text") {
			if (newText !== flattenRichText(original)) {
				const cmd: CanvasNodeUpdateCommand<"rich-text"> = {
					type: "node.update",
					nodeId: editingNodeId,
					kind: "rich-text",
					patch: { paragraphs: rebuildRichTextParagraphs(original, newText) },
				};
				commit(cmd);
			}
		}
		editingStore.getState().clearEditing();
	};

	const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === "Escape") {
			editingStore.getState().clearEditing();
			e.preventDefault();
		}
	};

	return (
		<textarea
			ref={textareaRef}
			data-testid="text-editor-overlay"
			value={draftText}
			onChange={(e) => setDraftText(e.target.value)}
			onBlur={commitAndClose}
			onKeyDown={handleKeyDown}
			style={{
				position: "fixed",
				left,
				top,
				width: editingNode.bounds.width * vp.zoom,
				height: editingNode.bounds.height * vp.zoom,
				fontFamily: overlayStyle.fontFamily,
				fontSize: overlayStyle.fontSize * vp.zoom,
				color: overlayStyle.color,
				border: "1px solid #3b82f6",
				background: "rgba(255, 255, 255, 0.9)",
				padding: 0,
				margin: 0,
				resize: "none",
				outline: "none",
				boxSizing: "border-box",
				zIndex: 9999,
			}}
		/>
	);
}
