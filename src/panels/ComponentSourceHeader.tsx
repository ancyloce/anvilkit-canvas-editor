"use client";

import { Button } from "@anvilkit/ui/button";
import { cn } from "@anvilkit/ui/lib/utils";
import { ChevronRight, Component, X } from "lucide-react";
import * as React from "react";
import { useSyncExternalStore } from "react";
import {
	exitAllComponentSourcesImpl,
	exitComponentSourceImpl,
} from "../actions/component-actions.js";
import {
	useCanvasStudio,
	useCanvasT,
} from "../context/canvas-studio-context.js";

/**
 * @file Source-editing breadcrumb (plan 0023 M5-03, LC-CREATE-002, AC-007).
 *
 * Renders the WHOLE scope stack, not just the innermost frame: nesting is real
 * (A's Source can hold a B instance whose Source is also open), and a user
 * several frames deep needs to see the path and be able to jump out of any level
 * of it.
 *
 * Renders nothing while editing a page, so mounting it unconditionally is safe.
 * Navigation is never a document command — clicking a crumb pops frames and
 * restores each one's return selection, and touches no IR.
 */

export interface ComponentSourceHeaderProps {
	className?: string;
}

export function ComponentSourceHeader({
	className,
}: ComponentSourceHeaderProps): React.JSX.Element | null {
	const ctx = useCanvasStudio();
	const t = useCanvasT();
	const scopeStore = ctx.componentScopeStore;
	const stack = useSyncExternalStore(
		scopeStore ? scopeStore.subscribe : NOOP_SUBSCRIBE,
		() => scopeStore?.getState().stack,
		() => undefined,
	);

	if (!stack || stack.length === 0) return null;

	/** Pop frames until `depth` is the innermost one (0 = leave everything). */
	const popTo = (depth: number): void => {
		if (depth === 0) {
			exitAllComponentSourcesImpl(ctx);
			return;
		}
		while ((scopeStore?.getState().stack.length ?? 0) > depth) {
			if (exitComponentSourceImpl(ctx) === null) break;
		}
	};

	const nameOf = (componentId: string): string =>
		ctx.ir.components?.[componentId]?.name ??
		// A frame whose definition vanished (deleted by a remote peer, or undone)
		// still renders — the user must be able to see where they are and leave.
		t("canvas.component.missing", "Missing component");

	return (
		<div
			data-testid="component-source-header"
			// `aria-live` so entering/leaving a Source is announced without moving
			// focus (NFR-004); the crumbs themselves stay ordinary buttons.
			aria-live="polite"
			className={cn(
				"flex items-center gap-1 border-b bg-muted/40 px-2 py-1.5 text-xs",
				className,
			)}
		>
			<Component
				className="size-3.5 shrink-0 text-muted-foreground"
				aria-hidden
			/>
			<nav
				aria-label={t("canvas.component.scopeTrail", "Component editing scope")}
				className="flex min-w-0 flex-1 items-center gap-0.5"
			>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="h-6 shrink-0 px-1.5 text-xs font-normal text-muted-foreground"
					data-testid="component-crumb-page"
					title={t("canvas.component.backToPage", "Back to the page")}
					onClick={() => popTo(0)}
				>
					{t("canvas.component.page", "Page")}
				</Button>
				{stack.map((frame, index) => {
					const innermost = index === stack.length - 1;
					return (
						<span
							key={frame.componentId}
							className="flex min-w-0 items-center gap-0.5"
						>
							<ChevronRight
								className="size-3 shrink-0 text-muted-foreground"
								aria-hidden
							/>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								// The innermost crumb IS the current scope, so it is not a
								// navigation target — marked current instead of clickable.
								disabled={innermost}
								aria-current={innermost ? "true" : undefined}
								className={cn(
									"h-6 min-w-0 px-1.5 text-xs",
									innermost
										? "font-medium text-foreground disabled:opacity-100"
										: "font-normal text-muted-foreground",
								)}
								data-testid={`component-crumb-${frame.componentId}`}
								onClick={() => popTo(index + 1)}
							>
								<span className="truncate">{nameOf(frame.componentId)}</span>
							</Button>
						</span>
					);
				})}
			</nav>
			<Button
				type="button"
				variant="ghost"
				size="icon"
				className="size-6 shrink-0"
				data-testid="component-source-exit"
				title={t("canvas.component.exitSource", "Exit component editing")}
				onClick={() => exitComponentSourceImpl(ctx)}
			>
				<X className="size-3.5" aria-hidden />
			</Button>
		</div>
	);
}

const NOOP_SUBSCRIBE = () => () => undefined;
