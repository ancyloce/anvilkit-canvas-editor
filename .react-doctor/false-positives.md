# React Doctor — verified false positives

Diagnostics investigated and confirmed non-actionable. Each entry names the exact
site, the mechanism that produced the false match, and how it was verified —
per a manual /doctor triage pass (see repo history for date). Re-check the
reasoning if the referenced code moves or changes shape; don't drop silently.

## deslop/unused-dev-dependency — package.json

- `@anvilkit/biome-config`: consumed via `biome.json`'s `"extends":
  ["@anvilkit/biome-config/base"]`. The scanner walks the JS/TS import graph,
  not JSON config `extends` fields, so it never sees this reference. Removing
  it breaks `pnpm lint`/`pnpm format` for this package.
- `typedoc-plugin-markdown`: consumed via `typedoc.json` → (extends)
  `typedoc.base.json`'s `"plugin": ["typedoc-plugin-markdown"]`, invoked by
  `scripts/check-api-snapshot.mjs` (`pnpm exec typedoc --options
  ./typedoc.json`), which is part of the `check:all` release gate. Same
  scanner blind spot as above.

Verified by reading `biome.json`, `typedoc.json`, `typedoc.base.json`, and
`scripts/check-api-snapshot.mjs` directly, and confirming both packages are
still real, resolvable devDependencies each package that runs these tools
needs declared locally under pnpm's strict (non-hoisted-by-default) install
model.

## react-doctor/no-impure-state-updater

All 6 findings in this package are the same root cause, not distinct bugs:

- `src/CanvasStudio.tsx:449` (`setStage(next)`)
- `src/header/ExportMenu.tsx:171` (`setOpen(next)`)
- `src/header/ExportMenu.tsx:310` (`setStripMetadata(checked)`)
- `src/panels/TemplatesPanel.tsx:187` (`setCategory(next)`)
- `src/panels/fields.tsx:144` (`setFrozen(value)`, reported via the
  `useFrozenKey(value)` call site)
- `src/selection/PathEditOverlay.tsx:57` (`setDraft(next)`)

None of these pass a `prevState => { ...sideEffect...; return next }`
functional updater to their setter — every one calls the setter with a plain
value (`setStage(next)`, not `setStage(prev => ...)`). The rule (oxlint-plugin-
react-doctor 0.7.7, `src/plugin/rules/state-and-effects/no-impure-state-
updater.ts`) resolves its `updaterArgument` via `resolveToFunction`, which
reads `ref.resolved.defs[0].node`. For a **parameter** binding, that scope-
analysis convention points at the *enclosing function*, not the parameter's
runtime value. Every flagged argument (`next`, `checked`, `value`) is itself a
parameter of the enclosing callback/hook, so the rule treats that whole
enclosing function as "the updater," walks its body, and finds the very same
setter call it started from — reporting it back as a fabricated "nested state
update." Confirmed by reading the compiled rule source
(`oxlint-plugin-react-doctor/dist/index.js`) and cross-checking the reported
column/length in `--json` output against the exact flagged token (e.g.
`ExportMenu.tsx:310` highlights `checked`, 7 chars — the argument identifier,
not the setter call).

No code change needed or made. Re-open if a future site in this rule's report
actually uses the `setX(prev => {...})` functional form with a real side
effect inside it — that shape is a genuine bug and this note does not cover it.

## react-doctor/no-array-index-as-key

- `src/panels/fill-shadow-fields.tsx:130` — gradient stops
  (`CanvasGradientStop` in `@anvilkit/canvas-core`) have no `id` field, only
  `color`/`offset`. The key already uses content (`${stop.color}@${stop.offset}`)
  with `#${i}` only as a tie-breaker for stops that are momentarily identical
  (same color and offset) — not index-only. Adding a real per-stop id would
  mean widening the `CanvasGradientStop` IR schema (validators, serialization,
  undo/redo, collab) — out of scope for a lint cleanup pass. Left as-is.
- `src/tools/PenPreview.tsx:40` — pen-tool anchor dots while actively drawing.
  `pen-store.ts`'s `addAnchor` only ever appends
  (`anchors: [...state.anchors, anchor]`) and `clear()` resets to `[]`; there
  is no splice/removal of an arbitrary middle anchor and no reordering. This
  is exactly the rule's own documented false-positive shape ("append-only
  ... rows ... never reorder or filter"). Left as-is.

## react-doctor/no-flush-sync — src/render/rasterize-page.tsx:10

`rasterizePage` mounts a standalone React root into an off-screen, `pointer-
events: none` detached `<div>` purely to drive react-konva into building a
`Konva.Stage`, then calls `stage.toDataURL()` and tears the root down — no
user ever sees this DOM. `flushSync` here guarantees the Konva stage instance
exists before the function proceeds to `waitFrame()`/`toDataURL()`; there is
no on-screen View Transition or concurrent update being skipped, because
there is no visible transition at all. This is exactly the rule's own
documented false positive: "integrating with a non-React imperative library
that must observe a fully-committed DOM before its next line runs." Swapping
to `startTransition` would make `stage` unreliable (it may still be `null`
when checked) — that's a real regression, not a fix. Left as-is.

## react-doctor/effect-needs-cleanup — src/selection/CanvasTransformer.tsx:397

`useAnchorHoverHighlight`'s effect registers `mouseenter.akhover` /
`mouseleave.akhover` on each Konva anchor inside a `for` loop, and the
*same* effect already returns `() => { for (const a of anchors) a.off(".akhover"); }`
— a second `for` loop that removes exactly the namespaced listeners just
added. The rule's own validation prompt documents this exact class of false
positive: its cleanup matcher checks the effect's top-level statements and
returned function but doesn't reliably correlate a registration inside one
`for` loop with a matching teardown inside a *different* `for` loop in the
return statement, even though both iterate the same `anchors` array. Cleanup
genuinely exists and genuinely releases what was registered. Left as-is.

## react-doctor/no-json-parse-stringify-clone — src/tools/__tests__/image-tool-frame.test.ts:305

The comment directly above this line states the intent: "Serialize exactly
as the document would be persisted." This test deliberately uses
`JSON.parse(JSON.stringify(...))` to exercise the *real* JSON persistence
round-trip — including that `patch: { crop: undefined }` (set two lines
above) actually drops the `crop` key on save, matching how the app's real
persistence layer serializes documents. `structuredClone` does **not** drop
`undefined`-valued keys, so swapping it in would silently change what the
test verifies (masking a real bug if `undefined` fields ever leaked into a
persisted document) — that weakens the test, which CLAUDE.md's gate rules
forbid doing just to satisfy a linter. Left as-is.
