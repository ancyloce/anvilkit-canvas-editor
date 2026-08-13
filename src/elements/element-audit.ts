import {
	type CanvasFill,
	type CanvasNode,
	CanvasNodeSchema,
	canvasInvariantErrors,
	createCanvasIR,
	createGroup,
	createPage,
	validateCanvasIRInvariants,
	walkPage,
} from "@anvilkit/canvas-core";
import {
	CANVAS_ELEMENT_NODE_KINDS,
	type CanvasElementEntry,
	type CanvasElementNode,
} from "./element-entry.js";

/**
 * Catalog-entry audit (`cp3-001`), shared by three downstream tests.
 *
 * WHY THIS EXISTS AND THE TEMPLATE CONTRACT HAS NO COUNTERPART.
 *
 * A template *is* a `CanvasIR`, so "is this template well-formed?" is already
 * answered by `validateCanvasIRInvariants` with no adapter. An element entry is
 * a **node factory**, and core has no entry point that validates a bare node in
 * isolation — a node's most important invariants (`duplicate-node-id`,
 * `dangling-asset-reference`) are whole-document facts. So the check that turns
 * `cp3-001`'s acceptance criterion *"`build()` output validates against the IR
 * schema and its invariants"* into something executable has to compose the
 * pieces itself, and it should compose them once:
 *
 * - `cp3-001` — this task's own acceptance test.
 * - `cp3-002` — "a unit test asserting SPDX validity across every entry" and
 *   "every entry's `build()` produces a valid node".
 * - `cp3-005` — "catalog-wide test: every entry is either fully recolourable or
 *   flagged".
 *
 * Three real call sites, one implementation. Deliberately NOT in
 * `element-entry.ts`: this module has *runtime* imports from `canvas-core`
 * (builders, the Zod schema, the walker), and the panel that imports the entry
 * types must not drag them in.
 */

export type CanvasElementIssueCode =
	/** `license` is present at the type level but blank or whitespace. */
	| "missing-license"
	/** `build()` produced, somewhere in its subtree, a kind an element may not build. */
	| "unbuildable-node-kind"
	/** Two `build()` calls reused a node id — a `duplicate-node-id` waiting to happen. */
	| "unstable-node-id"
	/** The built node failed `CanvasNodeSchema`. */
	| "schema-invalid"
	/** The built node failed a document invariant once inserted. */
	| "ir-invariant"
	/** The built geometry disagrees with the entry's declared `recolor`. */
	| "recolor-mismatch";

export interface CanvasElementIssue {
	readonly code: CanvasElementIssueCode;
	readonly entryId: string;
	readonly message: string;
}

/**
 * A colour no catalog entry should contain by coincidence, used to trace where
 * `build({ fill })` / `build({ stroke })` actually lands. Not `#000000` or a
 * brand token: a token is a `BrandTokenRef` object, and comparing one by
 * identity across a build would only prove the entry passed the reference
 * through, not that it reached the geometry.
 */
const FILL_PROBE = "#f0e1d2";
const STROKE_PROBE = "#d2e1f0";

/** Nodes whose paint is reachable from a single `fill`-shaped field. */
function fillOf(node: CanvasNode): CanvasFill | undefined {
	switch (node.type) {
		case "rect":
		case "ellipse":
		case "polygon":
		case "star":
		case "path":
			return node.fill;
		case "frame":
			return node.background;
		default:
			return undefined;
	}
}

function strokeOf(node: CanvasNode): string | undefined {
	switch (node.type) {
		case "rect":
		case "ellipse":
		case "polygon":
		case "star":
		case "path":
		case "line":
			return node.stroke;
		default:
			return undefined;
	}
}

/**
 * Put a built node on a page of its own so core's document-level machinery can
 * see it. The page root is a plain `group` from `createGroup`, exactly as
 * `createPage` would have made — so nothing about this wrapper is a fixture the
 * real insertion path would not also produce.
 */
function documentAround(node: CanvasElementNode) {
	return createCanvasIR({
		pages: [createPage({ root: createGroup({ children: [node] }) })],
	});
}

function eachNode(node: CanvasElementNode): CanvasNode[] {
	const page = createPage({ root: createGroup({ children: [node] }) });
	const found: CanvasNode[] = [];
	walkPage(page, (ctx) => {
		if (ctx.node !== page.root) found.push(ctx.node);
	});
	return found;
}

const BUILDABLE = new Set<string>(CANVAS_ELEMENT_NODE_KINDS);

/**
 * Audit one catalog entry against everything `cp3-001` promises about it.
 *
 * Returns an empty array for a sound entry. Never throws for a *bad* entry —
 * a catalog-wide test wants every failure named at once, not the first one.
 * A `build()` that throws is the one exception: that is a broken factory, not a
 * finding, and it propagates.
 */
export function checkElementEntry(
	entry: CanvasElementEntry,
): CanvasElementIssue[] {
	const issues: CanvasElementIssue[] = [];
	const add = (code: CanvasElementIssueCode, message: string): void => {
		issues.push({ code, entryId: entry.id, message });
	};

	if (entry.license.trim() === "") {
		add("missing-license", "`license` must be a non-empty SPDX identifier.");
	}

	const node = entry.build();
	const subtree = eachNode(node);

	for (const child of subtree) {
		if (!BUILDABLE.has(child.type)) {
			add(
				"unbuildable-node-kind",
				`build() produced a "${child.type}" node. An element may only build ${[...BUILDABLE].join("/")} — every other kind needs document-level state (ir.assets, ir.components, a job) that a node factory cannot write.`,
			);
		}
	}

	// Fresh ids per call. Reusing them makes a second insertion trip
	// `duplicate-node-id`, after which every findNode/parentOf in the editor
	// silently resolves to the wrong node.
	const secondIds = new Set(eachNode(entry.build()).map((n) => n.id));
	for (const child of subtree) {
		if (secondIds.has(child.id)) {
			add(
				"unstable-node-id",
				`build() reused node id "${child.id}" across two calls; ids must be minted per call.`,
			);
			break;
		}
	}

	const parsed = CanvasNodeSchema.safeParse(node);
	if (!parsed.success) {
		add("schema-invalid", parsed.error.issues.map((i) => i.message).join("; "));
	}

	// Errors only. A `"warning"` issue describes a document that renders in a
	// degraded way, not a catalog entry that is wrong to ship — failing an audit
	// on one would reject entries this build can insert and draw perfectly well.
	for (const issue of canvasInvariantErrors(
		validateCanvasIRInvariants(documentAround(node)),
	)) {
		add("ir-invariant", `${issue.code}: ${issue.message}`);
	}

	// `cp3-005`: never silently half-recolour. Build with a probe colour and see
	// where it actually landed.
	const painted = eachNode(entry.build({ fill: FILL_PROBE }));
	const fillSites = painted.filter((n) => fillOf(n) !== undefined);
	const filled = fillSites.filter((n) => fillOf(n) === FILL_PROBE);
	const stroked = eachNode(entry.build({ stroke: STROKE_PROBE }));
	const strokeSites = stroked.filter((n) => strokeOf(n) !== undefined);
	const strokedProbe = strokeSites.filter((n) => strokeOf(n) === STROKE_PROBE);

	switch (entry.recolor) {
		case "fill":
			if (filled.length === 0) {
				add(
					"recolor-mismatch",
					'recolor is "fill" but build({ fill }) reached no geometry.',
				);
			} else if (filled.length < fillSites.length) {
				add(
					"recolor-mismatch",
					`recolor is "fill" but build({ fill }) reached ${filled.length} of ${fillSites.length} painted nodes — declare "multi" rather than half-recolouring.`,
				);
			}
			break;
		case "stroke":
			if (strokedProbe.length === 0) {
				add(
					"recolor-mismatch",
					'recolor is "stroke" but build({ stroke }) reached no geometry.',
				);
			} else if (strokedProbe.length < strokeSites.length) {
				add(
					"recolor-mismatch",
					`recolor is "stroke" but build({ stroke }) reached ${strokedProbe.length} of ${strokeSites.length} stroked nodes — declare "multi" rather than half-recolouring.`,
				);
			}
			break;
		case "multi":
			if (filled.length === 0 && strokedProbe.length === 0) {
				add(
					"recolor-mismatch",
					'recolor is "multi" but neither fill nor stroke reached any geometry; declare "none".',
				);
			}
			break;
		case "none":
			if (filled.length > 0 || strokedProbe.length > 0) {
				add(
					"recolor-mismatch",
					'recolor is "none" but build() honoured a fill/stroke context; declare "fill", "stroke" or "multi".',
				);
			}
			break;
	}

	return issues;
}
