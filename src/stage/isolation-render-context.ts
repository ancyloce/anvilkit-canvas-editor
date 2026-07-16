"use client";

import { createContext } from "react";

/**
 * Ids that render dimmed and non-hit-testable while container isolation is
 * active (C-09, FR-055) — computed by `computeDimmedIds` in
 * `selection/isolation.ts` and provided by `<CanvasStudio>`'s stage. Null
 * (no provider / no isolation) renders everything normally. Chrome only:
 * `rasterizePage` and exports never provide it, so isolation can never leak
 * into output.
 */
export const IsolationRenderContext = createContext<ReadonlySet<string> | null>(
	null,
);

/** Exterior dim factor while isolated (FR-055 "dimmed"). */
export const ISOLATION_DIM_OPACITY = 0.3;
