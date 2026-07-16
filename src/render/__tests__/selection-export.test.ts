import { createGroup, createPage, createRect } from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import { buildSelectionExportPage } from "../selection-export.js";

describe("buildSelectionExportPage (FR-031 export selection)", () => {
	function page() {
		return createPage({
			id: "p1",
			root: createGroup({
				id: "root",
				bounds: { width: 500, height: 500 },
				children: [
					createRect({
						id: "a",
						bounds: { width: 40, height: 30 },
						transform: { x: 100, y: 100 },
					}),
					createRect({
						id: "b",
						bounds: { width: 20, height: 20 },
						transform: { x: 200, y: 160 },
					}),
				],
			}),
		});
	}

	it("returns null when nothing is selected", () => {
		expect(buildSelectionExportPage(page(), [])).toBeNull();
	});

	it("frames the page to the selection's combined AABB and shifts to origin", () => {
		const result = buildSelectionExportPage(page(), ["a", "b"]);
		expect(result).not.toBeNull();
		// AABB: x 100..220, y 100..180 → 120 × 80.
		expect(result?.size.width).toBe(120);
		expect(result?.size.height).toBe(80);
		const [a, b] = result?.root.children ?? [];
		expect(a?.transform.x).toBe(0);
		expect(a?.transform.y).toBe(0);
		expect(b?.transform.x).toBe(100);
		expect(b?.transform.y).toBe(60);
	});

	it("drops unselected siblings", () => {
		const result = buildSelectionExportPage(page(), ["b"]);
		expect(result?.root.children).toHaveLength(1);
		expect(result?.root.children[0]?.id).toBe("b");
		expect(result?.size.width).toBe(20);
		expect(result?.size.height).toBe(20);
	});

	it("keeps a selected node's whole subtree via its container", () => {
		const nested = createPage({
			id: "p2",
			root: createGroup({
				id: "root2",
				bounds: { width: 500, height: 500 },
				children: [
					createGroup({
						id: "g",
						bounds: { width: 100, height: 100 },
						transform: { x: 50, y: 50 },
						children: [
							createRect({ id: "child", bounds: { width: 10, height: 10 } }),
						],
					}),
				],
			}),
		});
		const result = buildSelectionExportPage(nested, ["g"]);
		expect(result?.root.children).toHaveLength(1);
		const group = result?.root.children[0];
		expect(group?.id).toBe("g");
		expect(group?.type).toBe("group");
	});
});
