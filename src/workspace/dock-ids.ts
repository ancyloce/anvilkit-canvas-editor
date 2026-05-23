/**
 * @file Single source of truth for the Canva-shell dock ids.
 *
 * Kept dependency-free (no lucide/React) so both the Zustand UI store
 * (`state/workspace-ui-store.ts`) and the icon/label config
 * (`workspace-config.ts`) can import it without a cycle. `DockId` is derived
 * from the tuple so the union and the runtime list never drift.
 */

export const DOCK_IDS = [
	"ai",
	"templates",
	"elements",
	"text",
	"brand",
	"uploads",
	"layers",
] as const;

export type DockId = (typeof DOCK_IDS)[number];
