import {
	type CanvasCommand,
	type CanvasNode,
	findNode,
	parentOf,
} from "@anvilkit/canvas-core";
import { useEffect, useRef } from "react";
import { useCanvasStudio } from "../context/canvas-studio-context.js";
import {
	groupSelection,
	ungroupSelection,
} from "../selection/group-actions.js";
import { progressiveSelectAllImpl } from "../selection/isolation.js";
import type { ToolId } from "../stores/tool-store.js";
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
	const {
		stage,
		selectionStore,
		getIR,
		activePageId,
		commit,
		commitBatch,
		commitCoalesced,
	} = ctx;
	const nudgeStep = opts.nudgeStep ?? 1;
	const rotateStep = opts.rotateStep ?? 1;
	// FR-041/043 space-hold Hand tool: the tool active when Space was first
	// pressed, restored on keyup — null while Space isn't held. A ref (not
	// state) since it must survive across renders without triggering one.
	const spaceHeldToolRef = useRef<ToolId | null>(null);

	useEffect(() => {
		if (!stage) return;
		const container = stage.container();
		if (!container) return;

		const dispatch = (cmds: CanvasCommand[]): void => {
			if (cmds.length === 0) return;
			if (cmds.length > 1) commitBatch(cmds);
			else if (cmds[0]) commit(cmds[0]);
		};

		// Nudge/resize/rotate repeat on every OS key-repeat while a key is held
		// (E-18): a 2s hold would otherwise flood history with ~30 undo entries
		// and ~30 collab broadcasts. Coalesce dispatches sharing the same key +
		// modifier + selection into one undo entry, the same way a drag does.
		const dispatchCoalesced = (
			cmds: CanvasCommand[],
			mergeKey: string,
		): void => {
			if (cmds.length === 0) return;
			if (!commitCoalesced) {
				dispatch(cmds);
				return;
			}
			if (cmds.length === 1 && cmds[0]) {
				commitCoalesced(cmds[0], mergeKey);
				return;
			}
			commitCoalesced({ type: "batch", commands: cmds }, mergeKey);
		};

		const onKeyDown = (e: KeyboardEvent): void => {
			const target = e.target as HTMLElement | null;
			if (
				target &&
				(target.isContentEditable || EDITABLE_TAG.test(target.tagName))
			) {
				return;
			}
			// FR-041/043: hold Space for a temporary Hand tool + drag-pan. Setting
			// `activeTool` to "hand" is the ENTIRE implementation — `handTool`
			// already owns cursor/drag-pan/cleanup via its onActivate/onDeactivate
			// lifecycle (ToolInteractionLayer fires these on every tool switch), so
			// there's nothing else to wire. Guarded by the ref (not `e.repeat`) so
			// OS key-repeat keydowns are no-ops once already held.
			if (e.code === "Space") {
				e.preventDefault();
				if (spaceHeldToolRef.current === null) {
					spaceHeldToolRef.current = ctx.toolStore.getState().activeTool;
					if (spaceHeldToolRef.current !== "hand") {
						ctx.toolStore.getState().setActiveTool("hand");
					}
				}
				return;
			}
			// Undo / redo (⌘Z / ⌘⇧Z, plus Ctrl+Y on Windows/Linux). Kept STAGE-
			// scoped on purpose (M0-03 → A-04 decision): headless <CanvasStudio>
			// embeds get undo keys over the stage, while the workspace registry
			// (WorkspaceShortcutLayer) covers the rest of the shell and SKIPS
			// events this handler claims via preventDefault — no double-fire.
			// Mirrors the header buttons' historyStore → sceneStore wiring, and
			// runs before the selection guard: history operations need no
			// selection.
			if (
				(e.metaKey || e.ctrlKey) &&
				(e.key === "z" || e.key === "Z" || e.key === "y" || e.key === "Y")
			) {
				e.preventDefault();
				const isRedo = e.key === "y" || e.key === "Y" || e.shiftKey;
				const history = ctx.historyStore.getState();
				if (isRedo ? !history.canRedo() : !history.canUndo()) return;
				// Prefer the context-level seam — it fires onChange/onChanges like
				// every other commit (E-20). Partial test contexts without it fall
				// back to the pre-P0-9 direct historyStore -> sceneStore wiring;
				// the store itself is crash-safe either way (a stale inverse is
				// dropped, not thrown).
				if (isRedo) {
					if (ctx.redo) ctx.redo();
					else ctx.sceneStore?.getState().setIR(history.redo(getIR()));
				} else if (ctx.undo) {
					ctx.undo();
				} else {
					ctx.sceneStore?.getState().setIR(history.undo(getIR()));
				}
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
				if (e.shiftKey) {
					const children = page.root.children;
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
					// FR-190 progressive select-all: same isolation-scoped path the
					// context menu uses, so ⌘A respects the active container scope
					// (and never selects into a locked container's exterior).
					progressiveSelectAllImpl(ctx);
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
				dispatchCoalesced(cmds, `${e.key}:${shift}:${ids.join(",")}`);
			}
		};

		const onKeyUp = (e: KeyboardEvent): void => {
			if (e.code !== "Space") return;
			const previous = spaceHeldToolRef.current;
			spaceHeldToolRef.current = null;
			// Only restore if still on "hand" — a tool picked explicitly while
			// Space was held (e.g. a toolbar click) must not be clobbered.
			if (
				previous !== null &&
				previous !== "hand" &&
				ctx.toolStore.getState().activeTool === "hand"
			) {
				ctx.toolStore.getState().setActiveTool(previous);
			}
		};

		container.addEventListener("keydown", onKeyDown);
		container.addEventListener("keyup", onKeyUp);
		return () => {
			container.removeEventListener("keydown", onKeyDown);
			container.removeEventListener("keyup", onKeyUp);
		};
	}, [
		stage,
		selectionStore,
		getIR,
		activePageId,
		commit,
		commitBatch,
		commitCoalesced,
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
