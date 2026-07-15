import {
	type CanvasIR,
	createCanvasIR,
	createGroup,
	createPage,
	createRect,
	createText,
} from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import { summarizeSelection } from "../selection-summary.js";

const FIXED_TS = "2026-05-20T00:00:00.000Z";

function fixtureIR(): CanvasIR {
	const page = createPage({ id: "p1" });
	page.root = createGroup({
		id: "p1-root",
		bounds: page.root.bounds,
		children: [
			createRect({ id: "r1" }),
			createRect({ id: "r2" }),
			createText({ id: "t1", text: "hi" }),
		],
	});
	return createCanvasIR({ id: "ir", pages: [page], now: () => FIXED_TS });
}

describe("summarizeSelection", () => {
	it("empty selection → mode none, no primary", () => {
		const s = summarizeSelection(fixtureIR(), []);
		expect(s.mode).toBe("none");
		expect(s.primary).toBeNull();
		expect(s.nodes).toHaveLength(0);
		expect(s.sharedKind).toBeNull();
	});

	it("single selection → mode single, primary is the node", () => {
		const s = summarizeSelection(fixtureIR(), ["r1"]);
		expect(s.mode).toBe("single");
		expect(s.primary?.id).toBe("r1");
		expect(s.sharedKind).toBe("rect");
	});

	it("multi same-kind selection → shared kind, primary stays FIRST selected (pre-B-12 semantics)", () => {
		const s = summarizeSelection(fixtureIR(), ["r2", "r1"]);
		expect(s.mode).toBe("multi");
		expect(s.primary?.id).toBe("r2");
		expect(s.nodes.map((n) => n.id)).toEqual(["r2", "r1"]);
		expect(s.sharedKind).toBe("rect");
	});

	it("mixed-kind selection → kinds set, null sharedKind", () => {
		const s = summarizeSelection(fixtureIR(), ["r1", "t1"]);
		expect(s.mode).toBe("multi");
		expect([...s.kinds].sort()).toEqual(["rect", "text"]);
		expect(s.sharedKind).toBeNull();
	});

	it("unknown ids are dropped; all-unknown behaves as none", () => {
		const some = summarizeSelection(fixtureIR(), ["nope", "r1"]);
		expect(some.mode).toBe("single");
		expect(some.primary?.id).toBe("r1");
		const none = summarizeSelection(fixtureIR(), ["nope"]);
		expect(none.mode).toBe("none");
		expect(none.primary).toBeNull();
	});
});
