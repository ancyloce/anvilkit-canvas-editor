import { type CanvasNode, createLine, createRect } from "@anvilkit/canvas-core";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	formatDashPattern,
	parseDashPattern,
	StrokeFields,
} from "../stroke-section.js";

afterEach(cleanup);

/**
 * FR-075 stroke cap/join/arrow pickers (`@anvilkit/ui/select`, Base UI): a
 * plain `fireEvent.click` on an option does NOT reach Base UI's internal
 * selection handler in jsdom — it needs a real pointer down+up sequence
 * first. No other test in this repo exercises this Select component yet, so
 * this pattern is established here.
 */
async function selectOption(
	triggerTestId: string,
	optionName: string,
): Promise<void> {
	fireEvent.click(screen.getByTestId(triggerTestId));
	const option = await screen.findByRole("option", { name: optionName });
	fireEvent.pointerDown(option, { pointerId: 1, button: 0 });
	fireEvent.pointerUp(option, { pointerId: 1, button: 0 });
	fireEvent.click(option);
}

function lastPatch(
	commitPatchAll: ReturnType<typeof vi.fn>,
	node: CanvasNode,
): Record<string, unknown> {
	const calls = commitPatchAll.mock.calls as [
		CanvasNode[],
		(n: CanvasNode) => Record<string, unknown>,
	][];
	const build = calls[calls.length - 1]?.[1];
	if (!build) throw new Error("commitPatchAll was never called");
	return build(node);
}

describe("StrokeFields — dash pattern parsing", () => {
	it("parses space- or comma-separated numbers", () => {
		expect(parseDashPattern("4 2")).toEqual([4, 2]);
		expect(parseDashPattern("4,2")).toEqual([4, 2]);
		expect(parseDashPattern("4, 2, 1")).toEqual([4, 2, 1]);
	});

	it("blank input parses to undefined", () => {
		expect(parseDashPattern("")).toBeUndefined();
		expect(parseDashPattern("   ")).toBeUndefined();
	});

	it("rejects negative or non-numeric tokens", () => {
		expect(parseDashPattern("4 -2")).toBeUndefined();
		expect(parseDashPattern("4 abc")).toBeUndefined();
	});

	it("formats back to a space-joined string", () => {
		expect(formatDashPattern([4, 2])).toBe("4 2");
		expect(formatDashPattern(undefined)).toBe("");
	});
});

describe("StrokeFields — Cap picker (FR-075)", () => {
	it("selecting a cap commits strokeCap via commitPatchAll", async () => {
		const node = {
			...createRect({ id: "r1", bounds: { width: 10, height: 10 } }),
			strokeCap: "butt" as const,
		};
		const commitPatchAll = vi.fn();
		render(
			<StrokeFields
				nodes={[node]}
				commitPatchAll={commitPatchAll}
				t={(_k, f) => f ?? ""}
			/>,
		);
		await selectOption("prop-stroke-cap", "round");
		await waitFor(() => expect(commitPatchAll).toHaveBeenCalledTimes(1));
		expect(lastPatch(commitPatchAll, node)).toEqual({ strokeCap: "round" });
	});

	it("shows a Mixed placeholder when the selection's caps differ (FR-070)", () => {
		const a = {
			...createRect({ id: "a", bounds: { width: 10, height: 10 } }),
			strokeCap: "butt" as const,
		};
		const b = {
			...createRect({ id: "b", bounds: { width: 10, height: 10 } }),
			strokeCap: "round" as const,
		};
		render(
			<StrokeFields
				nodes={[a, b]}
				commitPatchAll={vi.fn()}
				t={(_k, f) => f ?? ""}
			/>,
		);
		expect(screen.getByTestId("prop-stroke-cap").textContent).toContain(
			"Mixed",
		);
	});
});

describe("StrokeFields — Join picker (FR-075)", () => {
	it("selecting a join commits strokeJoin via commitPatchAll", async () => {
		const node = {
			...createRect({ id: "r1", bounds: { width: 10, height: 10 } }),
			strokeJoin: "miter" as const,
		};
		const commitPatchAll = vi.fn();
		render(
			<StrokeFields
				nodes={[node]}
				commitPatchAll={commitPatchAll}
				t={(_k, f) => f ?? ""}
			/>,
		);
		await selectOption("prop-stroke-join", "bevel");
		await waitFor(() => expect(commitPatchAll).toHaveBeenCalledTimes(1));
		expect(lastPatch(commitPatchAll, node)).toEqual({ strokeJoin: "bevel" });
	});
});

describe("StrokeFields — arrow pickers (FR-075, line/path kinds only)", () => {
	it("are absent unless the arrows prop is set", () => {
		const node = createRect({ id: "r1", bounds: { width: 10, height: 10 } });
		render(
			<StrokeFields
				nodes={[node]}
				commitPatchAll={vi.fn()}
				t={(_k, f) => f ?? ""}
			/>,
		);
		expect(screen.queryByTestId("prop-arrow-start")).toBeNull();
		expect(screen.queryByTestId("prop-arrow-end")).toBeNull();
	});

	it("selecting an arrowhead commits arrowStart via commitPatchAll", async () => {
		const line = createLine({ id: "l1", points: [0, 0, 100, 0] });
		const commitPatchAll = vi.fn();
		render(
			<StrokeFields
				nodes={[line]}
				commitPatchAll={commitPatchAll}
				t={(_k, f) => f ?? ""}
				arrows
			/>,
		);
		expect(screen.getByTestId("prop-arrow-start")).toBeDefined();
		await selectOption("prop-arrow-start", "arrow");
		await waitFor(() => expect(commitPatchAll).toHaveBeenCalledTimes(1));
		expect(lastPatch(commitPatchAll, line)).toEqual({ arrowStart: "arrow" });
	});
});
