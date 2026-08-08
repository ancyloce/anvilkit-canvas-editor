import {
	createCanvasIR,
	createEllipse,
	createGroup,
	createImage,
	createPage,
	createPath,
	createRect,
	createSvg,
	validateCanvasIRInvariants,
} from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import { checkElementEntry } from "../element-audit.js";
import type {
	CanvasElementBuildContext,
	CanvasElementEntry,
	CanvasElementNode,
} from "../element-entry.js";

const SQUARE = "M0 0H24V24H0Z";

function entry(
	id: string,
	build: (context: CanvasElementBuildContext) => CanvasElementNode,
	overrides: Partial<CanvasElementEntry> = {},
): CanvasElementEntry {
	return {
		id,
		name: id,
		category: "icon",
		tags: [],
		preview: { kind: "path", d: SQUARE },
		defaultSize: { width: 24, height: 24 },
		license: "MIT",
		recolor: "fill",
		build: (context: CanvasElementBuildContext = {}) => build(context),
		...overrides,
	};
}

/** A well-formed single-path icon: the shape `cp3-002` should aim for. */
function singlePath(context: CanvasElementBuildContext): CanvasElementNode {
	return createPath({
		...(context.newId ? { id: context.newId() } : {}),
		d: SQUARE,
		bounds: context.size ?? { width: 24, height: 24 },
		transform: context.at ?? { x: 0, y: 0 },
		fill: context.fill ?? "#000000",
	});
}

describe("checkElementEntry (cp3-001)", () => {
	it("passes a well-formed single-path icon", () => {
		expect(checkElementEntry(entry("ok", singlePath))).toEqual([]);
	});

	/**
	 * THE ACCEPTANCE CRITERION, run rather than asserted: the built node is
	 * inserted into a real document and put through
	 * `validateCanvasIRInvariants` (and `CanvasNodeSchema`) exactly as a
	 * persisted document would be at a trust boundary.
	 */
	it("build() output survives insertion into a real document", () => {
		const node = entry("ok", singlePath).build();
		const ir = createCanvasIR({
			pages: [createPage({ root: createGroup({ children: [node] }) })],
		});
		expect(validateCanvasIRInvariants(ir)).toEqual([]);
	});

	it("passes a multi-part group whose parts all take the fill", () => {
		const combo = entry(
			"combo",
			(context) =>
				createGroup({
					...(context.newId ? { id: context.newId() } : {}),
					bounds: context.size ?? { width: 24, height: 24 },
					transform: context.at ?? { x: 0, y: 0 },
					children: [
						createRect({
							bounds: { width: 24, height: 12 },
							fill: context.fill ?? "#000000",
						}),
						createEllipse({
							bounds: { width: 24, height: 12 },
							fill: context.fill ?? "#000000",
						}),
					],
				}),
			{ recolor: "fill" },
		);
		expect(checkElementEntry(combo)).toEqual([]);
	});

	it("flags a blank license", () => {
		const issues = checkElementEntry(
			entry("blank", singlePath, { license: "   " }),
		);
		expect(issues.map((i) => i.code)).toContain("missing-license");
	});

	/**
	 * THE KEY DECISION, caught at runtime. An `svg` node is the tempting
	 * shortcut for an icon set and it is exactly wrong: it holds only an
	 * `assetId`, so it is unrecolourable AND it dangles.
	 */
	it("flags an svg node — the asset-reference shortcut cp3-005 forbids", () => {
		const asSvg = entry(
			"as-svg",
			(context) =>
				// `CanvasElementNode` stops a bare `svg` return at compile time; a
				// `group`'s `children` is `CanvasNode[]`, which types cannot narrow
				// recursively. That gap is exactly what the runtime walk closes.
				createGroup({
					bounds: { width: 24, height: 24 },
					children: [
						createSvg({
							assetId: "asset-that-does-not-exist",
							bounds: context.size ?? { width: 24, height: 24 },
						}),
					],
				}),
			{ recolor: "none" },
		);
		const codes = checkElementEntry(asSvg).map((i) => i.code);
		expect(codes).toContain("unbuildable-node-kind");
		expect(codes).toContain("ir-invariant");
	});

	it("flags an image node nested inside an otherwise legal group", () => {
		const nested = entry(
			"nested-image",
			() =>
				createGroup({
					bounds: { width: 24, height: 24 },
					children: [
						createRect({ bounds: { width: 24, height: 24 }, fill: "#000000" }),
						createImage({
							assetId: "missing",
							bounds: { width: 24, height: 24 },
						}),
					],
				}),
			{ recolor: "multi" },
		);
		const codes = checkElementEntry(nested).map((i) => i.code);
		expect(codes).toContain("unbuildable-node-kind");
	});

	it("flags a build() that reuses node ids across calls", () => {
		const frozen = entry("frozen", (context) =>
			createPath({
				id: "always-the-same",
				d: SQUARE,
				bounds: context.size ?? { width: 24, height: 24 },
				fill: context.fill ?? "#000000",
			}),
		);
		expect(checkElementEntry(frozen).map((i) => i.code)).toContain(
			"unstable-node-id",
		);
	});

	it("flags a schema-invalid node", () => {
		const empty = entry("empty-d", (context) =>
			createPath({
				d: "",
				bounds: context.size ?? { width: 24, height: 24 },
				fill: context.fill ?? "#000000",
			}),
		);
		expect(checkElementEntry(empty).map((i) => i.code)).toContain(
			"schema-invalid",
		);
	});

	// `cp3-005`: "Do not silently half-recolour — that reads as a bug."
	it("flags an entry that declares fill but only half-recolours", () => {
		const half = entry(
			"half",
			(context) =>
				createGroup({
					bounds: { width: 24, height: 24 },
					children: [
						createRect({
							bounds: { width: 24, height: 12 },
							fill: context.fill ?? "#000000",
						}),
						// Baked-in fill: the inspector will never move this one.
						createRect({ bounds: { width: 24, height: 12 }, fill: "#ff0000" }),
					],
				}),
			{ recolor: "fill" },
		);
		const issues = checkElementEntry(half);
		expect(issues.map((i) => i.code)).toContain("recolor-mismatch");
		expect(issues[0]?.message).toMatch(/1 of 2/);
	});

	it("accepts the same half-recolouring entry once it declares multi", () => {
		const declared = entry(
			"declared",
			(context) =>
				createGroup({
					bounds: { width: 24, height: 24 },
					children: [
						createRect({
							bounds: { width: 24, height: 12 },
							fill: context.fill ?? "#000000",
						}),
						createRect({ bounds: { width: 24, height: 12 }, fill: "#ff0000" }),
					],
				}),
			{ recolor: "multi" },
		);
		expect(checkElementEntry(declared)).toEqual([]);
	});

	it("flags an entry that declares fill but ignores the fill context", () => {
		const deaf = entry(
			"deaf",
			() =>
				createPath({
					d: SQUARE,
					bounds: { width: 24, height: 24 },
					fill: "#000000",
				}),
			{ recolor: "fill" },
		);
		expect(checkElementEntry(deaf).map((i) => i.code)).toContain(
			"recolor-mismatch",
		);
	});

	it("flags an entry that declares none but honours the fill context", () => {
		expect(
			checkElementEntry(entry("liar", singlePath, { recolor: "none" })).map(
				(i) => i.code,
			),
		).toContain("recolor-mismatch");
	});

	it("accepts a stroke-drawn entry that declares stroke", () => {
		const outline = entry(
			"outline",
			(context) =>
				createPath({
					d: SQUARE,
					bounds: context.size ?? { width: 24, height: 24 },
					stroke: context.stroke ?? "#000000",
					strokeWidth: 2,
				}),
			{ recolor: "stroke" },
		);
		expect(checkElementEntry(outline)).toEqual([]);
	});

	it("accepts a fixed-colour entry that declares none", () => {
		const fixed = entry(
			"fixed",
			() =>
				createPath({
					d: SQUARE,
					bounds: { width: 24, height: 24 },
					fill: "#ff0000",
				}),
			{ recolor: "none" },
		);
		expect(checkElementEntry(fixed)).toEqual([]);
	});
});
