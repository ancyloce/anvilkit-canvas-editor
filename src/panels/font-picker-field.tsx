"use client";

import {
	Combobox,
	ComboboxCollection,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxGroup,
	ComboboxInput,
	ComboboxItem,
	ComboboxLabel,
	ComboboxList,
	ComboboxTrigger,
} from "@anvilkit/ui/combobox";
import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { type CanvasT, useCanvasT } from "../context/canvas-studio-context.js";
import {
	CANVAS_FONT_CATEGORIES,
	type CanvasFontCatalog,
	type CanvasFontCatalogRecord,
	type CanvasFontCategory,
	fontFamilyKey,
} from "../text/font-catalog.js";
import { useFontStatus } from "../text/font-status.js";
import {
	type FieldContractTarget,
	FieldRow,
	SelectControl,
	useFieldContract,
} from "./fields.js";
import {
	ensureFontStylesheet,
	fontPreviewStack,
	hasFontLoadingApi,
	matchesFontFamily,
	useFontPreviewVisible,
} from "./font-preview.js";

/**
 * @file `FontPickerField` — the picker over `cp2-002`'s catalog
 * (PLAN-0035 §5 P2, `cp2-003`).
 *
 * ## Built on `@anvilkit/ui`, not hand-rolled
 *
 * The searchable list is `@anvilkit/ui/combobox` (Base UI), which owns the
 * listbox roles, the highlight model, type-ahead and arrow/Enter/Escape
 * handling. The category filter is `SelectControl` from `./fields.js`, the same
 * `@anvilkit/ui/select` primitive every other inspector enum uses. Nothing here
 * renders a native `<select>` or a bespoke popup.
 *
 * The two controls are SIBLINGS in the field row rather than the filter living
 * inside the popup. A second focusable control inside a combobox popup is where
 * keyboard operation goes wrong — Tab out of a popup closes it — and the
 * acceptance criterion is that every option is reachable by keyboard alone.
 *
 * ## Why the catalog is a prop and not an import
 *
 * `cp2-002` measured re-exporting `DEFAULT_FONT_CATALOG` from the public entry
 * at +1,714 B gz. Taking {@link CanvasFontCatalog} as a prop keeps that
 * decision with `cp2-004`/`cp2-007`, which own the wiring, and keeps this
 * module's own cost to the contract module it needs for categories and family
 * identity.
 *
 * ## The load gate
 *
 * An option previewed in its own typeface is one stylesheet fetch, and the
 * default catalog is 37 families. `./font-preview.js` gates the fetch AND the
 * `useFontStatus` subscription on IntersectionObserver visibility; an option
 * that has not been seen renders its family name in the inherited face. So an
 * option is never blank, and opening the picker never costs 37 loads.
 */

/** `"all"` plus the six catalog categories — the filter's value space. */
export type FontCategoryFilter = "all" | CanvasFontCategory;

/** The four groups, in the order `cp2-003` fixes: Brand → Recent → Catalog. */
type FontGroupId = "brand" | "recent" | "catalog" | "custom";

interface FontOptionGroup {
	readonly id: FontGroupId;
	readonly label: string;
	/** Family names. Base UI's grouped-items contract requires this key. */
	readonly items: readonly string[];
}

const CATEGORY_LABEL_KEYS: Record<CanvasFontCategory, [string, string]> = {
	sans: ["canvas.fontPicker.categorySans", "Sans"],
	serif: ["canvas.fontPicker.categorySerif", "Serif"],
	slab: ["canvas.fontPicker.categorySlab", "Slab"],
	mono: ["canvas.fontPicker.categoryMono", "Mono"],
	display: ["canvas.fontPicker.categoryDisplay", "Display"],
	handwriting: ["canvas.fontPicker.categoryHandwriting", "Handwriting"],
};

export interface FontPickerFieldProps {
	/** Row label, already localized by the caller (mirrors the other fields). */
	label: string;
	/** The family the document currently holds; `""` when unset. */
	value: string;
	/** `mergeCatalogs(DEFAULT_FONT_CATALOG, brandCatalog, hostCatalog)`. */
	catalog: CanvasFontCatalog;
	dataTestId: string;
	/**
	 * Recently used families, most-recent first. `cp2-005` owns persistence;
	 * until then the group is simply absent, which is its empty state.
	 */
	recentFamilies?: readonly string[];
	/** Legacy commit path; ignored when {@link contract} is present. */
	onCommit?: (next: string) => void;
	/**
	 * §10 field-input contract (B-12). A pick is DISCRETE — there is no
	 * in-progress value — so, like `SelectControl`, this uses the commit half
	 * only and does not coalesce: two deliberate picks are two undo entries.
	 */
	contract?: FieldContractTarget<string>;
	/** Multi-selection mixed value (B-12): the trigger reads "Mixed". */
	mixed?: boolean;
	/** Native tooltip, e.g. flagging an unresolved brand-token value. */
	title?: string;
	disabled?: boolean;
	/**
	 * i18n resolver. Optional: defaults to the ambient {@link useCanvasT},
	 * which is null-tolerant, so a caller that already holds one (like
	 * `token-aware-fields.tsx`) passes it and everyone else gets it for free.
	 */
	t?: CanvasT;
}

/**
 * One option's face, once its stylesheet has settled.
 *
 * `useFontStatus` is called HERE and nowhere higher, so mounting this component
 * is exactly the act of observing the family — which is what makes the load
 * gate a structural property rather than a convention.
 */
function FontOptionFace({
	family,
	category,
	t,
}: {
	family: string;
	category: CanvasFontCategory | undefined;
	t: CanvasT;
}): React.JSX.Element {
	const status = useFontStatus(family);
	const unavailable = status === "missing" || status === "error";
	return (
		<span
			className="truncate"
			data-font-status={status}
			data-font-family={family}
			style={
				status === "loaded"
					? { fontFamily: fontPreviewStack(family, category) }
					: undefined
			}
			title={
				unavailable
					? t(
							"canvas.inspector.fontMissing",
							"Font isn't available — showing a fallback.",
						)
					: undefined
			}
		>
			{family}
		</span>
	);
}

/**
 * A visible option: inject the family's stylesheet, then render its face.
 *
 * The two steps are ordered rather than concurrent because
 * `document.fonts.load()` resolves against the faces the document already
 * knows: called before the stylesheet parses it resolves with none, and
 * `observeFontFamily` records that first answer as terminal. So the face is
 * mounted only once the sheet has settled — EXCEPT where there is no CSS Font
 * Loading API at all (jsdom/SSR), where the status is the terminal `"fallback"`
 * whatever we do and there is nothing to race against.
 */
function FontOptionLoader({
	family,
	record,
	t,
}: {
	family: string;
	record: CanvasFontCatalogRecord | undefined;
	t: CanvasT;
}): React.JSX.Element {
	const css = record?.source.kind === "css" ? record.source.css : undefined;
	const [sheetSettled, setSheetSettled] = useState(
		() => css === undefined || !hasFontLoadingApi(),
	);
	useEffect(() => {
		if (css === undefined) return;
		const settled = ensureFontStylesheet(css);
		if (sheetSettled) return;
		let cancelled = false;
		void settled.then(() => {
			if (!cancelled) setSheetSettled(true);
		});
		return () => {
			cancelled = true;
		};
	}, [css, sheetSettled]);
	if (!sheetSettled) {
		return (
			<span
				className="truncate"
				data-font-status="stylesheet"
				data-font-family={family}
			>
				{family}
			</span>
		);
	}
	return <FontOptionFace family={family} category={record?.category} t={t} />;
}

/**
 * One row in the list: the family name, previewed in its own face once seen.
 *
 * `data-font-status="idle"` is the un-observed state, so a test can tell "not
 * yet loaded" from "loaded" from "unavailable" without reaching into the store.
 */
function FontOption({
	family,
	record,
	index,
	t,
}: {
	family: string;
	record: CanvasFontCatalogRecord | undefined;
	index: number;
	t: CanvasT;
}): React.JSX.Element {
	const { ref, visible } = useFontPreviewVisible(index);
	return (
		<span ref={ref} className="flex min-w-0 flex-1 items-center gap-2">
			{visible ? (
				<FontOptionLoader family={family} record={record} t={t} />
			) : (
				<span
					className="truncate"
					data-font-status="idle"
					data-font-family={family}
				>
					{family}
				</span>
			)}
		</span>
	);
}

/** Brand tier first, then the rest in catalog order — `cp2-002` already sorts. */
function buildGroups(
	catalog: CanvasFontCatalog,
	category: FontCategoryFilter,
	recentFamilies: readonly string[],
	t: CanvasT,
): readonly FontOptionGroup[] {
	const brand: string[] = [];
	const rest: string[] = [];
	for (const record of catalog.entries) {
		if (category !== "all" && record.category !== category) continue;
		(record.origin === "brand" ? brand : rest).push(record.family);
	}
	const claimed = new Set(brand.map(fontFamilyKey));
	const recent: string[] = [];
	for (const family of recentFamilies) {
		const record = catalog.get(family);
		if (!record) continue;
		if (category !== "all" && record.category !== category) continue;
		const key = fontFamilyKey(record.family);
		if (claimed.has(key)) continue;
		claimed.add(key);
		recent.push(record.family);
	}
	const groups: FontOptionGroup[] = [];
	if (brand.length > 0) {
		groups.push({
			id: "brand",
			label: t("canvas.fontPicker.groupBrand", "Brand"),
			items: brand,
		});
	}
	if (recent.length > 0) {
		groups.push({
			id: "recent",
			label: t("canvas.fontPicker.groupRecent", "Recent"),
			items: recent,
		});
	}
	const catalogItems = rest.filter(
		(family) => !claimed.has(fontFamilyKey(family)),
	);
	if (catalogItems.length > 0) {
		groups.push({
			id: "catalog",
			label: t("canvas.fontPicker.groupCatalog", "All fonts"),
			items: catalogItems,
		});
	}
	return groups;
}

/**
 * A searchable, grouped font picker.
 *
 * Grouping is **Brand → Recent → Catalog**, plus a trailing "Custom" group
 * holding the raw query when it names no catalog family — without it, replacing
 * `token-aware-fields.tsx`'s free-text `TextField` (`cp2-004`) would silently
 * drop the ability to name a family the catalog has never heard of.
 */
export function FontPickerField({
	label,
	value,
	catalog,
	dataTestId,
	recentFamilies,
	onCommit,
	contract,
	mixed = false,
	title,
	disabled,
	t: tProp,
}: FontPickerFieldProps): React.JSX.Element {
	const ambientT = useCanvasT();
	const t = tProp ?? ambientT;
	const field = useFieldContract(contract, dataTestId, { coalesce: false });
	const [category, setCategory] = useState<FontCategoryFilter>("all");
	const [query, setQuery] = useState("");

	const groups = useMemo(
		() => buildGroups(catalog, category, recentFamilies ?? [], t),
		[catalog, category, recentFamilies, t],
	);

	// Filtering is done HERE and handed to Base UI as `filteredItems` rather
	// than left to its internal `filter`, for two reasons: the match has to be
	// diacritic-folding (see `foldFontText`), and the load gate needs each
	// option's index in the RENDERED order, which only the side that produced
	// that order knows.
	const { filteredGroups, indexOfFamily } = useMemo(() => {
		const out: FontOptionGroup[] = [];
		const indexOf = new Map<string, number>();
		let position = 0;
		for (const group of groups) {
			const items = group.items.filter((family) =>
				matchesFontFamily(family, query),
			);
			if (items.length === 0) continue;
			for (const family of items) indexOf.set(family, position++);
			out.push({ ...group, items });
		}
		const custom = query.trim();
		if (custom !== "" && catalog.get(custom) === undefined) {
			indexOf.set(custom, position++);
			out.push({
				id: "custom",
				label: t("canvas.fontPicker.groupCustom", "Custom"),
				items: [custom],
			});
		}
		return { filteredGroups: out, indexOfFamily: indexOf };
	}, [groups, query, catalog, t]);

	const categoryOptions = useMemo(
		() => [
			{
				value: "all" as FontCategoryFilter,
				label: t("canvas.fontPicker.categoryAll", "All"),
			},
			...CANVAS_FONT_CATEGORIES.map((id) => ({
				value: id as FontCategoryFilter,
				label: t(...CATEGORY_LABEL_KEYS[id]),
			})),
		],
		[t],
	);

	const commit = (next: string): void => {
		if (next === value) {
			field.cancel();
			return;
		}
		if (field.enabled) field.commit(next);
		else onCommit?.(next);
	};

	const triggerText = mixed
		? field.mixedLabel
		: value !== ""
			? value
			: t("canvas.fontPicker.unset", "Choose a font");

	return (
		<FieldRow label={label} title={title}>
			<div className="flex min-w-0 items-center gap-1.5">
				<Combobox
					items={groups}
					filteredItems={filteredGroups}
					value={mixed || value === "" ? null : value}
					disabled={disabled}
					onValueChange={(next: string | null) => {
						if (next != null) commit(next);
					}}
					onInputValueChange={(next: string) => setQuery(next)}
					onOpenChange={(open: boolean) => {
						if (!open) setQuery("");
					}}
				>
					<ComboboxTrigger
						aria-label={label}
						data-testid={dataTestId}
						disabled={disabled}
						className="flex h-7.5 min-w-0 flex-1 items-center justify-between gap-1 rounded-md border border-input bg-transparent px-2 text-left text-xs"
					>
						<span className="truncate" data-testid={`${dataTestId}-value`}>
							{triggerText}
						</span>
					</ComboboxTrigger>
					<ComboboxContent>
						<ComboboxInput
							aria-label={t("canvas.fontPicker.search", "Search fonts")}
							placeholder={t("canvas.fontPicker.search", "Search fonts")}
							data-testid={`${dataTestId}-search`}
							showTrigger={false}
						/>
						<ComboboxEmpty data-testid={`${dataTestId}-empty`}>
							{t("canvas.fontPicker.empty", "No fonts available.")}
						</ComboboxEmpty>
						<ComboboxList>
							{(group: FontOptionGroup) => (
								<ComboboxGroup key={group.id} items={group.items}>
									<ComboboxLabel
										data-testid={`${dataTestId}-group-${group.id}`}
									>
										{group.label}
									</ComboboxLabel>
									<ComboboxCollection>
										{(family: string) => (
											<ComboboxItem
												key={family}
												value={family}
												data-testid={`${dataTestId}-option`}
											>
												{group.id === "custom" ? (
													<span className="truncate">
														{t(
															"canvas.fontPicker.useCustom",
															'Use "{family}"',
														).replace("{family}", family)}
													</span>
												) : (
													<FontOption
														family={family}
														record={catalog.get(family)}
														index={indexOfFamily.get(family) ?? 0}
														t={t}
													/>
												)}
											</ComboboxItem>
										)}
									</ComboboxCollection>
								</ComboboxGroup>
							)}
						</ComboboxList>
					</ComboboxContent>
				</Combobox>
				<SelectControl<FontCategoryFilter>
					label={t("canvas.fontPicker.category", "Category")}
					value={category}
					options={categoryOptions}
					dataTestId={`${dataTestId}-category`}
					onCommit={setCategory}
					disabled={disabled}
					className="h-7.5 w-[92px] shrink-0"
				/>
			</div>
		</FieldRow>
	);
}
