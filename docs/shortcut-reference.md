# Keyboard shortcut reference

<!-- GENERATED FILE — do not edit by hand.
     Source: src/workspace/shortcuts/shortcut-registry.ts
     Regenerate: pnpm build && pnpm docs:shortcuts -->

Default bindings installed by `CanvasWorkspace` (disable wholesale with
`shortcuts={false}`, extend or replace per action id via
`shortcuts={{ extraBindings }}`). Headless `<CanvasStudio>` embeds install
none of these. Labels below are the exact strings
`formatShortcut()` produces for each platform; the in-app shortcut-help
dialog renders the same registry.

## Editing

| Action | Windows / Linux | macOS | Action id |
| --- | --- | --- | --- |
| Undo | `Ctrl+Z` | `⌘Z` | `undo` |
| Redo | `Ctrl+Shift+Z` or `Ctrl+Y` | `⇧⌘Z` or `⌘Y` | `redo` |
| Copy | `Ctrl+C` | `⌘C` | `copy` |
| Cut | `Ctrl+X` | `⌘X` | `cut` |
| Paste | `Ctrl+V` | `⌘V` | `paste` |
| Duplicate | `Ctrl+D` | `⌘D` | `duplicate` |
| Delete selection | `Delete` or `Backspace` | `⌫` | `delete` |
| Group selection | `Ctrl+G` | `⌘G` | `group` |
| Ungroup selection | `Ctrl+Shift+G` | `⇧⌘G` | `ungroup` |
| Cancel | `Escape` | `⎋` | `cancel` |
| Lock / unlock selection | `Ctrl+Shift+L` | `⇧⌘L` | `lock` |

## View and navigation

| Action | Windows / Linux | macOS | Action id |
| --- | --- | --- | --- |
| Zoom in | `Ctrl+=` or `Ctrl+Shift++` | `⌘=` or `⇧⌘+` | `zoom-in` |
| Zoom out | `Ctrl+-` | `⌘-` | `zoom-out` |
| Zoom to fit | `Shift+1` | `⇧1` | `zoom-fit` |
| Zoom to selection | `Shift+2` | `⇧2` | `zoom-selection` |
| Actual size | `Shift+0` | `⇧0` | `zoom-actual` |

## Tools

| Action | Windows / Linux | macOS | Action id |
| --- | --- | --- | --- |
| Select | `V` | `V` | `tool-select` |
| Hand | `H` | `H` | `tool-hand` |
| Frame | `F` | `F` | `tool-frame` |
| Rectangle | `R` | `R` | `tool-rect` |
| Ellipse | `O` | `O` | `tool-ellipse` |
| Line | `L` | `L` | `tool-line` |
| Pen | `P` | `P` | `tool-path` |
| Text | `T` | `T` | `tool-text` |
| Image | `I` | `I` | `tool-image` |

Generated from 25 registry bindings across 3 categories.
