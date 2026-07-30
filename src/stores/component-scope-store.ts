import { MAX_COMPONENT_NESTED_DEPTH } from "@anvilkit/canvas-core";
import { createStore, type StoreApi } from "zustand/vanilla";

/**
 * @file Component Source editing scope (plan 0023 M4-05, LC-CREATE-002, TD §11.1).
 *
 * UI STATE ONLY — a scope never enters the Canvas IR, and navigating is never a
 * document command (PRD §9.11). Editing a Source means pointing the editor's
 * surfaces at `ir.components[componentId].root` instead of a page tree; nothing
 * is inserted into `ir.pages` to make that happen.
 *
 * A STACK rather than a single frame, because the nesting is real: a user can
 * enter A's Source, select a nested B instance inside it, and edit B's Source.
 * Escape pops exactly one frame.
 *
 * `isolation-store` deliberately is NOT reused. Its `validateIsolationPath`
 * trims every entry that is not a real container reachable from the PAGE root,
 * so a component scope — which by definition lives outside `ir.pages` — would be
 * silently discarded on the next validation pass.
 */

/**
 * Where exiting a frame should put the user back.
 *
 * A frame can be entered from a page OR from another component's Source, so the
 * return address is a discriminated union rather than a page id — that is what
 * makes arbitrary-depth nesting exit correctly instead of always dumping the
 * user back on a page.
 */
export type CanvasComponentReturnSelection =
	| {
			readonly kind: "page";
			readonly pageId: string;
			readonly selectedIds: readonly string[];
	  }
	| {
			readonly kind: "component";
			readonly componentId: string;
			readonly selectedIds: readonly string[];
	  };

export interface CanvasComponentEditingFrame {
	readonly componentId: string;
	/** Restored by the caller when this frame is popped (M5-03). */
	readonly returnSelection: CanvasComponentReturnSelection;
}

/** Why {@link ComponentScopeState.enter} refused. */
export type CanvasComponentScopeRejection =
	/** The component is already open further up the stack — the interactive face
	 *  of the DAG rule: entering it again is the start of a cycle. */
	| "already-open"
	/** Nesting deeper than the resolver would expand (`MAX_COMPONENT_NESTED_DEPTH`). */
	| "depth-exceeded";

export interface ComponentScopeState {
	/** Outermost frame first; the LAST entry is the active editing scope. */
	readonly stack: readonly CanvasComponentEditingFrame[];
	/**
	 * Push a frame. Returns `null` on success, or why it was refused — callers
	 * surface the diagnostic rather than failing silently.
	 */
	enter: (
		frame: CanvasComponentEditingFrame,
	) => CanvasComponentScopeRejection | null;
	/** Pop the innermost frame and return it, so the caller can restore its
	 *  `returnSelection`. `null` when the stack is already empty. */
	exitOne: () => CanvasComponentEditingFrame | null;
	/** Pop everything and return the OUTERMOST frame — the one whose
	 *  `returnSelection` points back at a page. `null` when not editing. */
	exitAll: () => CanvasComponentEditingFrame | null;
	/** The active frame, or `null` when editing a page. */
	activeFrame: () => CanvasComponentEditingFrame | null;
	/** True when `componentId` is anywhere on the stack. */
	isOpen: (componentId: string) => boolean;
}

export type ComponentScopeStoreApi = StoreApi<ComponentScopeState>;

const EMPTY: readonly CanvasComponentEditingFrame[] = [];

export interface CreateComponentScopeStoreOptions {
	/** Override only for tests; defaults to the resolver's own nesting cap so the
	 *  UI can never open a scope deeper than a document could legally express. */
	readonly maxDepth?: number;
}

export function createComponentScopeStore(
	options: CreateComponentScopeStoreOptions = {},
): ComponentScopeStoreApi {
	const maxDepth = options.maxDepth ?? MAX_COMPONENT_NESTED_DEPTH;
	return createStore<ComponentScopeState>()((set, get) => ({
		stack: EMPTY,
		enter(frame) {
			const { stack } = get();
			if (stack.some((f) => f.componentId === frame.componentId)) {
				return "already-open";
			}
			if (stack.length >= maxDepth) return "depth-exceeded";
			set({ stack: [...stack, frame] });
			return null;
		},
		exitOne() {
			const { stack } = get();
			const innermost = stack.at(-1);
			if (!innermost) return null;
			set({ stack: stack.slice(0, -1) });
			return innermost;
		},
		exitAll() {
			const { stack } = get();
			const outermost = stack[0];
			if (!outermost) return null;
			set({ stack: EMPTY });
			return outermost;
		},
		activeFrame() {
			return get().stack.at(-1) ?? null;
		},
		isOpen(componentId) {
			return get().stack.some((f) => f.componentId === componentId);
		},
	}));
}
