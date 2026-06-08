"use client";

import type {
	CanvasNodeUpdateCommand,
	CanvasTextNode,
} from "@anvilkit/canvas-core";
import {
	type KeyboardEvent,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { useCanvasStudio } from "../context/canvas-studio-context.js";

export function TextEditorOverlay(): React.JSX.Element | null {
	const { editingStore, stage, getIR, activePageId, commit, viewportStore } =
		useCanvasStudio();
	const editingNodeId = useSyncExternalStore(
		editingStore.subscribe,
		() => editingStore.getState().editingNodeId,
		() => editingStore.getState().editingNodeId,
	);
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const [draftText, setDraftText] = useState("");
	const editingNodeRef = useRef<CanvasTextNode | null>(null);

	const ir = getIR();
	const page = ir.pages.find((p) => p.id === activePageId);
	const editingNode = page?.root.children.find((c) => c.id === editingNodeId);
	const isTextNode = editingNode !== undefined && editingNode.type === "text";

	useEffect(() => {
		if (isTextNode) {
			const textNode = editingNode as CanvasTextNode;
			editingNodeRef.current = textNode;
			setDraftText(textNode.text);
			requestAnimationFrame(() => {
				textareaRef.current?.focus();
				textareaRef.current?.select();
			});
		} else {
			editingNodeRef.current = null;
		}
	}, [editingNodeId, isTextNode, editingNode]);

	if (!editingNodeId || !editingNode || editingNode.type !== "text" || !stage) {
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

	const commitAndClose = () => {
		const original = editingNodeRef.current;
		// Read the live DOM value rather than React state — state updates from
		// `onChange` may not have re-rendered before `onBlur` fires.
		const newText = textareaRef.current?.value ?? draftText;
		if (original && newText !== original.text) {
			const cmd: CanvasNodeUpdateCommand<"text"> = {
				type: "node.update",
				nodeId: editingNodeId,
				kind: "text",
				patch: { text: newText },
			};
			commit(cmd);
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
				fontFamily: editingNode.fontFamily,
				fontSize: editingNode.fontSize * vp.zoom,
				color:
					typeof editingNode.fill === "string" ? editingNode.fill : undefined,
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
