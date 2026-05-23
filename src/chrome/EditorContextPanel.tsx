"use client";

import { cn } from "@anvilkit/ui/lib/utils";
import { Separator } from "@anvilkit/ui/separator";
import { useBrandColors, useBrandFonts } from "../brand/use-brand-kit.js";
import { BrandPanel } from "../panels/BrandPanel.js";
import { LayerPanel } from "../panels/LayerPanel.js";

export interface EditorContextPanelProps {
	className?: string;
}

/**
 * Left context panel (reference `.editor-panel`, col 2). Hosts the layer tree
 * and — when the host configured a {@link BrandKit} — a compact brand section
 * (palette + fonts) sourced from `useBrandColors` / `useBrandFonts`.
 */
export function EditorContextPanel({
	className,
}: EditorContextPanelProps): React.JSX.Element {
	const colors = useBrandColors();
	const fonts = useBrandFonts();
	const hasBrand = colors.length > 0 || fonts.length > 0;

	return (
		<aside
			data-testid="editor-context-panel"
			className={cn(
				"flex h-full flex-col overflow-hidden border-r border-border bg-card",
				className,
			)}
		>
			<div className="flex min-h-0 flex-1 flex-col">
				<LayerPanel />
			</div>
			{hasBrand ? (
				<>
					<Separator />
					<BrandPanel />
				</>
			) : null}
		</aside>
	);
}
