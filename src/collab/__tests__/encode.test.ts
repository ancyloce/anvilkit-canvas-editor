import { type CanvasIR, createCanvasIR } from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import { decodeCanvasIR, encodeCanvasIR } from "../encode.js";

/** Rebuild an object graph with every plain-object's keys reversed, to prove
 *  the encoder's recursive key-sort produces an identical string regardless
 *  of insertion order. */
function reverseKeys<T>(value: T): T {
	if (Array.isArray(value)) return value.map(reverseKeys) as unknown as T;
	if (value !== null && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const key of Object.keys(value as object).reverse()) {
			out[key] = reverseKeys((value as Record<string, unknown>)[key]);
		}
		return out as T;
	}
	return value;
}

describe("encodeCanvasIR / decodeCanvasIR", () => {
	it("round-trips an IR to a deep-equal value", () => {
		const ir = createCanvasIR({ id: "ir-1", title: "Round trip" });
		const decoded = decodeCanvasIR(encodeCanvasIR(ir));
		expect(decoded).toEqual(ir);
	});

	it("is byte-stable across key insertion order (recursive sort)", () => {
		const ir = createCanvasIR({ id: "ir-1", ownerId: "u1", brandId: "b1" });
		const shuffled = reverseKeys(ir) as CanvasIR;
		expect(encodeCanvasIR(shuffled)).toBe(encodeCanvasIR(ir));
		// And the shuffled copy still decodes to the same logical IR.
		expect(decodeCanvasIR(encodeCanvasIR(shuffled))).toEqual(ir);
	});

	it("rejects a payload with the wrong version", () => {
		const ir = createCanvasIR({ id: "ir-1" });
		// `decodeCanvasIR` pins the CURRENT schema version and does not migrate, so
		// this must be a version the schema will never accept — not merely an older
		// one, and certainly not the current one.
		const bad = JSON.stringify({ ...ir, version: "9" });
		expect(() => decodeCanvasIR(bad)).toThrow();
	});

	it("rejects a structurally invalid IR (no pages)", () => {
		const ir = createCanvasIR({ id: "ir-1" });
		const bad = JSON.stringify({ ...ir, pages: [] });
		expect(() => decodeCanvasIR(bad)).toThrow();
	});

	it("rejects non-JSON input", () => {
		expect(() => decodeCanvasIR("{ not json")).toThrow();
	});
});
