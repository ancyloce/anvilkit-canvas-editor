import { createRect } from "@anvilkit/canvas-core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import {
	ColorField,
	type FieldContractTarget,
	NumberField,
	TextField,
} from "../fields.js";

afterEach(cleanup);

/**
 * §10 field-input contract tests, shared across every field kind (B-12):
 * 1. adjusting previews transiently (no history), 2. completion commits ONE
 * coalesced entry, 3. Escape reverts without committing.
 */

function nodeFixture(id = "n1") {
	return createRect({
		id,
		bounds: { width: 100, height: 80 },
		transform: { x: 10, y: 20 },
		fill: "#ff0000",
		opacity: 0.5,
	});
}

function setup(ui: (h: ReturnType<typeof makeHarness>) => ReactNode) {
	const h = makeHarness();
	render(
		<CanvasStudioContext.Provider value={h.studioCtx}>
			{ui(h)}
		</CanvasStudioContext.Provider>,
	);
	return h;
}

function previews(h: ReturnType<typeof makeHarness>) {
	return h.studioCtx.fieldPreviewStore?.getState().previews ?? {};
}

const numberContract = (
	node: ReturnType<typeof nodeFixture>,
): FieldContractTarget<number> => ({
	nodes: [node],
	buildPatch: (_n, v) => ({ opacity: v }),
});

describe("§10 field-input contract (B-12)", () => {
	it("NumberField previews while typing without committing", () => {
		const node = nodeFixture();
		const h = setup(() => (
			<NumberField
				label="Opacity"
				value={0.5}
				step={0.05}
				dataTestId="f-num"
				contract={numberContract(node)}
			/>
		));
		fireEvent.change(screen.getByTestId("f-num"), { target: { value: "0.8" } });
		expect(previews(h)).toEqual({ n1: { opacity: 0.8 } });
		expect(h.studioCtx.commit).not.toHaveBeenCalled();
		expect(h.studioCtx.commitCoalesced).not.toHaveBeenCalled();
	});

	it("NumberField blur commits ONE coalesced entry and clears the preview", () => {
		const node = nodeFixture();
		const h = setup(() => (
			<NumberField
				label="Opacity"
				value={0.5}
				dataTestId="f-num"
				contract={numberContract(node)}
			/>
		));
		const input = screen.getByTestId("f-num");
		fireEvent.change(input, { target: { value: "0.8" } });
		fireEvent.blur(input);
		expect(h.studioCtx.commitCoalesced).toHaveBeenCalledTimes(1);
		expect(h.studioCtx.commitCoalesced).toHaveBeenCalledWith(
			{
				type: "node.update",
				nodeId: "n1",
				kind: "rect",
				patch: { opacity: 0.8 },
			},
			"field:f-num:n1",
		);
		expect(h.studioCtx.commit).not.toHaveBeenCalled();
		expect(previews(h)).toEqual({});
	});

	it("NumberField Enter commits (via blur)", () => {
		const node = nodeFixture();
		const h = setup(() => (
			<NumberField
				label="Opacity"
				value={0.5}
				dataTestId="f-num"
				contract={numberContract(node)}
			/>
		));
		const input = screen.getByTestId("f-num") as HTMLInputElement;
		input.focus();
		fireEvent.change(input, { target: { value: "0.9" } });
		// Enter blurs the input, and that blur is the single committing event.
		fireEvent.keyDown(input, { key: "Enter" });
		expect(h.studioCtx.commitCoalesced).toHaveBeenCalledTimes(1);
	});

	it("NumberField Escape reverts: preview cleared, no commit on blur", () => {
		const node = nodeFixture();
		const h = setup(() => (
			<NumberField
				label="Opacity"
				value={0.5}
				dataTestId="f-num"
				contract={numberContract(node)}
			/>
		));
		const input = screen.getByTestId("f-num") as HTMLInputElement;
		fireEvent.change(input, { target: { value: "0.9" } });
		expect(previews(h)).not.toEqual({});
		fireEvent.keyDown(input, { key: "Escape" });
		expect(previews(h)).toEqual({});
		expect(input.value).toBe("0.5");
		fireEvent.blur(input);
		expect(h.studioCtx.commit).not.toHaveBeenCalled();
		expect(h.studioCtx.commitCoalesced).not.toHaveBeenCalled();
	});

	it("NumberField unchanged blur commits nothing", () => {
		const node = nodeFixture();
		const h = setup(() => (
			<NumberField
				label="Opacity"
				value={0.5}
				dataTestId="f-num"
				contract={numberContract(node)}
			/>
		));
		const input = screen.getByTestId("f-num");
		fireEvent.focus(input);
		fireEvent.blur(input);
		expect(h.studioCtx.commit).not.toHaveBeenCalled();
		expect(h.studioCtx.commitCoalesced).not.toHaveBeenCalled();
	});

	it("NumberField Shift+ArrowUp previews a 10x step", () => {
		const node = nodeFixture();
		const h = setup(() => (
			<NumberField
				label="X"
				value={10}
				step={1}
				dataTestId="f-num"
				contract={{
					nodes: [node],
					buildPatch: (n, v) => ({ transform: { ...n.transform, x: v } }),
				}}
			/>
		));
		const input = screen.getByTestId("f-num") as HTMLInputElement;
		fireEvent.keyDown(input, { key: "ArrowUp", shiftKey: true });
		expect(input.value).toBe("20");
		expect(previews(h).n1).toMatchObject({
			transform: expect.objectContaining({ x: 20 }),
		});
	});

	it("multi-selection commits one coalesced batch across all nodes", () => {
		const a = nodeFixture("a");
		const b = nodeFixture("b");
		const h = setup(() => (
			<NumberField
				label="Opacity"
				value={0.5}
				mixed
				dataTestId="f-num"
				contract={{
					nodes: [a, b],
					buildPatch: (_n, v) => ({ opacity: v }),
				}}
			/>
		));
		const input = screen.getByTestId("f-num") as HTMLInputElement;
		expect(input.placeholder).toBe("Mixed");
		fireEvent.change(input, { target: { value: "1" } });
		expect(Object.keys(previews(h))).toEqual(["a", "b"]);
		fireEvent.blur(input);
		expect(h.studioCtx.commitCoalesced).toHaveBeenCalledWith(
			{
				type: "batch",
				commands: [
					{
						type: "node.update",
						nodeId: "a",
						kind: "rect",
						patch: { opacity: 1 },
					},
					{
						type: "node.update",
						nodeId: "b",
						kind: "rect",
						patch: { opacity: 1 },
					},
				],
			},
			"field:f-num:a,b",
		);
	});

	it("mixed field left empty commits nothing", () => {
		const a = nodeFixture("a");
		const b = nodeFixture("b");
		const h = setup(() => (
			<NumberField
				label="Opacity"
				value={0}
				mixed
				dataTestId="f-num"
				contract={{ nodes: [a, b], buildPatch: (_n, v) => ({ opacity: v }) }}
			/>
		));
		const input = screen.getByTestId("f-num");
		fireEvent.focus(input);
		fireEvent.blur(input);
		expect(h.studioCtx.commitCoalesced).not.toHaveBeenCalled();
	});

	it("TextField follows the same preview/commit/revert contract", () => {
		const node = nodeFixture();
		const h = setup(() => (
			<TextField
				label="Name"
				value="Old"
				dataTestId="f-text"
				contract={{ nodes: [node], buildPatch: (_n, v) => ({ name: v }) }}
			/>
		));
		const input = screen.getByTestId("f-text") as HTMLInputElement;
		fireEvent.change(input, { target: { value: "New" } });
		expect(previews(h)).toEqual({ n1: { name: "New" } });
		fireEvent.keyDown(input, { key: "Escape" });
		expect(previews(h)).toEqual({});
		expect(input.value).toBe("Old");
		fireEvent.change(input, { target: { value: "Newer" } });
		fireEvent.blur(input);
		expect(h.studioCtx.commitCoalesced).toHaveBeenCalledWith(
			{
				type: "node.update",
				nodeId: "n1",
				kind: "rect",
				patch: { name: "Newer" },
			},
			"field:f-text:n1",
		);
		expect(previews(h)).toEqual({});
	});

	it("ColorField follows the same preview/commit contract", () => {
		const node = nodeFixture();
		const h = setup(() => (
			<ColorField
				label="Fill"
				value="#ff0000"
				dataTestId="f-color"
				contract={{ nodes: [node], buildPatch: (_n, v) => ({ fill: v }) }}
			/>
		));
		const input = screen.getByTestId("f-color");
		fireEvent.change(input, { target: { value: "#00ff00" } });
		expect(previews(h)).toEqual({ n1: { fill: "#00ff00" } });
		fireEvent.blur(input);
		expect(h.studioCtx.commitCoalesced).toHaveBeenCalledWith(
			{
				type: "node.update",
				nodeId: "n1",
				kind: "rect",
				patch: { fill: "#00ff00" },
			},
			"field:f-color:n1",
		);
		expect(previews(h)).toEqual({});
	});

	it("falls back to plain commit when the context lacks commitCoalesced", () => {
		const node = nodeFixture();
		const h = makeHarness();
		const ctx = { ...h.studioCtx };
		// biome-ignore lint/performance/noDelete: building the degraded test context
		delete (ctx as Record<string, unknown>).commitCoalesced;
		render(
			<CanvasStudioContext.Provider value={ctx}>
				<NumberField
					label="Opacity"
					value={0.5}
					dataTestId="f-num"
					contract={numberContract(node)}
				/>
			</CanvasStudioContext.Provider>,
		);
		const input = screen.getByTestId("f-num");
		fireEvent.change(input, { target: { value: "0.7" } });
		fireEvent.blur(input);
		expect(h.studioCtx.commit).toHaveBeenCalledTimes(1);
	});

	it("legacy onCommit path (no contract) still commits on blur only", () => {
		const onCommit = vi.fn();
		const h = setup(() => (
			<NumberField
				label="Opacity"
				value={0.5}
				dataTestId="f-num"
				onCommit={onCommit}
			/>
		));
		const input = screen.getByTestId("f-num");
		fireEvent.change(input, { target: { value: "0.8" } });
		expect(onCommit).not.toHaveBeenCalled();
		expect(previews(h)).toEqual({});
		fireEvent.blur(input);
		expect(onCommit).toHaveBeenCalledWith(0.8);
		expect(h.studioCtx.commit).not.toHaveBeenCalled();
		expect(h.studioCtx.commitCoalesced).not.toHaveBeenCalled();
	});
});
