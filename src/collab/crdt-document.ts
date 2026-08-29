import type {
	CanvasDocumentBudgetPolicy,
	CanvasIR,
	CanvasNode,
	CanvasRuntime,
	RichTextParagraph,
	RichTextSpan,
} from "@anvilkit/canvas-core";
import * as Y from "yjs";
import { decodeCanvasIR } from "./encode.js";
import { DEFAULT_CANVAS_MAP_NAME } from "./keys.js";

/** Current persisted Canvas collaboration schema. */
export const CANVAS_COLLAB_SCHEMA_VERSION = 2;

const DOCUMENT_SUFFIX = ":document";
/** Shared-root key used by migration and compatibility guards. */
export const CANVAS_COLLAB_SCHEMA_VERSION_KEY = "collaborationSchemaVersion";
const FIELD_PREFIX = "field:";
const PAGE_ORDER_KEY = "pageOrder";
const PAGES_KEY = "pages";
const NODES_KEY = "nodes";
const ASSETS_KEY = "assets";
const COMPONENTS_KEY = "components";
const EXTERNAL_SNAPSHOTS_KEY = "externalComponentSnapshots";
const ROOT_ID_KEY = "rootId";
const TYPE_KEY = "type";
const PARENT_KEY = "parent";
const DELETED_KEY = "deleted";
const CHILDREN_KEY = "children";
const RICH_TEXT_KEY = "richText";
const SPAN_ATTRIBUTE = "canvasSpan";
const PARAGRAPH_ATTRIBUTE = "canvasParagraph";

/** Public shared-map shape returned for advanced provider integrations. */
export type CanvasCrdtSharedMap = Y.Map<unknown>;

type SharedMap = CanvasCrdtSharedMap;

export type CanvasCrdtProjectionErrorCode =
	| "incompatible-schema"
	| "invalid-shared-type"
	| "invalid-field"
	| "duplicate-node-id"
	| "missing-node"
	| "deleted-node-reference"
	| "parent-mismatch"
	| "cycle"
	| "orphan-node"
	| "invalid-canvas-ir";

/** Stable projection failure surfaced by the collaboration binding. */
export class CanvasCrdtProjectionError extends Error {
	readonly code: CanvasCrdtProjectionErrorCode;
	readonly path?: string;

	constructor(
		code: CanvasCrdtProjectionErrorCode,
		message: string,
		path?: string,
	) {
		super(message);
		this.name = "CanvasCrdtProjectionError";
		this.code = code;
		this.path = path;
	}
}

export interface ReadCanvasIRFromCrdtOptions {
	readonly runtime?: CanvasRuntime;
	readonly documentBudgetPolicy?: Partial<CanvasDocumentBudgetPolicy>;
}

/** Resolve the schema-v2 root without mutating it. */
export function getCanvasCrdtRoot(
	doc: Y.Doc,
	mapName = DEFAULT_CANVAS_MAP_NAME,
): CanvasCrdtSharedMap {
	return doc.getMap<unknown>(`${mapName}${DOCUMENT_SUFFIX}`);
}

/**
 * Reconcile one valid CanvasIR into granular Yjs structures.
 *
 * The caller owns the surrounding `doc.transact(...)` so one editor commit is
 * one CRDT transaction. Existing shared types are retained and only changed
 * fields/order entries are updated.
 */
export function writeCanvasIRToCrdt(root: SharedMap, ir: CanvasIR): void {
	root.set(CANVAS_COLLAB_SCHEMA_VERSION_KEY, CANVAS_COLLAB_SCHEMA_VERSION);

	syncFields(root, ir as unknown as Record<string, unknown>, [
		"pages",
		"assets",
		"components",
		"externalComponentSnapshots",
	]);

	const pages = getOrCreateMap(root, PAGES_KEY);
	const nodes = getOrCreateMap(root, NODES_KEY);
	const pageOrder = getOrCreateArray(root, PAGE_ORDER_KEY);
	const components = getOrCreateMap(root, COMPONENTS_KEY);
	const assets = getOrCreateMap(root, ASSETS_KEY);
	const externalSnapshots = getOrCreateMap(root, EXTERNAL_SNAPSHOTS_KEY);
	const livePageIds = new Set(ir.pages.map((page) => page.id));
	const liveNodeIds = new Set<string>();
	const liveComponentIds = new Set<string>();

	syncOrderedIds(
		pageOrder,
		ir.pages.map((page) => page.id),
	);

	for (const page of ir.pages) {
		const pageMap = getOrCreateEntryMap(pages, page.id, `pages.${page.id}`);
		pageMap.set(DELETED_KEY, false);
		pageMap.set(ROOT_ID_KEY, page.root.id);
		syncFields(pageMap, page as unknown as Record<string, unknown>, [
			"id",
			"root",
		]);
		writeNode(
			nodes,
			page.root,
			`page:${page.id}`,
			liveNodeIds,
			`pages.${page.id}.root`,
		);
	}
	markMissingEntriesDeleted(pages, livePageIds);

	for (const [componentId, definition] of Object.entries(ir.components ?? {})) {
		liveComponentIds.add(componentId);
		const componentMap = getOrCreateEntryMap(
			components,
			componentId,
			`components.${componentId}`,
		);
		componentMap.set(DELETED_KEY, false);
		componentMap.set(ROOT_ID_KEY, definition.root.id);
		syncFields(componentMap, definition as unknown as Record<string, unknown>, [
			"id",
			"root",
		]);
		writeNode(
			nodes,
			definition.root,
			`component:${componentId}`,
			liveNodeIds,
			`components.${componentId}.root`,
		);
	}
	markMissingEntriesDeleted(components, liveComponentIds);
	markMissingEntriesDeleted(nodes, liveNodeIds);
	syncEncodedMap(assets, ir.assets);
	syncEncodedMap(externalSnapshots, ir.externalComponentSnapshots ?? {});
}

/**
 * Project schema-v2 Yjs state back to CanvasIR and run the normal bounded load
 * pipeline before returning it to an editor.
 */
export function readCanvasIRFromCrdt(
	root: SharedMap,
	options: ReadCanvasIRFromCrdtOptions = {},
): CanvasIR {
	const schemaVersion = root.get(CANVAS_COLLAB_SCHEMA_VERSION_KEY);
	if (schemaVersion !== CANVAS_COLLAB_SCHEMA_VERSION) {
		throw new CanvasCrdtProjectionError(
			"incompatible-schema",
			`Canvas collaboration schema ${String(schemaVersion)} is incompatible with this client (expected ${CANVAS_COLLAB_SCHEMA_VERSION}).`,
			CANVAS_COLLAB_SCHEMA_VERSION_KEY,
		);
	}

	const pagesMap = requireMap(root, PAGES_KEY, PAGES_KEY);
	const nodesMap = requireMap(root, NODES_KEY, NODES_KEY);
	const pageOrder = requireArray(root, PAGE_ORDER_KEY, PAGE_ORDER_KEY);
	const assetsMap = requireMap(root, ASSETS_KEY, ASSETS_KEY);
	const componentsMap = requireMap(root, COMPONENTS_KEY, COMPONENTS_KEY);
	const externalSnapshotsMap = requireMap(
		root,
		EXTERNAL_SNAPSHOTS_KEY,
		EXTERNAL_SNAPSHOTS_KEY,
	);
	const visited = new Set<string>();
	const liveParentIndex = indexLiveNodesByParent(nodesMap);

	const pages = orderedLiveEntryIds(pageOrder, pagesMap, PAGES_KEY)
		.map((pageId) => {
			const pageMap = optionalEntryMap(pagesMap, pageId, `pages.${pageId}`);
			if (!pageMap || isDeleted(pageMap, `pages.${pageId}`)) return undefined;
			const rootId = requireString(
				pageMap.get(ROOT_ID_KEY),
				`pages.${pageId}.${ROOT_ID_KEY}`,
			);
			const rootNode = readNode(
				nodesMap,
				rootId,
				`page:${pageId}`,
				visited,
				new Set(),
				liveParentIndex,
				`pages.${pageId}.root`,
			);
			return {
				id: pageId,
				...readFields(pageMap, `pages.${pageId}`),
				root: rootNode,
			};
		})
		.filter((page): page is NonNullable<typeof page> => page !== undefined);

	const components: Record<string, unknown> = {};
	for (const componentId of sortedKeys(componentsMap)) {
		const componentMap = optionalEntryMap(
			componentsMap,
			componentId,
			`components.${componentId}`,
		);
		if (!componentMap || isDeleted(componentMap, `components.${componentId}`)) {
			continue;
		}
		const rootId = requireString(
			componentMap.get(ROOT_ID_KEY),
			`components.${componentId}.${ROOT_ID_KEY}`,
		);
		components[componentId] = {
			id: componentId,
			...readFields(componentMap, `components.${componentId}`),
			root: readNode(
				nodesMap,
				rootId,
				`component:${componentId}`,
				visited,
				new Set(),
				liveParentIndex,
				`components.${componentId}.root`,
			),
		};
	}

	for (const nodeId of sortedKeys(nodesMap)) {
		const nodeMap = optionalEntryMap(nodesMap, nodeId, `nodes.${nodeId}`);
		if (!nodeMap || isDeleted(nodeMap, `nodes.${nodeId}`)) continue;
		if (!visited.has(nodeId)) {
			throw new CanvasCrdtProjectionError(
				"orphan-node",
				`Live node "${nodeId}" is not reachable from a live page or component root.`,
				`nodes.${nodeId}`,
			);
		}
	}

	const candidate: Record<string, unknown> = {
		...readFields(root, "document"),
		pages,
		assets: readEncodedMap(assetsMap, ASSETS_KEY),
	};
	if (Object.keys(components).length > 0) candidate.components = components;
	const externalSnapshots = readEncodedMap(
		externalSnapshotsMap,
		EXTERNAL_SNAPSHOTS_KEY,
	);
	if (Object.keys(externalSnapshots).length > 0) {
		candidate.externalComponentSnapshots = externalSnapshots;
	}

	try {
		return decodeCanvasIR(
			encodeJson(candidate),
			options.runtime,
			options.documentBudgetPolicy,
		);
	} catch (error) {
		throw new CanvasCrdtProjectionError(
			"invalid-canvas-ir",
			`Projected collaboration state is not a valid CanvasIR: ${errorMessage(error)}`,
			"document",
		);
	}
}

function writeNode(
	nodes: SharedMap,
	node: CanvasNode,
	parent: string,
	liveNodeIds: Set<string>,
	path: string,
): void {
	if (liveNodeIds.has(node.id)) {
		throw new CanvasCrdtProjectionError(
			"duplicate-node-id",
			`Node id "${node.id}" occurs more than once in CanvasIR.`,
			path,
		);
	}
	liveNodeIds.add(node.id);
	const nodeMap = getOrCreateEntryMap(nodes, node.id, `nodes.${node.id}`);
	nodeMap.set(DELETED_KEY, false);
	nodeMap.set(TYPE_KEY, node.type);
	nodeMap.set(PARENT_KEY, parent);
	const record = node as unknown as Record<string, unknown>;
	const children = Array.isArray(record.children)
		? (record.children as CanvasNode[])
		: undefined;
	syncFields(nodeMap, record, [
		"id",
		"type",
		"children",
		...(node.type === "rich-text" ? ["paragraphs"] : []),
	]);

	if (node.type === "rich-text") {
		const text = getOrCreateText(nodeMap, RICH_TEXT_KEY);
		reconcileRichText(text, node.paragraphs);
	} else if (nodeMap.has(RICH_TEXT_KEY)) {
		nodeMap.delete(RICH_TEXT_KEY);
	}

	if (children) {
		const childOrder = getOrCreateArray(nodeMap, CHILDREN_KEY);
		syncOrderedIds(
			childOrder,
			children.map((child) => child.id),
		);
		for (const child of children) {
			writeNode(nodes, child, node.id, liveNodeIds, `${path}.${child.id}`);
		}
	} else if (nodeMap.has(CHILDREN_KEY)) {
		nodeMap.delete(CHILDREN_KEY);
	}
}

function readNode(
	nodes: SharedMap,
	nodeId: string,
	expectedParent: string,
	visited: Set<string>,
	ancestors: Set<string>,
	liveParentIndex: LiveParentIndex,
	path: string,
): CanvasNode {
	if (ancestors.has(nodeId)) {
		throw new CanvasCrdtProjectionError(
			"cycle",
			`Cycle detected at node "${nodeId}".`,
			path,
		);
	}
	if (visited.has(nodeId)) {
		throw new CanvasCrdtProjectionError(
			"duplicate-node-id",
			`Live node "${nodeId}" is referenced more than once.`,
			path,
		);
	}
	const nodeMap = requireEntryMap(nodes, nodeId, `nodes.${nodeId}`);
	if (isDeleted(nodeMap, `nodes.${nodeId}`)) {
		throw new CanvasCrdtProjectionError(
			"deleted-node-reference",
			`Deleted node "${nodeId}" is still referenced by the live tree.`,
			path,
		);
	}
	const parent =
		liveParentIndex.parentByNode.get(nodeId) ??
		requireString(nodeMap.get(PARENT_KEY), `nodes.${nodeId}.${PARENT_KEY}`);
	if (parent !== expectedParent) {
		throw new CanvasCrdtProjectionError(
			"parent-mismatch",
			`Node "${nodeId}" selects parent "${parent}" instead of "${expectedParent}".`,
			path,
		);
	}

	visited.add(nodeId);
	const nextAncestors = new Set(ancestors);
	nextAncestors.add(nodeId);
	const type = requireString(
		nodeMap.get(TYPE_KEY),
		`nodes.${nodeId}.${TYPE_KEY}`,
	);
	const value: Record<string, unknown> = {
		id: nodeId,
		type,
		...readFields(nodeMap, `nodes.${nodeId}`),
	};

	const childOrder = nodeMap.get(CHILDREN_KEY);
	const orderedChildIds: string[] = [];
	if (childOrder !== undefined) {
		if (!(childOrder instanceof Y.Array)) {
			throw invalidSharedType(`nodes.${nodeId}.${CHILDREN_KEY}`, "Y.Array");
		}
		for (const childId of uniqueStringIds(
			childOrder.toArray(),
			`nodes.${nodeId}.${CHILDREN_KEY}`,
		)) {
			const childMap = requireEntryMap(nodes, childId, `nodes.${childId}`);
			if (isDeleted(childMap, `nodes.${childId}`)) continue;
			const selectedParent = requireString(
				childMap.get(PARENT_KEY),
				`nodes.${childId}.${PARENT_KEY}`,
			);
			if (selectedParent !== nodeId) continue;
			orderedChildIds.push(childId);
		}
	}
	const includedChildIds = new Set(orderedChildIds);
	for (const childId of liveParentIndex.childrenByParent.get(nodeId) ?? []) {
		if (includedChildIds.has(childId)) continue;
		includedChildIds.add(childId);
		orderedChildIds.push(childId);
	}
	if (childOrder !== undefined || orderedChildIds.length > 0) {
		value.children = orderedChildIds.map((childId) =>
			readNode(
				nodes,
				childId,
				nodeId,
				visited,
				nextAncestors,
				liveParentIndex,
				`${path}.children.${childId}`,
			),
		);
	}

	if (type === "rich-text") {
		const richText = nodeMap.get(RICH_TEXT_KEY);
		if (!(richText instanceof Y.Text)) {
			throw invalidSharedType(`nodes.${nodeId}.${RICH_TEXT_KEY}`, "Y.Text");
		}
		value.paragraphs = readRichText(
			richText,
			`nodes.${nodeId}.${RICH_TEXT_KEY}`,
		);
	}

	return value as unknown as CanvasNode;
}

interface LiveParentIndex {
	readonly parentByNode: ReadonlyMap<string, string>;
	readonly childrenByParent: ReadonlyMap<string, readonly string[]>;
}

function indexLiveNodesByParent(nodes: SharedMap): LiveParentIndex {
	const parentByNode = new Map<string, string>();
	const childrenByParent = new Map<string, string[]>();
	for (const nodeId of sortedKeys(nodes)) {
		const nodeMap = requireEntryMap(nodes, nodeId, `nodes.${nodeId}`);
		if (isDeleted(nodeMap, `nodes.${nodeId}`)) continue;
		const parent = resolveEffectiveParent(nodes, nodeId);
		parentByNode.set(nodeId, parent);
		const children = childrenByParent.get(parent) ?? [];
		children.push(nodeId);
		childrenByParent.set(parent, children);
	}
	return { parentByNode, childrenByParent };
}

/**
 * Hoist live descendants through a winning tombstone to the first live
 * ancestor. This makes concurrent group/ungroup and delete/update races
 * project a valid tree while keeping the tombstoned container absent.
 */
function resolveEffectiveParent(nodes: SharedMap, nodeId: string): string {
	const seen = new Set([nodeId]);
	let parent = requireString(
		requireEntryMap(nodes, nodeId, `nodes.${nodeId}`).get(PARENT_KEY),
		`nodes.${nodeId}.${PARENT_KEY}`,
	);
	while (!parent.startsWith("page:") && !parent.startsWith("component:")) {
		if (seen.has(parent)) {
			throw new CanvasCrdtProjectionError(
				"cycle",
				`Cycle detected while resolving parent for node "${nodeId}".`,
				`nodes.${nodeId}.${PARENT_KEY}`,
			);
		}
		seen.add(parent);
		const parentMap = optionalEntryMap(nodes, parent, `nodes.${parent}`);
		if (!parentMap || !isDeleted(parentMap, `nodes.${parent}`)) return parent;
		parent = requireString(
			parentMap.get(PARENT_KEY),
			`nodes.${parent}.${PARENT_KEY}`,
		);
	}
	return parent;
}

function orderedLiveEntryIds(
	order: Y.Array<string>,
	entries: SharedMap,
	path: string,
): string[] {
	const result: string[] = [];
	const seen = new Set<string>();
	for (const id of uniqueStringIds(order.toArray(), `${path}Order`)) {
		const entry = optionalEntryMap(entries, id, `${path}.${id}`);
		if (!entry || isDeleted(entry, `${path}.${id}`)) continue;
		seen.add(id);
		result.push(id);
	}
	for (const id of sortedKeys(entries)) {
		if (seen.has(id)) continue;
		const entry = requireEntryMap(entries, id, `${path}.${id}`);
		if (isDeleted(entry, `${path}.${id}`)) continue;
		result.push(id);
	}
	return result;
}

function syncFields(
	target: SharedMap,
	value: Record<string, unknown>,
	omit: readonly string[],
): void {
	const omitted = new Set(omit);
	const desired = new Set<string>();
	for (const [key, fieldValue] of Object.entries(value)) {
		if (omitted.has(key) || fieldValue === undefined) continue;
		const sharedKey = `${FIELD_PREFIX}${key}`;
		desired.add(sharedKey);
		setIfChanged(target, sharedKey, encodeJson(fieldValue));
	}
	for (const key of Array.from(target.keys())) {
		if (key.startsWith(FIELD_PREFIX) && !desired.has(key)) target.delete(key);
	}
}

function readFields(target: SharedMap, path: string): Record<string, unknown> {
	const fields: Record<string, unknown> = {};
	for (const key of Array.from(target.keys()).sort()) {
		if (!key.startsWith(FIELD_PREFIX)) continue;
		const raw = target.get(key);
		if (typeof raw !== "string") {
			throw new CanvasCrdtProjectionError(
				"invalid-field",
				`Expected encoded JSON string at ${path}.${key}.`,
				`${path}.${key}`,
			);
		}
		fields[key.slice(FIELD_PREFIX.length)] = decodeJson(raw, `${path}.${key}`);
	}
	return fields;
}

function syncEncodedMap(
	target: SharedMap,
	values: Readonly<Record<string, unknown>>,
): void {
	const desired = new Set(Object.keys(values));
	for (const key of Array.from(target.keys())) {
		if (!desired.has(key)) target.delete(key);
	}
	for (const [key, value] of Object.entries(values)) {
		setIfChanged(target, key, encodeJson(value));
	}
}

function readEncodedMap(
	target: SharedMap,
	path: string,
): Record<string, unknown> {
	const values: Record<string, unknown> = {};
	for (const key of sortedKeys(target)) {
		const raw = target.get(key);
		if (typeof raw !== "string") {
			throw new CanvasCrdtProjectionError(
				"invalid-field",
				`Expected encoded JSON string at ${path}.${key}.`,
				`${path}.${key}`,
			);
		}
		values[key] = decodeJson(raw, `${path}.${key}`);
	}
	return values;
}

function markMissingEntriesDeleted(
	target: SharedMap,
	liveIds: Set<string>,
): void {
	for (const id of Array.from(target.keys())) {
		if (liveIds.has(id)) continue;
		const value = target.get(id);
		if (value instanceof Y.Map) value.set(DELETED_KEY, true);
	}
}

function syncOrderedIds(
	target: Y.Array<string>,
	desiredIds: readonly string[],
): void {
	const desiredSet = new Set(desiredIds);
	const seen = new Set<string>();
	const initial = target.toArray();
	for (let index = initial.length - 1; index >= 0; index -= 1) {
		const id = initial[index] as string;
		if (!desiredSet.has(id) || seen.has(id)) {
			target.delete(index, 1);
		} else {
			seen.add(id);
		}
	}

	const current = target.toArray();
	for (let index = 0; index < desiredIds.length; index += 1) {
		const desiredId = desiredIds[index] as string;
		if (current[index] === desiredId) continue;
		const existingIndex = current.indexOf(desiredId, index + 1);
		if (existingIndex >= 0) {
			target.delete(existingIndex, 1);
			current.splice(existingIndex, 1);
		}
		target.insert(index, [desiredId]);
		current.splice(index, 0, desiredId);
	}
	if (current.length > desiredIds.length) {
		target.delete(desiredIds.length, current.length - desiredIds.length);
	}
}

interface RichTextUnit {
	readonly text: string;
	readonly attributes: Readonly<Record<string, unknown>>;
}

function reconcileRichText(
	target: Y.Text,
	paragraphs: readonly RichTextParagraph[],
): void {
	const current = richTextUnitsFromDelta(target.toDelta());
	const desired = richTextUnitsFromParagraphs(paragraphs);
	let prefix = 0;
	while (
		prefix < current.length &&
		prefix < desired.length &&
		sameRichTextUnit(
			current[prefix] as RichTextUnit,
			desired[prefix] as RichTextUnit,
		)
	) {
		prefix += 1;
	}
	let suffix = 0;
	while (
		suffix < current.length - prefix &&
		suffix < desired.length - prefix &&
		sameRichTextUnit(
			current[current.length - suffix - 1] as RichTextUnit,
			desired[desired.length - suffix - 1] as RichTextUnit,
		)
	) {
		suffix += 1;
	}

	const offset = textLength(current.slice(0, prefix));
	const deleteLength = textLength(
		current.slice(prefix, current.length - suffix),
	);
	if (deleteLength > 0) target.delete(offset, deleteLength);
	let insertOffset = offset;
	let index = prefix;
	const end = desired.length - suffix;
	while (index < end) {
		const first = desired[index] as RichTextUnit;
		const attributes = first.attributes;
		let text = first.text;
		index += 1;
		while (
			index < end &&
			encodeJson((desired[index] as RichTextUnit).attributes) ===
				encodeJson(attributes)
		) {
			text += (desired[index] as RichTextUnit).text;
			index += 1;
		}
		target.insert(insertOffset, text, { ...attributes });
		insertOffset += text.length;
	}
}

function richTextUnitsFromParagraphs(
	paragraphs: readonly RichTextParagraph[],
): RichTextUnit[] {
	const units: RichTextUnit[] = [];
	for (const paragraph of paragraphs) {
		for (const span of paragraph.spans) {
			const { text, ...style } = span;
			const attributes = { [SPAN_ATTRIBUTE]: encodeJson(style) };
			for (const character of Array.from(text)) {
				units.push({ text: character, attributes });
			}
		}
		const { spans: _spans, ...paragraphStyle } = paragraph;
		units.push({
			text: "\n",
			attributes: { [PARAGRAPH_ATTRIBUTE]: encodeJson(paragraphStyle) },
		});
	}
	return units;
}

function richTextUnitsFromDelta(
	delta: readonly { insert?: unknown; attributes?: Record<string, unknown> }[],
): RichTextUnit[] {
	const units: RichTextUnit[] = [];
	for (const operation of delta) {
		if (typeof operation.insert !== "string") continue;
		const attributes = operation.attributes ?? {};
		for (const character of Array.from(operation.insert)) {
			units.push({ text: character, attributes });
		}
	}
	return units;
}

function readRichText(target: Y.Text, path: string): RichTextParagraph[] {
	const paragraphs: RichTextParagraph[] = [];
	let spans: RichTextSpan[] = [];
	for (const unit of richTextUnitsFromDelta(target.toDelta())) {
		const paragraphRaw = unit.attributes[PARAGRAPH_ATTRIBUTE];
		if (unit.text === "\n" && typeof paragraphRaw === "string") {
			const paragraphStyle = decodeJsonObject(paragraphRaw, path);
			paragraphs.push({ ...paragraphStyle, spans } as RichTextParagraph);
			spans = [];
			continue;
		}
		const spanRaw = unit.attributes[SPAN_ATTRIBUTE];
		const style =
			typeof spanRaw === "string" ? decodeJsonObject(spanRaw, path) : {};
		const previous = spans.at(-1);
		if (previous) {
			const { text: _previousText, ...previousStyle } = previous;
			if (encodeJson(previousStyle) === encodeJson(style)) {
				spans[spans.length - 1] = {
					...previous,
					text: previous.text + unit.text,
				};
				continue;
			}
		}
		spans.push({ text: unit.text, ...style } as RichTextSpan);
	}
	if (spans.length > 0 || paragraphs.length === 0) paragraphs.push({ spans });
	return paragraphs;
}

function sameRichTextUnit(a: RichTextUnit, b: RichTextUnit): boolean {
	return (
		a.text === b.text && encodeJson(a.attributes) === encodeJson(b.attributes)
	);
}

function textLength(units: readonly RichTextUnit[]): number {
	let length = 0;
	for (const unit of units) length += unit.text.length;
	return length;
}

function getOrCreateMap(parent: SharedMap, key: string): SharedMap {
	const existing = parent.get(key);
	if (existing instanceof Y.Map) return existing;
	if (existing !== undefined) throw invalidSharedType(key, "Y.Map");
	const created = new Y.Map<unknown>();
	parent.set(key, created);
	return created;
}

function getOrCreateEntryMap(
	parent: SharedMap,
	key: string,
	path: string,
): SharedMap {
	const existing = parent.get(key);
	if (existing instanceof Y.Map) return existing;
	if (existing !== undefined) throw invalidSharedType(path, "Y.Map");
	const created = new Y.Map<unknown>();
	parent.set(key, created);
	return created;
}

function getOrCreateArray(parent: SharedMap, key: string): Y.Array<string> {
	const existing = parent.get(key);
	if (existing instanceof Y.Array) return existing as Y.Array<string>;
	if (existing !== undefined) throw invalidSharedType(key, "Y.Array");
	const created = new Y.Array<string>();
	parent.set(key, created);
	return created;
}

function getOrCreateText(parent: SharedMap, key: string): Y.Text {
	const existing = parent.get(key);
	if (existing instanceof Y.Text) return existing;
	if (existing !== undefined) throw invalidSharedType(key, "Y.Text");
	const created = new Y.Text();
	parent.set(key, created);
	return created;
}

function requireMap(parent: SharedMap, key: string, path: string): SharedMap {
	const value = parent.get(key);
	if (!(value instanceof Y.Map)) throw invalidSharedType(path, "Y.Map");
	return value;
}

function requireArray(
	parent: SharedMap,
	key: string,
	path: string,
): Y.Array<string> {
	const value = parent.get(key);
	if (!(value instanceof Y.Array)) throw invalidSharedType(path, "Y.Array");
	return value as Y.Array<string>;
}

function optionalEntryMap(
	parent: SharedMap,
	key: string,
	path: string,
): SharedMap | undefined {
	const value = parent.get(key);
	if (value === undefined) return undefined;
	if (!(value instanceof Y.Map)) throw invalidSharedType(path, "Y.Map");
	return value;
}

function requireEntryMap(
	parent: SharedMap,
	key: string,
	path: string,
): SharedMap {
	const value = optionalEntryMap(parent, key, path);
	if (!value) {
		throw new CanvasCrdtProjectionError(
			"missing-node",
			`Missing shared node "${key}".`,
			path,
		);
	}
	return value;
}

function isDeleted(value: SharedMap, path: string): boolean {
	const deleted = value.get(DELETED_KEY);
	if (deleted === undefined) return false;
	if (typeof deleted !== "boolean") {
		throw new CanvasCrdtProjectionError(
			"invalid-field",
			`Expected boolean tombstone at ${path}.${DELETED_KEY}.`,
			`${path}.${DELETED_KEY}`,
		);
	}
	return deleted;
}

function uniqueStringIds(values: readonly unknown[], path: string): string[] {
	const result: string[] = [];
	const seen = new Set<string>();
	for (const value of values) {
		if (typeof value !== "string" || value.length === 0) {
			throw new CanvasCrdtProjectionError(
				"invalid-field",
				`Expected a non-empty stable ID in ${path}.`,
				path,
			);
		}
		if (seen.has(value)) continue;
		seen.add(value);
		result.push(value);
	}
	return result;
}

function requireString(value: unknown, path: string): string {
	if (typeof value !== "string" || value.length === 0) {
		throw new CanvasCrdtProjectionError(
			"invalid-field",
			`Expected non-empty string at ${path}.`,
			path,
		);
	}
	return value;
}

function setIfChanged(target: SharedMap, key: string, value: unknown): void {
	if (target.get(key) !== value) target.set(key, value);
}

function sortedKeys(target: SharedMap): string[] {
	return Array.from(target.keys()).sort();
}

function invalidSharedType(
	path: string,
	expected: string,
): CanvasCrdtProjectionError {
	return new CanvasCrdtProjectionError(
		"invalid-shared-type",
		`Expected ${expected} at ${path}.`,
		path,
	);
}

function decodeJson(raw: string, path: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		throw new CanvasCrdtProjectionError(
			"invalid-field",
			`Invalid encoded JSON at ${path}.`,
			path,
		);
	}
}

function decodeJsonObject(raw: string, path: string): Record<string, unknown> {
	const value = decodeJson(raw, path);
	if (!isPlainObject(value)) {
		throw new CanvasCrdtProjectionError(
			"invalid-field",
			`Expected encoded object at ${path}.`,
			path,
		);
	}
	return value;
}

function encodeJson(value: unknown): string {
	const encoded = JSON.stringify(canonicalize(value));
	if (encoded === undefined) {
		throw new CanvasCrdtProjectionError(
			"invalid-field",
			"Collaboration fields must be JSON-compatible.",
		);
	}
	return encoded;
}

function canonicalize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (!isPlainObject(value)) return value;
	const result: Record<string, unknown> = {};
	for (const key of Object.keys(value).sort()) {
		const child = value[key];
		if (child !== undefined) result[key] = canonicalize(child);
	}
	return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
