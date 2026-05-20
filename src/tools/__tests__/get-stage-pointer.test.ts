import type Konva from "konva";
import { describe, expect, it, vi } from "vitest";
import { getStagePointer } from "../get-stage-pointer.js";

function makeStage(
	pointer: { x: number; y: number } | null,
	invertPoint: (p: { x: number; y: number }) => { x: number; y: number } = (
		p,
	) => p,
): Konva.Stage {
	const invertedTransform = { point: vi.fn(invertPoint) };
	const transform = {
		copy: () => ({
			invert: () => invertedTransform,
		}),
	};
	return {
		getPointerPosition: () => pointer,
		getAbsoluteTransform: () => transform,
	} as unknown as Konva.Stage;
}

describe("getStagePointer", () => {
	it("returns null when stage has no pointer position", () => {
		const stage = makeStage(null);
		expect(getStagePointer(stage)).toBeNull();
	});

	it("returns identity world point when no transform applied", () => {
		const stage = makeStage({ x: 10, y: 20 });
		const ptr = getStagePointer(stage);
		expect(ptr).toEqual({ screen: { x: 10, y: 20 }, world: { x: 10, y: 20 } });
	});

	it("applies inverse-transform to derive world coords from screen coords", () => {
		// Stage with zoom=2, pan=(50, 30). Forward: world * 2 + offset.
		// Inverse of screen (110, 90): (110-50)/2 = 30, (90-30)/2 = 30.
		const stage = makeStage({ x: 110, y: 90 }, (p) => ({
			x: (p.x - 50) / 2,
			y: (p.y - 30) / 2,
		}));
		const ptr = getStagePointer(stage);
		expect(ptr).toEqual({
			screen: { x: 110, y: 90 },
			world: { x: 30, y: 30 },
		});
	});
});
