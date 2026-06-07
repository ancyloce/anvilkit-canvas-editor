"use client";

import { cn } from "@anvilkit/ui/lib/utils";
import { useBrandColors, useBrandFonts } from "../brand/use-brand-kit.js";
import { useCanvasT } from "../context/canvas-studio-context.js";

export interface BrandPanelProps {
	className?: string;
}

/**
 * Brand-kit panel: the host's shared palette + fonts (I3-4), sourced from
 * `useBrandColors` / `useBrandFonts`. Mounted by the `CanvasWorkspace` Tab
 * Panel (brand dock). Renders `null` when no brand kit is configured. Testids
 * (`brand-section` / `brand-palette` / `brand-fonts`) are unchanged.
 */
export function BrandPanel({
	className,
}: BrandPanelProps): React.JSX.Element | null {
	const colors = useBrandColors();
	const fonts = useBrandFonts();
	const t = useCanvasT();
	const hasBrand = colors.length > 0 || fonts.length > 0;

	if (!hasBrand) return null;

	return (
		<div
			className={cn("flex flex-col gap-3 p-4", className)}
			data-testid="brand-section"
		>
			<div className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
				{t("canvas.brand.title", "Brand kit")}
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
	);
}
