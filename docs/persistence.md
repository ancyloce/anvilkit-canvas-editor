# Persistence guide

The FR-160..164 save pipeline (B-08/C-10): what the editor does with a
`persistenceAdapter`, how dirty state and the save checkpoint work, and every
host hook in the lifecycle. Contract shapes are in
[adapters.md](./adapters.md); this guide is the behavior.

## The six save states (FR-003/FR-161)

`clean → dirty → saving → saved | error | offline`

- **clean** — the document is at the save checkpoint (freshly loaded, or
  saved, or undone back to it).
- **dirty** — history moved away from the checkpoint. Undoing *back to* the
  checkpoint returns to clean without touching the adapter.
- **saving** — an adapter `save()` is in flight.
- **saved** — the last attempt settled successfully (`lastSavedAt` shown in
  the header pill, announced for a11y per §12.8).
- **error** — retries exhausted; the header offers manual retry. The next
  change re-arms auto-save.
- **offline** — the online probe (`navigator.onLine` by default) reports
  offline; saving resumes when connectivity returns.

Subscribe from the host with `onSaveStateChange` (`CanvasStudioProps`).

## Checkpoint semantics — why `revision` matters

The controller subscribes to the history store's state identity. Each
`save()` carries the history `revision` it snapshotted, and the adapter
response **checkpoints the revision it actually saved** — so out-of-order
responses can never mark a newer state clean (a stale success is recorded
against the old revision only). This is also what makes
"undo-to-checkpoint = clean" exact rather than heuristic.

## Auto-save (FR-162)

`autoSave` on `CanvasStudioProps`: `true` (default behavior when an adapter
is present), `false`, or options:

| Option | Default | Meaning |
| --- | --- | --- |
| `debounceMs` | 1500 | Quiet period after the last change before a save fires. |
| `maxWaitMs` | 10000 | Ceiling: a save fires at most this long after the FIRST unsaved change, even under continuous editing. |
| `maxRetries` | 3 | Failed-save retries before giving up until the next change. |
| `retryBaseMs` | 1000 | Exponential backoff base (1s, 2s, 4s, …). |

## Leave protection (FR-163)

- `beforeunload` warns while `canLeave()` is false (dirty or save in flight).
- SPA routing: gate navigation on the context's `canLeave()` and call
  `flush()` (save-immediately) before unmount; the shell flushes on unmount
  automatically.
- Manual save: header button or the context `save()` — resolves `true`/`false`
  when *that* attempt settles.

## Local recovery (FR-164) and how it interacts

With a `recoveryAdapter`, a debounced IR snapshot (with its `revision`) is
written after commits and **cleared on a successful save** — recovery only
ever holds work that persistence hasn't. On mount, a snapshot newer than the
last save opens the recover-draft dialog; recovery failures are best-effort
and never block editing. `createIndexedDbRecoveryAdapter()` is provided.

## Host checklist

1. Pass a stable `persistenceAdapter` instance and a `documentId`.
2. Handle `save()` rejections in the adapter with meaningful errors — the
   message lands in the save-status store (`lastError`) and the error pill.
3. Gate SPA navigation on `canLeave()`; flush before unmount if you bypass
   the shell.
4. Optionally add `recoveryAdapter` (IndexedDB one-liner) and
   `onSaveStateChange` for host-side telemetry.
