import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
	CanvasComponentDefinition,
	CanvasIR,
} from "@anvilkit/canvas-core";
import {
	createCanvasIR,
	createComponentInstance,
	createGroup,
	createPage,
	createRect,
} from "@anvilkit/canvas-core";
import type { CanvasBrandPolicyContext } from "@anvilkit/canvas-core/brand-governance";
import { prepareExport } from "@anvilkit/canvas-core/export-preparation";
import { describe, expect, it } from "vitest";
import type { CanvasT } from "../../context/canvas-studio-context.js";
import { exportPreparationMessage } from "../export-preparation-message.js";
import { RASTER_FORMATS } from "../export-runner.js";

/**
 * T-046 — the Editor's export preflight.
 *
 * M4 closed AC-010 for override and detach but left flatten and export without
 * a call site; this is that call site. The behavioural assertions drive
 * `prepareExport` with exactly the arguments `ExportDialog` passes, and one
 * source assertion pins the wiring so a future refactor cannot quietly drop the
 * preflight and still pass the behavioural half.
 */

const t: CanvasT = (_key, fallback) => fallback ?? "";

const DEFINITION = {
	id: "card",
	name: "Card",
	revision: 1,
	root: createGroup({
		id: "card-root",
		children: [
			createRect({ id: "card-inner", bounds: { width: 4, height: 4 } }),
		],
	}),
	properties: [],
} as unknown as CanvasComponentDefinition;

function context(): CanvasBrandPolicyContext {
	return {
		enforcement: "blocking",
		capabilities: {
			canEditOverrides: true,
			canChangeVariant: true,
			canDetach: true,
			canFlatten: true,
			canInsertExternalComponents: true,
			canUpdateComponents: true,
		},
	};
}

function doc(policy?: Record<string, unknown>): CanvasIR {
	const instance = createComponentInstance({
		id: "inst-1",
		componentId: "card",
		bounds: { width: 10, height: 10 },
	});
	return {
		...createCanvasIR({
			id: "doc",
			pages: [
				createPage({
					id: "p1",
					root: createGroup({ id: "p1-root", children: [instance] }),
				}),
			],
		}),
		components: {
			card: { ...DEFINITION, ...(policy ? { policy } : {}) },
		},
	} as CanvasIR;
}

describe("the preflight blocks a flattening export the policy forbids", () => {
	it("refuses PNG but allows SVG for the same document", () => {
		const ir = doc({ allowFlatten: false });
		// Every raster format flattens; that is why the dialog asks per format
		// rather than refusing the document outright.
		for (const format of ["png", "jpeg", "webp"] as const) {
			expect(RASTER_FORMATS.has(format)).toBe(true);
			const result = prepareExport(
				{ document: ir },
				{ context: context(), flatten: RASTER_FORMATS.has(format) },
			);
			expect(result.ok).toBe(false);
			expect(result.ok === false && result.code).toBe("flatten-denied");
		}
		const svg = prepareExport(
			{ document: ir },
			{ context: context(), flatten: RASTER_FORMATS.has("svg") },
		);
		expect(svg.ok).toBe(true);
	});

	it("allows every format when policy permits flattening", () => {
		for (const format of ["png", "svg", "pdf", "json"] as const) {
			expect(
				prepareExport(
					{ document: doc() },
					{ context: context(), flatten: RASTER_FORMATS.has(format) },
				).ok,
			).toBe(true);
		}
	});

	it("refuses when a snapshot was quarantined at load", () => {
		const ir = { ...doc(), components: {} } as CanvasIR;
		const result = prepareExport({ document: ir }, { context: context() });
		expect(result.ok === false && result.code).toBe("component-unresolved");
	});
});

describe("refusal copy", () => {
	it("is localized from the stable code, never the developer message", () => {
		// `CanvasExportPreparation.message` names instance ids and counts. Showing
		// it to a content operator is unhelpful and, for `component-unresolved`,
		// discloses the document's library structure.
		const ir = doc({ allowFlatten: false });
		const result = prepareExport(
			{ document: ir },
			{ context: context(), flatten: true },
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		const shown = exportPreparationMessage(t, result.code);
		expect(shown).not.toBe(result.message);
		expect(shown).not.toContain("inst-1");
	});

	it("covers every refusal code", () => {
		for (const code of [
			"component-unresolved",
			"flatten-denied",
			"document-ref-unresolved",
			"document-invalid",
		] as const) {
			expect(exportPreparationMessage(t, code).length).toBeGreaterThan(0);
		}
	});
});

describe("the wiring itself (regression guard)", () => {
	const source = readFileSync(
		join(__dirname, "..", "ExportDialog.tsx"),
		"utf8",
	);

	it("runs the preflight BEFORE producing any artifact", () => {
		// Refusing after rendering would mean the blocked bytes had already
		// existed. Order is the assertion.
		const preflight = source.indexOf("prepareExport(");
		const firstRender = source.indexOf("renderPageArtifact({");
		expect(preflight).toBeGreaterThan(-1);
		expect(firstRender).toBeGreaterThan(-1);
		expect(preflight).toBeLessThan(firstRender);
	});

	it("passes the flatten flag from the format, not a constant", () => {
		expect(source).toContain("flatten: RASTER_FORMATS.has(format)");
	});

	it("threads the host's quarantined keys through", () => {
		expect(source).toContain("ctx.quarantinedSnapshotKeys");
	});
});
