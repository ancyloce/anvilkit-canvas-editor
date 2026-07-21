import type Konva from "konva";

/**
 * Look up the live Konva node for a `CanvasNode.id` (`CanvasNodeRenderer`'s
 * `commonProps` sets both `id` and `name` to it). Uses a predicate selector
 * rather than Konva's string-selector syntax (`findOne('.'+id)`): Konva's
 * matcher strips every space and splits on commas before comparing
 * (`Node.prototype._isMatch`), so a `CanvasNode.id` containing either
 * character — ids are untrusted, looseObject/hostile-peer by design —
 * silently fails to resolve, or resolves against the wrong node (E-13).
 */
export function findNodeById(
	container: Pick<Konva.Container, "findOne">,
	id: string,
): Konva.Node | undefined {
	return container.findOne((node: Konva.Node) => node.id() === id);
}
