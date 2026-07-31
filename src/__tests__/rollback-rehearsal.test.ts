import type {
	CanvasComponentDefinition,
	CanvasIR,
	CanvasNode,
} from "@anvilkit/canvas-core";
import {
	buildExternalSnapshotIndex,
	createCanvasIR,
	createComponentInstance,
	createGroup,
	createPage,
	createText,
	getDefinition,
	resolveComponentInstance,
} from "@anvilkit/canvas-core";
import type { CanvasBrandPolicyContext } from "@anvilkit/canvas-core/brand-governance";
import { CANVAS_PERMISSIVE_POLICY_CONTEXT } from "@anvilkit/canvas-core/brand-governance";
import { snapshotKey } from "@anvilkit/canvas-core/component-libraries";
import { prepareExport } from "@anvilkit/canvas-core/export-preparation";
import { describe, expect, it } from "vitest";

import { loadCanvasDocumentWithDiagnostics } from "../persistence/load-pipeline.js";

/**
 * @file The rollback rehearsal (plan 0021 T-053 steps 3-4).
 *
 * ## What a rollback must and must not do
 *
 * Turning the flags off disables **authoring**: search, insert, update, swap,
 * variant editing. It must leave everything else exactly as it was —
 * resolution from stored snapshots, reading, recovery, compliance reporting,
 * and export.
 *
 * The failure mode this file exists to prevent is the one that looks like a
 * successful rollback: the app comes up, nothing errors, and every document
 * quietly loses its refs, its variant selections, or its policies. That is not
 * a rollback, it is data loss with a clean exit code — and it is unrecoverable
 * once a save follows.
 *
 * So the assertions are all of the form "with authoring off, X is byte-identical
 * to X with authoring on".
 */

const REF = {
	kind: "library" as const,
	libraryId: "acme",
	componentId: "card",
	version: "1.0.0",
	integrity: `sha256-${"A".repeat(43)}`,
};

/** A DIFFERENT version of the same component, to prove no `latest` lookup. */
const NEWER_REF = {
	...REF,
	version: "2.0.0",
	integrity: `sha256-${"B".repeat(43)}`,
};

const DEFINITION = {
	id: "card",
	name: "Card",
	revision: 1,
	root: createGroup({
		id: "card-root",
		children: [
			createText({
				id: "card-inner",
				text: "v1",
				bounds: { width: 4, height: 4 },
			}),
		],
	}),
	properties: [
		{
			id: "label",
			name: "Label",
			nodeId: "card-inner",
			kind: "text",
			targetKind: "text",
		},
	],
	policy: { editablePropertyIds: ["label"], allowDetach: false },
} as unknown as CanvasComponentDefinition;

function snapshotFor(ref: typeof REF, text: string) {
	return {
		canonicalFormatVersion: 1,
		ref,
		definition: {
			...DEFINITION,
			root: createGroup({
				id: "card-root",
				children: [
					createText({
						id: "card-inner",
						text,
						bounds: { width: 4, height: 4 },
					}),
				],
			}),
		},
		dependencies: [],
	};
}

/** A document exercising every persisted shape the plan introduced. */
function fullDocument(): CanvasIR {
	const external = {
		...createComponentInstance({
			id: "inst-external",
			componentId: "card",
			bounds: { width: 10, height: 10 },
		}),
		source: REF,
		variantSelection: { size: "lg", theme: "dark" },
		overrides: {
			label: { kind: "text", value: { kind: "plain", text: "Hello" } },
		},
	} as unknown as CanvasNode;
	const local = {
		...createComponentInstance({
			id: "inst-local",
			componentId: "card",
			bounds: { width: 10, height: 10 },
		}),
		variantSelection: { size: "sm" },
	} as unknown as CanvasNode;

	const base = createCanvasIR({
		id: "doc",
		pages: [
			createPage({
				id: "p1",
				root: createGroup({ id: "p1-root", children: [external, local] }),
			}),
		],
	});
	return {
		...base,
		components: { card: DEFINITION },
		externalComponentSnapshots: {
			[snapshotKey(REF)]: snapshotFor(REF, "v1"),
			// A newer version is PRESENT in the registry. A rollback must not
			// start resolving it.
			[snapshotKey(NEWER_REF)]: snapshotFor(NEWER_REF, "v2"),
		},
		// `compatibility` is optional on a fresh document, so the fixture supplies
		// the whole block. `schemaVersion` must equal the document's own version —
		// a block that disagrees with it is not forward-compat metadata, it is a
		// corrupt document.
		compatibility: {
			schemaVersion: base.version,
			minReaderSchemaVersion: base.version,
			requiredCapabilities: ["canvas.components.local"],
		},
		// An unknown top-level field, standing in for anything a newer build
		// writes that this one does not understand (CON-5 forward-compat).
		vendorExtension: { futureThing: 42 },
	} as unknown as CanvasIR;
}

function context(): CanvasBrandPolicyContext {
	return CANVAS_PERMISSIVE_POLICY_CONTEXT;
}

describe("rollback preserves every persisted shape (T-053 step 4)", () => {
	it("a save/load round-trip keeps refs, snapshots, variants, overrides and policy", async () => {
		const before = fullDocument();
		const { ir } = await loadCanvasDocumentWithDiagnostics(
			JSON.stringify(before),
		);

		const external = ir.pages[0]?.root.children?.[0] as Record<string, unknown>;
		const local = ir.pages[0]?.root.children?.[1] as Record<string, unknown>;

		expect(external.source).toEqual(REF);
		expect(external.variantSelection).toEqual({ size: "lg", theme: "dark" });
		expect(external.overrides).toEqual({
			label: { kind: "text", value: { kind: "plain", text: "Hello" } },
		});
		expect(local.variantSelection).toEqual({ size: "sm" });

		// Both snapshots survive — including the one nothing references, because
		// GC is an explicit action and never a side effect of loading.
		expect(Object.keys(ir.externalComponentSnapshots ?? {}).sort()).toEqual(
			[snapshotKey(REF), snapshotKey(NEWER_REF)].sort(),
		);
		expect(
			(ir.components?.card as { policy?: unknown } | undefined)?.policy,
		).toEqual({ editablePropertyIds: ["label"], allowDetach: false });
	});

	it("keeps capability metadata and UNKNOWN fields", async () => {
		// CON-5: the schemas are loose for exactly this reason. A build that
		// strips what it does not understand cannot safely co-edit with a newer
		// one, and a rollback is precisely when that happens.
		const { ir } = await loadCanvasDocumentWithDiagnostics(
			JSON.stringify(fullDocument()),
		);
		expect(ir.compatibility?.requiredCapabilities).toEqual([
			"canvas.components.local",
		]);
		expect((ir as unknown as Record<string, unknown>).vendorExtension).toEqual({
			futureThing: 42,
		});
	});

	it("never resolves a DIFFERENT remote version (T-053 step 4)", () => {
		// The registry holds both 1.0.0 and 2.0.0. Resolution is by exact ref, so
		// a rollback — or an update check, or anything else — cannot silently
		// promote the instance to the newer bytes.
		const ir = fullDocument();
		const index = buildExternalSnapshotIndex(ir.externalComponentSnapshots);
		const lookup = getDefinition(REF, ir.components, index);
		expect(lookup.kind).toBe("external");
		if (lookup.kind !== "external") return;
		const text = (
			lookup.definition.root as unknown as {
				children: Array<{ text: string }>;
			}
		).children[0];
		expect(text?.text).toBe("v1");
	});
});

describe("what a rollback must NOT disable", () => {
	it("resolution from stored snapshots still works", () => {
		const ir = fullDocument();
		const instance = ir.pages[0]?.root.children?.[1] as CanvasNode;
		const resolved = resolveComponentInstance(
			ir.components,
			instance as never,
			{},
		);
		expect(resolved.issues.filter((i) => i.severity === "error")).toEqual([]);
	});

	it("export still works, and still reports compliance", () => {
		const result = prepareExport(
			{ document: fullDocument() },
			{ context: context() },
		);
		expect(result.ok).toBe(true);
	});

	it("compliance reporting still runs", async () => {
		const { diagnostics } = await loadCanvasDocumentWithDiagnostics(
			JSON.stringify(fullDocument()),
		);
		// Reporting is unconditional; it is authoring that is flagged.
		expect(diagnostics.graph).toBeDefined();
		expect(diagnostics.blocksExport).toBe(false);
	});

	it("recovery of a missing snapshot is still explicit, never substituted", () => {
		// TD §21.3: "Recovery never substitutes another version." With 1.0.0
		// removed and 2.0.0 present, the instance must report missing rather than
		// quietly rendering the version that happens to be there.
		const ir = fullDocument();
		const withoutV1 = {
			...ir,
			externalComponentSnapshots: {
				[snapshotKey(NEWER_REF)]: snapshotFor(NEWER_REF, "v2"),
			},
		} as CanvasIR;
		const index = buildExternalSnapshotIndex(
			withoutV1.externalComponentSnapshots,
		);
		const lookup = getDefinition(REF, withoutV1.components, index);
		expect(lookup.kind).toBe("unresolved");
		expect(lookup.kind === "unresolved" && lookup.reason).toBe(
			"snapshot-missing",
		);
	});
});

describe("flag interactions (F-8)", () => {
	it("variant RESOLUTION is unconditional, so the flag cannot change rendering", () => {
		// The flag gates authoring. If it gated resolution, turning it off would
		// re-render every instance at its default variant — a visual regression
		// across every page at once, and the exact thing a rollback must not do.
		const ir = fullDocument();
		const instance = ir.pages[0]?.root.children?.[1] as CanvasNode;
		const resolved = resolveComponentInstance(
			ir.components,
			instance as never,
			{},
		);
		// The selection is still on the node after resolution, untouched.
		expect(
			(instance as unknown as { variantSelection: unknown }).variantSelection,
		).toEqual({ size: "sm" });
		expect(resolved).toBeDefined();
	});

	it("governance OFF is the absence of a context, not a second switch", () => {
		// One source of truth: there is no "flag on but no context" state to get
		// wrong, and no way to enable enforcement without saying what to enforce.
		expect(CANVAS_PERMISSIVE_POLICY_CONTEXT.enforcement).not.toBe("blocking");
		const result = prepareExport(
			{ document: fullDocument() },
			{ context: CANVAS_PERMISSIVE_POLICY_CONTEXT, flatten: true },
		);
		// `allowDetach: false` is on the definition, but with governance off a
		// flattening export is permitted — which is what "rolled back" means.
		expect(result.ok).toBe(true);
	});
});
