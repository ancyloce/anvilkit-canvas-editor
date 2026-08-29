import {
	type CanvasComponentDefinition,
	type CanvasGroupNode,
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
import { createSceneStore } from "../../stores/scene-store.js";
import { createCanvasYjsBinding } from "../binding.js";
import { encodeCanvasIR } from "../encode.js";

function fixture(): CanvasIR {
	const root = createGroup({
		id: "page-1-root",
		bounds: { width: 800, height: 600 },
		children: [
			createRect({
				id: "rect-a",
				bounds: { width: 80, height: 40 },
				fill: "#ff0000",
			}),
			createRect({
				id: "rect-b",
				bounds: { width: 90, height: 45 },
				fill: "#00ff00",
			}),
			createRichText({
				id: "rich-1",
				bounds: { width: 240, height: 80 },
				paragraphs: [{ spans: [{ text: "Collaborate" }] }],
			}),
		],
	});
	return createCanvasIR({
		id: "granular-doc",
		title: "Granular operations",
		pages: [createPage({ id: "page-1", root })],
		now: () => "2026-08-28T00:00:00.000Z",
	});
}

function rootOf(ir: CanvasIR, pageId = "page-1"): CanvasGroupNode {
	const page = ir.pages.find((candidate) => candidate.id === pageId);
	if (!page) throw new Error(`missing page ${pageId}`);
	return page.root;
}

function findNode(ir: CanvasIR, id: string): CanvasNode | undefined {
	const stack: CanvasNode[] = [];
	for (const page of ir.pages) stack.push(page.root);
	for (const definition of Object.values(ir.components ?? {})) {
		stack.push(definition.root);
	}
	while (stack.length > 0) {
		const node = stack.pop() as CanvasNode;
		if (node.id === id) return node;
		const children = (node as { children?: CanvasNode[] }).children;
		if (children) stack.push(...children);
	}
	return undefined;
}

function linkDocs(a: Y.Doc, b: Y.Doc): void {
	a.on("updateV2", (update, origin) => {
		if (origin !== "replicate") Y.applyUpdateV2(b, update, "replicate");
	});
	b.on("updateV2", (update, origin) => {
		if (origin !== "replicate") Y.applyUpdateV2(a, update, "replicate");
	});
}

function mergePartition(a: Y.Doc, b: Y.Doc): void {
	const forA = Y.encodeStateAsUpdateV2(b, Y.encodeStateVector(a));
	const forB = Y.encodeStateAsUpdateV2(a, Y.encodeStateVector(b));
	Y.applyUpdateV2(a, forA, "replicate");
	Y.applyUpdateV2(b, forB, "replicate");
}

describe("schema-v2 granular Canvas transactions", () => {
	it("replicates create, update, delete, reorder, reparent, group, ungroup, page, component, and text commits", () => {
		const docA = new Y.Doc();
		const docB = new Y.Doc();
		linkDocs(docA, docB);
		const storeA = createSceneStore({ initialIR: fixture() });
		const storeB = createSceneStore({ initialIR: createCanvasIR({ id: "b" }) });
		const bindingA = createCanvasYjsBinding({
			doc: docA,
			sceneStore: storeA,
			peer: { id: "alice" },
		});
		const bindingB = createCanvasYjsBinding({
			doc: docB,
			sceneStore: storeB,
			peer: { id: "bob" },
		});

		const commit = (mutate: (ir: CanvasIR) => void) => {
			const next = structuredClone(storeA.getState().ir);
			mutate(next);
			storeA.getState().setIR(next);
			expect(storeB.getState().ir).toEqual(next);
		};

		commit((ir) => {
			rootOf(ir).children.push(
				createRect({
					id: "rect-c",
					bounds: { width: 50, height: 25 },
					fill: "#0000ff",
				}),
			);
		});
		commit((ir) => {
			const rect = findNode(ir, "rect-a") as CanvasNode & { fill?: string };
			rect.fill = "#ff00ff";
		});
		commit((ir) => {
			rootOf(ir).children.reverse();
		});
		commit((ir) => {
			const root = rootOf(ir);
			const index = root.children.findIndex((node) => node.id === "rect-b");
			const [rectB] = root.children.splice(index, 1);
			root.children.push(
				createGroup({
					id: "parent-1",
					bounds: { width: 120, height: 80 },
					children: [rectB as CanvasNode],
				}),
			);
		});
		commit((ir) => {
			const root = rootOf(ir);
			const grouped = root.children.filter((node) =>
				["rect-a", "rect-c"].includes(node.id),
			);
			root.children = root.children.filter(
				(node) => !["rect-a", "rect-c"].includes(node.id),
			);
			root.children.push(
				createGroup({
					id: "group-1",
					bounds: { width: 160, height: 100 },
					children: grouped,
				}),
			);
		});
		commit((ir) => {
			const root = rootOf(ir);
			const index = root.children.findIndex((node) => node.id === "group-1");
			const group = root.children[index] as CanvasGroupNode;
			root.children.splice(index, 1, ...group.children);
		});
		commit((ir) => {
			ir.pages.unshift(
				createPage({
					id: "page-2",
					name: "Second page",
					root: createGroup({
						id: "page-2-root",
						bounds: { width: 640, height: 480 },
					}),
				}),
			);
		});
		commit((ir) => {
			const definition: CanvasComponentDefinition = {
				id: "component-1",
				name: "Badge",
				revision: 1,
				root: createGroup({
					id: "component-1-root",
					bounds: { width: 100, height: 40 },
					children: [
						createRect({
							id: "component-1-rect",
							bounds: { width: 100, height: 40 },
							fill: "#222222",
						}),
					],
				}),
				properties: [],
			};
			ir.components = { "component-1": definition };
			ir.compatibility = {
				schemaVersion: "3",
				minReaderSchemaVersion: "3",
				requiredCapabilities: ["components.local.v1"],
			};
		});
		commit((ir) => {
			const rich = findNode(ir, "rich-1");
			if (!rich || rich.type !== "rich-text")
				throw new Error("missing rich text");
			rich.paragraphs = [
				{ spans: [{ text: "Granular ", fontWeight: "400" }] },
				{ spans: [{ text: "text update", fontWeight: "700" }] },
			];
		});
		commit((ir) => {
			const root = rootOf(ir);
			root.children = root.children.filter((node) => node.id !== "rect-c");
		});

		expect(encodeCanvasIR(bindingA.current() as CanvasIR)).toBe(
			encodeCanvasIR(bindingB.current() as CanvasIR),
		);
		bindingA.destroy();
		bindingB.destroy();
	});

	it("preserves disjoint nodes and different fields of the same node across a partition", () => {
		const docA = new Y.Doc();
		const docB = new Y.Doc();
		const storeA = createSceneStore({ initialIR: fixture() });
		const storeB = createSceneStore({ initialIR: createCanvasIR({ id: "b" }) });
		const bindingA = createCanvasYjsBinding({
			doc: docA,
			sceneStore: storeA,
			peer: { id: "alice" },
		});
		Y.applyUpdateV2(docB, Y.encodeStateAsUpdateV2(docA), "replicate");
		const bindingB = createCanvasYjsBinding({
			doc: docB,
			sceneStore: storeB,
			peer: { id: "bob" },
		});

		const nextA = structuredClone(storeA.getState().ir);
		const rectA = findNode(nextA, "rect-a") as CanvasNode & {
			fill?: string;
			opacity?: number;
		};
		rectA.fill = "#111111";
		storeA.getState().setIR(nextA);

		const nextB = structuredClone(storeB.getState().ir);
		const sameRect = findNode(nextB, "rect-a") as CanvasNode & {
			opacity?: number;
		};
		sameRect.opacity = 0.5;
		const otherRect = findNode(nextB, "rect-b") as CanvasNode & {
			name?: string;
		};
		otherRect.name = "Edited by Bob";
		storeB.getState().setIR(nextB);

		mergePartition(docA, docB);

		const a = bindingA.current() as CanvasIR;
		const b = bindingB.current() as CanvasIR;
		expect(encodeCanvasIR(a)).toBe(encodeCanvasIR(b));
		expect(findNode(a, "rect-a")).toMatchObject({
			fill: "#111111",
			opacity: 0.5,
		});
		expect(findNode(a, "rect-b")).toMatchObject({ name: "Edited by Bob" });
		bindingA.destroy();
		bindingB.destroy();
	});

	it("converges delete/update races to a valid document", () => {
		const docA = new Y.Doc();
		const docB = new Y.Doc();
		const storeA = createSceneStore({ initialIR: fixture() });
		const storeB = createSceneStore({ initialIR: createCanvasIR({ id: "b" }) });
		const bindingA = createCanvasYjsBinding({
			doc: docA,
			sceneStore: storeA,
			peer: { id: "alice" },
		});
		Y.applyUpdateV2(docB, Y.encodeStateAsUpdateV2(docA), "replicate");
		const bindingB = createCanvasYjsBinding({
			doc: docB,
			sceneStore: storeB,
			peer: { id: "bob" },
		});

		const deleted = structuredClone(storeA.getState().ir);
		rootOf(deleted).children = rootOf(deleted).children.filter(
			(node) => node.id !== "rect-a",
		);
		storeA.getState().setIR(deleted);
		const updated = structuredClone(storeB.getState().ir);
		const rect = findNode(updated, "rect-a") as CanvasNode & { fill?: string };
		rect.fill = "#abcdef";
		storeB.getState().setIR(updated);

		mergePartition(docA, docB);

		const a = bindingA.current() as CanvasIR;
		const b = bindingB.current() as CanvasIR;
		expect(encodeCanvasIR(a)).toBe(encodeCanvasIR(b));
		expect(a.pages).toHaveLength(1);
		bindingA.destroy();
		bindingB.destroy();
	});
});
