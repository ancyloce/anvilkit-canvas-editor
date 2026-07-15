"use client";

// INTENTIONAL null renderer (documented M0-08). A validated presence source
// exists (I3-1): `@anvilkit/canvas-editor/collab`'s `useCanvasPresence()` —
// presence DATA flows, but selection-overlay rendering is deferred to the
// collaboration upgrade (PRD 0012 Phase 3). Kept mounted so the render slot
// and layer ordering are stable when rendering lands.
export function RemoteSelections(): null {
	return null;
}
