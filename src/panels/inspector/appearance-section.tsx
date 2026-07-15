"use client";

import type {
	CanvasAnyNodeUpdateCommand,
	CanvasNode,
} from "@anvilkit/canvas-core";
import { Button } from "@anvilkit/ui/button";
import { Switch } from "@anvilkit/ui/components/animate-ui/components/base/switch";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@anvilkit/ui/select";
import { useCanvasActions } from "../../actions/editor-actions.js";
import type { CanvasT } from "../../context/canvas-studio-context.js";
import { useCanvasStores } from "../../context/canvas-studio-context.js";
import { FieldRow, Section } from "../fields.js";

/**
 * FR-073 appearance section (B-12): blend mode, visibility, lock, z-order.
 * Renders for single AND multi selections — discrete controls, so commits go
 * straight through `commit`/`commitBatch` (one batch = one undo entry across
 * the whole selection); z-order reuses the action layer's `reorderSelection`.
 */

/** Canvas 2D `globalCompositeOperation` blend subset — what Konva and the SVG
 * serializer can both express. `normal` maps to source-over / no attribute. */
export const CANVAS_BLEND_MODES = [
	"normal",
	"multiply",
	"screen",
	"overlay",
	"darken",
	"lighten",
	"color-dodge",
	"color-burn",
	"hard-light",
	"soft-light",
	"difference",
	"exclusion",
] as const;

export type CanvasBlendMode = (typeof CANVAS_BLEND_MODES)[number];

function sharedValue<T>(
	nodes: readonly CanvasNode[],
	get: (n: CanvasNode) => T,
): { value: T | undefined; mixed: boolean } {
	const first = nodes[0];
	if (!first) return { value: undefined, mixed: false };
	const v = get(first);
	const mixed = nodes.some((n) => get(n) !== v);
	return { value: mixed ? undefined : v, mixed };
}

export function AppearanceSection({
	nodes,
	t,
}: {
	nodes: readonly CanvasNode[];
	t: CanvasT;
}): React.JSX.Element | null {
	const ctx = useCanvasStores();
	const actions = useCanvasActions();
	if (nodes.length === 0) return null;

	const patchAll = (patch: Record<string, unknown>): void => {
		const cmds = nodes.map(
			(node) =>
				({
					type: "node.update",
					nodeId: node.id,
					kind: node.type,
					patch,
				}) as CanvasAnyNodeUpdateCommand,
		);
		const first = cmds[0];
		if (cmds.length === 1 && first) ctx.commit(first);
		else ctx.commitBatch(cmds, "Appearance");
	};

	const visible = sharedValue(nodes, (n) => n.visible ?? true);
	const locked = sharedValue(nodes, (n) => n.locked ?? false);
	const blend = sharedValue(nodes, (n) => n.blendMode ?? "normal");

	return (
		<Section title={t("canvas.inspector.appearance", "Appearance")}>
			<FieldRow label={t("canvas.inspector.visible", "Visible")}>
				<Switch
					checked={visible.value ?? false}
					onCheckedChange={(checked) => patchAll({ visible: checked })}
					aria-label={t("canvas.inspector.visible", "Visible")}
					data-testid="prop-visible"
				/>
			</FieldRow>
			<FieldRow label={t("canvas.inspector.locked", "Locked")}>
				<Switch
					checked={locked.value ?? false}
					onCheckedChange={(checked) => patchAll({ locked: checked })}
					aria-label={t("canvas.inspector.locked", "Locked")}
					data-testid="prop-locked"
				/>
			</FieldRow>
			<FieldRow label={t("canvas.inspector.blendMode", "Blend")}>
				<Select
					items={CANVAS_BLEND_MODES.map((m) => ({ value: m, label: m }))}
					value={blend.mixed ? undefined : blend.value}
					onValueChange={(next) =>
						next &&
						patchAll({ blendMode: next === "normal" ? undefined : next })
					}
				>
					<SelectTrigger data-testid="prop-blend-mode" className="h-7.5 flex-1">
						<SelectValue
							placeholder={
								blend.mixed ? t("canvas.inspector.mixed", "Mixed") : undefined
							}
						/>
					</SelectTrigger>
					<SelectContent>
						{CANVAS_BLEND_MODES.map((m) => (
							<SelectItem key={m} value={m}>
								{m}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</FieldRow>
			<FieldRow label={t("canvas.inspector.order", "Order")}>
				<div className="flex gap-1">
					<Button
						type="button"
						variant="outline"
						size="sm"
						data-testid="prop-order-front"
						title={t("canvas.inspector.bringToFront", "Bring to front")}
						onClick={() => actions.reorderSelection("front")}
					>
						{t("canvas.inspector.orderFront", "Front")}
					</Button>
					<Button
						type="button"
						variant="outline"
						size="sm"
						data-testid="prop-order-forward"
						title={t("canvas.inspector.bringForward", "Bring forward")}
						onClick={() => actions.reorderSelection("forward")}
					>
						{t("canvas.inspector.orderForward", "+1")}
					</Button>
					<Button
						type="button"
						variant="outline"
						size="sm"
						data-testid="prop-order-backward"
						title={t("canvas.inspector.sendBackward", "Send backward")}
						onClick={() => actions.reorderSelection("backward")}
					>
						{t("canvas.inspector.orderBackward", "-1")}
					</Button>
					<Button
						type="button"
						variant="outline"
						size="sm"
						data-testid="prop-order-back"
						title={t("canvas.inspector.sendToBack", "Send to back")}
						onClick={() => actions.reorderSelection("back")}
					>
						{t("canvas.inspector.orderBack", "Back")}
					</Button>
				</div>
			</FieldRow>
		</Section>
	);
}
