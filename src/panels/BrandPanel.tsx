"use client";

import {
	applyBrandColors,
	type BrandApplyResult,
	type BrandAsset,
	type BrandComplianceIssue,
	type BrandComplianceReport,
	type CanvasCommand,
	createImage,
	generateBrandComplianceReport,
	normalizeTypography,
	replaceFonts,
	replaceLogoPlaceholders,
} from "@anvilkit/canvas-core";
import { Button } from "@anvilkit/ui/button";
import { cn } from "@anvilkit/ui/lib/utils";
import { useState } from "react";
import {
	useBrandColors,
	useBrandFonts,
	useBrandKitDefinition,
	useBrandLogos,
} from "../brand/use-brand-kit.js";
import {
	type CanvasT,
	useCanvasStudio,
	useCanvasT,
} from "../context/canvas-studio-context.js";

export interface BrandPanelProps {
	className?: string;
}

/** FR-141: default square size for a standalone logo insert (no natural size on {@link BrandAsset}). */
const LOGO_INSERT_SIZE = 120;

type ApplyActionKind = "colors" | "fonts" | "logos" | "typography";

const APPLY_ACTIONS: ReadonlyArray<{
	kind: ApplyActionKind;
	labelKey: string;
	fallback: string;
}> = [
	{
		kind: "colors",
		labelKey: "canvas.brand.applyColors",
		fallback: "Link brand colors",
	},
	{
		kind: "fonts",
		labelKey: "canvas.brand.applyFonts",
		fallback: "Link brand fonts",
	},
	{
		kind: "logos",
		labelKey: "canvas.brand.applyLogos",
		fallback: "Fill logo placeholders",
	},
	{
		kind: "typography",
		labelKey: "canvas.brand.applyTypography",
		fallback: "Normalize typography",
	},
];

/** Shared with the inspector's passive warnings (C-07) — one wording everywhere. */
export function complianceIssueMessage(
	t: CanvasT,
	issue: BrandComplianceIssue,
): string {
	switch (issue.code) {
		case "unresolved-color-token":
		case "unresolved-font-token":
			return t(
				"canvas.brand.complianceUnresolvedToken",
				"References a brand token that no longer exists.",
			);
		case "forbidden-color":
		case "forbidden-font":
			return t(
				"canvas.brand.complianceForbidden",
				"Uses a forbidden brand value.",
			);
		default:
			return t(
				"canvas.brand.complianceOffBrand",
				"Doesn't match the brand kit.",
			);
	}
}

/**
 * Brand-kit panel: the host's shared palette + fonts (I3-4), plus — when the
 * host supplied a full `BrandKitDefinition` (canvas-m2-005) — a compliance
 * check and apply-brand-kit actions (canvas-m2-006, FR-032). "Check
 * compliance" computes a preview of every action's effect (count of affected
 * nodes) and a compliance report WITHOUT touching the document; each action
 * button then commits its own transform as one reversible step. Testids
 * (`brand-section` / `brand-palette` / `brand-fonts`) are unchanged.
 */
export function BrandPanel({
	className,
}: BrandPanelProps): React.JSX.Element | null {
	const ctx = useCanvasStudio();
	const colors = useBrandColors();
	const fonts = useBrandFonts();
	const logos = useBrandLogos();
	const definition = useBrandKitDefinition();
	const t = useCanvasT();
	const [preview, setPreview] = useState<Record<
		ApplyActionKind,
		BrandApplyResult
	> | null>(null);
	const [complianceReport, setComplianceReport] =
		useState<BrandComplianceReport | null>(null);
	const hasBrand = colors.length > 0 || fonts.length > 0 || logos.length > 0;

	if (!hasBrand) {
		return (
			<div
				className={cn("flex flex-col gap-3 p-4", className)}
				data-testid="brand-section"
			>
				<div className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
					{t("canvas.brand.title", "Brand kit")}
				</div>
				<div
					data-testid="brand-empty-state"
					className="p-2 text-xs text-muted-foreground italic"
				>
					{t("canvas.brand.noBrandKit", "No brand kit is connected yet.")}
				</div>
			</div>
		);
	}

	/**
	 * FR-141 standalone logo insertion: click a logo → a new image node at
	 * page center, selected, ONE undo step — mirrors the paste/duplicate
	 * selection-after-create pattern. `asset.put` only fires when this
	 * logo's asset isn't already registered in the document (repeat inserts
	 * of the same logo reuse it, matching `regenerateNodeIds`-based flows
	 * elsewhere that never duplicate an unchanged asset record).
	 */
	function insertLogo(logo: BrandAsset): void {
		const ir = ctx.getIR();
		const page = ir.pages.find((p) => p.id === ctx.activePageId);
		if (!page) return;
		const node = createImage({
			assetId: logo.id,
			bounds: { width: LOGO_INSERT_SIZE, height: LOGO_INSERT_SIZE },
			transform: {
				x: (page.size.width - LOGO_INSERT_SIZE) / 2,
				y: (page.size.height - LOGO_INSERT_SIZE) / 2,
			},
		});
		const cmds: CanvasCommand[] = [
			...(ir.assets[logo.id]
				? []
				: [
						{
							type: "asset.put" as const,
							asset: { id: logo.id, uri: logo.uri },
						},
					]),
			{ type: "node.create" as const, node, pageId: page.id },
		];
		const first = cmds[0];
		if (cmds.length === 1 && first) ctx.commit(first);
		else ctx.commitBatch(cmds, "Add logo");
		ctx.selectionStore.getState().setSelection([node.id]);
	}

	function checkCompliance(): void {
		if (!definition) return;
		const ir = ctx.getIR();
		setPreview({
			colors: applyBrandColors(ir, definition),
			fonts: replaceFonts(ir, definition),
			logos: replaceLogoPlaceholders(ir, definition),
			typography: normalizeTypography(ir, definition),
		});
		setComplianceReport(generateBrandComplianceReport(ir, definition));
	}

	function apply(kind: ApplyActionKind): void {
		const result = preview?.[kind];
		if (!result?.command) return;
		ctx.commit(result.command);
		// The applied document has moved on — clear the stale preview/report
		// rather than show counts that no longer reflect the live document.
		setPreview(null);
		setComplianceReport(null);
	}

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
			{logos.length > 0 ? (
				<div className="flex flex-col gap-1.5">
					<div className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
						{t("canvas.brand.logos", "Logos")}
					</div>
					<div className="flex flex-wrap gap-1.5" data-testid="brand-logos">
						{logos.map((logo) => (
							<button
								key={logo.id}
								type="button"
								data-testid={`brand-logo-${logo.id}`}
								title={t("canvas.brand.insertLogo", "Insert {name}").replace(
									"{name}",
									logo.name,
								)}
								aria-label={t(
									"canvas.brand.insertLogo",
									"Insert {name}",
								).replace("{name}", logo.name)}
								className="flex h-12 w-12 items-center justify-center rounded-md ring-1 ring-border hover:ring-2 hover:ring-primary"
								onClick={() => insertLogo(logo)}
							>
								<img
									src={logo.uri}
									alt=""
									className="max-h-full max-w-full object-contain"
								/>
							</button>
						))}
					</div>
				</div>
			) : null}

			{definition ? (
				<div className="flex flex-col gap-2 border-t border-border pt-3">
					<Button
						size="sm"
						variant="outline"
						data-testid="brand-check-compliance"
						onClick={checkCompliance}
					>
						{t("canvas.brand.checkCompliance", "Check brand compliance")}
					</Button>

					{preview ? (
						<div
							className="flex flex-col gap-1.5"
							data-testid="brand-apply-actions"
						>
							{APPLY_ACTIONS.map(({ kind, labelKey, fallback }) => {
								const count = preview[kind].report.affectedNodeIds.length;
								return (
									<div
										key={kind}
										className="flex items-center justify-between gap-2"
									>
										<span className="text-xs text-muted-foreground">
											{t(labelKey, fallback)} ({count})
										</span>
										<Button
											size="sm"
											disabled={count === 0}
											data-testid={`brand-apply-${kind}`}
											onClick={() => apply(kind)}
										>
											{t("canvas.brand.apply", "Apply")}
										</Button>
									</div>
								);
							})}
						</div>
					) : null}

					{complianceReport ? (
						<div
							className="flex flex-col gap-1 text-[11px] text-muted-foreground"
							data-testid="brand-compliance-report"
						>
							{complianceReport.issues.length === 0 ? (
								<span>
									{t(
										"canvas.brand.complianceNone",
										"No compliance issues found.",
									)}
								</span>
							) : (
								complianceReport.issues.map((issue) => (
									<span key={`${issue.nodeId}-${issue.code}-${issue.property}`}>
										{issue.property}: {complianceIssueMessage(t, issue)}
									</span>
								))
							)}
						</div>
					) : null}
				</div>
			) : null}
		</div>
	);
}
