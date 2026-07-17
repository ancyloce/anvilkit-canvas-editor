"use client";

import { Button } from "@anvilkit/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@anvilkit/ui/dialog";
import { Input } from "@anvilkit/ui/input";
import { useMemo, useState, useSyncExternalStore } from "react";
import { useCanvasT } from "../../context/canvas-studio-context.js";
import {
	type CanvasShortcutBinding,
	type CanvasShortcutOptions,
	type CanvasShortcutPlatform,
	detectShortcutPlatform,
	formatShortcut,
	resolveShortcutBindings,
} from "../shortcuts/shortcut-registry.js";

export interface ShortcutHelpDialogProps {
	/** The workspace's shortcut options, so host-provided entries show too. */
	options?: CanvasShortcutOptions;
	onClose: () => void;
}

/** Built-in category order; host categories append after, alphabetically. */
const CATEGORY_ORDER = ["edit", "view", "tools"];

const CATEGORY_LABELS: Record<string, [string, string]> = {
	edit: ["canvas.shortcutHelp.categoryEdit", "Editing"],
	view: ["canvas.shortcutHelp.categoryView", "View"],
	tools: ["canvas.shortcutHelp.categoryTools", "Tools"],
};

const subscribeToPlatform = (): (() => void) => () => {};

/**
 * FR-042 shortcut help (AC-004): searchable, category-grouped, with
 * platform-specific key labels GENERATED from the registry (§8.7 — never
 * hand-translated) and host-registered bindings included. Lazy-loaded like
 * every dialog-class surface (constraint 20.15).
 */
export default function ShortcutHelpDialog({
	options,
	onClose,
}: ShortcutHelpDialogProps): React.JSX.Element {
	const t = useCanvasT();
	const [query, setQuery] = useState("");
	const platform = useSyncExternalStore(
		subscribeToPlatform,
		detectShortcutPlatform,
		(): CanvasShortcutPlatform => "other",
	);
	const bindings = useMemo(() => resolveShortcutBindings(options), [options]);

	const groups = useMemo(() => {
		const q = query.trim().toLowerCase();
		const byCategory = new Map<string, CanvasShortcutBinding[]>();
		for (const binding of bindings) {
			const label = t(binding.labelKey, binding.label);
			if (q && !label.toLowerCase().includes(q)) continue;
			const list = byCategory.get(binding.category) ?? [];
			list.push(binding);
			byCategory.set(binding.category, list);
		}
		const known = CATEGORY_ORDER.filter((c) => byCategory.has(c));
		const custom = [...byCategory.keys()]
			.filter((c) => !CATEGORY_ORDER.includes(c))
			.sort();
		return [...known, ...custom].map((category) => ({
			category,
			bindings: byCategory.get(category) ?? [],
		}));
	}, [bindings, query, t]);

	const categoryLabel = (category: string): string => {
		const entry = CATEGORY_LABELS[category];
		return entry ? t(entry[0], entry[1]) : category;
	};

	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent data-testid="shortcut-help-dialog">
				<DialogHeader>
					<DialogTitle>
						{t("canvas.shortcutHelp.title", "Keyboard shortcuts")}
					</DialogTitle>
				</DialogHeader>
				<Input
					type="search"
					autoFocus
					value={query}
					data-testid="shortcut-help-search"
					aria-label={t("canvas.shortcutHelp.search", "Search shortcuts")}
					placeholder={t("canvas.shortcutHelp.search", "Search shortcuts")}
					className="h-8"
					onChange={(e) => setQuery(e.currentTarget.value)}
				/>
				<div className="flex max-h-80 flex-col gap-3 overflow-y-auto text-sm">
					{groups.length === 0 ? (
						<p
							className="text-xs text-muted-foreground italic"
							data-testid="shortcut-help-empty"
						>
							{t("canvas.shortcutHelp.empty", "No shortcuts match.")}
						</p>
					) : (
						groups.map(({ category, bindings: list }) => (
							<section key={category}>
								<h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
									{categoryLabel(category)}
								</h3>
								<ul className="flex flex-col gap-0.5">
									{list.map((binding) => (
										<li
											key={binding.id}
											data-testid={`shortcut-help-row-${binding.id}`}
											className="flex items-center justify-between gap-3 rounded px-1.5 py-0.5"
										>
											<span>{t(binding.labelKey, binding.label)}</span>
											<span className="flex gap-1">
												{binding.combos.map((combo) => (
													<kbd
														key={formatShortcut(combo, platform)}
														className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px]"
													>
														{formatShortcut(combo, platform)}
													</kbd>
												))}
											</span>
										</li>
									))}
								</ul>
							</section>
						))
					)}
				</div>
				<Button
					type="button"
					variant="outline"
					data-testid="shortcut-help-close"
					className="self-end"
					onClick={onClose}
				>
					{t("canvas.dialog.close", "Close")}
				</Button>
			</DialogContent>
		</Dialog>
	);
}
