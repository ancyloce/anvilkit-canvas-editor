import {
	type CanvasGroupNode,
	type CanvasIR,
	type CanvasNode,
	type CanvasRichTextNode,
	createCanvasIR,
	createGroup,
	createPage,
	createRect,
	createRichText,
} from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
	getCanvasCrdtRoot,
	readCanvasIRFromCrdt,
	writeCanvasIRToCrdt,
} from "../crdt-document.js";
import { encodeCanvasIR } from "../encode.js";

const REPLICA_COUNT = 4;
const STRESS_OPERATIONS = 10_000;

function fixture(): CanvasIR {
	const leaves = Array.from({ length: 8 }, (_, index) =>
		createRect({
			id: `leaf-${index}`,
			bounds: { width: 40 + index, height: 30 + index },
			fill: `#${(0x110000 + index * 0x10101).toString(16).padStart(6, "0")}`,
		}),
	);
	return createCanvasIR({
		id: "stress-doc",
		title: "Seed",
		pages: [
			createPage({
				id: "page-1",
				root: createGroup({
					id: "page-1-root",
					bounds: { width: 1200, height: 800 },
					children: [
						createGroup({
							id: "group-left",
							bounds: { width: 400, height: 600 },
							children: leaves.slice(0, 4),
						}),
						createGroup({
							id: "group-right",
							bounds: { width: 400, height: 600 },
							children: leaves.slice(4),
						}),
						createRichText({
							id: "rich-1",
							bounds: { width: 320, height: 120 },
							paragraphs: [{ spans: [{ text: "abcd" }] }],
						}),
					],
				}),
			}),
			createPage({
				id: "page-2",
				root: createGroup({
					id: "page-2-root",
					bounds: { width: 640, height: 480 },
					children: [
						createRect({
							id: "page-2-leaf",
							bounds: { width: 100, height: 60 },
						}),
					],
				}),
			}),
		],
		now: () => "2026-08-28T00:00:00.000Z",
	});
}

function project(doc: Y.Doc): CanvasIR {
	return readCanvasIRFromCrdt(getCanvasCrdtRoot(doc));
}

function write(doc: Y.Doc, ir: CanvasIR, origin: unknown): void {
	doc.transact(() => {
		writeCanvasIRToCrdt(getCanvasCrdtRoot(doc), ir);
	}, origin);
}

function findNode(ir: CanvasIR, id: string): CanvasNode | undefined {
	const stack: CanvasNode[] = ir.pages.map((page) => page.root);
	for (const definition of Object.values(ir.components ?? {})) {
		stack.push(definition.root);
	}
	while (stack.length > 0) {
		const node = stack.pop() as CanvasNode;
		if (node.id === id) return node;
		stack.push(...((node as CanvasGroupNode).children ?? []));
	}
	return undefined;
}

function group(ir: CanvasIR, id: string): CanvasGroupNode {
	const node = findNode(ir, id);
	if (!node || node.type !== "group") throw new Error(`missing group ${id}`);
	return node;
}

function removeChild(
	groupNode: CanvasGroupNode,
	id: string,
): CanvasNode | undefined {
	const index = groupNode.children.findIndex((node) => node.id === id);
	if (index < 0) return undefined;
	return groupNode.children.splice(index, 1)[0];
}

function seededRandom(seed: number): (max: number) => number {
	let state = seed >>> 0;
	return (max) => {
		state ^= state << 13;
		state ^= state >>> 17;
		state ^= state << 5;
		return (state >>> 0) % max;
	};
}

function mutateStressDocument(
	ir: CanvasIR,
	operation: number,
	replica: number,
	random: (max: number) => number,
): void {
	ir.title = `operation-${operation}-replica-${replica}`;
	const leafId = `leaf-${random(8)}`;
	const leaf = findNode(ir, leafId) as
		| (CanvasNode & {
				fill?: string;
				opacity?: number;
				rotation?: number;
				name?: string;
		  })
		| undefined;
	switch (random(10)) {
		case 0:
			if (leaf)
				leaf.fill = `#${random(0xffffff).toString(16).padStart(6, "0")}`;
			break;
		case 1:
			if (leaf) leaf.opacity = random(101) / 100;
			break;
		case 2:
			if (leaf) leaf.rotation = random(360);
			break;
		case 3:
			if (leaf) leaf.name = `node-${operation}-${replica}`;
			break;
		case 4: {
			const target =
				random(2) === 0 ? group(ir, "group-left") : group(ir, "group-right");
			const left = group(ir, "group-left");
			const right = group(ir, "group-right");
			const moving = removeChild(left, leafId) ?? removeChild(right, leafId);
			if (moving) target.children.push(moving);
			break;
		}
		case 5: {
			const target =
				random(2) === 0 ? group(ir, "group-left") : group(ir, "group-right");
			if (target.children.length > 1) {
				target.children.push(target.children.shift() as CanvasNode);
			}
			break;
		}
		case 6: {
			const left = group(ir, "group-left");
			const right = group(ir, "group-right");
			const removed =
				removeChild(left, "leaf-7") ?? removeChild(right, "leaf-7");
			if (!removed) {
				right.children.push(
					createRect({
						id: "leaf-7",
						bounds: { width: 47, height: 37 },
						fill: "#777777",
					}),
				);
			}
			break;
		}
		case 7:
			ir.pages.reverse();
			break;
		case 8: {
			const rich = findNode(ir, "rich-1");
			if (rich?.type === "rich-text") {
				rich.paragraphs = [
					{
						spans: [
							{
								text: `text-${operation % 97}-${replica}`,
								fontWeight: random(2) === 0 ? "400" : "700",
							},
						],
					},
				];
			}
			break;
		}
		case 9:
			ir.name = `document-${random(1000)}`;
			break;
	}
}

function rawNode(doc: Y.Doc, id: string): Y.Map<unknown> {
	const nodes = getCanvasCrdtRoot(doc).get("nodes");
	if (!(nodes instanceof Y.Map)) throw new Error("missing nodes map");
	const node = nodes.get(id);
	if (!(node instanceof Y.Map)) throw new Error(`missing raw node ${id}`);
	return node;
}

function rawOrder(node: Y.Map<unknown>): Y.Array<string> {
	const order = node.get("children");
	if (!(order instanceof Y.Array)) throw new Error("missing child order");
	return order;
}

function removeRawId(order: Y.Array<string>, id: string): void {
	const values = order.toArray();
	for (let index = values.length - 1; index >= 0; index -= 1) {
		if (values[index] === id) order.delete(index, 1);
	}
}

function applyRawStressOperation(
	doc: Y.Doc,
	operation: number,
	replica: number,
	random: (max: number) => number,
): boolean {
	let structural = false;
	doc.transact(() => {
		const leafId = `leaf-${random(8)}`;
		const leaf = rawNode(doc, leafId);
		switch (random(10)) {
			case 0:
				leaf.set(
					"field:fill",
					JSON.stringify(`#${random(0xffffff).toString(16).padStart(6, "0")}`),
				);
				break;
			case 1:
				leaf.set("field:opacity", JSON.stringify(random(101) / 100));
				break;
			case 2:
				leaf.set("field:rotation", JSON.stringify(random(360)));
				break;
			case 3:
				leaf.set("field:name", JSON.stringify(`node-${operation}-${replica}`));
				break;
			case 4: {
				const targetId = random(2) === 0 ? "group-left" : "group-right";
				const leftOrder = rawOrder(rawNode(doc, "group-left"));
				const rightOrder = rawOrder(rawNode(doc, "group-right"));
				removeRawId(leftOrder, leafId);
				removeRawId(rightOrder, leafId);
				rawOrder(rawNode(doc, targetId)).push([leafId]);
				leaf.set("parent", targetId);
				structural = true;
				break;
			}
			case 5: {
				const order = rawOrder(
					rawNode(doc, random(2) === 0 ? "group-left" : "group-right"),
				);
				const values = order.toArray();
				if (values.length > 1) {
					order.delete(0, 1);
					order.push([values[0] as string]);
				}
				structural = true;
				break;
			}
			case 6: {
				const text = rawNode(doc, "rich-1").get("richText");
				if (!(text instanceof Y.Text)) throw new Error("missing rich text");
				if (text.length > 40) text.delete(random(text.length - 1), 1);
				const offset = random(Math.max(1, text.length));
				text.insert(offset, String.fromCharCode(97 + random(26)), {
					canvasSpan: JSON.stringify({
						fontWeight: random(2) === 0 ? "400" : "700",
					}),
				});
				break;
			}
			case 7: {
				const toggledLeaf = rawNode(doc, "leaf-7");
				const leftOrder = rawOrder(rawNode(doc, "group-left"));
				const rightOrder = rawOrder(rawNode(doc, "group-right"));
				const deleted = toggledLeaf.get("deleted") === true;
				if (deleted) {
					toggledLeaf.set("deleted", false);
					toggledLeaf.set("parent", "group-right");
					removeRawId(leftOrder, "leaf-7");
					removeRawId(rightOrder, "leaf-7");
					rightOrder.push(["leaf-7"]);
				} else {
					toggledLeaf.set("deleted", true);
					removeRawId(leftOrder, "leaf-7");
					removeRawId(rightOrder, "leaf-7");
				}
				structural = true;
				break;
			}
			case 8: {
				const pageOrder = getCanvasCrdtRoot(doc).get("pageOrder");
				if (!(pageOrder instanceof Y.Array))
					throw new Error("missing page order");
				const values = pageOrder.toArray();
				if (values.length > 1) {
					pageOrder.delete(0, values.length);
					pageOrder.push(values.reverse());
				}
				structural = true;
				break;
			}
			case 9:
				getCanvasCrdtRoot(doc).set(
					"field:title",
					JSON.stringify(`operation-${operation}-replica-${replica}`),
				);
				break;
		}
	}, `replica-${replica}`);
	return structural;
}

function mergeAll(docs: readonly Y.Doc[], origin: unknown): void {
	const updates = docs.map((doc) => Y.encodeStateAsUpdateV2(doc));
	for (let target = 0; target < docs.length; target += 1) {
		for (let source = 0; source < updates.length; source += 1) {
			if (source === target) continue;
			Y.applyUpdateV2(
				docs[target] as Y.Doc,
				updates[source] as Uint8Array,
				origin,
			);
		}
	}
}

function allNodeIds(ir: CanvasIR): string[] {
	const ids: string[] = [];
	const stack: CanvasNode[] = ir.pages.map((page) => page.root);
	while (stack.length > 0) {
		const node = stack.pop() as CanvasNode;
		ids.push(node.id);
		stack.push(...((node as CanvasGroupNode).children ?? []));
	}
	return ids;
}

describe("deterministic Canvas collaboration concurrency", () => {
	it("merges rich-text character insertions and marks from two replicas", () => {
		const docA = new Y.Doc();
		const docB = new Y.Doc();
		write(docA, fixture(), "seed");
		Y.applyUpdateV2(docB, Y.encodeStateAsUpdateV2(docA), "seed");

		const a = project(docA);
		const richA = findNode(a, "rich-1") as CanvasRichTextNode;
		richA.paragraphs = [
			{
				spans: [
					{ text: "a" },
					{ text: "X", fontWeight: "700" },
					{ text: "bcd" },
				],
			},
		];
		write(docA, a, "alice");
		const b = project(docB);
		const richB = findNode(b, "rich-1") as CanvasRichTextNode;
		richB.paragraphs = [
			{
				spans: [{ text: "abcd" }, { text: "Y", underline: true }],
			},
		];
		write(docB, b, "bob");

		mergeAll([docA, docB], "merge");
		const mergedA = project(docA);
		const mergedB = project(docB);
		expect(encodeCanvasIR(mergedA)).toBe(encodeCanvasIR(mergedB));
		const rich = findNode(mergedA, "rich-1") as CanvasRichTextNode;
		const spans = rich.paragraphs.flatMap((paragraph) => paragraph.spans);
		expect(spans.find((span) => span.text.includes("X"))).toMatchObject({
			fontWeight: "700",
		});
		expect(spans.find((span) => span.text.includes("Y"))).toMatchObject({
			underline: true,
		});
	});

	it("converges concurrent group/ungroup, reparent, reorder, and delete/update races", () => {
		const base = fixture();
		const root = base.pages.find((page) => page.id === "page-1")
			?.root as CanvasGroupNode;
		const left = group(base, "group-left");
		const leaf0 = removeChild(left, "leaf-0") as CanvasNode;
		const leaf1 = removeChild(left, "leaf-1") as CanvasNode;
		root.children.unshift(
			createGroup({
				id: "dynamic-group",
				bounds: { width: 200, height: 100 },
				children: [leaf0, leaf1],
			}),
		);
		const docA = new Y.Doc();
		const docB = new Y.Doc();
		write(docA, base, "seed");
		Y.applyUpdateV2(docB, Y.encodeStateAsUpdateV2(docA), "seed");

		const a = project(docA);
		const rootA = a.pages.find((page) => page.id === "page-1")
			?.root as CanvasGroupNode;
		const dynamicA = removeChild(rootA, "dynamic-group") as CanvasGroupNode;
		rootA.children.push(...dynamicA.children);
		a.pages.reverse();
		removeChild(group(a, "group-right"), "leaf-7");
		write(docA, a, "alice");

		const b = project(docB);
		const dynamicB = group(b, "dynamic-group");
		const moving = removeChild(group(b, "group-left"), "leaf-2") as CanvasNode;
		dynamicB.children.reverse();
		dynamicB.children.push(moving);
		const updated = findNode(b, "leaf-7") as CanvasNode & { fill?: string };
		updated.fill = "#abcdef";
		write(docB, b, "bob");

		mergeAll([docA, docB], "merge");
		const mergedA = project(docA);
		const mergedB = project(docB);
		expect(encodeCanvasIR(mergedA)).toBe(encodeCanvasIR(mergedB));
		const ids = allNodeIds(mergedA);
		expect(new Set(ids).size).toBe(ids.length);
		expect(mergedA.pages).toHaveLength(2);
	});

	it(`runs ${STRESS_OPERATIONS.toLocaleString()} seeded operations across ${REPLICA_COUNT} replicas`, () => {
		const seed = new Y.Doc();
		write(seed, fixture(), "seed");
		const initialUpdate = Y.encodeStateAsUpdateV2(seed);
		const docs = Array.from({ length: REPLICA_COUNT }, () => {
			const doc = new Y.Doc();
			Y.applyUpdateV2(doc, initialUpdate, "seed");
			return doc;
		});
		const outboxes = docs.map(() => [] as Uint8Array[]);
		for (const [index, doc] of docs.entries()) {
			doc.on("updateV2", (update, origin) => {
				if (origin !== "delivery" && origin !== "reconnect") {
					outboxes[index]?.push(update);
				}
			});
		}
		const random = seededRandom(0x5eedc0de);
		let invalidDocuments = 0;
		let duplicateDeliveries = 0;
		let reconnects = 0;
		let structuralOperations = 0;

		const validate = (doc: Y.Doc) => {
			try {
				project(doc);
			} catch {
				invalidDocuments += 1;
			}
		};

		for (let operation = 0; operation < STRESS_OPERATIONS; operation += 1) {
			const replica = random(REPLICA_COUNT);
			const replicaDoc = docs[replica] as Y.Doc;
			if ((operation + 1) % 1000 === 0) {
				const ir = project(replicaDoc);
				mutateStressDocument(ir, operation, replica, random);
				write(replicaDoc, ir, `replica-${replica}`);
				validate(replicaDoc);
			} else if (
				applyRawStressOperation(replicaDoc, operation, replica, random)
			) {
				structuralOperations += 1;
			}

			if (operation % 11 === 0) {
				const source = random(REPLICA_COUNT);
				const outbox = outboxes[source] as Uint8Array[];
				if (outbox.length > 0) {
					const update = outbox.splice(
						random(outbox.length),
						1,
					)[0] as Uint8Array;
					const target =
						(source + 1 + random(REPLICA_COUNT - 1)) % REPLICA_COUNT;
					Y.applyUpdateV2(docs[target] as Y.Doc, update, "delivery");
					if (operation % 33 === 0) {
						Y.applyUpdateV2(docs[target] as Y.Doc, update, "delivery");
						duplicateDeliveries += 1;
					}
				}
			}

			if ((operation + 1) % 1000 === 0) {
				mergeAll(docs, "reconnect");
				reconnects += 1;
				for (const doc of docs) validate(doc);
			}
		}

		mergeAll(docs, "reconnect");
		const projections = docs.map((doc) => encodeCanvasIR(project(doc)));
		expect(new Set(projections).size).toBe(1);
		expect(invalidDocuments).toBe(0);
		expect(duplicateDeliveries).toBeGreaterThan(0);
		expect(structuralOperations).toBeGreaterThan(0);
		expect(reconnects).toBe(10);
		const finalIds = allNodeIds(project(docs[0] as Y.Doc));
		expect(new Set(finalIds).size).toBe(finalIds.length);
	}, 60_000);
});
