import type {
	CanvasComponentDefinition,
	CanvasIR,
} from "@anvilkit/canvas-core";
import {
	createCanvasIR,
	createComponentInstance,
	createGroup,
	createPage,
	createText,
} from "@anvilkit/canvas-core";
import { snapshotKey } from "@anvilkit/canvas-core/component-libraries";
import { describe, expect, it } from "vitest";

import { loadCanvasDocumentWithDiagnostics } from "../load-pipeline.js";

/**
 * T-045 — the §21.1 pipeline as a whole.
 *
 * The single most important assertion in this file is that a document with a
 * bad snapshot still MOUNTS. Everything else is about not losing information on
 * the way there.
 */

const DEFINITION = {
	id: "card",
	name: "Card",
	revision: 1,
	root: createGroup({
		id: "card-root",
		children: [
			createText({ id: "card-inner", text: "Label", bounds: { width: 4, height: 4 } }),
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
} as unknown as CanvasComponentDefinition;

const REF = {
	kind: "library" as const,
	libraryId: "acme",
	componentId: "card",
	version: "1.0.0",
	integrity: `sha256-${"A".repeat(43)}`,
};

function baseDoc(over: Partial<CanvasIR> = {}): CanvasIR {
	return {
		...createCanvasIR({
			id: "doc",
			pages: [
				createPage({
					id: "p1",
					root: createGroup({ id: "p1-root", children: [] }),
				}),
			],
		}),
		...over,
	} as CanvasIR;
}

/** The verifier a hostile/corrupt document would fail. */
const FAILING = { verify: () => Promise.resolve(false) };

describe("loadCanvasDocumentWithDiagnostics — §21.1 order", () => {
	it("mounts a clean document with no findings", async () => {
		const { ir, diagnostics } = await loadCanvasDocumentWithDiagnostics(
			baseDoc(),
		);
		expect(ir.id).toBe("doc");
		expect(diagnostics.quarantinedKeys).toEqual([]);
		expect(diagnostics.graph).toEqual([]);
		expect(diagnostics.policy).toEqual([]);
		expect(diagnostics.blocksExport).toBe(false);
	});

	it("accepts a JSON STRING as well as an object", async () => {
		const { ir } = await loadCanvasDocumentWithDiagnostics(
			JSON.stringify(baseDoc()),
		);
		expect(ir.id).toBe("doc");
	});

	it("STILL MOUNTS when a snapshot fails verification (T-045 step 3)", async () => {
		// The whole point. A bad snapshot degrades one instance; it must never
		// cost the user the document.
		const key = snapshotKey(REF);
		const instance = {
			...createComponentInstance({
				id: "inst-1",
				componentId: "card",
				bounds: { width: 10, height: 10 },
			}),
			source: REF,
		};
		const doc = baseDoc({
			pages: [
				createPage({
					id: "p1",
					root: createGroup({ id: "p1-root", children: [instance] }),
				}),
			],
			externalComponentSnapshots: {
				[key]: {
					canonicalFormatVersion: 1,
					ref: REF,
					definition: DEFINITION,
					dependencies: [],
				},
			},
		} as Partial<CanvasIR>);

		const { ir, diagnostics } = await loadCanvasDocumentWithDiagnostics(doc, {
			verifier: FAILING,
			origin: "imported",
		});

		expect(ir.pages).toHaveLength(1);
		expect(diagnostics.quarantinedKeys).toEqual([key]);
		expect(diagnostics.integrity[0]?.code).toBe("component-integrity-mismatch");
		// And it blocks export until recovered or removed.
		expect(diagnostics.blocksExport).toBe(true);
		// The snapshot is quarantined, NOT deleted — the exact ref is what the
		// Libraries panel needs in order to re-fetch the right version.
		expect(ir.externalComponentSnapshots?.[key]).toBeDefined();
	});

	it("still throws for a payload that is not a document at all", async () => {
		// The distinction this file exists to draw: a document with something
		// wrong INSIDE it mounts; a payload that is not a document cannot.
		await expect(
			loadCanvasDocumentWithDiagnostics("{not json"),
		).rejects.toThrow();
		await expect(
			loadCanvasDocumentWithDiagnostics({ nope: true }),
		).rejects.toThrow();
	});

	it("reports a policy that no longer validates rather than dropping it", async () => {
		// Dropping would quietly REMOVE a restriction — the failure direction
		// that matters. A policy naming a property the component no longer has is
		// the shape most likely to survive an update.
		const doc = baseDoc({
			components: {
				card: {
					...DEFINITION,
					policy: { editablePropertyIds: ["a-property-that-was-removed"] },
				},
			},
		} as Partial<CanvasIR>);
		const { ir, diagnostics } = await loadCanvasDocumentWithDiagnostics(doc);
		expect(diagnostics.policy).toEqual(["card"]);
		expect(diagnostics.blocksExport).toBe(true);
		// Reported, and still present in the document.
		expect(
			(ir.components?.card as { policy?: unknown } | undefined)?.policy,
		).toBeDefined();
	});

	it("a valid policy produces no finding", async () => {
		const doc = baseDoc({
			components: {
				card: { ...DEFINITION, policy: { editablePropertyIds: ["label"] } },
			},
		} as Partial<CanvasIR>);
		const { diagnostics } = await loadCanvasDocumentWithDiagnostics(doc);
		expect(diagnostics.policy).toEqual([]);
		expect(diagnostics.blocksExport).toBe(false);
	});

	it("a graph WARNING does not block export", async () => {
		// An orphaned override is a normal state of a living document; blocking
		// on it would make the editor unusable.
		const instance = {
			...createComponentInstance({
				id: "inst-1",
				componentId: "card",
				bounds: { width: 10, height: 10 },
			}),
			overrides: {
				"no-such-property": {
					kind: "text",
					value: { kind: "plain", text: "x" },
				},
			},
		};
		const doc = baseDoc({
			components: { card: DEFINITION },
			pages: [
				createPage({
					id: "p1",
					root: createGroup({ id: "p1-root", children: [instance] }),
				}),
			],
		} as Partial<CanvasIR>);
		const { diagnostics } = await loadCanvasDocumentWithDiagnostics(doc);
		expect(diagnostics.graph.some((i) => i.severity === "warning")).toBe(true);
		expect(diagnostics.graph.some((i) => i.severity === "error")).toBe(false);
		expect(diagnostics.blocksExport).toBe(false);
	});

	it("does not verify a host-persisted document by default", async () => {
		const key = snapshotKey(REF);
		const doc = baseDoc({
			externalComponentSnapshots: {
				[key]: {
					canonicalFormatVersion: 1,
					ref: REF,
					definition: DEFINITION,
					dependencies: [],
				},
			},
		} as Partial<CanvasIR>);
		const { diagnostics } = await loadCanvasDocumentWithDiagnostics(doc, {
			verifier: FAILING,
		});
		expect(diagnostics.verifiedCount).toBe(0);
		expect(diagnostics.quarantinedKeys).toEqual([]);
	});
});

describe("save/recovery preserves everything (T-045 DoD)", () => {
	it("round-trips refs, snapshots, variants, overrides and policy", async () => {
		const key = snapshotKey(REF);
		const instance = {
			...createComponentInstance({
				id: "inst-1",
				componentId: "card",
				bounds: { width: 10, height: 10 },
			}),
			source: REF,
			variantSelection: { size: "lg" },
			overrides: {
				label: { kind: "text", value: { kind: "plain", text: "Hi" } },
			},
		};
		const original = baseDoc({
			components: {
				card: { ...DEFINITION, policy: { editablePropertyIds: ["label"] } },
			},
			pages: [
				createPage({
					id: "p1",
					root: createGroup({ id: "p1-root", children: [instance] }),
				}),
			],
			externalComponentSnapshots: {
				[key]: {
					canonicalFormatVersion: 1,
					ref: REF,
					definition: DEFINITION,
					dependencies: [],
				},
			},
		} as Partial<CanvasIR>);

		// Through the real serialization boundary, not a structuredClone.
		const { ir } = await loadCanvasDocumentWithDiagnostics(
			JSON.stringify(original),
		);

		const loaded = ir.pages[0]?.root.children?.[0] as Record<string, unknown>;
		expect(loaded.source).toEqual(REF);
		expect(loaded.variantSelection).toEqual({ size: "lg" });
		expect(loaded.overrides).toEqual(instance.overrides);
		expect(ir.externalComponentSnapshots?.[key]?.ref).toEqual(REF);
		expect(
			(ir.components?.card as { policy?: unknown } | undefined)?.policy,
		).toEqual({ editablePropertyIds: ["label"] });
	});
});
