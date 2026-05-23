import {
	type CanvasIR,
	type CanvasNodeUpdateCommand,
	createCanvasIR,
	createPage,
	createPath,
	createRect,
} from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import { makeHarness } from "../../tools/__tests__/_tool-test-helpers.js";
import {
	beginPathEdit,
	commitPathD,
	endPathEdit,
} from "../path-edit-actions.js";

function pathIR(): CanvasIR {
	const page = createPage({ id: "p1" });
	page.root.children = [
		createPath({
			id: "path-a",
			bounds: { width: 10, height: 10 },
			d: "M 0 0 L 10 0",
		}),
		createRect({ id: "rect-a", bounds: { width: 10, height: 10 } }),
	];
	return createCanvasIR({ id: "ir", pages: [page] });
}

describe("beginPathEdit", () => {
	it("enters edit mode for a path node", () => {
		const h = makeHarness({ ir: pathIR() });
		expect(beginPathEdit(h.studioCtx, "path-a")).toBe(true);
		expect(h.studioCtx.pathEditStore?.getState().editNodeId).toBe("path-a");
	});

	it("is a no-op for a non-path node", () => {
		const h = makeHarness({ ir: pathIR() });
		expect(beginPathEdit(h.studioCtx, "rect-a")).toBe(false);
		expect(h.studioCtx.pathEditStore?.getState().editNodeId).toBeNull();
	});
});

describe("commitPathD", () => {
	it("commits a node.update with the new d", () => {
		const h = makeHarness({ ir: pathIR() });
		commitPathD(h.studioCtx, "path-a", "M 0 0 L 20 0 Z");
		expect(h.commits).toHaveLength(1);
		const cmd = h.commits[0] as CanvasNodeUpdateCommand<"path">;
		expect(cmd.type).toBe("node.update");
		expect(cmd.kind).toBe("path");
		expect((cmd.patch as { d?: string }).d).toBe("M 0 0 L 20 0 Z");
	});

	it("ignores an empty d", () => {
		const h = makeHarness({ ir: pathIR() });
		commitPathD(h.studioCtx, "path-a", "");
		expect(h.commits).toHaveLength(0);
	});
});

describe("endPathEdit", () => {
	it("clears the edit mode", () => {
		const h = makeHarness({ ir: pathIR() });
		beginPathEdit(h.studioCtx, "path-a");
		endPathEdit(h.studioCtx);
		expect(h.studioCtx.pathEditStore?.getState().editNodeId).toBeNull();
	});
});
