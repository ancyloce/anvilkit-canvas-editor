# Auto Layout — rollout, rollback, and release notes

Plan 0022 T-M5-05 · PRD 0014 §19 · capability `layout.auto.v1`

## What ships

- **Capability**: documents carrying Auto Layout intent declare
  `layout.auto.v1` in `compatibility.requiredCapabilities`. The editor
  completes the declaration at every persistence boundary (save, unload
  save, recovery mirror) — hosts never manage it by hand. A reader meeting
  an *unknown* capability opens the document read-only (commits blocked,
  render/export live); a layout-bearing document *missing* its declaration
  is rejected by the `missing-required-capability` invariant.
- **Feature flag**: `<CanvasStudio autoLayout>` (boolean or
  `{ creationUI: boolean }`; prop name provisional under OQ-5).
  **Opt-in, default OFF for the whole alpha/beta line.** It gates ONLY
  creation/conversion affordances. Reading, rendering, editing existing
  intent, and exporting are never flag-gated at any phase.
- **Host observability**: the optional `onLayoutEvent` callback carries the
  six PRD §12 events. No telemetry client is added; diagnostics fire on
  commit only, deduped by `(code, nodeId, axis)`.

## Staged rollout (plan §9.4)

| Phase | Read/render/export | Creation UI | Flag |
| --- | --- | --- | --- |
| 1 — internal fixtures | Yes | No | off (opt-in) |
| 2 — beta hosts | Yes | No | off (opt-in) |
| 3 — selected hosts | Yes | Yes | opt-in, enabled per host |
| 4 — GA | Yes | Yes | **default on** |

Polarity is load-bearing: Phase 2 is exactly "render and export, but no
creation", which a default-on opt-out prop cannot express. **The Phase-4
default-on flip is a releasable behaviour change and MUST carry release
notes** naming the new default and the opt-out.

## Rollback (plan §9.6)

Disable creation/edit affordances first (`autoLayout` off / prior editor
version). The resolver, read path, flatten-where-safe, and export remain
available — a rolled-back editor still opens, edits, and exports
layout-bearing documents. Rollback never strips `autoLayout`, `layoutItem`,
capability metadata, or unknown fields, and never saves a downgraded
document over the original. Rehearsed by
`src/__tests__/auto-layout-rollout.test.ts` (TS-59).

## Emergency flatten

`flattenCanvasLayout` is deliberately lossy (intent stripped, capability
cleared so older readers can open the result). It is an explicit user/host
action and its output MUST be written as a **new document or revision** —
never over the original. The rehearsed host recipe:

```ts
const flattened = {
	...flattenCanvasLayout(original, { resolved }),
	id: newDocumentId, // the original stays the source of truth
};
```

## Release-note checklist for any train touching Auto Layout

1. Capability `layout.auto.v1` and the read-only behaviour for unknown
   capabilities.
2. The flag's current phase and default (and, at Phase 4, the flip).
3. The `onLayoutEvent` observability surface.
4. Migration note: IR v3 documents open in v3-capable builds only
   (fail-closed at `migrateCanvasIR` for older readers, by design).
