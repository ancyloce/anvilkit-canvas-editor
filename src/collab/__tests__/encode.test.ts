import {
	type CanvasIR,
	createCanvasIR,
	createCanvasRuntime,
} from "@anvilkit/canvas-core";
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

	it("rejects a payload with an unsupported version (no migration path)", () => {
		const ir = createCanvasIR({ id: "ir-1" });
		// `decodeCanvasIR` migrates supported older versions forward (P0-8) — "9"
		// has no registered migration step, so it's still rejected.
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

	/**
	 * P0-8: previously this called `CanvasIRSchema.parse` directly — no
	 * migration — so an older supported document version was rejected outright.
	 * A v1 payload (a pure version-tag bump per core's v1->v2 migration) must
	 * now decode successfully through the default (no-`runtime`-argument) path.
	 */
	it("migrates a v1 payload to the current version by default", () => {
		const ir = createCanvasIR({ id: "ir-1", title: "legacy" });
		const v1Payload = JSON.stringify({ ...ir, version: "1" });
		const decoded = decodeCanvasIR(v1Payload);
		expect(decoded.version).toBe("2");
		expect(decoded.title).toBe("legacy");
	});

	/**
	 * P0-8: `decodeCanvasIR`'s optional `runtime` argument must actually be
	 * consulted, not silently ignored — proven here with a migration only THAT
	 * runtime knows about (a custom node-kind schema would prove the same thing
	 * but needs a `zod` schema instance, which this package does not depend on;
	 * core's own `canvas-runtime.test.ts` covers the custom-node-kind path).
	 */
	it("uses the passed runtime's own migration registry, not just the default", () => {
		const runtime = createCanvasRuntime([
			{
				id: "legacy-migration-ext",
				migrations: [
					{
						from: "legacy-v0",
						to: "1",
						up: (raw) => ({ ...(raw as object), version: "1" }),
					},
				],
			},
		]);
		const ir = createCanvasIR({ id: "ir-1", title: "ancient" });
		const legacyPayload = JSON.stringify({ ...ir, version: "legacy-v0" });

		// The default (no runtime) path has no "legacy-v0" step registered.
		expect(() => decodeCanvasIR(legacyPayload)).toThrow();

		// The runtime-aware path chains legacy-v0 -> 1 -> 2 and validates.
		const decoded = decodeCanvasIR(legacyPayload, runtime);
		expect(decoded.version).toBe("2");
		expect(decoded.title).toBe("ancient");
	});

	it("rejects a malformed payload safely even with a runtime supplied", () => {
		const runtime = createCanvasRuntime();
		expect(() => decodeCanvasIR("{ not json", runtime)).toThrow();
		const ir = createCanvasIR({ id: "ir-1" });
		expect(() =>
			decodeCanvasIR(JSON.stringify({ ...ir, pages: [] }), runtime),
		).toThrow();
	});
});
