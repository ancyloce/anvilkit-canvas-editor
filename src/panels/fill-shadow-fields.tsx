import {
	type CanvasDropShadowEffect,
	type CanvasEffect,
	type CanvasFill,
	type CanvasGradientFill,
	type CanvasGradientStop,
	type CanvasNode,
	type CanvasShadow,
	firstDropShadow,
	resolveNodeEffects,
} from "@anvilkit/canvas-core";
import { Button } from "@anvilkit/ui/button";
import { useSyncExternalStore } from "react";
import { resolveFillForDisplay } from "../brand/resolve-brand-token.js";
import { useBrandKit } from "../brand/use-brand-kit.js";
import type { CanvasT } from "../context/canvas-studio-context.js";
import { recentColorsStore } from "../stores/recent-colors-store.js";
import {
	ColorField,
	type CommitPatchAll,
	FieldRow,
	NumberField,
} from "./fields.js";
import { TokenAwareColorField } from "./token-aware-fields.js";

type FillKind = "none" | "solid" | "linear" | "radial";

/** Split a `#rrggbb` / `#rrggbbaa` color into its base hex and 0–1 alpha. */
function splitAlpha(color: string): { base: string; alpha: number } {
	if (/^#[0-9a-fA-F]{8}$/.test(color)) {
		const alpha = Number.parseInt(color.slice(7, 9), 16) / 255;
		return { base: color.slice(0, 7), alpha };
	}
	return { base: color, alpha: 1 };
}

/** Compose a base `#rrggbb` with a 0–1 alpha into `#rrggbb` (α=1) or `#rrggbbaa`. */
function withAlpha(base: string, alpha: number): string {
	const clamped = Math.max(0, Math.min(1, alpha));
	if (clamped >= 1 || !/^#[0-9a-fA-F]{6}$/.test(base)) return base;
	const hex = Math.round(clamped * 255)
		.toString(16)
		.padStart(2, "0");
	return `${base}${hex}`;
}

/** Takes an ALREADY-RESOLVED value (see `resolveFillForDisplay`) — never a
 * `BrandTokenRef`, so `typeof === "object"` unambiguously means a gradient. */
function asGradient(
	fill: string | CanvasGradientFill | undefined,
): CanvasGradientFill | undefined {
	return fill && typeof fill === "object" ? fill : undefined;
}

function defaultGradient(
	kind: "linear" | "radial",
	startColor: string,
): CanvasGradientFill {
	return {
		kind,
		stops: [
			{ offset: 0, color: startColor },
			{ offset: 1, color: "#ffffff" },
		],
		from: { x: 0, y: 0 },
		to: { x: 1, y: 1 },
	};
}

const DEFAULT_DROP_SHADOW: CanvasDropShadowEffect = {
	type: "drop-shadow",
	color: "#000000",
	blur: 4,
	offsetX: 2,
	offsetY: 2,
};

/** Read the node's own fill/background — whichever `fillKey` points at. */
function fillOf(
	node: CanvasNode,
	fillKey: "fill" | "background",
): CanvasFill | undefined {
	return (
		node as unknown as Record<"fill" | "background", CanvasFill | undefined>
	)[fillKey];
}

/** The node's own resolved drop shadow (effects > legacy `shadow`, C-03 §9.4). */
function shadowOf(node: CanvasNode): CanvasDropShadowEffect | undefined {
	return firstDropShadow(
		resolveNodeEffects(
			node as { effects?: CanvasEffect[]; shadow?: CanvasShadow },
		),
	);
}

/**
 * Fill (solid / linear / radial gradient) + drop-shadow editing controls, shared
 * by every fill-bearing node kind's inspector section. Gradients support N stops
 * (each an editable color + position, add/remove, min 2); direction defaults to
 * the box diagonal (from 0,0 to 1,1).
 *
 * The shadow half reads through core's effect resolver (C-03 §9.4 precedence)
 * and WRITES the `effects` model: any edit upgrades the node — the patch
 * carries the full effect list and clears the legacy `shadow` field — so
 * documents migrate per node as they are touched, undoably.
 *
 * Most kinds store their fill under `fill` and support a shadow. A frame is the
 * exception on both counts — its fill lives under `background` and it has no
 * shadow — hence `fillKey` and `showShadow`.
 *
 * FR-070 (B-12 multi-kind sections): `nodes` is the WHOLE same-kind selection
 * (a single node for single-selection). Continuous fields (color, alpha,
 * shadow blur/x/y/spread) patch every node in ONE batch via the `contract`
 * prop, reading each node's OWN current fill/shadow when building its patch —
 * editing "shadow blur" across 2 rects with different offsets never clobbers
 * their individual offsets. Discrete controls (fill-type select, gradient
 * add/remove-stop, recent-color swatches, remove-shadow) batch via
 * `commitPatchAll`. Display values (the fill-type dropdown, gradient stops,
 * shadow fields) read from the FIRST selected node — there is no established
 * "mixed" convention for a color swatch or a native `<select>`, so — like
 * `ColorField` itself — those show the representative value, not a mixed flag.
 */
export function FillAndShadowFields({
	nodes,
	commitPatchAll,
	t,
	fillKey = "fill",
	showFill = true,
	showShadow = true,
}: {
	nodes: readonly CanvasNode[];
	commitPatchAll: CommitPatchAll;
	t: CanvasT;
	/** Which node property the fill is written back to. Frames use `background`. */
	fillKey?: "fill" | "background";
	/** Plain `text` (FR-081) has its own dedicated Color field and only wants
	 * this component's SHADOW half — no duplicate "Fill type"/Fill picker. */
	showFill?: boolean;
	/** Frames have no `shadow` field, so they hide the shadow controls. */
	showShadow?: boolean;
}): React.JSX.Element {
	const node = nodes[0] as CanvasNode;
	// `fill` may be a brand-token ref (canvas-m1-013): resolve it FIRST so
	// every read below sees only a plain color or a gradient, never a
	// `BrandTokenRef`. A solid fill gets the full token-aware picker
	// (canvas-m2-007); an unresolved token shows a visible badge there.
	const brandKit = useBrandKit();
	const recentColors = useSyncExternalStore(
		recentColorsStore.subscribe,
		() => recentColorsStore.getState().colors,
		() => recentColorsStore.getState().colors,
	);
	const fill = fillOf(node, fillKey);
	const fillDisplay = resolveFillForDisplay(fill, brandKit);
	const resolvedFill = fillDisplay.value;
	const grad = asGradient(resolvedFill);
	// FR-074 no-fill: an absent fill (and no unresolved token) reads as "none".
	const kind: FillKind = grad?.kind ?? (fill === undefined ? "none" : "solid");
	const solidColor =
		typeof resolvedFill === "string" ? resolvedFill : "#000000";
	const { alpha: solidAlpha } = splitAlpha(solidColor);

	/** Uniform fill replacement — every selected node gets the SAME next value. */
	const commitFillAll = (next: CanvasFill | undefined): void => {
		commitPatchAll(nodes, () => ({ [fillKey]: next }));
	};

	const effShadow = shadowOf(node);
	/** Replace the first drop shadow inside NODE's OWN effect list (other
	 * effects ride along), clearing the legacy field — per-node so a batch
	 * edit never clobbers another selected node's distinct effect list. */
	const buildShadowPatch = (
		targetNode: CanvasNode,
		next: CanvasDropShadowEffect | null,
	): Record<string, unknown> => {
		const nEffects = resolveNodeEffects(
			targetNode as { effects?: CanvasEffect[]; shadow?: CanvasShadow },
		);
		const nShadow = firstDropShadow(nEffects);
		const nextEffects =
			next === null
				? nEffects.filter((e) => e !== nShadow)
				: nShadow
					? nEffects.map((e) => (e === nShadow ? next : e))
					: [...nEffects, next];
		return { effects: nextEffects, shadow: undefined };
	};
	/** Per-node shadow FIELD edit: merges `field` onto that node's OWN current
	 * shadow (falling back to the default), preserving its other properties. */
	const buildShadowFieldPatch = (
		targetNode: CanvasNode,
		field: Partial<CanvasDropShadowEffect>,
	): Record<string, unknown> =>
		buildShadowPatch(targetNode, {
			...(shadowOf(targetNode) ?? DEFAULT_DROP_SHADOW),
			...field,
		});

	const commitStops = (stops: CanvasGradientStop[]): void => {
		if (grad) commitFillAll({ ...grad, stops });
	};

	return (
		<>
			{showFill ? (
				<>
					<FieldRow label={t("canvas.inspector.fillType", "Fill type")}>
						<select
							aria-label={t("canvas.inspector.fillType", "Fill type")}
							data-testid="prop-fill-type"
							className="h-7.5 rounded-md border border-input bg-transparent px-2 text-xs"
							value={kind}
							onChange={(e) => {
								const next = e.currentTarget.value as FillKind;
								if (next === "none") {
									// FR-074 no-fill: clear the fill entirely.
									commitFillAll(undefined);
								} else if (next === "solid") {
									commitFillAll(grad?.stops[0]?.color ?? solidColor);
								} else if (grad) {
									commitFillAll({ ...grad, kind: next });
								} else {
									commitFillAll(defaultGradient(next, solidColor));
								}
							}}
						>
							<option value="none">
								{t("canvas.inspector.fillNone", "None")}
							</option>
							<option value="solid">
								{t("canvas.inspector.fillSolid", "Solid")}
							</option>
							<option value="linear">
								{t("canvas.inspector.fillLinear", "Linear")}
							</option>
							<option value="radial">
								{t("canvas.inspector.fillRadial", "Radial")}
							</option>
						</select>
					</FieldRow>
					{grad ? (
						<>
							{grad.stops.map((stop, i) => (
								<div
									key={`${stop.color}@${stop.offset}#${i}`}
									className="flex flex-col gap-1"
									data-testid={`prop-gradient-stop-row-${i}`}
								>
									<ColorField
										label={t("canvas.inspector.gradientStop", "Stop")}
										value={stop.color}
										dataTestId={`prop-gradient-stop-${i}`}
										contract={{
											nodes,
											buildPatch: (n, v) => {
												const nGrad = asGradient(
													resolveFillForDisplay(fillOf(n, fillKey), brandKit)
														.value,
												);
												if (!nGrad) return {};
												return {
													[fillKey]: {
														...nGrad,
														stops: nGrad.stops.map((s, j) =>
															j === i ? { ...s, color: v } : s,
														),
													},
												};
											},
										}}
									/>
									<NumberField
										label={t("canvas.inspector.gradientPos", "Pos")}
										value={stop.offset}
										min={0}
										max={1}
										step={0.1}
										dataTestId={`prop-gradient-offset-${i}`}
										contract={{
											nodes,
											buildPatch: (n, v) => {
												const nGrad = asGradient(
													resolveFillForDisplay(fillOf(n, fillKey), brandKit)
														.value,
												);
												if (!nGrad) return {};
												return {
													[fillKey]: {
														...nGrad,
														stops: nGrad.stops.map((s, j) =>
															j === i ? { ...s, offset: v } : s,
														),
													},
												};
											},
										}}
									/>
									{grad.stops.length > 2 ? (
										<Button
											type="button"
											variant="ghost"
											size="sm"
											data-testid={`prop-gradient-remove-${i}`}
											onClick={() =>
												commitStops(grad.stops.filter((_, j) => j !== i))
											}
										>
											{t("canvas.inspector.gradientRemoveStop", "Remove stop")}
										</Button>
									) : null}
								</div>
							))}
							<Button
								type="button"
								variant="outline"
								size="sm"
								data-testid="prop-gradient-add-stop"
								onClick={() =>
									commitStops([
										...grad.stops,
										{
											offset: 1,
											color:
												grad.stops[grad.stops.length - 1]?.color ?? "#ffffff",
										},
									])
								}
							>
								{t("canvas.inspector.gradientAddStop", "Add stop")}
							</Button>
						</>
					) : kind === "none" ? null : (
						<>
							<TokenAwareColorField
								label={t("canvas.inspector.fill", "Fill")}
								rawValue={fill}
								resolvedValue={
									typeof resolvedFill === "string" ? resolvedFill : undefined
								}
								unresolved={fillDisplay.unresolved}
								colors={brandKit.colors}
								dataTestId="prop-fill"
								onCommit={(v) => {
									if (typeof v === "string")
										recentColorsStore.getState().add(v);
									commitFillAll(v);
								}}
								contract={{
									nodes,
									buildPatch: (_n, v) => {
										if (typeof v === "string")
											recentColorsStore.getState().add(v);
										return { [fillKey]: v };
									},
								}}
								t={t}
							/>
							{/* FR-074 alpha channel — composes the base color into #rrggbbaa. */}
							<NumberField
								label={t("canvas.inspector.fillAlpha", "Fill alpha")}
								value={solidAlpha}
								min={0}
								max={1}
								step={0.05}
								dataTestId="prop-fill-alpha"
								contract={{
									nodes,
									buildPatch: (n, v) => {
										const nResolved = resolveFillForDisplay(
											fillOf(n, fillKey),
											brandKit,
										).value;
										const nSolid =
											typeof nResolved === "string" ? nResolved : "#000000";
										return {
											[fillKey]: withAlpha(splitAlpha(nSolid).base, v),
										};
									},
								}}
							/>
							{/* FR-074 recent colors. */}
							{recentColors.length > 0 ? (
								<FieldRow label={t("canvas.inspector.recentColors", "Recent")}>
									<div
										className="flex flex-wrap gap-1"
										data-testid="prop-recent-colors"
									>
										{recentColors.map((c) => (
											<button
												key={c}
												type="button"
												data-testid={`prop-recent-color-${c}`}
												aria-label={c}
												title={c}
												className="size-5 rounded border border-border"
												style={{ backgroundColor: c }}
												onClick={() => commitFillAll(c)}
											/>
										))}
									</div>
								</FieldRow>
							) : null}
						</>
					)}
				</>
			) : null}
			{showShadow ? (
				<ColorField
					label={t("canvas.inspector.shadow", "Shadow")}
					value={effShadow?.color}
					dataTestId="prop-shadow-color"
					contract={{
						nodes,
						buildPatch: (n, v) => buildShadowFieldPatch(n, { color: v }),
					}}
				/>
			) : null}
			{showShadow && effShadow ? (
				<>
					<NumberField
						label={t("canvas.inspector.shadowBlur", "Sh blur")}
						value={effShadow.blur}
						min={0}
						dataTestId="prop-shadow-blur"
						contract={{
							nodes,
							buildPatch: (n, v) => buildShadowFieldPatch(n, { blur: v }),
						}}
					/>
					<NumberField
						label={t("canvas.inspector.shadowX", "Sh X")}
						value={effShadow.offsetX}
						dataTestId="prop-shadow-x"
						contract={{
							nodes,
							buildPatch: (n, v) => buildShadowFieldPatch(n, { offsetX: v }),
						}}
					/>
					<NumberField
						label={t("canvas.inspector.shadowY", "Sh Y")}
						value={effShadow.offsetY}
						dataTestId="prop-shadow-y"
						contract={{
							nodes,
							buildPatch: (n, v) => buildShadowFieldPatch(n, { offsetY: v }),
						}}
					/>
					<NumberField
						label={t("canvas.inspector.shadowSpread", "Sh spread")}
						value={effShadow.spread ?? 0}
						min={0}
						dataTestId="prop-shadow-spread"
						contract={{
							nodes,
							buildPatch: (n, v) => buildShadowFieldPatch(n, { spread: v }),
						}}
					/>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						data-testid="prop-shadow-remove"
						onClick={() =>
							commitPatchAll(nodes, (n) => buildShadowPatch(n, null))
						}
					>
						{t("canvas.inspector.shadowRemove", "Remove shadow")}
					</Button>
				</>
			) : null}
		</>
	);
}
