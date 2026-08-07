import {
	type CanvasAssetRef,
	type CanvasCommand,
	type CanvasFrameNode,
	type CanvasFrameShape,
	type CanvasImageNode,
	type CanvasIR,
	type CanvasNode,
	type CanvasNodeUpdateCommand,
	isFrameNode,
	parentOf,
	resolveFrameClipShape,
} from "@anvilkit/canvas-core";
import type { CanvasStudioContextValue } from "../context/canvas-studio-context.js";
import {
	coverGeometry,
	isImageWell,
	wellImage,
} from "./frame-image-actions.js";

/**
 * cp4-004 — the frame CLIP-SHAPE operations behind the inspector's Shape
 * control and the double-click reposition gesture (ADR 0008 decision 1, which
 * re-scopes this task from "build the masking interaction" to "extend the
 * shipped image-well interaction to non-rectangular shapes").
 *
 * Nothing here re-derives clipping rules: every read of what a frame clips to
 * goes through core's ONE resolver, {@link resolveFrameClipShape}, the same
 * function the Konva `clipFunc` (cp4-003) and the SVG `<clipPath>` (cp4-002)
 * read. In particular `clip` stays the only on/off switch — applying a shape
 * turns clipping ON explicitly rather than letting `shape` become a second,
 * silent trigger.
 *
 * Every exported operation produces a command LIST that its caller hands to
 * `commitBatch` (or `commit`, for a single command), so an apply, a release and
 * a reposition are each exactly one undo step.
 */

/** The five `CanvasFrameShape` kinds, as an ordered list for the picker. */
export const FRAME_SHAPE_KINDS = [
	"rect",
	"ellipse",
	"polygon",
	"star",
	"path",
] as const satisfies readonly CanvasFrameShape["kind"][];

/**
 * What the inspector's Shape picker can be set to: one of the five shape kinds,
 * or `"none"` — which RELEASES the shape, restoring the implicit rectangle every
 * frame clipped to before ADR 0008. `"none"` and `"rect"` are deliberately
 * different: the resolver distinguishes an absent `shape` (`source: "default"`)
 * from an explicit `{ kind: "rect" }` (`source: "declared"`), and the picker
 * must not collapse that distinction.
 */
export type FrameShapeChoice = "none" | CanvasFrameShape["kind"];

/** Every picker option, release first. */
export const FRAME_SHAPE_CHOICES = [
	"none",
	...FRAME_SHAPE_KINDS,
] as const satisfies readonly FrameShapeChoice[];

/** A fresh polygon: a hexagon reads as "a shape" rather than as a broken square. */
export const DEFAULT_POLYGON_SIDES = 6;
/** A fresh star: the five-pointed star both benchmarked products default to. */
export const DEFAULT_STAR_POINTS = 5;
/** A fresh star's waist, as a fraction of its outer radius. */
export const DEFAULT_STAR_INNER_RADIUS_RATIO = 0.5;

function isFrameShapeKind(
	value: string | undefined,
): value is CanvasFrameShape["kind"] {
	return (
		value !== undefined &&
		(FRAME_SHAPE_KINDS as readonly string[]).includes(value)
	);
}

/**
 * A frame's picker value.
 *
 * `"none"` comes from the RESOLVER (`source: "default"`), never from a raw
 * `shape === undefined` test, so the picker and the renderers agree about what
 * "no shape" means. The kind then comes from the declared field rather than from
 * `resolved.shape`, because a degraded shape resolves to the rectangle while
 * still being stored — reporting "Rectangle" there would misdescribe the
 * document. A kind this build does not implement yields `undefined`, and the
 * picker renders no selection alongside the degraded note.
 */
export function frameShapeChoice(
	frame: CanvasFrameNode,
): FrameShapeChoice | undefined {
	if (resolveFrameClipShape(frame).source === "default") return "none";
	const kind = frame.shape?.kind;
	return isFrameShapeKind(kind) ? kind : undefined;
}

/**
 * The shape a picker choice means for THIS frame.
 *
 * Parameters already declared for the same kind are carried over, so
 * round-tripping a picker through another kind and back does not silently reset
 * a hand-tuned star. A fresh `path` is seeded with a diamond built from the
 * frame's own box, because `CanvasFrameShape`'s path data is in the frame's
 * LOCAL units (both render paths draw it inside the frame's group) — a
 * size-independent default would land off-box on every frame but one.
 */
export function frameShapeForChoice(
	choice: FrameShapeChoice,
	frame: CanvasFrameNode,
): CanvasFrameShape | undefined {
	const declared = frame.shape;
	switch (choice) {
		case "none":
			return undefined;
		case "rect":
			return { kind: "rect" };
		case "ellipse":
			return { kind: "ellipse" };
		case "polygon":
			return {
				kind: "polygon",
				sides:
					declared?.kind === "polygon" ? declared.sides : DEFAULT_POLYGON_SIDES,
			};
		case "star":
			return declared?.kind === "star"
				? {
						kind: "star",
						points: declared.points,
						innerRadiusRatio: declared.innerRadiusRatio,
					}
				: {
						kind: "star",
						points: DEFAULT_STAR_POINTS,
						innerRadiusRatio: DEFAULT_STAR_INNER_RADIUS_RATIO,
					};
		case "path":
			return {
				kind: "path",
				d: declared?.kind === "path" ? declared.d : diamondPathFor(frame),
			};
	}
}

/** A diamond inscribed in the frame's box, in the frame's local units. */
function diamondPathFor(frame: CanvasFrameNode): string {
	const w = frame.bounds.width;
	const h = frame.bounds.height;
	const cx = w / 2;
	const cy = h / 2;
	return `M ${cx} 0 L ${w} ${cy} L ${cx} ${h} L 0 ${cy} Z`;
}

/**
 * Would the well's image still be SEEN inside the frame after a clip change?
 *
 * The acceptance criterion "releasing a shape leaves a sane, visible image" is
 * only falsifiable against a definition, so here it is: the image's box must
 * have positive area, finite placement, and overlap the frame's box. Rotation
 * and scale in `transform` are ignored — the same simplification
 * {@link coverGeometry} makes when it places a cover-filled image, so the two
 * cannot disagree about what "fills the frame" means.
 */
export function wellImageIsVisible(
	frame: CanvasFrameNode,
	image: CanvasImageNode,
): boolean {
	const { width, height } = image.bounds;
	const { x, y } = image.transform;
	if (!(width > 0) || !(height > 0)) return false;
	if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
	return (
		x < frame.bounds.width &&
		y < frame.bounds.height &&
		x + width > 0 &&
		y + height > 0
	);
}

export interface FrameShapeChange {
	frame: CanvasFrameNode;
	/** The shape to apply; `undefined` releases the frame's declared shape. */
	shape: CanvasFrameShape | undefined;
	/** The asset behind the well's image, for the cover-geometry restore. */
	asset?: CanvasAssetRef | undefined;
}

/**
 * The commands that put `shape` on `frame` (or take it off), as ONE logical
 * action. Callers hand the result to `commitBatch`, so the whole thing is a
 * single undo step and `applyCommand`'s per-command inverses compose into one
 * `batch` inverse.
 *
 * Applying a shape:
 *
 * - **turns `clip` on** when it is off. `clip` is the only on/off switch, so a
 *   shape on an unclipped frame is inert (ADR 0008 decision 2) — a picker that
 *   left it that way would look broken. This is the ONLY place the two fields
 *   are written together.
 * - **turns an EMPTY, placeholder-less frame into an image well.** Shaping an
 *   empty frame is unambiguously "make this a photo shape", and without a
 *   placeholder the drag-onto gesture would not resolve the frame as a target
 *   at all (`resolveDropTarget` requires a well), so the photo would land beside
 *   the shape instead of inside it. A frame that already has children keeps its
 *   container semantics untouched — promoting one to a well would change what
 *   the next drop does to its existing content.
 *
 * Releasing a shape:
 *
 * - **never restores `clip: false`.** The frame keeps clipping to its rectangle.
 *   Turning clipping off here would let a cover-filled image — routinely larger
 *   than the frame, by construction — spill across the page the instant a mask
 *   is released, which is precisely the "collapses the image" failure this
 *   task's acceptance criterion rules out. `clip` has its own switch.
 *
 * Either way, a well image that would not be VISIBLE afterwards is restored to
 * cover geometry in the same batch. A visible image is never touched, so
 * changing the shape kind cannot discard a deliberate reposition, and
 * repositioning cannot alter the shape.
 */
export function buildFrameShapeCommands(
	change: FrameShapeChange,
): CanvasCommand[] {
	const { frame, shape, asset } = change;
	const applying = shape !== undefined;
	const framePatch: Partial<CanvasFrameNode> = { shape };
	if (applying) {
		if (frame.clip !== true) framePatch.clip = true;
		if (frame.placeholder === undefined && frame.children.length === 0) {
			framePatch.placeholder = { kind: "image" };
		}
	}
	const commands: CanvasCommand[] = [
		{
			type: "node.update",
			nodeId: frame.id,
			kind: "frame",
			patch: framePatch,
		} satisfies CanvasNodeUpdateCommand<"frame">,
	];
	const restore = buildWellImageRestoreCommand(frame, asset);
	if (restore) commands.push(restore);
	return commands;
}

/**
 * Put the well's image back where it can be seen, or nothing when it already
 * can. Split out because both the apply and the release path need it and
 * neither may re-derive "visible".
 */
function buildWellImageRestoreCommand(
	frame: CanvasFrameNode,
	asset: CanvasAssetRef | undefined,
): CanvasNodeUpdateCommand<"image"> | undefined {
	const image = isImageWell(frame) ? wellImage(frame) : undefined;
	if (!image || wellImageIsVisible(frame, image)) return undefined;
	const geo = coverGeometry(frame, asset);
	return {
		type: "node.update",
		nodeId: image.id,
		kind: "image",
		patch: {
			bounds: geo.bounds,
			transform: { ...image.transform, ...geo.transform },
		},
	};
}

/** The asset behind a frame's well image, if the well is filled. */
function wellAsset(
	ir: CanvasIR,
	frame: CanvasFrameNode,
): CanvasAssetRef | undefined {
	const image = isImageWell(frame) ? wellImage(frame) : undefined;
	return image ? ir.assets[image.assetId] : undefined;
}

/**
 * Apply (or release) a picker choice across a whole frame selection as ONE undo
 * entry — a `commitBatch` when more than one command falls out, a plain
 * `commit` otherwise. Same commit shape as `replaceImage`, for the same reason:
 * one user action must be one history entry.
 *
 * Returns false when nothing would change, so a no-op pick never mints an undo
 * entry the user has to press undo through.
 */
export function commitFrameShapeChoice(
	ctx: CanvasStudioContextValue,
	frames: readonly CanvasFrameNode[],
	choice: FrameShapeChoice,
): boolean {
	const ir = ctx.getIR();
	const commands = frames.flatMap((frame) =>
		frameShapeChoice(frame) === choice
			? []
			: buildFrameShapeCommands({
					frame,
					shape: frameShapeForChoice(choice, frame),
					asset: wellAsset(ir, frame),
				}),
	);
	if (commands.length === 0) return false;
	if (commands.length === 1 && commands[0]) ctx.commit(commands[0]);
	else ctx.commitBatch(commands, "Frame shape");
	return true;
}

/**
 * The image a "reposition inside the shape" gesture should open the crop editor
 * on, given the node the user double-clicked — or `undefined` when the gesture
 * does not apply and the caller's normal handling (isolation entry, plain
 * selection) stands.
 *
 * Both entry points resolve here so the stage gesture and the inspector button
 * can never disagree about which image is repositionable:
 *
 * - a CLIPPING image-well frame → the image filling it;
 * - an image whose direct parent is one → itself.
 *
 * "Clipping" is `resolveFrameClipShape(frame).clipped`, not a raw `clip` read,
 * so the gesture is enabled by exactly the condition that makes the mask
 * visible.
 */
export function frameRepositionTarget(
	ir: CanvasIR,
	node: CanvasNode,
): CanvasImageNode | undefined {
	if (node.type === "image") {
		const parent = parentOf(ir, node.id)?.parent;
		return parent && isRepositionWell(parent) ? node : undefined;
	}
	if (!isFrameNode(node) || !isRepositionWell(node)) return undefined;
	return wellImage(node);
}

function isRepositionWell(node: CanvasNode): node is CanvasFrameNode {
	return (
		isFrameNode(node) &&
		isImageWell(node) &&
		resolveFrameClipShape(node).clipped
	);
}
