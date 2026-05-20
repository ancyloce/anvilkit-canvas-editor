import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const destroyMock = vi.fn();
const stageInstances: Array<{ destroy: () => void }> = [];

vi.mock("react-konva", () => {
	type StageProps = {
		children?: ReactNode;
		ref?: { current: { destroy: () => void } | null };
		width?: number;
		height?: number;
		scaleX?: number;
		scaleY?: number;
		x?: number;
		y?: number;
	};
	const Stage = (props: StageProps) => {
		const inst = {
			destroy: destroyMock,
			width: props.width,
			height: props.height,
			scaleX: props.scaleX,
			scaleY: props.scaleY,
			x: props.x,
			y: props.y,
		};
		stageInstances.push(inst);
		if (props.ref && "current" in props.ref) {
			props.ref.current = inst;
		}
		return <div data-testid="stage">{props.children}</div>;
	};
	const Group = ({ children }: { children?: ReactNode }) => children ?? null;
	return { Stage, Layer: Group };
});

import { CanvasStage } from "../CanvasStage.js";

describe("CanvasStage", () => {
	it("renders its children inside a Stage", () => {
		stageInstances.length = 0;
		const { getByTestId } = render(
			<CanvasStage width={800} height={600}>
				<div data-testid="child" />
			</CanvasStage>,
		);
		expect(getByTestId("stage")).toBeTruthy();
		expect(getByTestId("child")).toBeTruthy();
	});

	it("forwards width/height/zoom/pan to the Stage", () => {
		stageInstances.length = 0;
		render(
			<CanvasStage width={1080} height={720} zoom={2} panX={50} panY={-30}>
				<div />
			</CanvasStage>,
		);
		const stage = stageInstances.at(-1);
		expect(stage?.width).toBe(1080);
		expect(stage?.height).toBe(720);
		expect(stage?.scaleX).toBe(2);
		expect(stage?.scaleY).toBe(2);
		expect(stage?.x).toBe(50);
		expect(stage?.y).toBe(-30);
	});

	it("defaults zoom=1 and pan=(0,0)", () => {
		stageInstances.length = 0;
		render(
			<CanvasStage width={100} height={100}>
				<div />
			</CanvasStage>,
		);
		const stage = stageInstances.at(-1);
		expect(stage?.scaleX).toBe(1);
		expect(stage?.scaleY).toBe(1);
		expect(stage?.x).toBe(0);
		expect(stage?.y).toBe(0);
	});

	it("calls stage.destroy() on unmount", () => {
		destroyMock.mockClear();
		const { unmount } = render(
			<CanvasStage width={100} height={100}>
				<div />
			</CanvasStage>,
		);
		expect(destroyMock).not.toHaveBeenCalled();
		unmount();
		expect(destroyMock).toHaveBeenCalledTimes(1);
	});

	it("fires onReady once the stage is mounted", () => {
		const onReady = vi.fn();
		render(
			<CanvasStage width={100} height={100} onReady={onReady}>
				<div />
			</CanvasStage>,
		);
		expect(onReady).toHaveBeenCalledTimes(1);
		expect(onReady.mock.calls[0]?.[0]).toMatchObject({ width: 100 });
	});
});
