"use client";

/**
 * The editor's ONE resolution of the host font catalog (PLAN-0035 §5 P2,
 * `cp2-007`).
 *
 * WHY THIS EXISTS AT ALL. `cp2-001` built the contract, `cp2-002` the default
 * data, `cp2-003` the picker and `cp2-006` the export manifest — four consumers
 * of one catalog, none of which could reach a host's. This module is the seam:
 * `<CanvasStudio fontCatalog>` is merged here, once, and BOTH the picker and
 * the SVG export manifest read the result. A second merge somewhere else is how
 * "the picker offered it but the export ignored it" happens, so there is
 * deliberately only this one.
 *
 * WHY IT LIVES IN `context/` AND NOT IN `text/`. `text/` is a rank-0 LEAF in
 * `scripts/check-layering.mjs` — nothing in it may import across `src/`. The
 * hook has to read the studio context (rank 1), so it cannot live beside
 * `font-catalog.ts`. `resolveFontCatalog` rides along rather than sitting alone
 * in `text/`: the merge and the read of the merge are one decision, and
 * splitting them across two files is how they drift.
 *
 * MERGE SEMANTICS: **brand > host > default**. Precedence is a property of each
 * record's `origin` (stamped by `createFontCatalog`, preserved by
 * `mergeCatalogs`), NOT of the argument order here — see
 * {@link resolveFontCatalog}.
 */

import { DEFAULT_FONT_CATALOG } from "../text/default-font-catalog.js";
import type { CanvasFontCatalog } from "../text/font-catalog.js";
import { mergeCatalogs } from "../text/font-catalog.js";
import { useCanvasStores } from "./canvas-studio-context.js";

/**
 * `DEFAULT_FONT_CATALOG` extended by the host's catalog, or the default alone
 * when the host passed none.
 *
 * **Argument order is not the precedence.** `mergeCatalogs` resolves a
 * duplicate family by the winning record's `origin`, so passing the default
 * first does not make it win: a host entry (`origin: "host"`, the default of
 * `createFontCatalog`) replaces a default entry for the same family, and a
 * brand entry (`createFontCatalog(entries, { origin: "brand" })`) replaces
 * both. This is the non-obvious part of the contract and the one a host is
 * most likely to get wrong by "fixing" the order at its own call site.
 *
 * Replacement is WHOLE-ENTRY, never field-level (`cp2-001`): a host entry never
 * inherits the default entry's `license` or `source`, because an entry claiming
 * a licence nobody asserted for those bytes is a licensing bug, not a
 * convenience.
 *
 * What this canNOT do, stated rather than discovered: it never *removes* a
 * default family. A host that overrides `Inter` sees its own `Inter`, but the
 * other 36 default families still appear in the picker. Shipping a curated list
 * only is not expressible through this prop today.
 *
 * Not memoized — it allocates a new catalog per call. `<CanvasStudio>` calls it
 * inside the memo that builds the stable context value, so in-tree consumers
 * should read {@link useCanvasFontCatalog} rather than calling this in render.
 */
export function resolveFontCatalog(
	hostCatalog?: CanvasFontCatalog,
): CanvasFontCatalog {
	return hostCatalog
		? mergeCatalogs(DEFAULT_FONT_CATALOG, hostCatalog)
		: DEFAULT_FONT_CATALOG;
}

/**
 * The resolved catalog for the current editor — what the font picker offers and
 * what the SVG exporter derives its `@font-face` manifest from.
 *
 * Mirrors {@link useBrandKit}: the context field is optional (a partial test
 * context, or a surface mounted outside a full `<CanvasStudio>`, may omit it)
 * and the absent case normalizes to `DEFAULT_FONT_CATALOG`, so a caller never
 * branches on `undefined` and never sees an empty catalog.
 *
 * Reads through `useCanvasStores`, so it does NOT subscribe to the per-commit
 * live state — a picker rendering 37 options must not re-render on every edit.
 */
export function useCanvasFontCatalog(): CanvasFontCatalog {
	return useCanvasStores().fontCatalog ?? DEFAULT_FONT_CATALOG;
}
