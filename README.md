# @anvilkit/canvas-editor

The React + Konva editor UI for **AnvilKit Canvas Studio**. It renders the
headless [`@anvilkit/canvas-core`](../core) IR onto a Konva stage and gives you a
Figma-style authoring surface: tools, selection and transform handles, smart
guides, multi-page artboards, panels, export, and real-time presence.

This package is the **stateful, client-only view layer**. `@anvilkit/canvas-core`
is the React-free, Konva-free data layer (the IR, validators, immutable
mutations, and the undoable command runtime); this package turns that IR into
pixels and turns user gestures back into core commands. It must run in the
browser — mount it via `next/dynamic(() => …, { ssr: false })`.

```bash
pnpm add @anvilkit/canvas-editor @anvilkit/canvas-core
```

Peer dependencies: `react` / `react-dom` (>= 19), `konva`, and `react-konva`.
`yjs` + `y-protocols` are **optional** peers — install them only if you use the
collaboration entry (`@anvilkit/canvas-editor/collab`).

## Core features

- **Uncontrolled IR + undo/redo** — seed the document with `initialIR`; every
  edit flows through the command runtime, which records an inverse for undo.
- **Tool-driven editing** — `select`, `rect`, `ellipse`, `line`, `pen` (bezier
  paths), `text`, `image`, `hand` (pan), plus AI gesture tools (`ai-image`,
  `ai-brush`).
- **Smart-guide snapping** — alignment guides and snap-to-grid / snap-to-object
  while drawing and moving.
- **Selection & transforms** — marquee + click selection, resize/rotate handles,
  image cropping, and on-canvas path-point editing.
- **Multi-page artboards** — a built-in `<PageNavigator>` (suppressible) and
  page actions (`addPage`, `clonePage`, `switchToPage`, …).
- **Mountable UI** — `<LayerPanel>`, `<PropertyInspector>`, `<ElementsPanel>`,
  `<BrandPanel>`, `<ExportMenu>`, and inspector field primitives you compose
  into your own chrome (or use the `<CanvasWorkspace>` shell).
- **Brand kit** — pass shared colors + fonts via `brandKit`, read them with
  `useBrandKit`.
- **i18n seam** — host-injected `canvas.*` message catalog (`messages` prop);
  bundled English + Chinese catalogs ship under `./i18n`.
- **Collaboration** — optional Yjs binding and remote cursor / selection
  presence via the `./collab` entry.
- **Export** — built-in PNG + JSON exporters, a pluggable export menu
  (`createCanvasExportPlugin`), and stage-raster bridges (`exportStageContentDataURL`,
  `rasterizePage`).
- **Accessibility** — roving keyboard focus ring, an off-screen scene tree, and
  a live tool announcer.
- **Extensible** — register custom node kinds (renderers + inspectors) and
  custom tools through the `extensions` prop.

## Core Architecture

`<CanvasStudio>` is the root: it creates and owns every store, exposes them
through a two-tier React context, and renders the Konva stage. User gestures
enter through the tool layer, become `@anvilkit/canvas-core` commands, and run
through a single **commit cycle** that updates the live IR and notifies the
host. Rendering is a one-way projection of that IR onto Konva layers.

```
                    +-------------------------------------+
                    |              Host app               |
                    |  next/dynamic(() => ..., ssr:0)     |
                    +------------------+------------------+
                                       |  props in  /  IR + changes out
                                       v
                    +------------------+------------------+
                    |           <CanvasStudio>            |
                    |      creates 14 Zustand stores      |
                    +------------------+------------------+
                                       |  provides
         +-----------------------------+-----------------------------+
         |                 React context (two-tier)                  |
         |   Stable: stores . getIR . commit . commitBatch           |
         |   Full  : + live ir . activePageId . Konva stage          |
         +----+------------------------+------------------------+----+
              |                        |                        |
         read |                   read |                   read |
              v                        v                        v
   +----------+----------+  +----------+----------+  +----------+----------+
   |   Zustand stores    |  |     Tool layer      |  |   Render pipeline   |
   |  scene (live IR)    |  | ToolInteraction-    |  | <CanvasStage>       |
   | history (undo/redo) |  | Layer dispatches    |  | stacked Konva       |
   | selection . focus   |  | pointer to the      |  | layers (low->high)  |
   | tool . viewport     |  | active tool:        |  | background . grid   |
   | draft . guides      |  | select rect line    |  | objects . drag      |
   | editing . crop      |  | pen text image      |  | selection overlays  |
   | pen . pathEdit . ai |  | hand ai-image ...   |  | presence (collab)   |
   +----------+----------+  +----------+----------+  +----------+----------+
              ^                        |                        ^
              | setIR + inverse        | commit(cmd)            | redraw on
              |                        v                        |  new IR
   +----------+------------------------+------------------------+----------+
   |   commit cycle  (CanvasStudio.commit):                                |
   |   1. historyStore.commit(ir, cmd)                                     |
   |      -> applyCommand(ir, cmd) -> { ir, inverse }                      |
   |   2. sceneStore.setIR(next)  ->  re-render                            |
   |   3. onChange / onChanges    ->  host                                 |
   +-----------------------------------+-----------------------------------+
                                       |  uses (pure, headless)
                                       v
   +-----------------------------------+-----------------------------------+
   |                       @anvilkit/canvas-core                           |
   |   CanvasIR . CanvasNode . CanvasCommand . Change                      |
   |   applyCommand (returns inverse) . node factories                     |
   |   geometry . snap . SVG / PDF serializers                             |
   +-----------------------------------------------------------------------+
```

**Reading the diagram**

- **Stores** — 14 framework-agnostic Zustand stores. `scene` holds the live
  `CanvasIR` (the single source of truth); `history` records inverses for
  undo/redo; the rest hold transient UI state (selection, active tool, viewport,
  in-progress drafts, snap guides, pen anchors, crop, AI jobs).
- **Context (two-tier)** — the *Stable* half (stores + `getIR` / `commit` /
  `commitBatch`) never changes identity, so toolbars and panels reading it don't
  re-render on every edit. The *Full* context adds the live `ir`, `activePageId`,
  and Konva `stage` for components that need them.
- **Tool layer** — `ToolInteractionLayer` dispatches coalesced Konva pointer
  events to the active tool. Tools write transient `draft` / `guides` state while
  dragging, then call `commit(cmd)` on release. Drawing tools build nodes with
  core factories (`createRect`, `createText`, …).
- **Render pipeline** — `<CanvasStage>` stacks Konva `RenderLayer`s
  (background → objects → drag → selection overlays → presence).
  `CanvasNodeRenderer` projects each IR node to a Konva shape and defers to
  extension `kindRenderers` for custom node kinds.
- **Commit cycle** — the one path that mutates the document: `commit` runs
  core's pure `applyCommand`, stores the inverse for undo, swaps the new IR into
  `sceneStore`, and fires `onChange` / `onChanges` so the host can mirror,
  autosave, or sync the change. Because the render pipeline reads `scene` through
  context, `setIR` is what drives the redraw.

## How to use

Mount `<CanvasStudio>` client-side with an IR built from the core factories, and
mirror edits out through `onChange`:

```tsx
"use client";

import dynamic from "next/dynamic";
import { createCanvasIR, createRect } from "@anvilkit/canvas-core";
import "@anvilkit/canvas-editor/styles.css";

const CanvasStudio = dynamic(
	() => import("@anvilkit/canvas-editor").then((m) => m.CanvasStudio),
	{ ssr: false },
);

const initialIR = createCanvasIR({ title: "Untitled" });
initialIR.pages[0].root.children.push(
	createRect({ bounds: { width: 240, height: 160 }, fill: "#38bdf8" }),
);

export function Editor() {
	return (
		<CanvasStudio
			initialIR={initialIR}
			onChange={(ir, command) => {
				// persist / mirror into a host store; `command` is the applied action
			}}
			onPickAsset={async () => {
				// open your asset picker, return an asset id (needed for the image tool)
				return "asset-id";
			}}
		/>
	);
}
```

The editor ships **no toolbar of its own** — tool selection is host-driven.
Render your own chrome and panels in one of two ways, both of which run inside
the editor's context so they can call `useCanvasStudio()`:

- pass them as `children` of `<CanvasStudio>`, or
- use the `<CanvasWorkspace>` shell (exported from this package) for a complete
  rail + panel layout, or compose the stage yourself with the `renderShell` prop.

Mountable panels (`<LayerPanel>`, `<PropertyInspector>`, `<ElementsPanel>`,
`<BrandPanel>`, `<PageNavigator>`, `<ExportMenu>`) bind to the active instance's
stores automatically when rendered inside the provider.

### Entry points

| Subpath                              | Use it for                                                                                   |
| ------------------------------------ | -------------------------------------------------------------------------------------------- |
| `@anvilkit/canvas-editor`            | Stable host API: `CanvasStudio`, `CanvasWorkspace`, hooks, panels, export                    |
| `@anvilkit/canvas-editor/collab`     | Yjs binding + presence (requires the optional `yjs` / `y-protocols` peers)                   |
| `@anvilkit/canvas-editor/internal`   | Advanced internals: store factories, tools, stage + snap primitives (no stability guarantee) |
| `@anvilkit/canvas-editor/styles.css` | Compiled editor styles — import once in the host                                             |
| `@anvilkit/canvas-editor/i18n/en.json`, `…/zh.json` | Bundled message catalogs for the `messages` prop                              |

## Extending

Register custom node kinds and tools through the `extensions` prop. Each
`CanvasEditorExtension` may contribute `renderers` (kind → Konva renderer),
`inspectors` (kind → inspector UI), and `tools`. Pair it with
`createCanvasRuntime` in `@anvilkit/canvas-core`, which supplies the matching
schema / command / serializer extensions for the same kinds.

```tsx
<CanvasStudio
	initialIR={initialIR}
	extensions={[
		{
			id: "my-widget",
			renderers: [{ kind: "my-widget", render: ({ node }) => /* Konva */ null }],
			inspectors: [{ kind: "my-widget", render: (node, commit) => /* fields */ null }],
		},
	]}
/>
```

## Notes

- **IR is uncontrolled.** `initialIR` seeds the editor once; later prop updates
  do **not** replace the internal document. Mirror state out with `onChange`, and
  remount via a React `key` to load a different document.
- **Client-only.** The editor depends on Konva and the DOM — always load it with
  `ssr: false`. There is no server render path.
- **Styles must be imported.** Tailwind utilities and parent-document CSS do not
  reach the Konva canvas; import `@anvilkit/canvas-editor/styles.css` in the host.
- **`./internal` is unstable.** Deep imports (store factories, tools, stage / snap
  primitives) carry no semver guarantee — prefer the root entry where possible.
- **Collaboration peers are optional.** `yjs` and `y-protocols` are only needed
  for the `./collab` entry; omit them for single-user editing.

## Release gates

`pnpm check:all` runs the release-gate chain: `check:publint` (packed-tarball publint), `check:circular` (madge), `check:peer-deps` (dependency-cone rules), and `check:bundle-budget` (esbuild-based, budget and externals read from `.size-limit.json` so the two size gates cannot drift). An API-snapshot gate will join the chain once snapshot infrastructure lands.

Gates assume a **full package build** first — always run `pnpm build`: for this package, a bare `rslib build` wipes `dist/styles.css` (the `build:css` step regenerates it).

## License

MIT
