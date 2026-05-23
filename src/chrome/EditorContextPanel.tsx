"use client";

import { cn } from "@anvilkit/ui/lib/utils";
import { Separator } from "@anvilkit/ui/separator";
import { useBrandColors, useBrandFonts } from "../brand/use-brand-kit.js";
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
					<div className="flex flex-col gap-3 p-4" data-testid="brand-section">
						<div className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
							Brand kit
						</div>
						{colors.length > 0 ? (
							<div className="flex gap-1.5" data-testid="brand-palette">
								{colors.map((c) => (
									<span
										key={c.name}
										title={`${c.name} · ${c.value}`}
										className="h-7 flex-1 rounded-md ring-1 ring-border"
										style={{ backgroundColor: c.value }}
									/>
								))}
							</div>
						) : null}
						{fonts.length > 0 ? (
							<div className="flex flex-col gap-1" data-testid="brand-fonts">
								{fonts.map((f) => (
									<div
										key={f}
										className="text-xs text-muted-foreground"
										style={{ fontFamily: f }}
									>
										{f}
									</div>
								))}
							</div>
						) : null}
					</div>
				</>
			) : null}
		</aside>
	);
}
