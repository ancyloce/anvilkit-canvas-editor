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
import { useSyncExternalStore } from "react";
import {
	useCanvasStudio,
	useCanvasT,
} from "../context/canvas-studio-context.js";
import { resolveNodeWorldPosition } from "../stage/node-world-position.js";
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

	const container =
		typeof ctx.stage.container === "function" ? ctx.stage.container() : null;
	const rect = container?.getBoundingClientRect?.();
	// Ancestor-composed (E-10) — see TextEditorOverlay, which shares this
	// positioning contract; a rich-text node nested in a moved/rotated/scaled
	// group or frame needs more than its own local transform.x/y.
	const worldPosition =
		resolveNodeWorldPosition(ctx.ir, richText.id) ?? richText.transform;
	const left = (rect?.left ?? 0) + worldPosition.x * zoom + panX;
	const top = (rect?.top ?? 0) + worldPosition.y * zoom + panY;

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
			<select
				data-testid="rich-text-font"
				aria-label={t("canvas.richText.font", "Font")}
				title={t("canvas.richText.font", "Font")}
				className="h-6 max-w-24 rounded border border-input bg-transparent px-1 text-xs"
				value={
					typeof firstStyle.fontFamily === "string" &&
					FONT_FAMILIES.includes(firstStyle.fontFamily)
						? firstStyle.fontFamily
						: "Inter"
				}
				onChange={(e) => {
					const fontFamily = e.currentTarget.value;
					commitParagraphs(
						mapSpans(currentRichText(), (s) => ({ ...s, fontFamily })),
					);
				}}
			>
				{FONT_FAMILIES.map((family) => (
					<option key={family} value={family}>
						{family}
					</option>
				))}
			</select>
			<input
				type="color"
				data-testid="rich-text-color"
				aria-label={t("canvas.richText.color", "Text color")}
				title={t("canvas.richText.color", "Text color")}
				className="size-6 cursor-pointer rounded border border-input bg-transparent"
				value={
					typeof firstStyle.fill === "string" ? firstStyle.fill : "#000000"
				}
				onChange={(e) => {
					const fill = e.currentTarget.value;
					commitParagraphs(
						mapSpans(currentRichText(), (s) => ({ ...s, fill })),
					);
				}}
			/>
			<input
				type="number"
				data-testid="rich-text-size"
				aria-label={t("canvas.richText.size", "Font size")}
				title={t("canvas.richText.size", "Font size")}
				className="h-6 w-14 rounded border border-input bg-transparent px-1 text-xs"
				min={1}
				value={firstStyle.fontSize}
				onChange={(e) => {
					const fontSize = Number(e.currentTarget.value);
					if (!Number.isFinite(fontSize) || fontSize < 1) return;
					commitParagraphs(
						mapSpans(currentRichText(), (s) => ({ ...s, fontSize })),
					);
				}}
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
