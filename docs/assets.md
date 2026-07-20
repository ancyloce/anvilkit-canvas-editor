# Asset integration guide

How images (and other media) get into a document: the picker and uploader
adapters (FR-090/091), drag-and-drop (FR-092), replacement (FR-093), fit
modes (FR-094), and loading/adjustment behavior. Contract shapes are in
[adapters.md](./adapters.md).

## The asset model

Assets live in `ir.assets` (id → `{ uri, mimeType?, width?, height? }`);
nodes reference them by `assetId`. Whatever `uri` you return is what renders
in the editor *and* what exports embed or reference — return a durable URL
(CDN), not a blob URL that dies with the session. Intrinsic `width`/`height`
matter: the `original` and `center` fit modes need them (exports approximate
as `fit` with a typed warning when they're missing), and drop placement uses
them for initial node bounds.

## Entry paths into a document

| Path | Requires | Behavior |
| --- | --- | --- |
| Uploads panel ("Browse") | `assetPicker` | `pick()` with kind/accept filters; multi-select supported. |
| Uploads panel (file input) | `assetUploader` | Upload with per-file progress, retry, and cancel via the upload store. |
| Drag-and-drop onto canvas / workspace / panel | `assetUploader` | Drop-position insert; multi-file drops grid-arrange; **no nodes are created on upload failure** (error toast instead). |
| Drag-to-replace (FR-093) | `assetUploader` (or a done upload dragged from the panel) | A SINGLE file — or a completed upload dragged from the uploads panel — dropped on an existing image node or image-well frame replaces that target instead of inserting: bounds, transform, and crop survive (`image.replace` only swaps `assetId`; a filled well's placeholder re-points in the same step). One atomic undo entry including the upload's `asset.put`. Locked and hidden nodes are never targets; multi-file drops never replace (ambiguous) and target-less drops insert as usual. A "Drop to replace" badge plus `data-drop-target`/`data-drop-target-id` attributes on the drop zone announce the active target while dragging. |
| Image well "Replace" (inspector / frame wells) | either adapter | Swaps the node's `assetId`, preserving bounds, fit mode, crop, and adjustments. |
| No adapter configured | — | Drop/browse show an info toast; nothing mutates. |

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
  resolves; a missing asset renders nothing (no crash) and warns on export.

## Legacy compat

The pre-B-10 `onPickAsset?: () => Promise<string>` prop still works through a
compat shim (contract-tested). New hosts should implement `CanvasAssetPicker`
— it carries MIME/kind filters, multi-select, and intrinsic dimensions.
