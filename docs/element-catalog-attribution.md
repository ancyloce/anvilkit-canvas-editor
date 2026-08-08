# Element catalog — third-party notices

`@anvilkit/canvas-editor` ships a default element catalog of **425 entries** for
the Elements panel (`src/elements/default-element-catalog.ts`). 307 of them are
icons whose geometry is **copied from two upstream sets**; the other 118 —
shapes, lines, frames and stickers — are original to this package.

Both upstream sets are MIT-licensed, and MIT requires the copyright notice and
the permission notice to travel with the copy. This file is that notice. It
ships in the published tarball (`package.json` `files` lists `docs`), and the
same records are available at runtime as data:

```ts
import { DEFAULT_ELEMENT_ATTRIBUTIONS } from "@anvilkit/canvas-editor/elements/default-element-catalog";
```

Every catalog entry also carries its own `license` (an SPDX identifier) and
`upstreamUrl` (the specimen page for that exact icon), so provenance is
resolvable per entry and not only per set.

## Summary

| Portion | Entries | SPDX | Copyright | Source |
| --- | --- | --- | --- | --- |
| Icons, filled | 151 | `MIT` | Copyright (c) 2019-2024 The Bootstrap Authors | [twbs/icons](https://github.com/twbs/icons) |
| Icons, outline | 156 | `MIT` | Copyright (c) Tailwind Labs, Inc. | [tailwindlabs/heroicons](https://github.com/tailwindlabs/heroicons) |
| Shapes, lines, frames, stickers | 118 | `MIT` | Copyright (c) 2026 Ancyloce | This package (see `LICENSE`) |

Licences were transcribed on **2026-08-07** from the `LICENSE` file and the
`package.json` `license` field inside each set's own published npm tarball —
`bootstrap-icons@1.13.1` and `heroicons@2.2.0` — not from documentation or
recollection.

Neither set is a runtime dependency. The geometry is vendored as data so that
`@anvilkit/canvas-editor` does not take on a dependency in order to ship
artwork, and so that an inserted icon becomes editable, recolourable Canvas IR
rather than an opaque asset reference.

## Bootstrap Icons

Copyright (c) 2019-2024 The Bootstrap Authors

> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

Used for the 151 filled icons (`icon-*-solid`). Each entry's `upstreamUrl`
points at `https://icons.getbootstrap.com/icons/<name>/`.

## Heroicons

Copyright (c) Tailwind Labs, Inc.

> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

Used for the 156 outline icons (`icon-*-outline`), from the 24px outline set.
Each entry's `upstreamUrl` points at the exact source file on GitHub.

## Modifications made to the upstream geometry

Recorded because MIT permits modification but a reader is entitled to know the
copies are not byte-identical to upstream:

- **Bootstrap.** The `d` string is verbatim. Only icons that are a *single*
  `<path>` carrying no `fill-rule`/`clip-rule` were taken, because
  `CanvasPathNode` has no fill-rule field and both renderers fill non-zero — an
  `evenodd` icon would draw its holes solid. The surrounding `<svg>` element and
  its attributes are not copied; the viewBox (`0 0 16 16`) is recorded as data.
- **Heroicons.** For an icon whose upstream file holds more than one `<path>`,
  the `d` strings are joined with a single space into one path. Stroking has no
  winding rule, and every path in the set carries the same
  `stroke-linecap`/`stroke-linejoin`, so the join is rendering-identical. The
  stroke width (`1.5`) and viewBox (`0 0 24 24`) are recorded as data.

## Sets considered and not used

- **Lucide** — ISC. Not in this catalog's allowed set (`OFL-1.1`, `MIT`,
  `Apache-2.0`, `CC0-1.0`). It is the icon set already installed elsewhere in
  this workspace, so its absence here is deliberate; a unit test asserts no
  entry ships under `ISC`.
- **Feather**, **Tabler** — both verified MIT and both usable, but neither was
  needed once Bootstrap and Heroicons covered the filled and outline styles.
  Every additional set is another notice to maintain for no additional coverage.
