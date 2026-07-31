import {
	CANVAS_COMPONENTS_LOCAL_CAPABILITY,
	CANVAS_COMPONENTS_OVERRIDES_CAPABILITY,
	CANVAS_LAYOUT_AUTO_CAPABILITY,
	type CanvasIR,
	createCanvasIR,
	createPage,
	validateLayoutInvariants,
} from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import { unsupportedDeclaredCapabilities } from "@/persistence/load-pipeline.js";
import { decodeCanvasIR, unsupportedCapabilitiesOf } from "../encode.js";

/**
 * @file T-COMPAT-2 (plan 0023 M6-06, decision D-7, LC-COMPAT-002, INV-14).
 *
 * `CanvasNodeSchema` is a `discriminatedUnion`, so a document from a NEWER peer
 * fails validation outright and the whole remote document is discarded — an
 * older peer could destroy a newer peer's work. The pre-parse gate exists so a
 * binding can route to read-only preview instead, and it must answer WITHOUT
 * parsing (parsing is the thing that throws).
 */

function docDeclaring(capabilities: readonly string[]): CanvasIR {
	const ir = createCanvasIR({
		id: "doc",
		title: "t",
		pages: [createPage({ id: "p1" })],
		now: () => "2026-07-29T00:00:00.000Z",
	});
	return {
		...ir,
		compatibility: {
			schemaVersion: "3",
			minReaderSchemaVersion: "3",
			requiredCapabilities: [...capabilities],
		},
	};
}

describe("pre-parse capability gate (M6-06, D-7)", () => {
	it("reports a capability this build does not implement", () => {
		const raw = JSON.stringify(docDeclaring(["components.remote.v1"]));
		expect(unsupportedCapabilitiesOf(raw)).toEqual(["components.remote.v1"]);
	});

	it("passes a document declaring only implemented capabilities", () => {
		const raw = JSON.stringify(
			docDeclaring([
				CANVAS_LAYOUT_AUTO_CAPABILITY,
				CANVAS_COMPONENTS_LOCAL_CAPABILITY,
				CANVAS_COMPONENTS_OVERRIDES_CAPABILITY,
			]),
		);
		expect(unsupportedCapabilitiesOf(raw)).toEqual([]);
	});

	it("M6-06 flip: the two component capabilities are IMPLEMENTED now", () => {
		// M3-12 deliberately deferred this flip to M6. Before it, a
		// component-bearing document routed to read-only preview in this build.
		const ir = docDeclaring([
			CANVAS_COMPONENTS_LOCAL_CAPABILITY,
			CANVAS_COMPONENTS_OVERRIDES_CAPABILITY,
		]);
		expect(
			validateLayoutInvariants(ir).some(
				(issue) => issue.code === "layout-capability-unsupported",
			),
		).toBe(false);
	});

	it("answers WITHOUT parsing — the payload never has to be valid", () => {
		// A node kind this build lacks: `decodeCanvasIR` rejects the document
		// wholesale, which is exactly the discard D-7 exists to prevent. The gate
		// still answers, because it reads the declaration and nothing else.
		const raw = JSON.stringify({
			...docDeclaring(["components.remote.v1"]),
			pages: [
				{
					id: "p1",
					size: { width: 10, height: 10, unit: "px" },
					root: {
						id: "root",
						type: "some-future-kind",
						transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
						bounds: { width: 10, height: 10 },
						zIndex: 0,
						children: [],
					},
				},
			],
		});
		expect(unsupportedCapabilitiesOf(raw)).toEqual(["components.remote.v1"]);
		// Proof that the ordering matters: decoding the same payload throws.
		expect(() => decodeCanvasIR(raw)).toThrow();
	});

	it("treats malformed JSON as a parse problem, not a capability one", () => {
		// Mislabelling it would send a corrupt payload down the read-only-preview
		// path instead of surfacing a decode error.
		expect(unsupportedCapabilitiesOf("{not json")).toEqual([]);
	});

	it("is total over hostile shapes", () => {
		for (const payload of [
			null,
			undefined,
			42,
			"string",
			{},
			{ compatibility: null },
			{ compatibility: { requiredCapabilities: "not-an-array" } },
			{ compatibility: { requiredCapabilities: [1, 2, 3] } },
		]) {
			expect(() => unsupportedDeclaredCapabilities(payload)).not.toThrow();
			expect(unsupportedDeclaredCapabilities(payload)).toEqual([]);
		}
	});

	it("agrees with core's parsed-document invariant on an unsupported capability", () => {
		// Two implementations of "do we support this?" — the pre-parse mirror and
		// core's `layout-capability-unsupported` invariant — must never disagree,
		// or a document would preview as unsupported yet validate as fine.
		const ir = docDeclaring(["components.remote.v1"]);
		expect(unsupportedDeclaredCapabilities(ir)).toEqual([
			"components.remote.v1",
		]);
		expect(
			validateLayoutInvariants(ir).some(
				(issue) => issue.code === "layout-capability-unsupported",
			),
		).toBe(true);
	});
});
