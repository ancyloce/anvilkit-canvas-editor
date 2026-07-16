"use client";

import { findNode } from "@anvilkit/canvas-core";
import { Button } from "@anvilkit/ui/button";
import { X } from "lucide-react";
import * as React from "react";
import { useSyncExternalStore } from "react";
import {
	useCanvasStudio,
	useCanvasT,
} from "../../context/canvas-studio-context.js";

const NOOP_UNSUBSCRIBE = (): void => {
	// Partial test contexts have no isolation store; nothing to release.
};
const NOOP_SUBSCRIBE = (): (() => void) => NOOP_UNSUBSCRIBE;
const EMPTY_PATH: readonly string[] = [];

/**
 * FR-055 breadcrumb chip (C-09): shows the isolation context stack over the
 * canvas while a container is isolated — each crumb names a container,
 * clicking a crumb pops back TO that level, and the ✕ exits isolation
 * entirely. Hidden when the stack is empty.
 */
export function IsolationBreadcrumb(): React.JSX.Element | null {
	const ctx = useCanvasStudio();
	const store = ctx.isolationStore;
	const path = useSyncExternalStore(
		store?.subscribe ?? NOOP_SUBSCRIBE,
		() => store?.getState().path ?? EMPTY_PATH,
		() => store?.getState().path ?? EMPTY_PATH,
	);
	const t = useCanvasT();
	if (!store || path.length === 0) return null;

	const labelFor = (id: string): string => {
		const found = findNode(ctx.ir, id);
		if (!found) return id;
		return (
			found.node.name ??
			(found.node.type === "frame"
				? t("canvas.layer.kind.frame", "Frame")
				: t("canvas.layer.kind.group", "Group"))
		);
	};

	return (
		<div
			data-testid="isolation-breadcrumb"
			role="status"
			className="pointer-events-auto absolute top-2 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-background/95 py-1 pr-1 pl-3 text-xs shadow-md"
		>
			<span className="text-muted-foreground">
				{t("canvas.isolation.editing", "Editing")}
			</span>
			{path.map((id, index) => (
				<Button
					key={id}
					type="button"
					variant="ghost"
					size="sm"
					className="h-5 px-1.5 text-xs font-medium"
					data-testid={`isolation-crumb-${id}`}
					onClick={() => {
						// Pop back TO this crumb (drop everything after it).
						store.getState().setPath(path.slice(0, index + 1));
					}}
				>
					{labelFor(id)}
				</Button>
			))}
			<Button
				type="button"
				variant="ghost"
				size="icon-xs"
				data-testid="isolation-exit"
				aria-label={t("canvas.isolation.exit", "Exit isolation")}
				title={t("canvas.isolation.exit", "Exit isolation")}
				onClick={() => store.getState().exitAll()}
			>
				<X aria-hidden />
			</Button>
		</div>
	);
}
