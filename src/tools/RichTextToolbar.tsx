"use client";

import type {
	CanvasNodeUpdateCommand,
	CanvasRichTextNode,
	CanvasTextAlign,
	RichTextParagraph,
	RichTextSpan,
} from "@anvilkit/canvas-core";
import { findNode, resolveSpanStyle } from "@anvilkit/canvas-core";
import { Button } from "@anvilkit/ui/button";
import { ColorRow } from "@anvilkit/ui/color-picker";
import { Input } from "@anvilkit/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@anvilkit/ui/select";
import {
	AlignCenter,
	AlignLeft,
	AlignRight,
	Bold,
	Italic,
	Link,
	Strikethrough,
	Underline,
} from "lucide-react";
import * as React from "react";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import {
	type CanvasT,
	useCanvasStudio,
	useCanvasT,
	useResolvedDocument,
} from "../context/canvas-studio-context.js";
import {
	type FieldContractTarget,
	useFieldContract,
} from "../context/field-contract.js";
import { resolveNodeWorldPosition } from "../stage/node-world-position.js";
import { resolvedNodeWorldPosition } from "../stage/resolved-page-space.js";
import { pageToClientPoint } from "../stage/viewport-point.js";
import {
	flattenRichText,
	rebuildRichTextParagraphs,
} from "../text/rich-text-draft.js";
import { DEFAULT_RICH_TEXT_STYLE } from "../text/rich-text-style.js";

const ALIGN_CYCLE: readonly CanvasTextAlign[] = ["left", "center", "right"];

/** Common families offered in the FR-082 font control (whole-block scope). */
const FONT_FAMILIES: readonly string[] = [
	"Inter",
	"Arial",
	"Helvetica",
	"Georgia",
	"Times New Roman",
	"Courier New",
	"Verdana",
];

type SpanFlag = "italic" | "underline" | "strikethrough";

function mapSpans(
	node: CanvasRichTextNode,
	map: (span: RichTextSpan) => RichTextSpan,
): RichTextParagraph[] {
	return node.paragraphs.map((p) => ({ ...p, spans: p.spans.map(map) }));
}

function everySpan(
	node: CanvasRichTextNode,
	test: (span: RichTextSpan) => boolean,
): boolean {
	return node.paragraphs.every((p) => p.spans.every(test));
}

/**
 * Shared wiring for the toolbar's two CONTINUOUS controls (plan 0024 Phase 1).
 *
 * Both previously drove `commitCoalesced` on every pointer move / keystroke.
 * That kept undo clean, but `commitCoalesced` writes the IR and fires
 * `onChange`/`onChanges` on every call (`CanvasStudio.tsx`), so a colour drag
 * rewrote the document, notified the host, and broadcast to collab peers once
 * per frame. They now use the §10 field contract like every other continuous
 * field: transient preview while adjusting, ONE commit on release.
 *
 * `buildParagraphs` is a callback rather than a prebuilt patch because the
 * paragraphs must be rebuilt from the LIVE textarea at the moment of each
 * preview/commit (E-4) — see `currentRichText` in the parent.
 */
function useParagraphContract<T>(
	node: CanvasRichTextNode,
	buildParagraphs: (value: T) => RichTextParagraph[],
	fieldId: string,
): ReturnType<typeof useFieldContract<T>> {
	// The parent rebuilds `buildParagraphs` on every render (it closes over a
	// fresh read of the live textarea), and this toolbar re-renders on every
	// zoom/pan tick — it holds three viewport subscriptions. Keying the contract
	// on the callback would therefore allocate a new contract object per frame
	// during any pan, and since `useFieldContract` lists `contract` in all three
	// of its `useCallback` deps, every one of its closures would be rebuilt too.
	// Hold the callback in a ref instead and key the contract on `node` alone.
	const latest = useRef(buildParagraphs);
	// Synced in an effect, never during render: a render React later discards
	// must not leave its closure behind. Events only fire after commit, so a
	// handler always sees the committed render's callback.
	useEffect(() => {
		latest.current = buildParagraphs;
	});
	const contract = useMemo<FieldContractTarget<T>>(
		() => ({
			nodes: [node],
			// Still read at CALL time (E-4), so a click builds from whatever is
			// currently in the textarea rather than a per-render snapshot.
			buildPatch: (_n, value) => ({ paragraphs: latest.current(value) }),
		}),
		[node],
	);
	return useFieldContract<T>(contract, fieldId);
}

/** Colour the picker shows for a fill it cannot represent as a hex swatch. */
const UNSET_FILL_DISPLAY = "#000000";

/** FR-082 text colour — swatch only; the toolbar supplies its own chrome. */
function RichTextColorControl({
	node,
	fill: committedFill,
	buildParagraphs,
	t,
}: {
	node: CanvasRichTextNode;
	/**
	 * The first span's COMMITTED fill as a plain hex, or `undefined` when it is
	 * not one — a gradient, or an unresolved brand token.
	 */
	fill: string | undefined;
	buildParagraphs: (fill: string) => RichTextParagraph[];
	t: CanvasT;
}): React.JSX.Element {
	const field = useParagraphContract(node, buildParagraphs, "rich-text-color");
	// Only commit when this interaction actually moved the picker — closing an
	// untouched picker must not land an undo entry.
	const dirty = useRef(false);
	// The picker needs a concrete colour, so a span whose fill is NOT a plain hex
	// — a gradient, or an unresolved brand token — displays as black. The change
	// test below compares against the COMMITTED fill rather than this display
	// fallback: testing `picked !== displayed` made black compare equal to
	// "unchanged" for those spans, so gradient-filled text could never be set to
	// solid black. (A span with no fill at all is a different case: it resolves
	// to black upstream via `DEFAULT_RICH_TEXT_STYLE`, so picking black there is
	// genuinely a no-op and still cancels.)
	const value = committedFill ?? UNSET_FILL_DISPLAY;
	return (
		<ColorRow
			compact
			label={t("canvas.richText.color", "Text color")}
			data-testid="rich-text-color"
			value={value}
			onValueChange={(fill) => {
				dirty.current = true;
				field.preview(fill);
			}}
			onCommit={(fill) => {
				const changed = dirty.current && fill !== committedFill;
				dirty.current = false;
				if (changed) field.commit(fill);
				else field.cancel();
			}}
			onCancel={() => {
				dirty.current = false;
				field.cancel();
			}}
		/>
	);
}

/** FR-082 font size — uncontrolled/commit-on-blur, mirroring `NumberField`. */
function RichTextSizeControl({
	node,
	value,
	buildParagraphs,
	t,
}: {
	node: CanvasRichTextNode;
	value: number;
	buildParagraphs: (fontSize: number) => RichTextParagraph[];
	t: CanvasT;
}): React.JSX.Element {
	const field = useParagraphContract(node, buildParagraphs, "rich-text-size");
	return (
		<Input
			// Uncontrolled so preview-only typing is not fought by a controlled
			// value. Re-keys when an EXTERNAL change lands (undo, another client);
			// `value` reads the committed node, which previews never touch, so this
			// key cannot change mid-edit and steal focus.
			key={value}
			type="number"
			data-testid="rich-text-size"
			aria-label={t("canvas.richText.size", "Font size")}
			title={t("canvas.richText.size", "Font size")}
			className="h-6 w-14 px-1 text-xs"
			min={1}
			defaultValue={value}
			onChange={(e) => {
				const fontSize = Number(e.currentTarget.value);
				if (!Number.isFinite(fontSize) || fontSize < 1) return;
				field.preview(fontSize);
			}}
			onKeyDown={(e) => {
				if (e.key === "Enter")
					e.currentTarget.blur(); // blur commits
				else if (e.key === "Escape") {
					// Revert to the pre-edit value; stop propagation so the workspace
					// Escape stack (which would exit text editing) stays out of it.
					e.stopPropagation();
					e.currentTarget.value = String(value);
					field.cancel();
				}
			}}
			onBlur={(e) => {
				const fontSize = Number(e.currentTarget.value);
				if (!Number.isFinite(fontSize) || fontSize < 1) {
					field.cancel();
					return;
				}
				if (fontSize !== value) field.commit(fontSize);
				else field.cancel();
			}}
		/>
	);
}

/**
 * FR-082 floating rich-text toolbar (C-11). Appears above the text box while
 * a rich-text node is being edited. The current editing model is a flat
 * textarea (per-span SELECTION styling is deferred with the Phase-3 text
 * model decision), so every control applies to the WHOLE block — each click
 * is one undoable `node.update`. The link control is the FR-082 placeholder:
 * visible, disabled, tooltip explains it is coming.
 */
export function RichTextToolbar(): React.JSX.Element | null {
	const ctx = useCanvasStudio();
	const t = useCanvasT();
	// T-M3-07: anchor to the RESOLVED position, so the toolbar follows an Auto
	// Layout child's flow slot; the raw walk stays as the storeless fallback.
	const resolvedDocument = useResolvedDocument();
	const editingNodeId = useSyncExternalStore(
		ctx.editingStore.subscribe,
		() => ctx.editingStore.getState().editingNodeId,
		() => ctx.editingStore.getState().editingNodeId,
	);
	// Subscribed (not a one-off getState() snapshot) so the toolbar
	// repositions on zoom/pan while editing (E-10) — called unconditionally,
	// before the early return below, per the Rules of Hooks.
	const zoom = useSyncExternalStore(
		ctx.viewportStore.subscribe,
		() => ctx.viewportStore.getState().zoom,
		() => ctx.viewportStore.getState().zoom,
	);
	const panX = useSyncExternalStore(
		ctx.viewportStore.subscribe,
		() => ctx.viewportStore.getState().panX,
		() => ctx.viewportStore.getState().panX,
	);
	const panY = useSyncExternalStore(
		ctx.viewportStore.subscribe,
		() => ctx.viewportStore.getState().panY,
		() => ctx.viewportStore.getState().panY,
	);
	const node = editingNodeId
		? (findNode(ctx.ir, editingNodeId)?.node ?? null)
		: null;
	if (!node || node.type !== "rich-text" || !ctx.stage) return null;
	// DISPLAY only (button active-states, current font/color, position) — as
	// of THIS render, same reactivity as every other toolbar control. Never
	// used to build a committed patch — see `currentRichText` below.
	const richText = node;

	/**
	 * The user may keep typing between this render and the moment a control
	 * is actually clicked — reading `ctx.editingStore.getState().textareaEl`
	 * up here (once per render) would still capture a stale value the next
	 * keystroke immediately invalidates. Called FRESH inside each mutation
	 * handler instead, so a click always builds from whatever is CURRENTLY in
	 * the textarea (E-4), not a snapshot from whenever RichTextToolbar last
	 * happened to re-render.
	 */
	const currentRichText = (): CanvasRichTextNode => {
		const liveDraft = ctx.editingStore.getState().textareaEl?.value;
		return liveDraft !== undefined && liveDraft !== flattenRichText(node)
			? { ...node, paragraphs: rebuildRichTextParagraphs(node, liveDraft) }
			: node;
	};

	// Ancestor-composed (E-10) — see TextEditorOverlay, which shares this
	// positioning contract; a rich-text node nested in a moved/rotated/scaled
	// group or frame needs more than its own local transform.x/y.
	const worldPosition =
		(resolvedDocument
			? resolvedNodeWorldPosition(resolvedDocument, richText.id)
			: null) ??
		resolveNodeWorldPosition(ctx.ir, richText.id) ??
		richText.transform;
	// K-1: footprint-anchored shared mapping (see TextEditorOverlay).
	const anchor = pageToClientPoint(ctx, worldPosition.x, worldPosition.y);
	const left = anchor?.x ?? worldPosition.x * zoom + panX;
	const top = anchor?.y ?? worldPosition.y * zoom + panY;

	const firstStyle = resolveSpanStyle(
		richText.paragraphs[0]?.spans[0] ?? { text: "" },
		DEFAULT_RICH_TEXT_STYLE,
	);

	const commitParagraphs = (paragraphs: RichTextParagraph[]): void => {
		const cmd: CanvasNodeUpdateCommand<"rich-text"> = {
			type: "node.update",
			nodeId: node.id,
			kind: "rich-text",
			patch: { paragraphs },
		};
		ctx.commit(cmd);
	};

	const boldActive = everySpan(
		richText,
		(s) =>
			Number.parseInt(
				resolveSpanStyle(s, DEFAULT_RICH_TEXT_STYLE).fontWeight ?? "400",
				10,
			) >= 600,
	);
	const toggleBold = (): void => {
		commitParagraphs(
			mapSpans(currentRichText(), (s) => ({
				...s,
				fontWeight: boldActive ? "400" : "700",
			})),
		);
	};

	const flagActive = (flag: SpanFlag): boolean =>
		everySpan(
			richText,
			(s) => resolveSpanStyle(s, DEFAULT_RICH_TEXT_STYLE)[flag] === true,
		);
	const toggleFlag = (flag: SpanFlag): void => {
		const next = !flagActive(flag);
		commitParagraphs(
			mapSpans(currentRichText(), (s) => ({ ...s, [flag]: next })),
		);
	};

	const align = richText.paragraphs[0]?.align ?? DEFAULT_RICH_TEXT_STYLE.align;
	const cycleAlign = (): void => {
		const next =
			ALIGN_CYCLE[(ALIGN_CYCLE.indexOf(align) + 1) % ALIGN_CYCLE.length] ??
			"left";
		commitParagraphs(
			currentRichText().paragraphs.map((p) => ({ ...p, align: next })),
		);
	};
	const AlignIcon =
		align === "center"
			? AlignCenter
			: align === "right"
				? AlignRight
				: AlignLeft;

	const toggles: ReadonlyArray<{
		key: string;
		label: string;
		active: boolean;
		onClick: () => void;
		icon: React.JSX.Element;
	}> = [
		{
			key: "bold",
			label: t("canvas.richText.bold", "Bold"),
			active: boldActive,
			onClick: toggleBold,
			icon: <Bold aria-hidden />,
		},
		{
			key: "italic",
			label: t("canvas.richText.italic", "Italic"),
			active: flagActive("italic"),
			onClick: () => toggleFlag("italic"),
			icon: <Italic aria-hidden />,
		},
		{
			key: "underline",
			label: t("canvas.richText.underline", "Underline"),
			active: flagActive("underline"),
			onClick: () => toggleFlag("underline"),
			icon: <Underline aria-hidden />,
		},
		{
			key: "strikethrough",
			label: t("canvas.richText.strikethrough", "Strikethrough"),
			active: flagActive("strikethrough"),
			onClick: () => toggleFlag("strikethrough"),
			icon: <Strikethrough aria-hidden />,
		},
	];

	return (
		<div
			data-testid="rich-text-toolbar"
			role="toolbar"
			aria-label={t("canvas.richText.toolbar", "Text formatting")}
			className="fixed z-[10000] flex items-center gap-0.5 rounded-md border border-border bg-background p-0.5 shadow-md"
			style={{ left, top: Math.max(0, top - 40) }}
			// The textarea commits on blur; keep focus there while clicking.
			onMouseDown={(e) => e.preventDefault()}
		>
			{toggles.map(({ key, label, active, onClick, icon }) => (
				<Button
					key={key}
					type="button"
					variant={active ? "secondary" : "ghost"}
					size="icon-xs"
					data-testid={`rich-text-${key}`}
					aria-label={label}
					aria-pressed={active}
					title={label}
					onClick={onClick}
				>
					{icon}
				</Button>
			))}
			{/* Uses `@anvilkit/ui/select` directly rather than the inspector's
			    packaged `SelectControl`: `tools/` is interaction-core (rank 1) and
			    may not import `panels/` (rank 3) — see scripts/check-layering.mjs.
			    No field contract is needed here; this commits straight through. */}
			<Select
				items={FONT_FAMILIES.map((family) => ({
					value: family,
					label: family,
				}))}
				value={
					typeof firstStyle.fontFamily === "string" &&
					FONT_FAMILIES.includes(firstStyle.fontFamily)
						? firstStyle.fontFamily
						: "Inter"
				}
				onValueChange={(next) => {
					if (next == null) return;
					const fontFamily = next as string;
					commitParagraphs(
						mapSpans(currentRichText(), (s) => ({ ...s, fontFamily })),
					);
				}}
			>
				<SelectTrigger
					data-testid="rich-text-font"
					aria-label={t("canvas.richText.font", "Font")}
					title={t("canvas.richText.font", "Font")}
					className="h-6 max-w-24 text-xs"
				>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{FONT_FAMILIES.map((family) => (
						<SelectItem key={family} value={family}>
							{family}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<RichTextColorControl
				node={node}
				fill={typeof firstStyle.fill === "string" ? firstStyle.fill : undefined}
				buildParagraphs={(fill) =>
					mapSpans(currentRichText(), (s) => ({ ...s, fill }))
				}
				t={t}
			/>
			<RichTextSizeControl
				node={node}
				value={firstStyle.fontSize ?? DEFAULT_RICH_TEXT_STYLE.fontSize}
				buildParagraphs={(fontSize) =>
					mapSpans(currentRichText(), (s) => ({ ...s, fontSize }))
				}
				t={t}
			/>
			<Button
				type="button"
				variant="ghost"
				size="icon-xs"
				data-testid="rich-text-align"
				aria-label={t("canvas.richText.align", "Alignment")}
				title={t("canvas.richText.align", "Alignment")}
				onClick={cycleAlign}
			>
				<AlignIcon aria-hidden />
			</Button>
			<Button
				type="button"
				variant="ghost"
				size="icon-xs"
				disabled
				data-testid="rich-text-link"
				aria-label={t("canvas.richText.linkSoon", "Links coming soon")}
				title={t("canvas.richText.linkSoon", "Links coming soon")}
			>
				<Link aria-hidden />
			</Button>
		</div>
	);
}
