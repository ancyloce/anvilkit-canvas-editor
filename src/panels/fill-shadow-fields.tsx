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
import { resolveFillForDisplay } from "../brand/resolve-brand-token.js";
import { useBrandKit } from "../brand/use-brand-kit.js";
import type { CanvasT } from "../context/canvas-studio-context.js";
import {
	ColorField,
	type CommitPatch,
	FieldRow,
	NumberField,
} from "./fields.js";
import { TokenAwareColorField } from "./token-aware-fields.js";

type FillKind = "solid" | "linear" | "radial";

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
 */
export function FillAndShadowFields({
	node,
	fill,
	commitPatch,
	t,
	fillKey = "fill",
	showShadow = true,
}: {
	node: CanvasNode;
	fill: CanvasFill | undefined;
	commitPatch: CommitPatch;
	t: CanvasT;
	/** Which node property the fill is written back to. Frames use `background`. */
	fillKey?: "fill" | "background";
	/** Frames have no `shadow` field, so they hide the shadow controls. */
	showShadow?: boolean;
}): React.JSX.Element {
	// `fill` may be a brand-token ref (canvas-m1-013): resolve it FIRST so
	// every read below sees only a plain color or a gradient, never a
	// `BrandTokenRef`. A solid fill gets the full token-aware picker
	// (canvas-m2-007); an unresolved token shows a visible badge there.
	const brandKit = useBrandKit();
	const fillDisplay = resolveFillForDisplay(fill, brandKit);
	const resolvedFill = fillDisplay.value;
	const grad = asGradient(resolvedFill);
	const kind: FillKind = grad?.kind ?? "solid";
	const solidColor =
		typeof resolvedFill === "string" ? resolvedFill : "#000000";

	const fillPatch = (next: CanvasFill): Record<string, unknown> => ({
		[fillKey]: next,
	});
	const commitFill = (next: CanvasFill): void => {
		commitPatch(node, fillPatch(next));
	};

	// Shadow reads resolve through core's ONE resolver (effects > legacy
	// `shadow`); writes replace the first drop shadow inside the full effect
	// list (other effects ride along) and clear the legacy field. The cast
	// widens the node union: kinds without these fields resolve to [].
	const effects = resolveNodeEffects(
		node as { effects?: CanvasEffect[]; shadow?: CanvasShadow },
	);
	const effShadow = firstDropShadow(effects);
	const shadowPatch = (
		next: CanvasDropShadowEffect | null,
	): Record<string, unknown> => {
		const nextEffects =
			next === null
				? effects.filter((e) => e !== effShadow)
				: effShadow
					? effects.map((e) => (e === effShadow ? next : e))
					: [...effects, next];
		return { effects: nextEffects, shadow: undefined };
	};

	const commitStops = (stops: CanvasGradientStop[]): void => {
		if (grad) commitFill({ ...grad, stops });
	};

	return (
		<>
			<FieldRow label={t("canvas.inspector.fillType", "Fill type")}>
				<select
					aria-label={t("canvas.inspector.fillType", "Fill type")}
					data-testid="prop-fill-type"
					className="h-7.5 rounded-md border border-input bg-transparent px-2 text-xs"
					value={kind}
					onChange={(e) => {
						const next = e.currentTarget.value as FillKind;
						if (next === "solid") {
							commitFill(grad?.stops[0]?.color ?? solidColor);
						} else if (grad) {
							commitFill({ ...grad, kind: next });
						} else {
							commitFill(defaultGradient(next, solidColor));
						}
					}}
				>
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
									nodes: [node],
									buildPatch: (_n, v) =>
										fillPatch({
											...grad,
											stops: grad.stops.map((s, j) =>
												j === i ? { ...s, color: v } : s,
											),
										}),
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
									nodes: [node],
									buildPatch: (_n, v) =>
										fillPatch({
											...grad,
											stops: grad.stops.map((s, j) =>
												j === i ? { ...s, offset: v } : s,
											),
										}),
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
									color: grad.stops[grad.stops.length - 1]?.color ?? "#ffffff",
								},
							])
						}
					>
						{t("canvas.inspector.gradientAddStop", "Add stop")}
					</Button>
				</>
			) : (
				<TokenAwareColorField
					label={t("canvas.inspector.fill", "Fill")}
					rawValue={fill}
					resolvedValue={
						typeof resolvedFill === "string" ? resolvedFill : undefined
					}
					unresolved={fillDisplay.unresolved}
					colors={brandKit.colors}
					dataTestId="prop-fill"
					onCommit={commitFill}
					contract={{ nodes: [node], buildPatch: (_n, v) => fillPatch(v) }}
					t={t}
				/>
			)}
			{showShadow ? (
				<ColorField
					label={t("canvas.inspector.shadow", "Shadow")}
					value={effShadow?.color}
					dataTestId="prop-shadow-color"
					contract={{
						nodes: [node],
						buildPatch: (_n, v) =>
							shadowPatch({ ...(effShadow ?? DEFAULT_DROP_SHADOW), color: v }),
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
							nodes: [node],
							buildPatch: (_n, v) => shadowPatch({ ...effShadow, blur: v }),
						}}
					/>
					<NumberField
						label={t("canvas.inspector.shadowX", "Sh X")}
						value={effShadow.offsetX}
						dataTestId="prop-shadow-x"
						contract={{
							nodes: [node],
							buildPatch: (_n, v) => shadowPatch({ ...effShadow, offsetX: v }),
						}}
					/>
					<NumberField
						label={t("canvas.inspector.shadowY", "Sh Y")}
						value={effShadow.offsetY}
						dataTestId="prop-shadow-y"
						contract={{
							nodes: [node],
							buildPatch: (_n, v) => shadowPatch({ ...effShadow, offsetY: v }),
						}}
					/>
					<NumberField
						label={t("canvas.inspector.shadowSpread", "Sh spread")}
						value={effShadow.spread ?? 0}
						min={0}
						dataTestId="prop-shadow-spread"
						contract={{
							nodes: [node],
							buildPatch: (_n, v) => shadowPatch({ ...effShadow, spread: v }),
						}}
					/>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						data-testid="prop-shadow-remove"
						onClick={() => commitPatch(node, shadowPatch(null))}
					>
						{t("canvas.inspector.shadowRemove", "Remove shadow")}
					</Button>
				</>
			) : null}
		</>
	);
}
