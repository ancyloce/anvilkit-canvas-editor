# Adapter integration guide

`@anvilkit/canvas-editor` keeps hosts in charge of storage, transport, and
catalogs through five small adapter contracts (PRD 0012 §11.1, §23). The
editor owns *when* things happen (debounce, retry, progress, undo semantics);
the adapter owns *where* data lives. All five are optional `CanvasStudioProps`
— omit one and its feature degrades gracefully (documented per adapter).

| Adapter | Prop | Feature it unlocks | Without it |
| --- | --- | --- | --- |
| `CanvasPersistenceAdapter` | `persistenceAdapter` | Save status, manual + auto save, dirty tracking, leave protection | No save UI, no dirty tracking |
| `CanvasAssetPicker` | `assetPicker` | "Browse" flows in image wells / uploads panel | Picker entries hidden |
| `CanvasAssetUploader` | `assetUploader` | File upload + drag-and-drop onto workspace/canvas/panel | Drop shows an info toast, no mutation |
| `CanvasTemplateProvider` | `templateProvider` | Remote template catalog (search, pagination, recents) | Static `templates` array (auto-wrapped in the same protocol) |
| `CanvasRecoveryAdapter` | `recoveryAdapter` | Crash-recovery snapshots + recover-draft dialog | No local recovery |

## Persistence — `CanvasPersistenceAdapter`

```ts
interface CanvasPersistenceAdapter {
	save(input: { ir: CanvasIR; documentId: string; revision: number }): Promise<{ savedAt?: string }>;
	load?(documentId: string): Promise<CanvasIR>;
}
```

`revision` is the history state id of the snapshot and is round-tripped so the
editor checkpoints exactly the state you persisted, even when responses arrive
out of order. Auto-save tuning via `autoSave` (defaults: `debounceMs` 1500,
`maxWaitMs` 10000, `maxRetries` 3, `retryBaseMs` 1000). Full lifecycle —
dirty state, save states, `beforeunload`, `canLeave()` — in
[persistence.md](./persistence.md).

## Assets — `CanvasAssetPicker` and `CanvasAssetUploader`

```ts
interface CanvasAssetPicker {
	pick(options: { multiple?: boolean; accept?: readonly string[]; kind?: "image" | "svg" | "video" | "audio" }): Promise<readonly CanvasPickedAsset[]>;
}
interface CanvasAssetUploader {
	upload(files: readonly File[], context: { documentId: string }): Promise<readonly CanvasUploadedAsset[]>;
}
```

A returned asset's `id` becomes the `ir.assets` key and the node's `assetId`;
`uri` is what renders and exports. The legacy `onPickAsset` prop keeps working
through a compat shim. Flows, progress, and failure semantics in
[assets.md](./assets.md).

## Templates — `CanvasTemplateProvider`

```ts
interface CanvasTemplateProvider {
	search(query: { text?; category?; size?; cursor?; limit? }): Promise<{ entries; nextCursor?; total? }>;
	getById(id: string): Promise<CanvasTemplateEntry | null>;
}
```

Cursor-paginated; the panel drives debounced text search, the FR-130 size
filter, skeleton/error/load-more states, and persisted recents. A static
`templates` array is wrapped in `createStaticTemplateProvider()` so the panel
always speaks one protocol — implementing the provider is only needed for
remote catalogs.

## Recovery — `CanvasRecoveryAdapter`

```ts
interface CanvasRecoveryAdapter {
	write(snapshot: { documentId: string; ir: CanvasIR; revision: number; savedAt: string }): Promise<void>;
	read(documentId: string): Promise<CanvasRecoverySnapshot | null>;
	clear(documentId: string): Promise<void>;
}
```

Snapshots are written debounced after commits and cleared on a successful
save or explicit discard; on mount, a newer-than-last-save snapshot opens the
recover-draft dialog (headless embeds auto-confirm — data-preserving).
Adapter failures are best-effort and never break editing.
`createIndexedDbRecoveryAdapter()` is the ready-made browser implementation.

## Rules that hold for every adapter

- Contracts are `Promise`-based; reject to signal failure — the editor maps
  failures to its own states (save retries/backoff, upload error toasts,
  panel error+retry states). Never `throw` synchronously.
- Adapters are identified by prop identity: pass a stable instance
  (module-level or memoized), not a fresh object per render.
- The editor never persists anything itself; no adapter, no I/O.
