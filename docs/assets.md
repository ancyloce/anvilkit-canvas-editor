# Asset integration guide

How images (and other media) get into a document: the built-in browser-local
default, the picker and uploader adapters that override it (FR-090/091),
drag-and-drop (FR-092), replacement (FR-093), fit modes (FR-094), and
loading/adjustment behavior. Contract shapes are in
[adapters.md](./adapters.md).

**Neither asset adapter is required.** Since PLAN-0035 P1 a bare
`<CanvasStudio initialIR={…} />` ingests images on its own, into
browser-local storage. Wiring `assetPicker` / `assetUploader` *overrides* that
default; it is not a precondition for images working. The precedence rule —
including the `disableLocalAssetFallback` opt-out — is in
[adapters.md → Asset adapter precedence](./adapters.md#asset-adapter-precedence).

## The asset model

Assets live in `ir.assets` (id → `{ uri, mimeType?, width?, height? }`);
nodes reference them by `assetId`. Whatever `uri` is stored is what renders in
the editor *and* what exports embed or reference. **A host adapter should
return a durable URL (a CDN URL), because the document travels wherever that
URL resolves.** The built-in fallback deliberately does not — it returns a
`blob:` handle into this browser's own store, which is exactly why it carries
the portability caveat below. Intrinsic `width`/`height` matter either way:
the `original` and `center` fit modes need them (exports approximate as `fit`
with a typed warning when they're missing), and drop placement uses them for
initial node bounds.

## The built-in local adapters (zero config)

With no `assetPicker`, no `assetUploader`, and no legacy `onPickAsset`, the
editor supplies its own pair. They implement the same two contracts a host
would, through the same seams, so every downstream behaviour — per-file
progress, cancel, retry, drag-to-replace, one-undo-entry inserts — is the
behaviour documented on this page rather than a reduced variant.

### Portability caveat — read this before relying on the default

> **A document whose images came from the built-in default is browser-local.**
> The bytes live in *this* browser's IndexedDB, and the document itself stores
> only a `blob:` URI — a handle, not an address. It resolves nowhere but the
> session that minted it: not on a colleague's machine, not on your server, and
> not in this browser after a reload. The editor papers over that last case by
> re-minting the handle on load ([Rehydration](#rehydration-across-a-reload)),
> but a raw copy of the document JSON has no such help.

This is the default's one real limitation, and it is not a bug — it is what
"zero config" costs. A document becomes portable only by exporting through a
format that **carries the bytes**:

| Format | Carries local bytes? |
| --- | --- |
| `png` / `jpeg` / `webp` | **Yes** — these are pixels read off the stage, never a URI. Output is byte-identical whether the asset was local or remote. |
| `pdf` / `pdf-print` | **Yes** — PDF embeds those same rasters. |
| `svg` | **Yes** — the exporter embeds real base64 bytes and the `blob:` URI never appears in the output. `MISSING_ASSET` when the store no longer holds them. |
| `json` | **Under a cap.** Local assets inline as `data:` URIs while their combined *source* size is at most `DEFAULT_JSON_INLINE_ASSET_BYTES` (10 MiB). Above the cap nothing is inlined and the artifact carries one `LOCAL_ASSET_NOT_PORTABLE` warning **per** image, naming it — it never emits an unresolvable URI silently. |

So: if the product's documents must move between devices, users, or a server,
either wire a real `assetUploader` (which stops the fallback being constructed
at all) or turn images off deliberately with `disableLocalAssetFallback`. If
they stay on one machine — a scratch pad, a preview, a demo — the default is
exactly right.

The per-format detail, all three warning codes, and how to change the JSON cap
are in
[export-capability-matrix.md → Browser-local assets and portability](./export-capability-matrix.md#browser-local-assets-and-portability).

### What it stores, and where

| | |
| --- | --- |
| Bytes | The original `File` as a `Blob` — no re-encoding, no base64. |
| Where | IndexedDB, database `anvilkit-canvas-assets`, this origin only. |
| Document reference | `ir.assets[id].uri` is a `blob:` object URL; `id` is a `crypto.randomUUID()`. |
| Metadata | `mimeType`, `byteSize`, `createdAt`, intrinsic `width`/`height`, original filename — stored beside the blob, never in the IR. |
| Per-asset cap | **25 MiB.** A larger file is rejected with a toast; nothing is written. |
| Total cap | **200 MiB** across the whole store. At the limit the user is told storage is full and asked to remove images. |
| Intrinsic sizing | Read per file so inserted nodes are correctly sized. SVG dimensions come from the source `<svg>` element (`width`/`height`/`viewBox`), not from an image decoder. |

The caps are not tuning knobs on a public prop: they exist so a runaway drop
cannot silently consume the user's origin quota. 200 MiB stays inside the
smallest realistic browser quota, and is also the ceiling on the in-memory
degradation below, where the whole store is resident in the tab.

### When IndexedDB is unavailable

Private-browsing modes, disabled site storage, sandboxed frames, and SSR/test
environments have no usable IndexedDB. The store **degrades to an in-memory
`Map`** with one console warning and never throws — uploads keep working for
the life of the tab.

**In that state assets do not survive a reload at all**, not merely a move to
another machine. The editor surfaces this as a `LOCAL_ASSET_VOLATILE_STORE`
export warning (`level: "error"`), but only on the JSON over-cap path — once
the bytes are inlined the artifact is portable regardless of what the store is
made of.

### Rehydration across a reload

Object URLs die with the page. On document load the editor re-mints a fresh
`blob:` URL for every asset id the local store still holds and publishes it to
the stage through the assets context, so a reloaded document paints its images
normally.

Two properties are worth knowing because they shape what a host can observe:

- **The document is never rewritten.** The fresh URI exists only in the
  render-time context — it cannot reach `onChange`, a save, or an export. A
  re-minted `blob:` URI is exactly as unportable as the one it replaces, so
  persisting it would only move the same breakage one save later.
- **Rehydration only runs in the zero-config state.** With a host adapter
  present the editor stays out of it entirely and your URIs reach the renderer
  untouched.

An id the store no longer holds is dropped from the table and renders the
existing missing-asset placeholder (`canvas.image.missingAsset`) plus the
batched missing-asset toast — never a crash, and never an invented second
error state.

## Entry paths into a document

Every path below works in the zero-config default; the "Adapter" column names
which contract it goes through, **not** a prop you must pass.

| Path | Adapter used | Behavior |
| --- | --- | --- |
| Uploads panel ("Browse") | `assetPicker` (host or built-in) | `pick()` with kind/accept filters; multi-select supported. |
| Uploads panel (file input) | `assetUploader` (host or built-in) | Upload with per-file progress, retry, and cancel via the upload store. |
| Image tool | `assetPicker` (host or built-in) | Opens the picker for a single image. The tool is disabled only when there is no picker at all — i.e. state 3. |
| Drag-and-drop onto canvas / workspace / panel | `assetUploader` (host or built-in) | Drop-position insert; multi-file drops grid-arrange; **no nodes are created on upload failure** (error toast instead). |
| Drag-to-replace (FR-093) | `assetUploader` (or a done upload dragged from the panel) | A SINGLE file — or a completed upload dragged from the uploads panel — dropped on an existing image node or image-well frame replaces that target instead of inserting: bounds, transform, and crop survive (`image.replace` only swaps `assetId`; a filled well's placeholder re-points in the same step). One atomic undo entry including the upload's `asset.put`. Locked and hidden nodes are never targets; multi-file drops never replace (ambiguous) and target-less drops insert as usual. A "Drop to replace" badge plus `data-drop-target`/`data-drop-target-id` attributes on the drop zone announce the active target while dragging. |
| Image well "Replace" (inspector / frame wells) | either adapter | Swaps the node's `assetId`, preserving bounds, fit mode, crop, and adjustments. |
| `disableLocalAssetFallback` and no host adapter | — | Drop/browse show an info toast ("This workspace has no upload service configured"); the Image tool is disabled; nothing mutates. |

Every successful path is a single undo entry (node insert + asset
registration together).

## Upload lifecycle

`upload(files, { documentId, signal, onProgress })` is called **once per
file** (a one-element `files` array) so progress and cancellation attribute
to a single task; adapters may batch internally. `onProgress` fractions
render a determinate percentage; adapters that never report show an
accessible indeterminate bar. Cancelling a task aborts its `signal` (real
transport cancellation when honored; logical result-discard for legacy
adapters that ignore it — see [adapters.md](./adapters.md)). A partial batch
inserts only its successes, still as one undo entry. Document replacement and
unmount abort every in-flight task. Rejection surfaces an error toast with
retry. Uploads that succeed after the user navigated away are dropped (no
orphan commits). Validate type/size limits host-side in the adapter — the
editor enforces only its `accept` filters.

Under the built-in fallback the *store's* caps are the only size enforcement,
and they surface through this same lifecycle: a file over 25 MiB, or one that
would push the store past 200 MiB, rejects the task and the existing upload
error toast reports the limit. Cancelling before the write lands stores
nothing; cancelling after it lands deletes the blob and revokes its URL, so a
cancelled upload never leaves an orphan behind.

## Fit modes and adjustments (rendering contract)

- `fitMode` (FR-094): `stretch` (default, distorts), `fill` (cover + crop),
  `fit` (letterbox), `original` (intrinsic size from node origin), `center` —
  the latter two need intrinsic dims (see above). `crop` applies within the
  fitted space.
- `adjustments` (FR-100) compile to ONE color matrix in
  `@anvilkit/canvas-core` shared by the live canvas and SVG export — what you
  see is what exports. See
  [export-capability-matrix.md](./export-capability-matrix.md) for the
  per-format details.
- Loading states (FR-095): images render a placeholder until the asset
  resolves. A missing asset renders **selectable placeholder chrome in the
  live editor** (no crash) and nothing at all in an export or rasterize pass,
  where it warns instead.

## Known gaps

Two surfaces still read the document's raw `ir.assets` instead of the
rehydrated table, so they show the missing-asset placeholder for an image the
stage is painting correctly. Both are invisible until the user reloads, both
are zero-config-default-only (a host adapter's URIs need no rehydration), and
**neither has an owning task** — they are recorded here rather than buried:

| Surface | Symptom after a reload |
| --- | --- |
| Page thumbnails (`usePageThumbnails`, called from the page navigator and the pages canvas — both sit outside the assets context provider) | The stage shows the image; its page thumbnail shows the missing placeholder. |
| Offscreen raster and PDF export (`export-runner`'s `renderPageArtifact` and `pdfExporter` both hand `rasterizePage` the raw `ir.assets`) | The stage shows the image; a PNG/JPEG/WebP/PDF export of it renders the missing-asset placeholder. In the session that uploaded the image this is harmless — `ir.assets` still holds a live handle. |

They are one class of bug, not two: a consumer reading `ir.assets` directly
rather than the rehydrated table, which lives only in the stage's assets
context. The fix has the same shape in both places — put the rehydrated table
where those call sites can read it (a `CanvasStudioContextValue` addition),
then read it — and it is a public-surface change, which is why neither was
done opportunistically.

A third gap is in coverage rather than behaviour: the unit suites cover the
default adapters against mocked stores and an emulated file input, but a real
OS file dialog, a real IndexedDB backend (jsdom has none, so the store
degrades to memory), and real DOM drag events are exercised only by the
zero-config smoke E2E.

## Legacy compat

The pre-B-10 `onPickAsset?: () => Promise<string>` prop still works through a
compat shim (contract-tested). New hosts should implement `CanvasAssetPicker`
— it carries MIME/kind filters, multi-select, and intrinsic dimensions.
