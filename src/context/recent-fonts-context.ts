"use client";

import { createContext, use } from "react";

/**
 * Recently-used font families seam (`cp2-005`, PLAN-0035 §5 P2).
 *
 * A deliberate MIRROR of {@link ../context/recent-templates-context.js} (C-06,
 * FR-130) rather than a second, differently-shaped recents mechanism: same
 * storage strategy (the workspace's persisted UI store, bridged in), same cap
 * semantics (move-to-front, oldest-first eviction, cap 8), same reset
 * behaviour (`reset()` clears it; `restoreLayout()` does not). The only
 * difference is the identity a list holds — a template `id` there, a font
 * `family` here.
 *
 * Lives in `context/` (interaction-core) so `panels/` can consume it without
 * importing workspace chrome — the same layering posture as `toast-context`
 * and the templates seam. The workspace shell provides an implementation
 * backed by its persisted UI store; headless hosts have none and the font
 * picker simply shows no Recent group.
 */
export interface RecentFonts {
	/** Most recent first, capped by the provider. */
	readonly families: readonly string[];
	readonly add: (family: string) => void;
}

export const RecentFontsContext = createContext<RecentFonts | null>(null);

const NONE: RecentFonts = {
	families: [],
	add() {
		// No provider (headless mount, or a font field mounted standalone):
		// recents are off. Recording must never throw here — `cp2-004` made the
		// field deliberately mountable outside a studio tree.
	},
};

/** Null-tolerant read — resolves to an inert no-recents value outside the shell. */
export function useRecentFonts(): RecentFonts {
	return use(RecentFontsContext) ?? NONE;
}
