# Workspace composition guide

How `@anvilkit/canvas-editor`'s two mounting modes fit together, what the
default shell is made of, and every seam a host can compose against.
(PRD 0012 §23 "Workspace composition guide".)

## Two mounting modes

| Mode | Component | What you get |
| --- | --- | --- |
| Shell | `<CanvasWorkspace>` | The full Canva-style editor: header, panel dock + tab panel, canvas with floating tool strip and element controls, inspector, footer, toast/dialog hosts, workspace shortcuts. |
| Headless | `<CanvasStudio>` | Stage + stores only. No chrome, no global keymap (only stage-scoped editing keys), no toast/dialog hosts (auto-confirm / no-op seams). Compose your own chrome via `renderShell`. |

`CanvasWorkspaceProps` extends `CanvasStudioProps` (minus `renderShell`, which
the shell owns): every adapter and document prop documented in
[adapters.md](./adapters.md) works identically in both modes.

## Shell anatomy

```
CanvasStudio (stores, stage, action layer)
└─ renderShell:
   WorkspaceUiStoreProvider (per-storeId persisted layout)
   └─ CanvasToastHost › CanvasDialogHost
      └─ workspace root (shortcut registry listens here, never window)
         ├─ WorkspaceHeader   back · title · avatars · save status · zoom ·
         │                    more menu · headerPlugins · shareSlot
         ├─ WorkspaceBody     PanelDock · TabPanel (resizable, persisted) ·
         │                    canvas (ToolStrip · ElementControls) · inspector
         └─ WorkspaceFooter   selection summary · zoom · continuous-creation badge
```

## Composition seams (`CanvasWorkspaceProps`)

| Prop | Default | Use |
| --- | --- | --- |
| `storeId` | `"default"` | Namespaces the persisted UI layout (panel widths, recents). Pass a per-design id to isolate. |
| `shortcuts` | `true` | `false` disables the whole workspace keymap; `{ extraBindings }` appends host bindings (same `id` replaces a built-in). See [shortcut-reference.md](./shortcut-reference.md) — generated from the registry. |
| `toolStrip` | `true` | `false` hides the floating tool strip (hosts with their own tool chrome). |
| `inspector` | `true` | `false` removes the right property-inspector column. |
| `headerPlugins` | — | Header right-cluster plugins; the built-in export dialog ships as `createCanvasExportPlugin()`. |
| `dockItems` / `panels` | built-ins | Reorder/extend the panel dock; override tab-panel registry entries. |
| `onBack`, `title`, `onTitleChange`, `avatarsSlot`, `shareSlot` | — | Header slots: back button, click-to-edit title, collaborator avatars, share/publish cluster. |
| `elementActions` | — | Host handlers for the ElementControls "more" menu; built-in duplicate/align/distribute run through the action layer when omitted. |

Headless embeds compose the same stage with their own chrome:

```tsx
<CanvasStudio
	initialIR={ir}
	renderShell={(stage) => (
		<MyChrome>{stage}</MyChrome>
	)}
/>
```

## Shortcut registry ownership

Shortcuts belong to the WORKSPACE (A-04 ownership decision): the registry
listener sits on the workspace root element, respects the typing guard (never
fires from form fields or text editing), and `preventDefault`s only when the
workspace has focus. Headless `<CanvasStudio>` embeds never install it. Tool
keys, the Escape cancel stack, and zoom keys all resolve through
`createCoreShortcutBindings()` — the same source the in-app shortcut-help
dialog and the generated [shortcut-reference.md](./shortcut-reference.md)
render.

## Tool completion behavior

Creation tools return to Select after committing one element (FR-012).
`continuousCreation` (on `CanvasStudioProps`, so both modes) restores
draw-many behavior and surfaces a footer badge in the shell.

## Responsive behavior (B-14)

- Desktop: Tab Panel docks as a grid column; width is drag-resizable and
  persisted per `storeId` (restore-default-layout lives in the header menu).
- ≤ 1024 px: the inspector auto-collapses.
- ≤ 768 px: panels float as overlays instead of docking.

## Related

- [adapters.md](./adapters.md) — persistence, assets, upload, templates, recovery.
- [migration.md](./migration.md) — behavior-change history and opt-outs by release.
- [export-capability-matrix.md](./export-capability-matrix.md) — per-format export fidelity.
