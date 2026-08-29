import {
	type CanvasIR,
	type CanvasNode,
	createCanvasIR,
	createGroup,
	createPage,
	createRect,
	createRichText,
} from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
	CANVAS_COLLAB_SCHEMA_VERSION,
	CanvasCrdtProjectionError,
	getCanvasCrdtRoot,
	readCanvasIRFromCrdt,
	writeCanvasIRToCrdt,
} from "../crdt-document.js";
import { encodeCanvasIR } from "../encode.js";

function fixture(): CanvasIR {
	const rect = createRect({
		id: "rect-1",
		bounds: { width: 80, height: 40 },
		fill: "#ff0000",
	});
	const richText = createRichText({
		id: "rich-1",
		bounds: { width: 240, height: 80 },
		paragraphs: [
			{
				align: "center",
				lineHeight: 1.4,
				spans: [
					{ text: "Hello ", fontWeight: "400" },
					{ text: "Canvas", fontWeight: "700", underline: true },
				],
			},
			{ spans: [{ text: "Second paragraph", italic: true }] },
		],
	});
	const root = createGroup({
		id: "page-root",
		bounds: { width: 800, height: 600 },
		children: [rect, richText],
	});
	const page = createPage({ id: "page-1", name: "Page one", root });
	const ir = createCanvasIR({
		id: "doc-1",
		title: "Collaborative document",
		pages: [page],
		now: () => "2026-08-28T00:00:00.000Z",
	});
	ir.assets = {
		"asset-1": { id: "asset-1", uri: "https://example.invalid/image.png" },
	};
	return ir;
}

function requireMap(value: unknown): Y.Map<unknown> {
	expect(value).toBeInstanceOf(Y.Map);
	return value as Y.Map<unknown>;
}

describe("CanvasIR to CRDT projection", () => {
	it("round-trips stable IDs, per-field node data, assets, and rich text", () => {
		const doc = new Y.Doc();
		const root = getCanvasCrdtRoot(doc);
		const ir = fixture();

		doc.transact(() => writeCanvasIRToCrdt(root, ir), "alice");

		expect(root.get("collaborationSchemaVersion")).toBe(
			CANVAS_COLLAB_SCHEMA_VERSION,
		);
		const pages = requireMap(root.get("pages"));
		const nodes = requireMap(root.get("nodes"));
		expect(pages.has("page-1")).toBe(true);
		expect(nodes.has("page-root")).toBe(true);
		expect(nodes.has("rect-1")).toBe(true);
		const rich = requireMap(nodes.get("rich-1"));
		expect(rich.get("richText")).toBeInstanceOf(Y.Text);
		expect(readCanvasIRFromCrdt(root)).toEqual(ir);
	});

	it("projects byte-identically after Yjs state transfer", () => {
		const source = new Y.Doc();
		const target = new Y.Doc();
		const sourceRoot = getCanvasCrdtRoot(source);
		writeCanvasIRToCrdt(sourceRoot, fixture());

		Y.applyUpdateV2(target, Y.encodeStateAsUpdateV2(source), "replicate");

		const sourceIR = readCanvasIRFromCrdt(sourceRoot);
		const targetIR = readCanvasIRFromCrdt(getCanvasCrdtRoot(target));
		expect(encodeCanvasIR(targetIR)).toBe(encodeCanvasIR(sourceIR));
	});

	it("retains node shared types while reconciling changed fields", () => {
		const doc = new Y.Doc();
		const root = getCanvasCrdtRoot(doc);
		const initial = fixture();
		writeCanvasIRToCrdt(root, initial);
		const nodes = requireMap(root.get("nodes"));
		const rectMap = nodes.get("rect-1");

		const changed = structuredClone(initial);
		const rect = changed.pages[0]?.root.children[0] as CanvasNode & {
			fill?: string;
		};
		rect.fill = "#0000ff";
		writeCanvasIRToCrdt(root, changed);

		expect(nodes.get("rect-1")).toBe(rectMap);
		expect(readCanvasIRFromCrdt(root)).toEqual(changed);
	});

	it("rejects duplicate stable node IDs before completing a projection", () => {
		const doc = new Y.Doc();
		const ir = fixture();
		ir.pages[0]?.root.children.push(
			createRect({ id: "rect-1", bounds: { width: 1, height: 1 } }),
		);

		expect(() => writeCanvasIRToCrdt(getCanvasCrdtRoot(doc), ir)).toThrowError(
			expect.objectContaining<Partial<CanvasCrdtProjectionError>>({
				code: "duplicate-node-id",
			}),
		);
	});

	it("validates the complete projected CanvasIR before returning it", () => {
		const doc = new Y.Doc();
		const root = getCanvasCrdtRoot(doc);
		writeCanvasIRToCrdt(root, fixture());
		const nodes = requireMap(root.get("nodes"));
		const rect = requireMap(nodes.get("rect-1"));
		rect.delete("field:transform");

		expect(() => readCanvasIRFromCrdt(root)).toThrowError(
			expect.objectContaining<Partial<CanvasCrdtProjectionError>>({
				code: "invalid-canvas-ir",
			}),
		);
	});
});
