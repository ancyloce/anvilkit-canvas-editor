import type { CanvasNode } from "@anvilkit/canvas-core";
import {
	createCanvasIR,
	createFrame,
	createPage,
	createRect,
	insertNode,
} from "@anvilkit/canvas-core";
import type Konva from "konva";
import { describe, expect, it, vi } from "vitest";
import {
	DEFAULT_CANVAS_EXPORTERS,
	jpegExporter,
	jsonExporter,
	pngExporter,
	sanitizeExportFilename,
	svgExporter,
	webpExporter,
} from "../exporters.js";

const NOW = "2026-01-01T00:00:00.000Z";

function fixture() {
	const ir = createCanvasIR({
		id: "doc-1",
		title: "Poster",
		pages: [createPage({ id: "p1" })],
		now: () => NOW,
	});
	const toDataURL = vi.fn(
		(opts: { mimeType?: string }) =>
			`data:${opts.mimeType ?? "image/png"};base64,AAAA`,
	);
	// A panned/zoomed viewport (E-8): scale/position start non-identity so a
	// test can assert they're neutralized during the capture and restored
	// after.
	let scale = { x: 2, y: 2 };
	let position = { x: 100, y: 50 };
	const stage = {
		toDataURL,
		scale: vi.fn((next?: { x: number; y: number }) => {
			if (next) {
				scale = next;
				return stage;
			}
			return scale;
		}),
		position: vi.fn((next?: { x: number; y: number }) => {
			if (next) {
				position = next;
				return stage;
			}
			return position;
		}),
		batchDraw: vi.fn(),
	} as unknown as Konva.Stage;
	return { ir, stage, toDataURL };
}

describe("built-in raster exporters (B-18, AC-010)", () => {
	it("png/jpeg/webp map format → mimeType, extension, and pixel ratio", () => {
		const { ir, stage, toDataURL } = fixture();
		const cases = [
			{ exporter: pngExporter, mime: "image/png", ext: "png" },
			{ exporter: jpegExporter, mime: "image/jpeg", ext: "jpg" },
			{ exporter: webpExporter, mime: "image/webp", ext: "webp" },
		] as const;
		for (const { exporter, mime, ext } of cases) {
			const artifact = exporter(
				{ ir, stage, pageId: "p1" },
				{ resolution: 2, quality: 0.8, transparent: false },
			);
			expect(artifact.mimeType).toBe(mime);
			expect(artifact.filename).toBe(`Poster.${ext}`);
			expect(String(artifact.data)).toContain(mime);
		}
		// resolution 2 → pixelRatio 4 (2× retina base) on every call.
		for (const call of toDataURL.mock.calls) {
			expect((call[0] as { pixelRatio: number }).pixelRatio).toBe(4);
		}
	});

	it("quality reaches the lossy formats but never PNG", () => {
		const { ir, stage, toDataURL } = fixture();
		pngExporter(
			{ ir, stage, pageId: "p1" },
			{
				resolution: 1,
				quality: 0.5,
				transparent: false,
			},
		);
		jpegExporter(
			{ ir, stage, pageId: "p1" },
			{
				resolution: 1,
				quality: 0.5,
				transparent: false,
			},
		);
		const [pngCall, jpegCall] = toDataURL.mock.calls;
		expect(pngCall?.[0]).not.toHaveProperty("quality");
		expect(jpegCall?.[0]).toMatchObject({ quality: 0.5 });
	});

	it("neutralizes stage scale/position around the capture and restores them after (E-8)", () => {
		const { ir, stage, toDataURL } = fixture();
		let capturedDuringCall: {
			scale: { x: number; y: number };
			position: { x: number; y: number };
		} | null = null;
		toDataURL.mockImplementation((opts: { mimeType?: string }) => {
			capturedDuringCall = {
				scale: (stage.scale as unknown as () => { x: number; y: number })(),
				position: (
					stage.position as unknown as () => { x: number; y: number }
				)(),
			};
			return `data:${opts.mimeType ?? "image/png"};base64,AAAA`;
		});

		pngExporter(
			{ ir, stage, pageId: "p1" },
			{ resolution: 1, quality: 0.8, transparent: false },
		);

		// Neutralized DURING the capture, not whatever pan/zoom was active.
		expect(capturedDuringCall).toEqual({
			scale: { x: 1, y: 1 },
			position: { x: 0, y: 0 },
		});
		// Restored afterward — the live stage is not left in a mutated state.
		expect((stage.scale as unknown as () => unknown)()).toEqual({
			x: 2,
			y: 2,
		});
		expect((stage.position as unknown as () => unknown)()).toEqual({
			x: 100,
			y: 50,
		});
	});

	it("raster exporters throw without a stage; json works stage-free", () => {
		const { ir } = fixture();
		expect(() =>
			jpegExporter(
				{ ir, stage: null, pageId: "p1" },
				{
					resolution: 1,
					quality: 1,
					transparent: false,
				},
			),
		).toThrow(/JPG export needs a ready Konva stage/i);
		const artifact = jsonExporter(
			{ ir, stage: null, pageId: "p1" },
			{
				resolution: 1,
				quality: 1,
				transparent: false,
			},
		);
		expect(artifact.mimeType).toBe("application/json");
	});

	it("the default exporter map covers all seven FR-151 formats", () => {
		// FR-151 / AC-010: PNG, JPG, WebP, SVG, PDF, print PDF, and JSON all
		// export with zero host wiring.
		expect(Object.keys(DEFAULT_CANVAS_EXPORTERS).sort()).toEqual([
			"jpeg",
			"json",
			"pdf",
			"pdf-print",
			"png",
			"svg",
			"webp",
		]);
	});
});

/**
 * T-M3-10 (AC: no export path emits LAYOUT_UNRESOLVED in normal operation)
 * and T-M3-03 (TS-45, integration): the built-in SVG exporter resolves the
 * committed document itself, serializes resolved geometry, and surfaces
 * layout diagnostics in the export result.
 */
describe("svgExporter resolved-layout path (T-M3-10)", () => {
	/** 200-wide frame, gap 30, two 150-wide children (stored stale at x=0) —
	 * flows r2 to x=180 AND overflows, so a diagnostic must surface. */
	function layoutFixture() {
		const frame: CanvasNode = {
			...createFrame({ id: "f1", bounds: { width: 200, height: 100 } }),
			autoLayout: {
				version: 1,
				direction: "horizontal",
				padding: { top: 0, right: 0, bottom: 0, left: 0 },
				gap: 30,
				primaryAlign: "start",
				crossAlign: "start",
			},
			children: [
				createRect({ id: "r1", bounds: { width: 150, height: 20 } }),
				createRect({ id: "r2", bounds: { width: 150, height: 20 } }),
			],
		} as CanvasNode;
		const page = createPage({ id: "p1" });
		let ir = createCanvasIR({
			id: "doc-1",
			title: "Poster",
			pages: [page],
			now: () => NOW,
		});
		ir = insertNode(ir, { parentId: page.root.id, node: frame });
		return ir;
	}

	it("emits resolved geometry, no LAYOUT_UNRESOLVED, and mapped layout diagnostics", async () => {
		const ir = layoutFixture();
		const artifact = await svgExporter(
			{ ir, activePageId: "p1" } as Parameters<typeof svgExporter>[0],
			{} as Parameters<typeof svgExporter>[1],
		);
		const codes = (artifact.warnings ?? []).map((w) => w.code);
		// The acceptance criterion: the built-in export path supplies its own
		// resolution, so the serializer never warns unresolved.
		expect(codes).not.toContain("LAYOUT_UNRESOLVED");
		// Resolved flow geometry was emitted (stored geometry had r2 at x=0).
		expect(String(artifact.data)).toContain("translate(180 0)");
		// TS-45: the overflow diagnostic rides into the export result via the
		// shared severity→level map, stamped with the page.
		const overflow = (artifact.warnings ?? []).find(
			(w) => w.code === "layout-insufficient-space",
		);
		expect(overflow).toBeDefined();
		expect(overflow?.level).toBe("warn");
		expect(overflow?.pageId).toBe("p1");
	});

	it("emits no layout warnings for a document without layout intent", async () => {
		const ir = createCanvasIR({
			id: "doc-1",
			title: "Poster",
			pages: [createPage({ id: "p1" })],
			now: () => NOW,
		});
		const artifact = await svgExporter(
			{ ir, activePageId: "p1" } as Parameters<typeof svgExporter>[0],
			{} as Parameters<typeof svgExporter>[1],
		);
		const codes = (artifact.warnings ?? []).map((w) => w.code);
		expect(codes).not.toContain("LAYOUT_UNRESOLVED");
		expect(codes.some((code) => code.startsWith("layout-"))).toBe(false);
	});
});

describe("sanitizeExportFilename (§14.5)", () => {
	it("strips path separators and illegal filename characters", () => {
		expect(sanitizeExportFilename("../../etc/passwd")).toBe("etc passwd");
		expect(sanitizeExportFilename('a:b*c?"<>|d')).toBe("a b c d");
	});

	it("strips leading dots and collapses whitespace and control chars", () => {
		expect(sanitizeExportFilename(".hidden")).toBe("hidden");
		expect(sanitizeExportFilename("a   b")).toBe("a b");
		expect(sanitizeExportFilename(`a${String.fromCharCode(1)}b`)).toBe("a b");
	});

	it("falls back when the result is empty", () => {
		expect(sanitizeExportFilename("///", "fallback")).toBe("fallback");
		expect(sanitizeExportFilename("")).toBe("canvas");
	});
});
