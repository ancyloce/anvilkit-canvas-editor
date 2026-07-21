"use client";

import {
	type CanvasImageFitMode,
	type CanvasImageNode,
	type CanvasNode,
	type CanvasRichTextNode,
	type CanvasTextAlign,
	type CanvasTextNode,
	type RichTextParagraph,
	type RichTextSpan,
	resolveSpanStyle,
} from "@anvilkit/canvas-core";
import { Button } from "@anvilkit/ui/button";
import {
	Popover,
	PopoverPanel,
	PopoverTrigger,
} from "@anvilkit/ui/components/animate-ui/components/base/popover";
import { Input } from "@anvilkit/ui/input";
import { cn } from "@anvilkit/ui/lib/utils";
import { Separator } from "@anvilkit/ui/separator";
import {
	AlignCenter,
	AlignLeft,
	AlignRight,
	Bold,
	Crop,
	ImageUp,
	SlidersHorizontal,
} from "lucide-react";
import { useRef, useSyncExternalStore } from "react";
import {
	useCanvasStudio,
	useCanvasT,
} from "@/context/canvas-studio-context.js";
import {
	type CommitPatchAll,
	type FieldContractTarget,
	sharedFieldValue,
	useCommitPatchAll,
	useFieldContract,
} from "@/panels/fields.js";
import {
	FIT_MODE_LABELS,
	FIT_MODES,
	renderAdjustmentFields,
} from "@/panels/inspector/media-sections.js";
import { summarizeSelection } from "@/panels/inspector/selection-summary.js";
import { beginCrop } from "@/selection/crop-actions.js";
import { pickAndReplaceImage } from "@/selection/frame-image-actions.js";
import { DEFAULT_RICH_TEXT_STYLE } from "@/text/rich-text-style.js";

/** Node kinds that carry a `fill`. */
const FILL_TYPES = new Set<CanvasNode["type"]>([
	"rect",
	"ellipse",
	"text",
	"path",
]);
/** Node kinds that carry a `stroke` / `strokeWidth` (the "border"). */
const STROKE_TYPES = new Set<CanvasNode["type"]>([
	"rect",
	"ellipse",
	"line",
	"path",
]);

/** Common families offered in the compact font control — the same FR-082 list
 * `RichTextToolbar` offers (its `FONT_FAMILIES` is module-private, so the list
 * is mirrored here; keep the two in sync). */
const FONT_FAMILIES: readonly string[] = [
	"Inter",
	"Arial",
	"Helvetica",
	"Georgia",
	"Times New Roman",
	"Courier New",
	"Verdana",
];

const ALIGN_CYCLE: readonly CanvasTextAlign[] = ["left", "center", "right"];

/* -------------------------------------------------------------------------- *
 * Typography readers / patch builders over the two text kinds.
 *
 * The rich-text patch shapes mirror `panels/inspector/text-sections.tsx`'s
 * private `allSpansPatch` / `allParagraphsPatch` (not exported from panels, so
 * they are re-derived here with the same field paths): span-level style writes
 * rewrite ONLY the edited field on every span, paragraph-level writes on every
 * paragraph — each node keeps its own paragraph/span structure.
 * -------------------------------------------------------------------------- */

function isRichText(n: CanvasNode): n is CanvasRichTextNode {
	return n.type === "rich-text";
}

/** Representative span style: first paragraph's first span, defaults filled. */
function spanStyleOf(n: CanvasRichTextNode) {
	return resolveSpanStyle(
		n.paragraphs[0]?.spans[0] ?? { text: "" },
		DEFAULT_RICH_TEXT_STYLE,
	);
}

function spansPatch(
	n: CanvasRichTextNode,
	patch: Partial<RichTextSpan>,
): Record<string, unknown> {
	return {
		paragraphs: n.paragraphs.map((p) => ({
			...p,
			spans: p.spans.map((s) => ({ ...s, ...patch })),
		})),
	};
}

function paragraphsPatch(
	n: CanvasRichTextNode,
	patch: Pick<RichTextParagraph, "align">,
): Record<string, unknown> {
	return { paragraphs: n.paragraphs.map((p) => ({ ...p, ...patch })) };
}

function fontFamilyOf(n: CanvasNode): string {
	const raw = isRichText(n)
		? spanStyleOf(n).fontFamily
		: (n as CanvasTextNode).fontFamily;
	// A brand-token ref (canvas-m1-013) is not a literal family; show the
	// default rather than crashing the string-typed select.
	return typeof raw === "string" ? raw : "Inter";
}

function fontSizeOf(n: CanvasNode): number {
	return isRichText(n)
		? spanStyleOf(n).fontSize
		: (n as CanvasTextNode).fontSize;
}

function boldOf(n: CanvasNode): boolean {
	const weight = isRichText(n)
		? spanStyleOf(n).fontWeight
		: (n as CanvasTextNode).fontWeight;
	return Number.parseInt(weight ?? "400", 10) >= 600;
}

function alignOf(n: CanvasNode): CanvasTextAlign {
	return isRichText(n)
		? (n.paragraphs[0]?.align ?? DEFAULT_RICH_TEXT_STYLE.align)
		: ((n as CanvasTextNode).align ?? "left");
}

function textFillOf(n: CanvasNode): string | undefined {
	const raw = isRichText(n) ? spanStyleOf(n).fill : (n as CanvasTextNode).fill;
	return typeof raw === "string" ? raw : undefined;
}

function fontFamilyPatch(n: CanvasNode, v: string): Record<string, unknown> {
	return isRichText(n) ? spansPatch(n, { fontFamily: v }) : { fontFamily: v };
}

function fontSizePatch(n: CanvasNode, v: number): Record<string, unknown> {
	return isRichText(n) ? spansPatch(n, { fontSize: v }) : { fontSize: v };
}

function fontWeightPatch(n: CanvasNode, v: string): Record<string, unknown> {
	return isRichText(n) ? spansPatch(n, { fontWeight: v }) : { fontWeight: v };
}

function alignPatch(n: CanvasNode, v: string): Record<string, unknown> {
	return isRichText(n)
		? paragraphsPatch(n, { align: v as CanvasTextAlign })
		: { align: v as CanvasTextAlign };
}

function textFillPatch(n: CanvasNode, v: string): Record<string, unknown> {
	return isRichText(n) ? spansPatch(n, { fill: v }) : { fill: v };
}

export interface CanvasToolbarProps {
	className?: string;
}

/**
 * Dynamic property toolbar — a floating, centered pill above the page (Canva
 * style). Surfaces the most-used quick props for the whole selection
 * (FR-180): fill · border · width · opacity · position for shapes, typography
 * for text / rich-text selections, crop · replace · fit · adjust for a single
 * image — committing through the §10 field contract (transient preview, ONE
 * coalesced undo entry per completed interaction, Escape revert), mixed-value
 * aware across a multi-selection. Renders nothing when the selection is empty
 * or while an inline text editor is open (the `RichTextToolbar` owns that
 * mode).
 */
export function CanvasToolbar({
	className,
}: CanvasToolbarProps): React.JSX.Element | null {
	const ctx = useCanvasStudio();
	const t = useCanvasT();
	const commitPatchAll = useCommitPatchAll();
	const selectedIds = useSyncExternalStore(
		ctx.selectionStore.subscribe,
		() => ctx.selectionStore.getState().selectedIds,
		() => ctx.selectionStore.getState().selectedIds,
	);
	const editingNodeId = useSyncExternalStore(
		ctx.editingStore.subscribe,
		() => ctx.editingStore.getState().editingNodeId,
		() => ctx.editingStore.getState().editingNodeId,
	);

	// While inline text editing is active the RichTextToolbar owns the floating
	// chrome — both selection toolbars stay hidden (FR-180).
	if (editingNodeId !== null) return null;

	const summary = summarizeSelection(ctx.ir, selectedIds);
	const primary = summary.primary;
	if (!primary) return null;
	const nodes = summary.nodes;

	// FR-024 locked gating: an all-locked selection (reachable via the layer
	// panel) renders every quick-prop disabled instead of silently no-op'ing
	// commits. A mixed locked/unlocked selection stays editable — the command
	// pipeline already skips locked nodes.
	const allLocked = nodes.every((n) => n.locked === true);

	const isText =
		summary.sharedKind === "text" || summary.sharedKind === "rich-text";
	// The TEXT section's dedicated color control IS the text nodes' fill —
	// suppress the generic fill swatch for a pure text selection so the same
	// field never renders twice.
	const fillNodes = isText ? [] : nodes.filter((n) => FILL_TYPES.has(n.type));
	const strokeNodes = nodes.filter((n) => STROKE_TYPES.has(n.type));
	// Crop/replace are single-node interactive workflows (an on-stage editing
	// mode, an async picker) — the IMAGE section shows for a single image only,
	// same as the inspector's representative-node convention.
	const image =
		summary.sharedKind === "image" && summary.mode === "single"
			? (primary as CanvasImageNode)
			: null;

	const fill =
		fillNodes.length > 0
			? sharedFieldValue(fillNodes, (n) => {
					const raw = (n as { fill?: unknown }).fill;
					return typeof raw === "string" ? raw : undefined;
				})
			: null;
	const stroke =
		strokeNodes.length > 0
			? sharedFieldValue(strokeNodes, (n) => (n as { stroke?: string }).stroke)
			: null;
	const strokeWidth =
		strokeNodes.length > 0
			? sharedFieldValue(
					strokeNodes,
					(n) => (n as { strokeWidth?: number }).strokeWidth ?? 0,
				)
			: null;
	const opacity = sharedFieldValue(nodes, (n) => n.opacity ?? 1);
	// FR-180 Position (common control): X/Y follow the same per-node absolute
	// patch the inspector's TransformSection already establishes for a
	// multi-selection — every selected node's transform.x/y is set to the
	// typed value, mixed-aware.
	const posX = sharedFieldValue(nodes, (n) => n.transform.x);
	const posY = sharedFieldValue(nodes, (n) => n.transform.y);

	const fontFamily = isText ? sharedFieldValue(nodes, fontFamilyOf) : null;
	const fontSize = isText ? sharedFieldValue(nodes, fontSizeOf) : null;
	const bold = isText ? sharedFieldValue(nodes, boldOf) : null;
	const align = isText ? sharedFieldValue(nodes, alignOf) : null;
	const textFill = isText ? sharedFieldValue(nodes, textFillOf) : null;
	const familyOptions =
		fontFamily && !fontFamily.mixed && !FONT_FAMILIES.includes(fontFamily.value)
			? [fontFamily.value, ...FONT_FAMILIES]
			: FONT_FAMILIES;

	const fitMode = image ? (image.fitMode ?? "stretch") : null;
	// FR-011 picker availability — same gate the Tool Strip uses; `true` when
	// the host leaves it unset.
	const hasPicker = ctx.hasImagePicker !== false;

	return (
		// Fixed, non-interactive lane pinned to the top of the canvas so the pill
		// floats over the page (centered) without taking layout space / pushing
		// the canvas down; only the pill itself captures pointer events.
		<div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center p-3">
			<div
				data-testid="canvas-toolbar"
				data-node-id={primary.id}
				role="toolbar"
				aria-label={t("canvas.toolbar.elementProperties", "Element properties")}
				className={cn(
					"pointer-events-auto inline-flex h-11 max-w-full items-center gap-1 overflow-x-auto rounded-full border border-border bg-card px-2 shadow-md",
					className,
				)}
			>
				{fill ? (
					<SwatchControl
						label={t("canvas.toolbar.fill", "Fill")}
						value={fill.value}
						mixed={fill.mixed}
						disabled={allLocked}
						testId="toolbar-fill"
						contract={{
							nodes: fillNodes,
							buildPatch: (_n, v) => ({ fill: v }),
						}}
					/>
				) : null}
				{fill && stroke ? <PillDivider /> : null}
				{stroke ? (
					<SwatchControl
						label={t("canvas.toolbar.border", "Border")}
						value={stroke.value}
						mixed={stroke.mixed}
						disabled={allLocked}
						testId="toolbar-stroke"
						contract={{
							nodes: strokeNodes,
							buildPatch: (_n, v) => ({ stroke: v }),
						}}
					/>
				) : null}
				{strokeWidth ? (
					<NumberControl
						label={t("canvas.toolbar.width", "Width")}
						value={strokeWidth.value}
						mixed={strokeWidth.mixed}
						disabled={allLocked}
						min={0}
						testId="toolbar-stroke-width"
						contract={{
							nodes: strokeNodes,
							buildPatch: (_n, v) => ({ strokeWidth: v }),
						}}
					/>
				) : null}
				{isText && fontFamily && fontSize && bold && align && textFill ? (
					<>
						<SelectControl
							label={t("canvas.toolbar.font", "Font")}
							value={fontFamily.value}
							mixed={fontFamily.mixed}
							disabled={allLocked}
							options={familyOptions.map((f) => ({ value: f, label: f }))}
							testId="toolbar-font-family"
							contract={{ nodes, buildPatch: fontFamilyPatch }}
						/>
						<NumberControl
							label={t("canvas.toolbar.fontSize", "Size")}
							value={fontSize.value}
							mixed={fontSize.mixed}
							disabled={allLocked}
							min={1}
							testId="toolbar-font-size"
							contract={{ nodes, buildPatch: fontSizePatch }}
						/>
						<BoldToggleControl
							label={t("canvas.toolbar.bold", "Bold")}
							active={!bold.mixed && bold.value}
							disabled={allLocked}
							testId="toolbar-bold"
							contract={{ nodes, buildPatch: fontWeightPatch }}
						/>
						<AlignCycleControl
							label={t("canvas.toolbar.align", "Align")}
							value={align.value}
							disabled={allLocked}
							testId="toolbar-align"
							contract={{ nodes, buildPatch: alignPatch }}
						/>
						<SwatchControl
							label={t("canvas.toolbar.textColor", "Text color")}
							value={textFill.value}
							mixed={textFill.mixed}
							disabled={allLocked}
							testId="toolbar-text-color"
							contract={{ nodes, buildPatch: textFillPatch }}
						/>
					</>
				) : null}
				{image ? (
					<>
						<Button
							type="button"
							size="icon-sm"
							variant="ghost"
							data-testid="toolbar-image-crop"
							disabled={allLocked}
							aria-label={t("canvas.toolbar.crop", "Crop")}
							title={t("canvas.toolbar.crop", "Crop")}
							onClick={() => beginCrop(ctx, image.id)}
						>
							<Crop aria-hidden />
						</Button>
						<Button
							type="button"
							size="icon-sm"
							variant="ghost"
							data-testid="toolbar-image-replace"
							disabled={allLocked || !hasPicker}
							aria-label={t("canvas.toolbar.replaceImage", "Replace")}
							title={t("canvas.toolbar.replaceImage", "Replace")}
							onClick={() => {
								void pickAndReplaceImage(ctx, image);
							}}
						>
							<ImageUp aria-hidden />
						</Button>
						<SelectControl
							label={t("canvas.toolbar.fitMode", "Fit")}
							value={fitMode ?? "stretch"}
							disabled={allLocked}
							options={FIT_MODES.map((m) => ({
								value: m,
								label: t(...FIT_MODE_LABELS[m]),
							}))}
							testId="toolbar-fit-mode"
							contract={{
								nodes: [image],
								buildPatch: (_n, v) => ({
									fitMode:
										v === "stretch" ? undefined : (v as CanvasImageFitMode),
								}),
							}}
						/>
						<Popover>
							<PopoverTrigger
								data-testid="toolbar-image-adjust"
								disabled={allLocked}
								aria-label={t("canvas.toolbar.adjust", "Adjust")}
								title={t("canvas.toolbar.adjust", "Adjust")}
								render={<Button type="button" size="icon-sm" variant="ghost" />}
							>
								<SlidersHorizontal aria-hidden />
							</PopoverTrigger>
							<PopoverPanel
								data-testid="toolbar-adjust-panel"
								className="max-h-96 w-72 overflow-y-auto"
							>
								{renderAdjustmentFields([image], commitPatchAll, t)}
							</PopoverPanel>
						</Popover>
					</>
				) : null}
				<PillDivider />
				<NumberControl
					label={t("canvas.toolbar.opacity", "Opacity")}
					value={opacity.value}
					mixed={opacity.mixed}
					disabled={allLocked}
					step={0.05}
					min={0}
					max={1}
					testId="toolbar-opacity"
					contract={{ nodes, buildPatch: (_n, v) => ({ opacity: v }) }}
				/>
				<PillDivider />
				<NumberControl
					label={t("canvas.toolbar.positionX", "X")}
					value={posX.value}
					mixed={posX.mixed}
					disabled={allLocked}
					testId="toolbar-position-x"
					contract={{
						nodes,
						buildPatch: (n, v) => ({ transform: { ...n.transform, x: v } }),
					}}
				/>
				<NumberControl
					label={t("canvas.toolbar.positionY", "Y")}
					value={posY.value}
					mixed={posY.mixed}
					disabled={allLocked}
					testId="toolbar-position-y"
					contract={{
						nodes,
						buildPatch: (n, v) => ({ transform: { ...n.transform, y: v } }),
					}}
				/>
			</div>
		</div>
	);
}

function PillDivider(): React.JSX.Element {
	return (
		<Separator
			orientation="vertical"
			className="mx-0.5 h-5 data-vertical:self-center"
		/>
	);
}

/** Compact color control: a swatch + label that opens the native picker. */
function SwatchControl({
	label,
	value,
	mixed,
	disabled,
	testId,
	contract,
}: {
	label: string;
	value: string | undefined;
	/** Multi-selection mixed value (B-12): split swatch + "Mixed" tooltip. */
	mixed?: boolean;
	disabled?: boolean;
	testId: string;
	/** §10 field-input contract (B-12): preview + coalesced commit + revert. */
	contract: FieldContractTarget<string>;
}): React.JSX.Element {
	const field = useFieldContract(contract, testId);
	// The picker only commits when the user actually changed it this
	// interaction — required for mixed selections, where committing the
	// UNTOUCHED default would overwrite every node.
	const dirty = useRef(false);
	const fallback = value ?? "#000000";
	return (
		<label
			className={cn(
				"inline-flex items-center gap-1.5 rounded-full px-2 py-1",
				disabled
					? "cursor-not-allowed opacity-50"
					: "cursor-pointer hover:bg-muted",
			)}
			title={mixed ? `${label}: ${field.mixedLabel}` : label}
		>
			<span
				className="size-4 rounded-full ring-1 ring-border"
				style={
					mixed
						? {
								background: "linear-gradient(135deg, #d4d4d8 50%, #52525b 50%)",
							}
						: { backgroundColor: fallback }
				}
				aria-hidden
			/>
			<span className="text-xs text-muted-foreground">{label}</span>
			<input
				// Commit-on-blur (after the picker closes); re-key on external change.
				key={mixed ? "mixed" : fallback}
				type="color"
				aria-label={label}
				aria-disabled={disabled || undefined}
				disabled={disabled}
				defaultValue={fallback}
				data-testid={testId}
				data-mixed={mixed ? "true" : undefined}
				className="sr-only"
				onChange={(e) => {
					if (disabled) return;
					dirty.current = true;
					field.preview(e.currentTarget.value);
				}}
				onKeyDown={(e) => {
					if (e.key === "Escape") {
						e.stopPropagation();
						e.currentTarget.value = fallback;
						dirty.current = false;
						field.cancel();
					}
				}}
				onBlur={(e) => {
					const next = e.currentTarget.value;
					const changed = dirty.current && (mixed || next !== value);
					dirty.current = false;
					if (!disabled && changed) field.commit(next);
					else field.cancel();
				}}
			/>
		</label>
	);
}

/** Compact number control reusing the `@anvilkit/ui` Input, sized for the pill. */
function NumberControl({
	label,
	value,
	mixed,
	disabled,
	step,
	min,
	max,
	testId,
	contract,
}: {
	label: string;
	value: number;
	/** Multi-selection mixed value (B-12): empty field + "Mixed" placeholder. */
	mixed?: boolean;
	disabled?: boolean;
	step?: number;
	min?: number;
	max?: number;
	testId: string;
	/** §10 field-input contract (B-12): preview + coalesced commit + revert. */
	contract: FieldContractTarget<number>;
}): React.JSX.Element {
	const field = useFieldContract(contract, testId);
	return (
		<label className="inline-flex items-center gap-1.5 px-1.5" title={label}>
			<span className="text-xs text-muted-foreground">{label}</span>
			<Input
				// See SwatchControl: commit-on-blur, re-key on external value change.
				key={mixed ? "mixed" : value}
				type="number"
				aria-label={label}
				aria-disabled={disabled || undefined}
				disabled={disabled}
				defaultValue={mixed ? "" : value}
				placeholder={mixed ? field.mixedLabel : undefined}
				step={step ?? 1}
				min={min}
				max={max}
				data-testid={testId}
				className="h-7 w-14 rounded-md px-1.5 text-xs"
				onChange={(e) => {
					if (disabled) return;
					const parsed = Number.parseFloat(e.currentTarget.value);
					if (!Number.isNaN(parsed)) field.preview(parsed);
				}}
				onKeyDown={(e) => {
					if (e.key === "Enter") e.currentTarget.blur();
					else if (e.key === "Escape") {
						e.stopPropagation();
						e.currentTarget.value = mixed ? "" : String(value);
						field.cancel();
					}
				}}
				onBlur={(e) => {
					const raw = e.currentTarget.value;
					const parsed = Number.parseFloat(raw);
					if (disabled || Number.isNaN(parsed) || (mixed && raw === "")) {
						field.cancel();
						return;
					}
					// A mixed field always commits a typed value — it unifies the
					// selection even when it matches the representative node's value.
					if (mixed || parsed !== value) field.commit(parsed);
					else field.cancel();
				}}
			/>
		</label>
	);
}

/** Compact native `<select>` wired through the §10 field contract — each pick
 * is one committed interaction (same pattern as the inspector's
 * `TextAlignField`). Mixed renders a disabled "Mixed" placeholder option. */
function SelectControl({
	label,
	value,
	mixed,
	disabled,
	options,
	testId,
	contract,
}: {
	label: string;
	value: string;
	mixed?: boolean;
	disabled?: boolean;
	options: readonly { value: string; label: string }[];
	testId: string;
	contract: FieldContractTarget<string>;
}): React.JSX.Element {
	const field = useFieldContract(contract, testId);
	return (
		<select
			aria-label={label}
			aria-disabled={disabled || undefined}
			title={label}
			disabled={disabled}
			data-testid={testId}
			className="h-7 max-w-28 rounded-md border border-input bg-transparent px-1 text-xs"
			value={mixed ? "" : value}
			onChange={(e) => {
				if (!disabled && e.currentTarget.value)
					field.commit(e.currentTarget.value);
			}}
		>
			{mixed ? (
				<option value="" disabled>
					{field.mixedLabel}
				</option>
			) : null}
			{options.map((o) => (
				<option key={o.value} value={o.value}>
					{o.label}
				</option>
			))}
		</select>
	);
}

/** Bold toggle: commits 700 ⇄ 400 through the field contract. A mixed
 * selection reads as "not bold", so the first press bolds every node. */
function BoldToggleControl({
	label,
	active,
	disabled,
	testId,
	contract,
}: {
	label: string;
	active: boolean;
	disabled?: boolean;
	testId: string;
	contract: FieldContractTarget<string>;
}): React.JSX.Element {
	const field = useFieldContract(contract, testId);
	return (
		<Button
			type="button"
			size="icon-sm"
			variant={active ? "secondary" : "ghost"}
			data-testid={testId}
			disabled={disabled}
			aria-pressed={active}
			aria-label={label}
			title={label}
			onClick={() => field.commit(active ? "400" : "700")}
		>
			<Bold aria-hidden />
		</Button>
	);
}

/** Alignment cycle button (left → center → right), like the RichTextToolbar's
 * FR-082 control, committing through the field contract. */
function AlignCycleControl({
	label,
	value,
	disabled,
	testId,
	contract,
}: {
	label: string;
	value: CanvasTextAlign;
	disabled?: boolean;
	testId: string;
	contract: FieldContractTarget<string>;
}): React.JSX.Element {
	const field = useFieldContract(contract, testId);
	const Icon =
		value === "center"
			? AlignCenter
			: value === "right"
				? AlignRight
				: AlignLeft;
	const next =
		ALIGN_CYCLE[(ALIGN_CYCLE.indexOf(value) + 1) % ALIGN_CYCLE.length] ??
		"left";
	return (
		<Button
			type="button"
			size="icon-sm"
			variant="ghost"
			data-testid={testId}
			disabled={disabled}
			aria-label={label}
			title={label}
			onClick={() => field.commit(next)}
		>
			<Icon aria-hidden />
		</Button>
	);
}
