import { createStore, type StoreApi } from "zustand/vanilla";

/**
 * Guide orientation, matching `CanvasPageGuides` in core (§9.3): a
 * `horizontal` guide is a horizontal LINE at a y-position; a `vertical`
 * guide is a vertical line at an x-position.
 */
export type CanvasGuideAxis = "horizontal" | "vertical";

/** A drag-from-ruler guide preview, in page coordinates of the active page. */
export interface PendingGuide {
	axis: CanvasGuideAxis;
	position: number;
}

/**
 * Workspace-chrome state for rulers and guides (C-02, FR-110/111/113).
 * Persistent guide POSITIONS live in the document (`page.layoutAids.guides`,
 * committed via the action layer); everything here is UI-only — visibility
 * toggles, the lock switch, and the transient drag-from-ruler preview — and
 * must never enter Canvas IR.
 */
export interface RulerGuideState {
	/** FR-110 ruler visibility. Off by default (existing hosts keep their look). */
	rulersVisible: boolean;
	/** FR-111 hide guides (positions stay in the document). */
	guidesVisible: boolean;
	/** FR-111 lock guides — locked guides render but cannot be dragged. */
	guidesLocked: boolean;
	/** FR-113 center-line display aid (pure chrome, never persisted). */
	centerLinesVisible: boolean;
	/** FR-113 margin/bleed/safe-area rendering toggle for pages that have them. */
	layoutAidsVisible: boolean;
	/** Live drag-from-ruler preview; null when no drag is in progress. */
	pendingGuide: PendingGuide | null;
	setRulersVisible: (visible: boolean) => void;
	setGuidesVisible: (visible: boolean) => void;
	setGuidesLocked: (locked: boolean) => void;
	setCenterLinesVisible: (visible: boolean) => void;
	setLayoutAidsVisible: (visible: boolean) => void;
	setPendingGuide: (pending: PendingGuide | null) => void;
}

export type RulerGuideStoreApi = StoreApi<RulerGuideState>;

export interface CreateRulerGuideStoreOptions {
	rulersVisible?: boolean;
	guidesVisible?: boolean;
	guidesLocked?: boolean;
	centerLinesVisible?: boolean;
	layoutAidsVisible?: boolean;
}

export function createRulerGuideStore(
	options: CreateRulerGuideStoreOptions = {},
): RulerGuideStoreApi {
	return createStore<RulerGuideState>()((set) => ({
		rulersVisible: options.rulersVisible ?? false,
		guidesVisible: options.guidesVisible ?? true,
		guidesLocked: options.guidesLocked ?? false,
		centerLinesVisible: options.centerLinesVisible ?? false,
		layoutAidsVisible: options.layoutAidsVisible ?? true,
		pendingGuide: null,
		setRulersVisible(visible) {
			set({ rulersVisible: visible });
		},
		setGuidesVisible(visible) {
			set({ guidesVisible: visible });
		},
		setGuidesLocked(locked) {
			set({ guidesLocked: locked });
		},
		setCenterLinesVisible(visible) {
			set({ centerLinesVisible: visible });
		},
		setLayoutAidsVisible(visible) {
			set({ layoutAidsVisible: visible });
		},
		setPendingGuide(pending) {
			set({ pendingGuide: pending });
		},
	}));
}
