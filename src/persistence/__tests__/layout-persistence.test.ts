import type { CanvasIR, CanvasNode } from "@anvilkit/canvas-core";
import {
	applyCommand,
	createCanvasIR,
	createFrame,
	createPage,
	createRect,
	insertNode,
} from "@anvilkit/canvas-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHistoryStore } from "@/stores/history-store.js";
import { createSaveStatusStore } from "@/stores/save-status-store.js";
import {
	isDocumentCapabilityReadOnly,
	withRequiredLayoutCapability,
} from "../layout-compatibility.js";
import { loadCanvasDocument } from "../load-pipeline.js";
import { createRecoveryController } from "../recovery.js";
import { createSaveController } from "../save-controller.js";
import { prepareDocumentForSave } from "../save-pipeline.js";
import type { CanvasSaveInput } from "../types.js";

/**
 * @file T-M5-03 (TS-52, NFR-REL-003, AC-001, AC-010, AC-013) — the
 * persistence boundary completes and stamps layout documents, recovery
 * mirrors stay capability-complete, and unsupported-capability documents
 * gate as read-only. Fixture 7's full journey (save → recover → migrate →
 * edit → export) runs at the bottom.
 */

const FIXED_TS = "2026-07-28T00:00:00.000Z";

const LAYOUT = {
	version: 1,
	direction: "horizontal",
	padding: { top: 0, right: 0, bottom: 0, left: 0 },
	gap: 10,
	primaryAlign: "start",
	crossAlign: "start",
} as const;

function layoutIr(): CanvasIR {
	const frame: CanvasNode = {
		...createFrame({ id: "f1", bounds: { width: 200, height: 100 } }),
		autoLayout: LAYOUT,
		children: [
			createRect({ id: "r1", bounds: { width: 40, height: 20 } }),
			createRect({ id: "r2", bounds: { width: 40, height: 20 } }),
		],
	} as CanvasNode;
	const page = createPage({ id: "p1" });
	let ir = createCanvasIR({
		id: "journey-doc",
		title: "journey",
		pages: [page],
		now: () => FIXED_TS,
	});
	ir = insertNode(ir, { parentId: page.root.id, node: frame });
	// NFR-COMPAT-001: unknown keys must survive every hop of the journey.
	return { ...ir, vendorExtension: { theme: "spring" } } as CanvasIR;
}

function plainIr(): CanvasIR {
	const page = createPage({ id: "p1" });
	let ir = createCanvasIR({ id: "plain", pages: [page], now: () => FIXED_TS });
	ir = insertNode(ir, {
		parentId: page.root.id,
		node: createRect({ id: "solo", bounds: { width: 10, height: 10 } }),
	});
	return ir;
}

describe("withRequiredLayoutCapability", () => {
	it("declares layout.auto.v1 for a layout-bearing document", () => {
		const complete = withRequiredLayoutCapability(layoutIr());
		expect(complete.compatibility?.requiredCapabilities).toEqual([
			"layout.auto.v1",
		]);
		expect(complete.compatibility?.schemaVersion).toBe(complete.version);
	});

	it("is a reference-identical no-op for plain documents and already-complete ones", () => {
		const plain = plainIr();
		expect(withRequiredLayoutCapability(plain)).toBe(plain);
		const complete = withRequiredLayoutCapability(layoutIr());
		expect(withRequiredLayoutCapability(complete)).toBe(complete);
	});

	it("preserves existing capabilities and compatibility fields", () => {
		const ir = {
			...layoutIr(),
			compatibility: {
				schemaVersion: "3",
				minReaderSchemaVersion: "2",
				requiredCapabilities: ["vendor.custom.v1"],
			},
		} as CanvasIR;
		const complete = withRequiredLayoutCapability(ir);
		expect(complete.compatibility?.requiredCapabilities).toEqual([
			"vendor.custom.v1",
			"layout.auto.v1",
		]);
		expect(complete.compatibility?.minReaderSchemaVersion).toBe("2");
	});
});

describe("isDocumentCapabilityReadOnly (AC-010)", () => {
	it("gates documents declaring an unimplemented capability", () => {
		const ir = {
			...layoutIr(),
			compatibility: {
				schemaVersion: "3",
				minReaderSchemaVersion: "3",
				requiredCapabilities: ["layout.auto.v1", "test.future.v9"],
			},
		} as CanvasIR;
		expect(isDocumentCapabilityReadOnly(ir)).toBe(true);
	});

	it("passes documents whose capabilities this build implements", () => {
		expect(
			isDocumentCapabilityReadOnly(withRequiredLayoutCapability(layoutIr())),
		).toBe(false);
		expect(isDocumentCapabilityReadOnly(plainIr())).toBe(false);
	});
});

describe("prepareDocumentForSave", () => {
	it("completes the capability and writes the materialization stamp with the save revision", () => {
		const saved = prepareDocumentForSave(layoutIr(), 7);
		expect(saved.compatibility?.requiredCapabilities).toEqual([
			"layout.auto.v1",
		]);
		expect(saved.layoutMaterialization).toMatchObject({
			engineVersion: 1,
			resolvedAtRevision: 7,
		});
		expect(typeof saved.layoutMaterialization?.inputHash).toBe("string");
		// Geometry materialized: r2 sits at its flow position (40 + gap 10).
		const frame = saved.pages[0]?.root.children[0] as CanvasNode & {
			children: CanvasNode[];
			autoLayout?: unknown;
		};
		expect(frame.children[1]?.transform.x).toBe(50);
		// Intent is never discarded to satisfy an old writer.
		expect(frame.autoLayout).toEqual(LAYOUT);
		expect(
			(saved as unknown as Record<string, unknown>).vendorExtension,
		).toEqual({ theme: "spring" });
	});

	it("returns plain documents by reference — no layout, no work", () => {
		const plain = plainIr();
		expect(prepareDocumentForSave(plain, 3)).toBe(plain);
	});
});

describe("save controller ships the prepared document", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("adapter.save receives a capability-complete, stamped document", async () => {
		const ir = layoutIr();
		const historyStore = createHistoryStore({ now: () => FIXED_TS });
		const calls: CanvasSaveInput[] = [];
		const controller = createSaveController({
			adapter: {
				save: async (input) => {
					calls.push(input);
					return { savedAt: FIXED_TS };
				},
			},
			getIR: () => ir,
			historyStore,
			saveStatusStore: createSaveStatusStore(),
		});
		await controller.save();
		controller.dispose();
		expect(calls).toHaveLength(1);
		const saved = calls[0]?.ir;
		expect(saved?.compatibility?.requiredCapabilities).toEqual([
			"layout.auto.v1",
		]);
		expect(saved?.layoutMaterialization?.resolvedAtRevision).toBe(
			calls[0]?.revision,
		);
	});
});

describe("recovery mirror stays capability-complete", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("written snapshots declare the capability without a stamp", async () => {
		const ir = layoutIr();
		const historyStore = createHistoryStore({ now: () => FIXED_TS });
		const written: CanvasIR[] = [];
		const controller = createRecoveryController({
			adapter: {
				write: async (snapshot) => {
					written.push(snapshot.ir);
				},
				read: async () => null,
				clear: async () => undefined,
			},
			getIR: () => ir,
			historyStore,
			saveStatusStore: createSaveStatusStore(),
		});
		historyStore.getState().commit(ir, {
			type: "node.move",
			nodeId: "r1",
			from: { x: 0, y: 0 },
			to: { x: 1, y: 0 },
		});
		await vi.advanceTimersByTimeAsync(2500);
		controller.dispose();
		expect(written.length).toBeGreaterThan(0);
		expect(written[0]?.compatibility?.requiredCapabilities).toEqual([
			"layout.auto.v1",
		]);
		// The mirror is NOT materialized — restore re-resolves.
		expect(written[0]?.layoutMaterialization).toBeUndefined();
	});
});

describe("fixture 7 — save → recover → migrate → edit → export (TS-52)", () => {
	it("preserves intent, capability, and unknown keys end-to-end", async () => {
		// SAVE: the document leaves the session complete and stamped.
		const saved = prepareDocumentForSave(layoutIr(), 11);

		// RECOVER + MIGRATE: the load pipeline parses/migrates the raw text
		// exactly as mount and recovery restore do (one shared seam).
		const recovered = loadCanvasDocument(JSON.stringify(saved));
		expect(recovered).toEqual(saved);
		expect(
			(recovered as unknown as Record<string, unknown>).vendorExtension,
		).toEqual({ theme: "spring" });

		// EDIT: any command clears the stamp by construction — intent stays.
		const edited = applyCommand(recovered, {
			type: "node.move",
			nodeId: "r1",
			from: { x: 0, y: 0 },
			to: { x: 5, y: 5 },
		}).ir;
		expect(edited.layoutMaterialization).toBeUndefined();
		const frame = edited.pages[0]?.root.children[0] as CanvasNode & {
			autoLayout?: unknown;
		};
		expect(frame.autoLayout).toEqual(LAYOUT);
		expect(edited.compatibility?.requiredCapabilities).toEqual([
			"layout.auto.v1",
		]);

		// EXPORT: the SVG exporter resolves the edited document itself and
		// emits resolved flow geometry with no LAYOUT_UNRESOLVED warning.
		const { svgExporter } = await import("@/header/exporters.js");
		const artifact = await svgExporter(
			{ ir: edited, activePageId: "p1" } as Parameters<typeof svgExporter>[0],
			{} as Parameters<typeof svgExporter>[1],
		);
		expect(artifact.warnings?.map((w) => w.code) ?? []).not.toContain(
			"LAYOUT_UNRESOLVED",
		);
		expect(String(artifact.data)).toContain("translate(50 0)");
	});
});
