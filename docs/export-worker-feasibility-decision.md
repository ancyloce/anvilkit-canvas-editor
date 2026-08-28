# Export worker feasibility decision

Status: accepted (2026-08-27, PLAN-0039 E2-T7)

## Decision

Keep the built-in browser export pipeline on the main thread for E2. Continue
to cost and reject work before allocation, render and embed PDF pages one at a
time, and route jobs above the interactive budget to a host-provided
background or server executor. Do not add an internal Web Worker that moves
only PDF assembly or duplicates the Canvas renderer.

The pure `estimateCanvasExportCost` and `preflightCanvasPrint` functions are
already worker-safe: they use serializable inputs and no DOM, React, Konva,
font, canvas, or network APIs. Hosts that already own a worker may call those
core functions there, but they are deliberately kept before allocation in the
built-in main-thread path because their linear traversal is not the expensive
part of an export.

## Spike findings

| Stage | Worker feasibility | E2 outcome |
| --- | --- | --- |
| Cost estimation and print preflight | Worker-safe pure core functions. Structured cloning the document is likely more work than these checks save. | Keep immediately before allocation; host workers may reuse them. |
| JSON serialization | `JSON.stringify` itself is worker-safe, but browser-local asset resolution uses IndexedDB-backed state and produces a second full document string/Blob. | Keep bounded by the existing local-asset cap; no worker copy. |
| SVG serialization | Core emission is mostly worker-safe, but the built-in path resolves browser-local assets, font manifests, brand tokens, and text measurements through editor/host providers. Those callbacks are not transferable. | Keep code-split on the main thread until providers have byte-manifest message contracts. |
| PDF assembly | `pdf-lib` can run in a worker when given transferable image bytes. | Do not move it alone: the current serializer requests, embeds, and releases one page raster at a time. A batch worker message would retain every raster and regress E2-T3 memory bounds. |
| Rasterization and image encoding | Not worker-compatible in the current renderer. `rasterizePage` mounts React-Konva into a DOM container, waits for `document.fonts` and animation frames, then calls Konva `Stage.toDataURL`. | Keep on the main thread. `OffscreenCanvas` cannot mount the existing React-Konva tree or prove equivalent browser font/asset behavior. |

The executable regression in
`src/header/__tests__/export-worker-feasibility.test.ts` pins both sides of
this boundary: core estimation/preflight remain free of browser dependencies,
and the editor continues to rasterize inside the incremental PDF provider that
releases each page after embedding.

## Rejected alternatives

1. **Render every page, transfer the batch, then assemble PDF in a worker.**
   This removes some `pdf-lib` work from the main thread but simultaneously
   retains all page rasters in the sender/transfer queue and removes useful
   cancellation points. It conflicts with E2-T3.
2. **Rebuild Canvas rendering with `OffscreenCanvas`.** This would be a second
   renderer with different React, Konva, font, image, and encoder behavior. It
   cannot be treated as a performance-only change.
3. **Clone the whole IR for the pure checks.** These checks must finish before
   high-cost allocation. Paying an asynchronous structured-clone round trip
   would delay rejection without moving the expensive stage.

## Revisit conditions

Reconsider a worker implementation only when all of these contracts exist:

- a worker-compatible renderer with fidelity tests against the live
  React-Konva output;
- serializable asset, font, brand-token, and text-measurement manifests;
- a streaming raster protocol with one-page backpressure, transfer ownership,
  release acknowledgement, and cancellation acknowledgement;
- browser regressions proving all supported encoders and PDF output; and
- memory evidence showing no retained buffers after repeated cancellation.

Until then, the estimator's `likelyExecutionTier` is the routing seam. Hosts
should keep interactive jobs on the built-in bounded path and execute larger
jobs in their own background or server capability.
