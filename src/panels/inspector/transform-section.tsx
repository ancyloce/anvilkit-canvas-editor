"use client";

import type { CanvasNode } from "@anvilkit/canvas-core";
import { Button } from "@anvilkit/ui/button";
import { FlipHorizontal, FlipVertical, Link, Link2Off } from "lucide-react";
import { useState } from "react";
import {
	useCanvasStudio,
	useCanvasT,
} from "../../context/canvas-studio-context.js";
import { NumberField, Section } from "../fields.js";

/** Shared-value/mixed reduction over the selection (FR-070 multi-editing). */
function shared(
	nodes: readonly CanvasNode[],
	get: (n: CanvasNode) => number,
): { value: number; mixed: boolean } {
	const first = nodes[0];
	if (!first) return { value: 0, mixed: false };
	const v = get(first);
	return { value: v, mixed: nodes.some((n) => get(n) !== v) };
}

/**
 * FR-071 Transform section. X/Y/W/H/rotation follow the §10 field contract;
 * this adds the previously-missing controls: a uniform **scale** field,
 * **aspect-ratio lock** (couples W↔H proportionally per node), **reset
 * rotation**, and **flip horizontal/vertical** (negative scaleX/scaleY). Flip
 * and reset commit as ONE batch across the whole selection.
 */
export function TransformSection({
	nodes,
}: {
	nodes: readonly CanvasNode[];
}): React.JSX.Element {
	const ctx = useCanvasStudio();
	const t = useCanvasT();
	const [aspectLocked, setAspectLocked] = useState(false);

	const x = shared(nodes, (n) => n.transform.x);
	const y = shared(nodes, (n) => n.transform.y);
	const width = shared(nodes, (n) => n.bounds.width);
	const height = shared(nodes, (n) => n.bounds.height);
	const rotation = shared(nodes, (n) => n.transform.rotation);
	const scale = shared(nodes, (n) => n.transform.scaleX);

	/** Apply a transform-field patch across the selection as ONE undo entry. */
	const batchPatch = (
		build: (n: CanvasNode) => Record<string, unknown>,
		label: string,
	): void => {
		ctx.commitBatch(
			nodes.map((n) => ({
				type: "node.update" as const,
				nodeId: n.id,
				kind: n.type,
				patch: build(n),
			})),
			label,
		);
	};

	return (
		<Section title={t("canvas.inspector.transform", "Transform")}>
			<NumberField
				label={t("canvas.inspector.x", "X")}
				value={x.value}
				mixed={x.mixed}
				dataTestId="prop-x"
				contract={{
					nodes,
					buildPatch: (n, v) => ({ transform: { ...n.transform, x: v } }),
				}}
			/>
			<NumberField
				label={t("canvas.inspector.y", "Y")}
				value={y.value}
				mixed={y.mixed}
				dataTestId="prop-y"
				contract={{
					nodes,
					buildPatch: (n, v) => ({ transform: { ...n.transform, y: v } }),
				}}
			/>
			<div className="flex items-end gap-1.5">
				<div className="min-w-0 flex-1">
					<NumberField
						label={t("canvas.inspector.width", "Width")}
						value={width.value}
						mixed={width.mixed}
						min={0}
						dataTestId="prop-width"
						contract={{
							nodes,
							buildPatch: (n, v) =>
								aspectLocked && n.bounds.width > 0
									? {
											bounds: {
												...n.bounds,
												width: v,
												height: Math.round(
													(v * n.bounds.height) / n.bounds.width,
												),
											},
										}
									: { bounds: { ...n.bounds, width: v } },
						}}
					/>
				</div>
				<Button
					type="button"
					variant={aspectLocked ? "default" : "outline"}
					size="icon-sm"
					data-testid="prop-aspect-lock"
					aria-pressed={aspectLocked}
					aria-label={t("canvas.inspector.lockAspect", "Lock aspect ratio")}
					title={t("canvas.inspector.lockAspect", "Lock aspect ratio")}
					onClick={() => setAspectLocked((v) => !v)}
				>
					{aspectLocked ? (
						<Link aria-hidden className="size-3.5" />
					) : (
						<Link2Off aria-hidden className="size-3.5" />
					)}
				</Button>
				<div className="min-w-0 flex-1">
					<NumberField
						label={t("canvas.inspector.height", "Height")}
						value={height.value}
						mixed={height.mixed}
						min={0}
						dataTestId="prop-height"
						contract={{
							nodes,
							buildPatch: (n, v) =>
								aspectLocked && n.bounds.height > 0
									? {
											bounds: {
												...n.bounds,
												height: v,
												width: Math.round(
													(v * n.bounds.width) / n.bounds.height,
												),
											},
										}
									: { bounds: { ...n.bounds, height: v } },
						}}
					/>
				</div>
			</div>
			<NumberField
				label={t("canvas.inspector.scale", "Scale")}
				value={scale.value}
				mixed={scale.mixed}
				step={0.05}
				dataTestId="prop-scale"
				contract={{
					nodes,
					buildPatch: (n, v) => ({
						transform: { ...n.transform, scaleX: v, scaleY: v },
					}),
				}}
			/>
			<div className="flex items-end gap-1.5">
				<div className="min-w-0 flex-1">
					<NumberField
						label={t("canvas.inspector.rotation", "Rotation")}
						value={rotation.value}
						mixed={rotation.mixed}
						step={1}
						dataTestId="prop-rotation"
						contract={{
							nodes,
							buildPatch: (n, v) => ({
								transform: { ...n.transform, rotation: v },
							}),
						}}
					/>
				</div>
				<Button
					type="button"
					variant="outline"
					size="icon-sm"
					data-testid="prop-reset-rotation"
					aria-label={t("canvas.inspector.resetRotation", "Reset rotation")}
					title={t("canvas.inspector.resetRotation", "Reset rotation")}
					onClick={() =>
						batchPatch(
							(n) => ({ transform: { ...n.transform, rotation: 0 } }),
							"Reset rotation",
						)
					}
				>
					<span aria-hidden className="text-[11px]">
						0°
					</span>
				</Button>
			</div>
			<div className="flex gap-1.5">
				<Button
					type="button"
					variant="outline"
					size="sm"
					className="flex-1"
					data-testid="prop-flip-h"
					aria-label={t("canvas.inspector.flipHorizontal", "Flip horizontal")}
					title={t("canvas.inspector.flipHorizontal", "Flip horizontal")}
					onClick={() =>
						batchPatch(
							(n) => ({
								transform: { ...n.transform, scaleX: -n.transform.scaleX },
							}),
							"Flip horizontal",
						)
					}
				>
					<FlipHorizontal aria-hidden className="size-3.5" />
				</Button>
				<Button
					type="button"
					variant="outline"
					size="sm"
					className="flex-1"
					data-testid="prop-flip-v"
					aria-label={t("canvas.inspector.flipVertical", "Flip vertical")}
					title={t("canvas.inspector.flipVertical", "Flip vertical")}
					onClick={() =>
						batchPatch(
							(n) => ({
								transform: { ...n.transform, scaleY: -n.transform.scaleY },
							}),
							"Flip vertical",
						)
					}
				>
					<FlipVertical aria-hidden className="size-3.5" />
				</Button>
			</div>
		</Section>
	);
}
