import { describe, expect, it } from "vitest";
import { shouldReturnToSelect } from "../tool-completion.js";

const CREATE = { type: "node.create", node: {}, pageId: "p1" } as never;
const MOVE = { type: "node.move" } as never;

describe("shouldReturnToSelect (FR-012)", () => {
	it("returns to Select after a creation commit from a creation tool", () => {
		expect(shouldReturnToSelect([CREATE], "rect", false)).toBe(true);
		expect(shouldReturnToSelect([CREATE], "text", false)).toBe(true);
	});

	it("detects node.create inside nested batches", () => {
		const batch = { type: "batch", commands: [MOVE, CREATE] } as never;
		expect(shouldReturnToSelect([batch], "path", false)).toBe(true);
	});

	it("stays put for continuous creation, mode tools, and non-create commits", () => {
		expect(shouldReturnToSelect([CREATE], "rect", true)).toBe(false);
		expect(shouldReturnToSelect([CREATE], "select", false)).toBe(false);
		expect(shouldReturnToSelect([CREATE], "hand", false)).toBe(false);
		expect(shouldReturnToSelect([MOVE], "rect", false)).toBe(false);
	});
});
