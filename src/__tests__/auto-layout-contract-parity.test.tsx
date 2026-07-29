import type { CanvasIR, CanvasNode } from "@anvilkit/canvas-core";
import {
	createCanvasIR,
	createFrame,
	createPage,
	createRect,
	createResolvedView,
	insertNode,
	resolveCanvasLayout,
} from "@anvilkit/canvas-core";
import { cleanup, render } from "@testing-library/react";
import type Konva from "konva";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Props of every <Rect> rendered by either consumer, in render order. */
const rectCalls: Array<Record<string, unknown>> = [];

vi.mock("react-konva", () => {
	const Container = ({ children }: { children?: ReactNode }) =>
		children ?? null;
	const Rect = (props: Record<string, unknown>) => {
		rectCalls.push(props);
		return null;
	};
	const Leaf = () => null;
	return {
		Stage: Container,
		Layer: Container,
		Group: Container,
		Rect,
		Ellipse: Leaf,
		RegularPolygon: Leaf,
		Star: Leaf,
		Line: Leaf,
		Path: Leaf,
		Text: Leaf,
		Image: Leaf,
		Transformer: Leaf,
	};
});

vi.mock("use-image", () => ({ default: () => [null, "loading"] }));

vi.mock("../stage/CanvasStage.js", () => ({
	CanvasStage: ({
		children,
		onReady,
	}: {
		children?: ReactNode;
		onReady?: (stage: Konva.Stage) => void;
	}) => {
		if (onReady) {
			const stage = {
				toDataURL: () => "data:image/png;base64,STUB",
				destroy: () => undefined,
				scaleX: () => undefined,
				scaleY: () => undefined,
			} as unknown as Konva.Stage;
			queueMicrotask(() => onReady(stage));
		}
		return <>{children}</>;
	},
}));

import {
	CanvasStudioContext,
	type CanvasStudioContextValue,
} from "@/context/canvas-studio-context.js";
import { svgExporter } from "@/header/exporters.js";
import { rasterizePage } from "@/render/rasterize-page.js";
import { CanvasNodeRenderer } from "@/stage/CanvasNodeRenderer.js";
import { createFieldPreviewStore } from "@/stores/field-preview-store.js";
import { createResolvedDocumentStore } from "@/stores/resolved-document-store.js";
import { createSceneStore } from "@/stores/scene-store.js";

/**
 * @file T-M5-01 (TS-57 editor half, TS-41) — the editor's two consumers
 * (live renderer, offscreen raster/PDF tree) and the SVG exporter agree with
 * the headless resolver on the contract fixtures. The documents MIRROR
 * `canvas-core/src/layout/__tests__/contract/fixtures.ts` (test files cannot
 * cross the package boundary); geometry values must stay literal-identical
 * with that module.
 *
 * AC-009 tolerance (PROVISIONAL under OQ-4, same statement as the core
 * harness): both sides share the resolver's 1e-4 quantisation grid, so
 * numeric agreement is asserted at ≤ 1e-3 local units, and the SVG consumer
 * at exact 4-dp formatted strings.
 */

const TOLERANCE = 1e-3;

function near(actual: unknown, expected: number, label: string): void {
	expect(typeof actual, label).toBe("number");
	expect(
		Math.abs((actual as number) - expected),
		`${label}: ${String(actual)} vs ${expected}`,
	).toBeLessThanOrEqual(TOLERANCE);
}

/** Mirror of the serializer's `fmt`: 4-dp rounding, trailing zeros dropped. */
function fmt(n: number): string {
	return String(Number(n.toFixed(4)));
}

function layout(overrides: Record<string, unknown> = {}) {
	return {
		version: 1,
		direction: "horizontal",
		padding: { top: 0, right: 0, bottom: 0, left: 0 },
		gap: 0,
		primaryAlign: "start",
		crossAlign: "start",
		...overrides,
	};
}

function rect(
	id: string,
	width: number,
	height: number,
	overrides: Record<string, unknown> = {},
): CanvasNode {
	return {
		...createRect({ id, bounds: { width, height }, fill: "#334455" }),
		...overrides,
	} as CanvasNode;
}

function frameWith(
	id: string,
	children: CanvasNode[],
	layoutOverrides: Record<string, unknown> = {},
	overrides: Record<string, unknown> = {},
): CanvasNode {
	return {
		...createFrame({ id, bounds: { width: 200, height: 100 } }),
		autoLayout: layout(layoutOverrides),
		children,
		...overrides,
	} as CanvasNode;
}

function docOf(children: CanvasNode[]): CanvasIR {
	const page = createPage({ id: "p1" });
	let ir = createCanvasIR({
		id: "contract-doc",
		title: "contract",
		pages: [page],
		now: () => "2026-07-28T00:00:00.000Z",
	});
	for (const child of children) {
		ir = insertNode(ir, { parentId: page.root.id, node: child });
	}
	return ir;
}

/** Mirror of core fixture 4 — pricing row with a Fill child. */
function pricingRowFill(): CanvasIR {
	return docOf([
		frameWith(
			"pricing",
			[
				rect("plan-a", 60, 40),
				rect("plan-b", 40, 40, { layoutItem: { widthSizing: "fill" } }),
				rect("plan-c", 60, 40),
			],
			{ gap: 10, padding: { top: 10, right: 10, bottom: 10, left: 10 } },
			{ bounds: { width: 300, height: 60 } },
		),
	]);
}

/** Mirror of core fixture 5 — absolute badge overlay. */
function absoluteBadge(): CanvasIR {
	return docOf([
		frameWith(
			"banner",
			[
				rect("slot-a", 50, 30),
				rect("slot-b", 50, 30),
				rect("overlay-badge", 24, 24, {
					transform: { x: 176, y: -12 },
					layoutItem: { positioning: "absolute" },
				}),
			],
			{ gap: 8, padding: { top: 8, right: 8, bottom: 8, left: 8 } },
		),
	]);
}

/** Mirror of core fixture 3 — nested product card (rect rows only). */
function nestedProductCard(): CanvasIR {
	return docOf([
		frameWith(
			"card",
			[
				frameWith(
					"card-header",
					[rect("avatar", 32, 32), rect("title", 120, 16)],
					{ gap: 8, crossAlign: "center" },
					{
						bounds: { width: 236, height: 40 },
						layoutItem: { heightSizing: "hug" },
					},
				),
				rect("hero", 236, 120),
				frameWith(
					"card-footer",
					[rect("price", 60, 20), rect("cta", 80, 28)],
					{ gap: 10, primaryAlign: "end", crossAlign: "center" },
					{
						bounds: { width: 236, height: 36 },
						layoutItem: { heightSizing: "hug" },
					},
				),
			],
			{
				direction: "vertical",
				gap: 12,
				padding: { top: 12, right: 12, bottom: 12, left: 12 },
			},
			{
				bounds: { width: 260, height: 240 },
				layoutItem: { heightSizing: "hug" },
			},
		),
	]);
}

const MIRRORED_FIXTURES: ReadonlyArray<{
	id: string;
	build: () => CanvasIR;
	rectIds: readonly string[];
}> = [
	{
		id: "pricing-row-fill",
		build: pricingRowFill,
		rectIds: ["plan-a", "plan-b", "plan-c"],
	},
	{
		id: "absolute-badge",
		build: absoluteBadge,
		rectIds: ["slot-a", "slot-b", "overlay-badge"],
	},
	{
		id: "nested-product-card",
		build: nestedProductCard,
		rectIds: ["avatar", "title", "hero", "price", "cta"],
	},
];

function recordOf(ir: CanvasIR, nodeId: string) {
	const resolved = resolveCanvasLayout(ir, {});
	const record = createResolvedView(resolved).getRecord(nodeId);
	if (!record) throw new Error(`no resolved record for ${nodeId}`);
	return record;
}

function lastRectProps(id: string): Record<string, unknown> | undefined {
	return rectCalls.filter((c) => c.id === id).at(-1);
}

beforeEach(() => {
	rectCalls.length = 0;
});

afterEach(cleanup);

describe("editor renderer consumer agrees with the resolver", () => {
	for (const fixture of MIRRORED_FIXTURES) {
		it(`"${fixture.id}": Konva rect props equal resolved records`, () => {
			const ir = fixture.build();
			const frame = ir.pages[0]?.root.children[0];
			if (!frame) throw new Error("fixture frame missing");
			const sceneStore = createSceneStore({ initialIR: ir });
			const fieldPreviewStore = createFieldPreviewStore();
			const resolvedDocumentStore = createResolvedDocumentStore({
				sceneStore,
				fieldPreviewStore,
			});
			const disconnect = resolvedDocumentStore.connect();
			try {
				render(
					<CanvasStudioContext.Provider
						value={
							{
								sceneStore,
								fieldPreviewStore,
								resolvedDocumentStore,
							} as unknown as CanvasStudioContextValue
						}
					>
						<CanvasNodeRenderer node={frame} />
					</CanvasStudioContext.Provider>,
				);
				for (const id of fixture.rectIds) {
					const props = lastRectProps(id);
					const record = recordOf(ir, id);
					expect(props, `${fixture.id}/${id} rendered`).toBeDefined();
					near(props?.x, record.geometry.localTransform.x, `${id} x`);
					near(props?.y, record.geometry.localTransform.y, `${id} y`);
					near(props?.width, record.geometry.bounds.width, `${id} width`);
					near(props?.height, record.geometry.bounds.height, `${id} height`);
				}
			} finally {
				disconnect();
			}
		});
	}
});

describe("raster/PDF offscreen consumer agrees with the resolver", () => {
	for (const fixture of MIRRORED_FIXTURES) {
		it(`"${fixture.id}": rasterize tree rect props equal resolved records`, async () => {
			const ir = fixture.build();
			const page = ir.pages[0];
			if (!page) throw new Error("fixture page missing");
			const resolved = resolveCanvasLayout(ir, {});
			await rasterizePage({ page, resolvedDocument: resolved });
			const view = createResolvedView(resolved);
			for (const id of fixture.rectIds) {
				const props = lastRectProps(id);
				const record = view.getRecord(id);
				if (!record) throw new Error(`no record for ${id}`);
				expect(props, `${fixture.id}/${id} rasterized`).toBeDefined();
				near(props?.x, record.geometry.localTransform.x, `${id} x`);
				near(props?.y, record.geometry.localTransform.y, `${id} y`);
				near(props?.width, record.geometry.bounds.width, `${id} width`);
				near(props?.height, record.geometry.bounds.height, `${id} height`);
			}
		});
	}
});

describe("SVG export consumer agrees with the resolver", () => {
	for (const fixture of MIRRORED_FIXTURES) {
		it(`"${fixture.id}": exported SVG places every rect at its resolved transform`, async () => {
			const ir = fixture.build();
			const artifact = await svgExporter(
				{ ir, activePageId: "p1" } as Parameters<typeof svgExporter>[0],
				{} as Parameters<typeof svgExporter>[1],
			);
			const svg = String(artifact.data);
			expect(artifact.warnings?.map((w) => w.code) ?? []).not.toContain(
				"LAYOUT_UNRESOLVED",
			);
			for (const id of fixture.rectIds) {
				const record = recordOf(ir, id);
				const { x, y } = record.geometry.localTransform;
				if (x === 0 && y === 0) continue; // identity omits the attribute
				expect(svg, `${fixture.id}/${id}`).toContain(
					`translate(${fmt(x)} ${fmt(y)})`,
				);
			}
		});
	}
});
