"use client";

import { useEffect, useMemo } from "react";
import { useCanvasActions } from "../../actions/editor-actions.js";
import { useCanvasStores } from "../../context/canvas-studio-context.js";
import {
	type CanvasShortcutOptions,
	matchesCombo,
	resolveShortcutBindings,
} from "./shortcut-registry.js";

const EDITABLE_TAG = /^(INPUT|TEXTAREA|SELECT)$/;

export interface WorkspaceShortcutLayerProps {
	/** The workspace root element the keydown listener attaches to. */
	rootRef: React.RefObject<HTMLElement | null>;
	options?: CanvasShortcutOptions;
}

/**
 * Null-rendering layer that installs the workspace shortcut registry
 * (A-04, FR-040). Mounted by `<CanvasWorkspace>` unless `shortcuts={false}`;
 * never mounted by headless `<CanvasStudio>`. Skips keystrokes originating in
 * form fields / contenteditable (typing guard) and events a lower layer —
 * e.g. the stage-scoped `useCanvasKeyboard` — already claimed via
 * `preventDefault`, so stage and workspace bindings never double-fire.
 */
export function WorkspaceShortcutLayer({
	rootRef,
	options,
}: WorkspaceShortcutLayerProps): null {
	const stores = useCanvasStores();
	const actions = useCanvasActions();
	const bindings = useMemo(() => resolveShortcutBindings(options), [options]);

	useEffect(() => {
		const el = rootRef.current;
		if (!el) return;
		const onKeyDown = (e: KeyboardEvent): void => {
			if (e.defaultPrevented) return;
			const target = e.target as HTMLElement | null;
			if (
				target &&
				(target.isContentEditable || EDITABLE_TAG.test(target.tagName))
			) {
				return;
			}
			for (const binding of bindings) {
				if (binding.combos.some((combo) => matchesCombo(e, combo))) {
					e.preventDefault();
					binding.run({ stores, actions });
					return;
				}
			}
		};
		el.addEventListener("keydown", onKeyDown);
		return () => el.removeEventListener("keydown", onKeyDown);
	}, [rootRef, bindings, stores, actions]);

	return null;
}
