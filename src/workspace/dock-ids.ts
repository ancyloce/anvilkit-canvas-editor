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

/**
 * Dock entries HIDDEN from the default rail because their features do not
 * exist yet (M0-08 stub reconciliation): "coming soon" tabs don't ship in the
 * default UI. `ai`/`text` return when their panels land (PRD 0012 Phase 2+);
 * `uploads` stays visible as it is filled next milestone (B-10). The ids stay
 * in {@link DOCK_IDS} so the type union, persisted-state migration, and host
 * registry overrides remain stable.
 */
export const HIDDEN_DOCK_IDS: ReadonlySet<DockId> = new Set<DockId>([
	"ai",
	"text",
]);
