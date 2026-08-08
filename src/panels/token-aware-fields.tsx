"use client";

import type {
	BrandTokenRef,
	CanvasFill,
	CanvasFontFamily,
	CanvasNode,
} from "@anvilkit/canvas-core";
import { Button } from "@anvilkit/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@anvilkit/ui/select";
import * as React from "react";
import { use, useMemo } from "react";
import type { BrandColor, BrandKit } from "../brand/brand-kit.js";
import { slug } from "../brand/resolve-brand-token.js";
import {
	CanvasStudioContext,
	CanvasStudioStableContext,
	type CanvasT,
} from "../context/canvas-studio-context.js";
import { useRecentFonts } from "../context/recent-fonts-context.js";
import { DEFAULT_FONT_CATALOG } from "../text/default-font-catalog.js";
import {
	type CanvasFontCatalog,
	type CanvasFontCatalogEntry,
	createFontCatalog,
	fontFamilyKey,
	mergeCatalogs,
} from "../text/font-catalog.js";
import { ColorField, type FieldContractTarget, FieldRow } from "./fields.js";
import { FontPickerField } from "./font-picker-field.js";

/** The identity a `BrandTokenRef` resolves against — mirrors `resolveBrandToken`'s own `color.id ?? slug(color.name)` fallback. */
function colorIdentity(color: BrandColor): string {
	return color.id ?? slug(color.name);
}

function isColorTokenRef(
	value: CanvasFill | undefined,
): value is BrandTokenRef {
	return (
		typeof value === "object" &&
		value !== null &&
		"type" in value &&
		value.type === "brand-token" &&
		value.tokenType === "color"
	);
}

function isFontTokenRef(value: CanvasFontFamily): value is BrandTokenRef {
	return typeof value === "object" && value.type === "brand-token";
}

/** A small, always-visible (no hover needed) flag for an unresolved brand token. */
function UnresolvedBadge({ t }: { t: CanvasT }): React.JSX.Element {
	return (
		<span
			data-testid="prop-token-unresolved-badge"
			className="rounded bg-destructive/10 px-1 text-[10px] text-destructive"
			title={t(
				"canvas.inspector.unresolvedToken",
				"Unresolved brand token — showing fallback",
			)}
		>
			{t("canvas.inspector.unresolvedBadge", "Unresolved")}
		</span>
	);
}

export interface TokenAwareColorFieldProps {
	label: string;
	/** The raw field value — may be a literal color, a `BrandTokenRef`, or absent. */
	rawValue: CanvasFill | undefined;
	/** `resolveFillForDisplay(rawValue, brandKit).value`, when it resolves to a solid color (never a gradient — callers branch that out first). */
	resolvedValue: string | undefined;
	/** `resolveFillForDisplay(rawValue, brandKit).unresolved`. */
	unresolved: boolean;
	colors: readonly BrandColor[];
	dataTestId: string;
	onCommit: (next: CanvasFill) => void;
	/**
	 * §10 field-input contract for the LITERAL color path (B-12) — the token
	 * Select and detach/attach actions are discrete and stay on `onCommit`.
	 */
	contract?: FieldContractTarget<string>;
	t: CanvasT;
}

/**
 * A color field that can hold either a literal value or a brand-token
 * reference (FR-033, canvas-m2-007). With no brand colors configured, this
 * renders the plain literal `ColorField` — there is nothing to pick from.
 */
export function TokenAwareColorField({
	label,
	rawValue,
	resolvedValue,
	unresolved,
	colors,
	dataTestId,
	onCommit,
	contract,
	t,
}: TokenAwareColorFieldProps): React.JSX.Element {
	if (colors.length === 0) {
		return (
			<ColorField
				label={label}
				value={resolvedValue}
				dataTestId={dataTestId}
				onCommit={(v) => onCommit(v)}
				{...(contract ? { contract } : {})}
			/>
		);
	}

	const token = isColorTokenRef(rawValue) ? rawValue : undefined;

	if (token) {
		return (
			<FieldRow label={label}>
				<div className="flex items-center gap-1.5">
					<Select
						items={colors.map((c) => ({
							value: colorIdentity(c),
							label: c.name,
						}))}
						value={token.id}
						onValueChange={(next) =>
							next &&
							onCommit({ type: "brand-token", tokenType: "color", id: next })
						}
					>
						<SelectTrigger data-testid={dataTestId} className="h-7.5 flex-1">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{colors.map((c) => (
								<SelectItem key={colorIdentity(c)} value={colorIdentity(c)}>
									{c.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					{unresolved ? <UnresolvedBadge t={t} /> : null}
					<Button
						type="button"
						variant="ghost"
						size="sm"
						data-testid={`${dataTestId}-detach`}
						onClick={() => onCommit(resolvedValue ?? "#000000")}
					>
						{t("canvas.inspector.detachToken", "Detach")}
					</Button>
				</div>
			</FieldRow>
		);
	}

	return (
		<FieldRow label={label}>
			<div className="flex items-center gap-2">
				<div className="flex-1">
					<ColorField
						label=""
						value={resolvedValue}
						dataTestId={dataTestId}
						onCommit={(v) => onCommit(v)}
						{...(contract ? { contract } : {})}
					/>
				</div>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					data-testid={`${dataTestId}-use-token`}
					onClick={() => {
						const first = colors[0];
						if (!first) return;
						onCommit({
							type: "brand-token",
							tokenType: "color",
							id: colorIdentity(first),
						});
					}}
				>
					{t("canvas.inspector.useColorToken", "Use brand color")}
				</Button>
			</div>
		</FieldRow>
	);
}

/**
 * A brand-kit family the catalog has never heard of, as a catalog entry
 * (`cp2-004`).
 *
 * A `BrandKit` font is a bare family STRING — it carries no source, no weights
 * and no licence (`brand/brand-kit.ts`), which is exactly why `cp2-001` says a
 * brand token "is NOT a catalog entry". But the picker pins its Brand group off
 * `record.origin === "brand"`, so a brand family with no record cannot be shown
 * first — it could only be reached by typing it into the Custom row, which is
 * the opposite of "brand families take precedence".
 *
 * So a record is synthesised for exactly the families the merged catalog does
 * NOT already describe, and every field of it is chosen to assert nothing that
 * is not known:
 *
 * - `source: {kind: "files", files: []}` — "no bytes here". `FontPickerField`
 *   injects a stylesheet only for a `"css"` source, so this loads nothing, and
 *   `cp2-006`'s manifest reads `source.files ?? []` and emits no `@font-face`.
 *   A host that wants its brand face embedded ships a real catalog entry for it
 *   (`CanvasStudioProps.fontCatalog`, `cp2-007`), which wins by whole-entry
 *   replacement — see {@link mergeCatalogs}.
 * - `license: "LicenseRef-brand-kit"` — the `LicenseRef-…` form `cp2-001`
 *   reserves for "a licence the host holds and we have not recorded". Never an
 *   SPDX id, because inventing one would be a provenance lie.
 * - `category: "sans"` — the CSS generic `fontPreviewStack` already falls back
 *   to for an unknown category, so the rendered preview stack is byte-identical
 *   to "category unknown". `CanvasFontCatalogEntry.category` is required and has
 *   no "unknown" member.
 * - `weights: [400]` — unread by the picker; the normal weight every family has.
 *
 * A brand family the catalog DOES describe is never synthesised: it is
 * re-stamped from the merged record (see {@link brandTieredCatalog}), so its
 * real licence, source and category survive and only its tier changes.
 */
function unlistedBrandEntry(family: string): CanvasFontCatalogEntry {
	return {
		family,
		category: "sans",
		weights: [400],
		source: { kind: "files", files: [] },
		license: "LicenseRef-brand-kit",
	};
}

/**
 * The studio's RESOLVED catalog (default ← host), extended with the brand tier.
 *
 * `base` is `ctx.fontCatalog` — `cp2-007` merges the host's
 * `<CanvasStudio fontCatalog>` over the defaults exactly once, and this must not
 * be a second merge of the same two inputs: that is how "the picker offered it
 * but the export ignored it" happens.
 *
 * The brand tier is built LAST and FROM that merge, so a family the host
 * describes with its own licensed files keeps that record (host beats default)
 * and is then merely re-tiered to `"brand"` — never replaced by the default
 * catalog's copy of the same family. The brand catalog is passed FIRST to
 * {@link mergeCatalogs} so the Brand group reads in the kit's own order (its
 * first entry being the brand default font); precedence itself rides on
 * `origin`, not on argument order.
 */
function brandTieredCatalog(
	fonts: readonly string[],
	base: CanvasFontCatalog,
): CanvasFontCatalog {
	if (fonts.length === 0) return base;
	const brand = createFontCatalog(
		fonts.map((family) => base.get(family) ?? unlistedBrandEntry(family)),
		{ origin: "brand" },
	);
	return mergeCatalogs(brand, base);
}

export interface TokenAwareFontFieldProps {
	label: string;
	rawValue: CanvasFontFamily;
	resolvedValue: string | undefined;
	unresolved: boolean;
	fonts: readonly string[];
	dataTestId: string;
	onCommit: (next: CanvasFontFamily) => void;
	/**
	 * §10 contract for the PICKER path (B-12); see TokenAwareColorField. Typed
	 * over `CanvasFontFamily` rather than `string` because a pick from the Brand
	 * group commits a token, and it must land in the SAME batch as a literal
	 * pick — one command, one undo step, whatever was picked.
	 */
	contract?: FieldContractTarget<CanvasFontFamily>;
	/**
	 * Explicit catalog override, for a mount with no `<CanvasStudio>` ancestor.
	 * Inside a studio tree this is left unset: the resolved catalog
	 * (`DEFAULT_FONT_CATALOG` + the host's `<CanvasStudio fontCatalog>`, merged
	 * once by `cp2-007`) is read from the studio context.
	 */
	catalog?: CanvasFontCatalog;
	/**
	 * Explicit recents override, most-recent first. Left UNSET inside a
	 * workspace: `cp2-005` reads the shared list from `RecentFontsContext`, so
	 * both inspector call sites get it without a signature change. A standalone
	 * mount (or a test) can still supply its own.
	 */
	recentFamilies?: readonly string[];
	/** Multi-selection mixed value (B-12): the control reads "Mixed". */
	mixed?: boolean;
	t: CanvasT;
}

/**
 * The font-family counterpart of {@link TokenAwareColorField}.
 *
 * `cp2-004`: the literal path is the searchable catalog picker
 * ({@link FontPickerField}), not a free-text box. Three properties the swap had
 * to keep, asserted at this component's level in
 * `__tests__/token-aware-fields.test.tsx` and through the real inspector — both
 * call sites — in `inspector/__tests__/text-font-field.test.tsx`:
 *
 * 1. **Free text survives.** The picker's trailing "Custom" group offers
 *    `Use "<query>"` for any family the catalog does not know, so naming an
 *    arbitrary family is still one action — and a document that already holds
 *    an off-catalog family shows it on the trigger rather than resetting.
 * 2. **Brand families stay tokens.** Picking a family the brand kit names
 *    commits a `BrandTokenRef`, not the literal string, so the value round-trips
 *    back into the token branch below instead of being flattened.
 * 3. **The commit is one command.** Both shapes go through the same `contract`,
 *    which batches across the whole selection (`useFieldContract`).
 */
export function TokenAwareFontField({
	label,
	rawValue,
	resolvedValue,
	unresolved,
	fonts,
	dataTestId,
	onCommit,
	contract,
	catalog,
	recentFamilies,
	mixed = false,
	t,
}: TokenAwareFontFieldProps): React.JSX.Element {
	// `cp2-007`'s `useCanvasFontCatalog()` is the canonical read, but it goes
	// through `useCanvasStores`, which THROWS with no `<CanvasStudio>` ancestor —
	// and this field is deliberately mountable standalone (the same reason
	// `useFieldContract` reads the context null-tolerantly). So the same
	// already-merged `ctx.fontCatalog` is read directly, with cp2-007's own
	// absent-case normalization. No second merge: the value read here IS
	// `resolveFontCatalog`'s output.
	const studio = use(CanvasStudioStableContext) ?? use(CanvasStudioContext);
	const resolvedCatalog =
		catalog ?? studio?.fontCatalog ?? DEFAULT_FONT_CATALOG;
	const pickerCatalog = useMemo(
		() => brandTieredCatalog(fonts, resolvedCatalog),
		[fonts, resolvedCatalog],
	);
	// `cp2-005`: the recents seam, read the same null-tolerant way as the
	// catalog above — outside a `<CanvasWorkspace>` it resolves to an inert
	// value whose `add` is a no-op, so a standalone mount neither throws nor
	// silently accumulates state nobody can see.
	const recentFonts = useRecentFonts();
	const recent = recentFamilies ?? recentFonts.families;

	/**
	 * A picked family as a document value: a brand token when the brand kit
	 * names that family (matched on {@link fontFamilyKey}, the catalog's own
	 * identity, and keyed by `slug` because that is what `resolveBrandToken`
	 * resolves against), a literal string otherwise.
	 */
	const toFontValue = (family: string): CanvasFontFamily => {
		const brandFamily = fonts.find(
			(candidate) => fontFamilyKey(candidate) === fontFamilyKey(family),
		);
		return brandFamily
			? { type: "brand-token", tokenType: "font", id: slug(brandFamily) }
			: family;
	};

	/**
	 * Record the pick as recent, then map it (`cp2-005`).
	 *
	 * Recording happens HERE and not inside {@link FontPickerField}: `cp2-003`
	 * deliberately left the shared picker side-effect-free, and this wrapper is
	 * the one place that knows a pick is a *document* commit rather than a
	 * transient highlight.
	 *
	 * Every commit path funnels through this function — the legacy `onCommit`
	 * (once) and the §10 contract's `buildPatch`/`buildCommand` (once per
	 * selected node) — so neither can be forgotten. `add` is move-to-front +
	 * dedupe, so a multi-node commit records the family exactly once. The
	 * picker never calls `field.preview()` (a pick is discrete), so this never
	 * fires for an in-progress value.
	 *
	 * A BRAND family is recorded like any other. Precedence is enforced once,
	 * at render time in `buildGroups`, which drops a recent already claimed by
	 * the Brand group — so a brand pick can never displace the Brand group, and
	 * a family that stops being a brand font later still shows up under Recent
	 * instead of having been silently dropped at write time.
	 */
	const recordPick = (family: string): CanvasFontFamily => {
		recentFonts.add(family);
		return toFontValue(family);
	};

	const buildCommand = contract?.buildCommand;
	const pickerContract: FieldContractTarget<string> | undefined = contract
		? {
				nodes: contract.nodes,
				buildPatch: (node, family) =>
					contract.buildPatch(node, recordPick(family)),
				...(buildCommand
					? {
							buildCommand: (node: CanvasNode, family: string) =>
								buildCommand(node, recordPick(family)),
						}
					: {}),
			}
		: undefined;

	const picker = (rowLabel: string): React.JSX.Element => (
		<FontPickerField
			label={rowLabel}
			value={resolvedValue ?? ""}
			catalog={pickerCatalog}
			dataTestId={dataTestId}
			mixed={mixed}
			onCommit={(family) => onCommit(recordPick(family))}
			t={t}
			recentFamilies={recent}
			{...(pickerContract ? { contract: pickerContract } : {})}
			{...(unresolved
				? {
						title: t(
							"canvas.inspector.unresolvedToken",
							"Unresolved brand token — showing fallback",
						),
					}
				: {})}
		/>
	);

	// No brand fonts: no token affordances to offer, but the catalog still makes
	// the picker the right control — which is the whole of `cp2-004`.
	if (fonts.length === 0) return picker(label);

	const token = isFontTokenRef(rawValue) ? rawValue : undefined;

	if (token) {
		return (
			<FieldRow label={label}>
				<div className="flex items-center gap-1.5">
					<Select
						items={fonts.map((family) => ({
							value: slug(family),
							label: family,
						}))}
						value={mixed ? undefined : token.id}
						onValueChange={(next) =>
							next &&
							onCommit({ type: "brand-token", tokenType: "font", id: next })
						}
					>
						<SelectTrigger data-testid={dataTestId} className="h-7.5 flex-1">
							<SelectValue
								placeholder={
									mixed ? t("canvas.inspector.mixed", "Mixed") : undefined
								}
							/>
						</SelectTrigger>
						<SelectContent>
							{fonts.map((family) => (
								<SelectItem key={family} value={slug(family)}>
									{family}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					{unresolved ? <UnresolvedBadge t={t} /> : null}
					<Button
						type="button"
						variant="ghost"
						size="sm"
						data-testid={`${dataTestId}-detach`}
						onClick={() => onCommit(resolvedValue ?? "")}
					>
						{t("canvas.inspector.detachToken", "Detach")}
					</Button>
				</div>
			</FieldRow>
		);
	}

	// Literal value WITH a brand kit: the picker pins the brand families first,
	// and the explicit "use brand font" action stays for attaching the kit's
	// default. Same row shape the `TextField` had, so the layout is unchanged.
	return (
		<FieldRow label={label}>
			<div className="flex items-center gap-2">
				<div className="min-w-0 flex-1">{picker("")}</div>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					data-testid={`${dataTestId}-use-token`}
					onClick={() => {
						const first = fonts[0];
						if (!first) return;
						onCommit({
							type: "brand-token",
							tokenType: "font",
							id: slug(first),
						});
					}}
				>
					{t("canvas.inspector.useFontToken", "Use brand font")}
				</Button>
			</div>
		</FieldRow>
	);
}
