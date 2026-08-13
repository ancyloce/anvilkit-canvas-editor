/**
 * @file The single Konva entry point for this package (K-13).
 *
 * WHY NOT `import Konva from "konva"`: that barrel pulls every shape AND every
 * filter Konva ships. react-konva itself deliberately imports only
 * `konva/lib/Core.js` (`ReactKonvaHostConfig.js:2`), so the barrel is pure
 * addition on top of what the renderer needs. Konva is an EXTERNAL dependency
 * of this package, so the cost does not show up in our own bundle budget — it
 * lands in every app that bundles us. Measured with esbuild + gzip -9:
 *
 *     barrel                                55,276 B gz
 *     Core + all shapes + Blur              50,038 B gz   (−5,238 B, −9.5%)
 *     Core + only the shapes we render      47,970 B gz   (−7,306 B, −13.2%)
 *
 * WHY THE MIDDLE ONE, not the smallest: react-konva resolves a component to a
 * class by NAME — `NodeClass = Konva[type]` — and when the class is missing it
 * logs an error and silently substitutes `Konva.Group`
 * (`ReactKonvaHostConfig.js:24-27`). This package exposes `kindRenderers` as
 * public extension API, so a host extension is free to render `<Circle>` or
 * `<Wedge>`. Registering only the shapes WE happen to use would turn any such
 * extension into an invisible empty Group with nothing but a console message —
 * a silent-degradation trap in exchange for the last 2 kB. So every shape
 * react-konva can name is registered here; only the unused FILTERS are dropped,
 * which nothing can reach by name from JSX.
 *
 * Anything importing Konva as a VALUE must import it from here. Type-only
 * imports (`import type Konva from "konva"`) are fine anywhere — they erase.
 *
 * REACHABILITY. Registration only happens if this module is in the graph, so
 * it has to be unavoidable on every path that can render a Konva shape. It is:
 * `CanvasNodeRenderer` and `CanvasTransformer` both import it, and the only two
 * importers of `CanvasStage` — `CanvasStudio` and `rasterize-page` — both pull
 * `CanvasNodeRenderer` as well. `CanvasStage` is not part of the public entry
 * (it is exported from `internal.ts` only), so the single way to reach
 * react-konva without this module is to import `CanvasStage` from the internal
 * entry and hand-write react-konva children — a deliberate advanced use, and
 * one that should import this module too.
 */
import KonvaCore from "konva/lib/Core.js";

// Every shape react-konva exports as a component, so `Konva[type]` always
// resolves. Keep this list in step with react-konva's exports.
import "konva/lib/shapes/Arc.js";
import "konva/lib/shapes/Arrow.js";
import "konva/lib/shapes/Circle.js";
import "konva/lib/shapes/Ellipse.js";
import "konva/lib/shapes/Image.js";
import "konva/lib/shapes/Label.js";
import "konva/lib/shapes/Line.js";
import "konva/lib/shapes/Path.js";
import "konva/lib/shapes/Rect.js";
import "konva/lib/shapes/RegularPolygon.js";
import "konva/lib/shapes/Ring.js";
import "konva/lib/shapes/Sprite.js";
import "konva/lib/shapes/Star.js";
import "konva/lib/shapes/Text.js";
import "konva/lib/shapes/TextPath.js";
import "konva/lib/shapes/Transformer.js";
import "konva/lib/shapes/Wedge.js";

/**
 * The only filter this package applies (`AdjustedKonvaImage`'s blur), re-exported
 * as a value rather than reached through `Konva.Filters`: that container is
 * assembled by the BARREL (`_FullInternals.js:58`), not by the filter modules,
 * so it does not exist on the Core object. Importing the module also registers
 * Konva's `blurRadius` attribute (`Blur.js`, last line), which the renderer sets.
 * The rest of Konva's filter set is left out.
 */
export { Blur as BlurFilter } from "konva/lib/filters/Blur.js";

/**
 * `konva/lib/Core.js` ships a Core-only TYPE namespace, so `Konva.Rect`,
 * `Konva.Path`, `Konva.Transformer` and friends are absent from it even though
 * the side-effect imports above have attached every one of them to the runtime
 * object — that is exactly what `_registerNode` does
 * (`Konva[NodeClass.prototype.getClassName()] = NodeClass`, `Global.js:63-65`),
 * and it is the same mechanism the barrel relies on.
 *
 * So the value is the registered Core object and the TYPE is the barrel's,
 * which describes it accurately. `import type` erases, so naming the barrel
 * here costs no bytes.
 */
export default KonvaCore as unknown as typeof import("konva").default;
