"use client";

import { createContext, use } from "react";

/**
 * Recently-used templates seam (C-06, FR-130). Lives in `context/`
 * (interaction-core) so `panels/` can consume it without importing workspace
 * chrome — the same layering posture as `toast-context`. The workspace shell
 * provides an implementation backed by its persisted UI store; headless
 * hosts have none and the Templates panel simply shows no recents row.
 */
export interface RecentTemplates {
	/** Most recent first, capped by the provider. */
	readonly ids: readonly string[];
	readonly add: (id: string) => void;
}

export const RecentTemplatesContext = createContext<RecentTemplates | null>(
	null,
);

const NONE: RecentTemplates = {
	ids: [],
	add() {
		// No provider (headless mount): recents are off.
	},
};

/** Null-tolerant read — resolves to an inert no-recents value outside the shell. */
export function useRecentTemplates(): RecentTemplates {
	return use(RecentTemplatesContext) ?? NONE;
}
