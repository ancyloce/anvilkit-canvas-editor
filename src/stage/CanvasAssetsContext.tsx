"use client";

import type { CanvasAssetRef } from "@anvilkit/canvas-core";
import { createContext, use } from "react";

/**
 * The asset table the stage renders against.
 *
 * This is NOT necessarily `ir.assets`. `<CanvasStudio>` provides a REHYDRATED
 * table (cp1-005, `assets/local-asset-rehydration.ts`): a locally-uploaded
 * asset is persisted in IndexedDB, but the `blob:` URI recorded in the document
 * dies with the page that minted it, so on load every such entry is remapped
 * onto a freshly minted object URL. The document itself is never rewritten —
 * the fresh URI lives only in this context, so it can never reach `onChange`,
 * the save pipeline or an export.
 *
 * Three states reach a renderer through here, and all three are already
 * handled by `CanvasNodeRenderer`'s FR-095 chrome — rehydration adds no fourth:
 *
 * | Entry | Renderer state |
 * |---|---|
 * | a resolvable `uri` | normal |
 * | `PENDING_ASSET_URI` | "loading" (`use-image` never starts a request for an empty src, so `status` stays `"loading"`) |
 * | absent from the table | "missing" (plus the FR-170 batched toast) |
 */
export const CanvasAssetsContext = createContext<
	Record<string, CanvasAssetRef>
>({});

/**
 * The `uri` an asset carries while its bytes are still being looked up in the
 * local store (cp1-005). Deliberately the empty string: `use-image` treats a
 * falsy src as "nothing to load yet" and leaves `status` at `"loading"`, so a
 * not-yet-rehydrated asset shows the editor's ordinary loading placeholder
 * instead of briefly flashing the load-error one it would get from the dead
 * `blob:` URI still recorded in the document.
 */
export const PENDING_ASSET_URI = "";

export function useCanvasAsset(id: string): CanvasAssetRef | undefined {
	return use(CanvasAssetsContext)[id];
}
