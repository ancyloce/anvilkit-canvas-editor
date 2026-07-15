import {
	type CanvasCommand,
	type CanvasNode,
	findNode,
	parentOf,
} from "@anvilkit/canvas-core";
import { useEffect } from "react";
import { useCanvasStudio } from "../context/canvas-studio-context.js";
import {
	groupSelection,
	ungroupSelection,
} from "../selection/group-actions.js";
import {
	nudgeCommand,
	resizeStepCommand,
	rotateStepCommand,
} from "./keyboard-actions.js";

export interface CanvasKeyboardOptions {
	/** Pixels per arrow nudge / resize step (default 1). */
	nudgeStep?: number;
	/** Degrees per `[`/`]` rotate step (default 1). */
	rotateStep?: number;
}

const EDITABLE_TAG = /^(INPUT|TEXTAREA|SELECT)$/;

/**
 * Keyboard operation of the canvas (a11y): with a selection, arrows nudge,
 * Shift+arrows resize, `[`/`]` rotate, Delete/Backspace remove. Every edit goes
 * through the SAME `commit`/`commitBatch` as the mouse, so undo/history/collab
 * are identical. The listener is scoped to the stage container and ignores
 * keystrokes originating in form fields / contenteditable. Must be called inside
 * a `<CanvasStudio>` tree.
 */
function useCanvasKeyboard(opts: CanvasKeyboardOptions = {}): void {
	const ctx = useCanvasStudio();
	const { stage, selectionStore, getIR, activePageId, commit, commitBatch } =
		ctx;
	const nudgeStep = opts.nudgeStep ?? 1;
	const rotateStep = opts.rotateStep ?? 1;

	useEffect(() => {
		if (!stage) return;
		const container = stage.container();
		if (!container) return;

		const dispatch = (cmds: CanvasCommand[]): void => {
			if (cmds.length === 0) return;
			if (cmds.length > 1) commitBatch(cmds);
			else if (cmds[0]) commit(cmds[0]);
		};

		const onKeyDown = (e: KeyboardEvent): void => {
			const target = e.target as HTMLElement | null;
			if (
				target &&
				(target.isContentEditable || EDITABLE_TAG.test(target.tagName))
			) {
				return;
			}
			// Undo / redo (⌘Z / ⌘⇧Z, plus Ctrl+Y on Windows/Linux) — interim
			// stage-scoped binding (M0-03); migrates into the workspace shortcut
			// registry in Phase 1a. Mirrors the header buttons' historyStore →
			// sceneStore wiring, and runs before the selection guard: history
			// operations need no selection.
			if (
				(e.metaKey || e.ctrlKey) &&
				(e.key === "z" || e.key === "Z" || e.key === "y" || e.key === "Y")
			) {
				e.preventDefault();
				const isRedo = e.key === "y" || e.key === "Y" || e.shiftKey;
				const history = ctx.historyStore.getState();
				if (isRedo ? !history.canRedo() : !history.canUndo()) return;
				const next = isRedo ? history.redo(getIR()) : history.undo(getIR());
				ctx.sceneStore?.getState().setIR(next);
				return;
			}
			// Group / ungroup (⌘G / ⌘⇧G). group-actions read the selection + handle
			// no-ops themselves, so this runs before the selection guard below.
			if ((e.metaKey || e.ctrlKey) && (e.key === "g" || e.key === "G")) {
				e.preventDefault();
				if (e.shiftKey) ungroupSelection(ctx);
				else groupSelection(ctx);
				return;
			}
			// Select all (⌘A) / select same kind (⌘⇧A). Pure selection, no commit.
			if ((e.metaKey || e.ctrlKey) && (e.key === "a" || e.key === "A")) {
				e.preventDefault();
				const page = getIR().pages.find((p) => p.id === activePageId);
				if (!page) return;
				const children = page.root.children;
				if (e.shiftKey) {
					const refId = selectionStore.getState().selectedIds[0];
					const ref = refId ? findNode(getIR(), refId) : null;
					if (ref) {
						const kind = ref.node.type;
						selectionStore
							.getState()
							.setSelection(
								children.flatMap((c) => (c.type === kind ? [c.id] : [])),
							);
					}
				} else {
					selectionStore.getState().setSelection(children.map((c) => c.id));
				}
				return;
			}
			const ids = selectionStore.getState().selectedIds;
			if (ids.length === 0) return;
			const ir = getIR();
			const nodes: CanvasNode[] = [];
			for (const id of ids) {
				const found = findNode(ir, id);
				if (
					found &&
					found.page.id === activePageId &&
					found.node.locked !== true
				) {
					nodes.push(found.node);
				}
			}
			if (nodes.length === 0) return;

			// Reorder the first selected node within its parent (Ctrl/⌘ + [ / ]).
			// Checked before the plain `[`/`]` rotate cases below. toIndex is clamped
			// by the runtime, so boundaries are a safe no-op.
			if ((e.metaKey || e.ctrlKey) && (e.key === "[" || e.key === "]")) {
				e.preventDefault();
				const node = nodes[0];
				if (node) {
					const parentResult = parentOf(ir, node.id);
					if (parentResult) {
						const idx = parentResult.parent.children.findIndex(
							(c) => c.id === node.id,
						);
						dispatch([
							{
								type: "node.reorder",
								nodeId: node.id,
								toIndex: idx + (e.key === "]" ? 1 : -1),
							},
						]);
					}
				}
				return;
			}

			const shift = e.shiftKey;
			let cmds: CanvasCommand[] | null = null;
			switch (e.key) {
				case "ArrowLeft":
					cmds = shift
						? nodes.map((n) => resizeStepCommand(n, -nudgeStep, 0))
						: nodes.map((n) => nudgeCommand(n, -nudgeStep, 0));
					break;
				case "ArrowRight":
					cmds = shift
						? nodes.map((n) => resizeStepCommand(n, nudgeStep, 0))
						: nodes.map((n) => nudgeCommand(n, nudgeStep, 0));
					break;
				case "ArrowUp":
					cmds = shift
						? nodes.map((n) => resizeStepCommand(n, 0, -nudgeStep))
						: nodes.map((n) => nudgeCommand(n, 0, -nudgeStep));
					break;
				case "ArrowDown":
					cmds = shift
						? nodes.map((n) => resizeStepCommand(n, 0, nudgeStep))
						: nodes.map((n) => nudgeCommand(n, 0, nudgeStep));
					break;
				case "[":
					cmds = nodes.map((n) => rotateStepCommand(n, -rotateStep));
					break;
				case "]":
					cmds = nodes.map((n) => rotateStepCommand(n, rotateStep));
					break;
				case "Delete":
				case "Backspace":
					cmds = nodes.map(
						(n): CanvasCommand => ({ type: "node.delete", nodeId: n.id }),
					);
					break;
			}
			if (cmds) {
				e.preventDefault();
				dispatch(cmds);
			}
		};

		container.addEventListener("keydown", onKeyDown);
		return () => container.removeEventListener("keydown", onKeyDown);
	}, [
		stage,
		selectionStore,
		getIR,
		activePageId,
		commit,
		commitBatch,
		ctx,
		nudgeStep,
		rotateStep,
	]);
}

/** Null-rendering layer that activates {@link useCanvasKeyboard} inside the provider. */
export function CanvasKeyboardLayer(opts: CanvasKeyboardOptions = {}): null {
	useCanvasKeyboard(opts);
	return null;
}
