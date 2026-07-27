import {
	CANVAS_IR_VERSION,
	createCanvasIR,
	createPage,
} from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import { decodeCanvasIR, encodeCanvasIR } from "../../collab/encode.js";
import { loadCanvasDocument } from "../load-pipeline.js";

const FIXED_TS = "2026-07-27T00:00:00.000Z";

function makeIR() {
	return createCanvasIR({
		id: "doc-1",
		title: "t",
		pages: [createPage({ id: "p1" })],
		now: () => FIXED_TS,
	});
}

/**
 * @file T-M0-04 (plan 0022 M0) — the editor's single document-load pipeline.
 *
 * The defect this closes: `CanvasPersistenceAdapter.load` was declared but
 * never called, and the recovery controller restored snapshots with no parse
 * and no migration. Both meant a persisted document could enter the editor
 * without passing through `migrateCanvasIR` — which is precisely the seam the
 * IR v3 work in M1 hangs on.
 */
describe("loadCanvasDocument (T-M0-04)", () => {
	it("accepts an already-parsed document (the adapter.load shape)", () => {
		// `CanvasPersistenceAdapter.load` resolves a CanvasIR object, not text.
		const loaded = loadCanvasDocument(makeIR());
		expect(loaded.id).toBe("doc-1");
		expect(loaded.version).toBe(CANVAS_IR_VERSION);
	});

	it("accepts JSON text (the recovery / collab shape)", () => {
		const loaded = loadCanvasDocument(JSON.stringify(makeIR()));
		expect(loaded.id).toBe("doc-1");
		expect(loaded.version).toBe(CANVAS_IR_VERSION);
	});

	it("forward-migrates an older document version", () => {
		// A v1 document is exactly what a host's stored document or a stale
		// recovery snapshot looks like after the app ships a new IR version.
		const legacy = { ...makeIR(), version: "1" };
		const loaded = loadCanvasDocument(legacy);
		expect(loaded.version).toBe(CANVAS_IR_VERSION);
		// Migration must be geometry-preserving, not merely accepted.
		expect(loaded.pages[0]?.id).toBe("p1");
	});

	it("throws on malformed JSON rather than returning a partial document", () => {
		expect(() => loadCanvasDocument("{not json")).toThrow();
	});

	it("throws on a structurally invalid document", () => {
		// The Zod validation at the end of migration is the barrier that stops
		// a corrupt or hostile payload reaching the scene.
		expect(() => loadCanvasDocument({ version: CANVAS_IR_VERSION })).toThrow();
		expect(() => loadCanvasDocument(null)).toThrow();
	});

	it("throws on an unsupported future version", () => {
		expect(() => loadCanvasDocument({ ...makeIR(), version: "999" })).toThrow();
	});

	it("is the implementation the collab decoder uses", () => {
		// T-M0-05's DoD: no second migration implementation exists in the
		// editor. If `decodeCanvasIR` ever grows its own parse+migrate again,
		// the two paths can diverge on the next IR version — so pin that they
		// agree, including on an old version that only migration can accept.
		const legacy = JSON.stringify({ ...makeIR(), version: "1" });
		expect(decodeCanvasIR(legacy)).toEqual(loadCanvasDocument(legacy));
	});

	it("round-trips an encoded document through the shared pipeline", () => {
		const ir = makeIR();
		expect(loadCanvasDocument(encodeCanvasIR(ir))).toEqual(ir);
	});
});
