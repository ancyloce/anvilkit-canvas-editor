import type {
	CanvasFill,
	CanvasGradientFill,
	CanvasGradientStop,
	CanvasNode,
	CanvasShadow,
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

const DEFAULT_SHADOW = { color: "#000000", blur: 4, offsetX: 2, offsetY: 2 };

/**
 * Fill (solid / linear / radial gradient) + drop-shadow editing controls, shared
 * by every fill-bearing node kind's inspector section. Gradients support N stops
 * (each an editable color + position, add/remove, min 2); direction defaults to
 * the box diagonal (from 0,0 to 1,1).
 *
 * Most kinds store their fill under `fill` and support a shadow. A frame is the
 * exception on both counts — its fill lives under `background` and it has no
 * `shadow` field at all — hence `fillKey` and `showShadow`.
 */
export function FillAndShadowFields({
	node,
	fill,
	shadow,
	commitPatch,
	t,
	fillKey = "fill",
	showShadow = true,
}: {
	node: CanvasNode;
	fill: CanvasFill | undefined;
	shadow: CanvasShadow | undefined;
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

	const commitFill = (next: CanvasFill): void => {
		commitPatch(node, { [fillKey]: next });
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
								onCommit={(v) =>
									commitStops(
										grad.stops.map((s, j) =>
											j === i ? { ...s, color: v } : s,
										),
									)
								}
							/>
							<NumberField
								label={t("canvas.inspector.gradientPos", "Pos")}
								value={stop.offset}
								min={0}
								max={1}
								step={0.1}
								dataTestId={`prop-gradient-offset-${i}`}
								onCommit={(v) =>
									commitStops(
										grad.stops.map((s, j) =>
											j === i ? { ...s, offset: v } : s,
										),
									)
								}
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
					t={t}
				/>
			)}
			{showShadow ? (
				<ColorField
					label={t("canvas.inspector.shadow", "Shadow")}
					value={shadow?.color}
					dataTestId="prop-shadow-color"
					onCommit={(v) =>
						commitPatch(node, {
							shadow: { ...(shadow ?? DEFAULT_SHADOW), color: v },
						})
					}
				/>
			) : null}
			{showShadow && shadow ? (
				<>
					<NumberField
						label={t("canvas.inspector.shadowBlur", "Sh blur")}
						value={shadow.blur}
						min={0}
						dataTestId="prop-shadow-blur"
						onCommit={(v) =>
							commitPatch(node, { shadow: { ...shadow, blur: v } })
						}
					/>
					<NumberField
						label={t("canvas.inspector.shadowX", "Sh X")}
						value={shadow.offsetX}
						dataTestId="prop-shadow-x"
						onCommit={(v) =>
							commitPatch(node, { shadow: { ...shadow, offsetX: v } })
						}
					/>
					<NumberField
						label={t("canvas.inspector.shadowY", "Sh Y")}
						value={shadow.offsetY}
						dataTestId="prop-shadow-y"
						onCommit={(v) =>
							commitPatch(node, { shadow: { ...shadow, offsetY: v } })
						}
					/>
				</>
			) : null}
		</>
	);
}
