import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const layerInstances: Array<{ name?: string; listening?: boolean }> = [];

vi.mock("react-konva", () => {
	type LayerProps = {
		name?: string;
		listening?: boolean;
		children?: ReactNode;
	};
	const Layer = (props: LayerProps) => {
		layerInstances.push({ name: props.name, listening: props.listening });
		return (
			<div data-testid="layer" data-name={props.name}>
				{props.children}
			</div>
		);
	};
	return { Layer };
});

import { RenderLayer } from "../RenderLayer.js";

describe("RenderLayer", () => {
	it("forwards name and defaults listening to true", () => {
		layerInstances.length = 0;
		render(<RenderLayer name="objects" />);
		expect(layerInstances.at(-1)).toEqual({
			name: "objects",
			listening: true,
		});
	});

	it("forwards listening={false} for background and presence layers", () => {
		layerInstances.length = 0;
		render(
			<>
				<RenderLayer name="background" listening={false} />
				<RenderLayer name="presence" listening={false} />
			</>,
		);
		expect(layerInstances).toEqual([
			{ name: "background", listening: false },
			{ name: "presence", listening: false },
		]);
	});

	it("renders its children inside the Layer", () => {
		const { getByTestId } = render(
			<RenderLayer name="overlay">
				<div data-testid="layer-child" />
			</RenderLayer>,
		);
		expect(getByTestId("layer-child")).toBeTruthy();
	});
});
