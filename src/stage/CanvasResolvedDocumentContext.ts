"use client";

import type { CanvasResolvedDocument } from "@anvilkit/canvas-core";
import { createContext } from "react";

/**
 * T-M3-10: a STATIC resolution for provider-less render passes.
 *
 * `rasterizePage` deliberately mounts `<CanvasNodeRenderer>` with no
 * `CanvasStudioContext` — providing one would flip every `isInteractive`
 * branch (auto-width reconciliation commits, missing-asset toasts) and could
 * leak previews into exports. This context carries ONLY a resolved document,
 * so the offscreen raster/PDF/thumbnail path draws the same resolved geometry
 * the live stage does while staying non-interactive. When present it WINS
 * over the studio store, which is what keeps an export preview-free even if
 * both are somehow mounted.
 */
export const CanvasResolvedDocumentContext =
	createContext<CanvasResolvedDocument | null>(null);
