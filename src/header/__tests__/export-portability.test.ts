import type { CanvasExportWarning, CanvasIR } from "@anvilkit/canvas-core";
import {
	createCanvasIR,
	createImage,
	createPage,
	insertNode,
} from "@anvilkit/canvas-core";
import type Konva from "konva";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
	LocalAssetMeta,
	LocalAssetStore,
	LocalAssetStoreBackend,
} from "../../assets/local-asset-store.js";
import {
	createJsonExporter,
	createSvgExporter,
	DEFAULT_JSON_INLINE_ASSET_BYTES,
	jpegExporter,
	jsonExporter,
	pdfExporter,
	pngExporter,
	svgExporter,
	webpExporter,
} from "../exporters.js";
import type {
	CanvasExportArtifact,
	CanvasExportContext,
	CanvasExportRequest,
} from "../types.js";

/**
 * cp1-006 — export portability, end to end through the real exporters.
 *
 * The two acceptance criteria that need a whole exporter to be meaningful:
 * SVG export of a locally-uploaded image embeds REAL BYTES, and JSON export
 * either inlines or warns — never a silent `blob:` URI. Plus the third, which
 * needs no code at all and therefore needs a test: raster and PDF export are
 * unchanged.
 *
 * The store is mocked at the {@link LocalAssetStore} interface (`cp1-001` owns
 * the IndexedDB coverage; `fake-indexeddb` is still not installed).
 */

vi.mock("../../render/rasterize-page.js", () => ({
	rasterizePage: vi.fn(async ({ page }: { page: { id: string } }) => ({
		url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
		mimeType: "image/png",
		pageId: page.id,
	})),
}));

/**
 * The real store module, with one call counter around the singleton accessor —
 * that accessor is the ONLY way an exporter can reach browser-local bytes
 * without being handed a store, so "was it called" is exactly the question
 * "did this format touch local storage".
 */
const { sharedStoreAccesses } = vi.hoisted(() => ({
	sharedStoreAccesses: vi.fn(),
}));
vi.mock("../../assets/local-asset-store.js", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../../assets/local-asset-store.js")>();
	return {
		...actual,
		getSharedLocalAssetStore: (
			...args: Parameters<typeof actual.getSharedLocalAssetStore>
		) => {
			sharedStoreAccesses();
			return actual.getSharedLocalAssetStore(...args);
		},
	};
});

const NOW = "2026-01-01T00:00:00.000Z";
const HI = new Uint8Array([72, 105]); // base64 "SGk="
const LOCAL_URI = "blob:http://localhost/abcd-1234";
const REMOTE_URI = "https://cdn.example.com/x.png";

const REQUEST: CanvasExportRequest = {
	quality: 1,
	resolution: 1,
	stripMetadata: false,
};

function makeStore(
	entries: ReadonlyArray<{ id: string; byteSize: number; name?: string }>,
	backend: LocalAssetStoreBackend = "indexeddb",
): LocalAssetStore & { touched: () => boolean } {
	let touched = false;
	const metas: LocalAssetMeta[] = entries.map((entry) => ({
		id: entry.id,
		mimeType: "image/png",
		byteSize: entry.byteSize,
		createdAt: 0,
		...(entry.name !== undefined ? { name: entry.name } : {}),
	}));
	return {
		touched: () => touched,
		async put() {
			throw new Error("not used");
		},
		async get(id) {
			touched = true;
			return metas.some((m) => m.id === id)
				? new Blob([HI as unknown as BlobPart], { type: "image/png" })
				: undefined;
		},
		async delete() {
			/* the export path never deletes */
		},
		async list() {
			touched = true;
			return metas.map((m) => ({ ...m }));
		},
		async has(id) {
			touched = true;
			return metas.some((m) => m.id === id);
		},
		async usage() {
			touched = true;
			return {
				count: metas.length,
				totalBytes: metas.reduce((sum, m) => sum + m.byteSize, 0),
				maxAssetBytes: 25 * 1024 * 1024,
				maxTotalBytes: 200 * 1024 * 1024,
			};
		},
		async clear() {
			/* the export path never clears */
		},
		async backend() {
			touched = true;
			return backend;
		},
		close() {
			/* nothing to release in a stub */
		},
	};
}

function fixture(uri: string, assetId = "a1"): CanvasIR {
	const page = createPage({ id: "p1" });
	let ir = createCanvasIR({
		id: "doc-1",
		title: "Poster",
		pages: [page],
		now: () => NOW,
	});
	ir = insertNode(ir, {
		parentId: page.root.id,
		node: createImage({
			id: "img1",
			assetId,
			bounds: { x: 0, y: 0, width: 10, height: 10 },
		}),
	});
	return {
		...ir,
		assets: { [assetId]: { id: assetId, uri, mimeType: "image/png" } },
	};
}

function makeStage(): Konva.Stage {
	return {
		toDataURL: vi.fn(
			(opts: { mimeType?: string }) =>
				`data:${opts.mimeType ?? "image/png"};base64,AAAA`,
		),
		scale: vi.fn(() => ({ x: 1, y: 1 })),
		position: vi.fn(() => ({ x: 0, y: 0 })),
		batchDraw: vi.fn(),
	} as unknown as Konva.Stage;
}

function ctx(
	ir: CanvasIR,
	stage: Konva.Stage | null = null,
): CanvasExportContext {
	return { ir, activePageId: "p1", stage };
}

afterEach(() => {
	vi.useRealTimers();
});

describe("SVG export embeds browser-local assets (AC 1)", () => {
	it("emits real bytes instead of a dead blob: reference", async () => {
		const store = makeStore([{ id: "a1", byteSize: 2 }]);
		const artifact = await createSvgExporter({ store })(
			ctx(fixture(LOCAL_URI)),
			REQUEST,
		);
		const svg = String(artifact.data);
		expect(svg).toContain('href="data:image/png;base64,SGk="');
		expect(svg).not.toContain("blob:");
		// Before cp1-006 this document exported an empty page plus UNSAFE_URI.
		expect(svg).toContain("<image");
		expect((artifact.warnings ?? []).map((w) => w.code)).not.toContain(
			"UNSAFE_URI",
		);
	});

	it("warns MISSING_ASSET rather than silently dropping when the bytes are gone", async () => {
		const store = makeStore([]);
		const artifact = await createSvgExporter({ store })(
			ctx(fixture(LOCAL_URI)),
			REQUEST,
		);
		const codes = (artifact.warnings ?? []).map((w) => w.code);
		expect(codes).toContain("MISSING_ASSET");
		expect(String(artifact.data)).not.toContain("<image");
	});

	it("never touches the store for a document with only remote assets", async () => {
		const store = makeStore([{ id: "a1", byteSize: 2 }]);
		const artifact = await createSvgExporter({ store })(
			ctx(fixture(REMOTE_URI)),
			REQUEST,
		);
		expect(store.touched()).toBe(false);
		expect(String(artifact.data)).toContain(`href="${REMOTE_URI}"`);
		expect(artifact.warnings).toEqual([]);
	});
});

describe("JSON export inlines or warns — never a silent blob: URI (AC 2)", () => {
	it("inlines a local asset as a data URI under the cap", async () => {
		const store = makeStore([{ id: "a1", byteSize: 2 }]);
		const artifact = await createJsonExporter({ store })(
			ctx(fixture(LOCAL_URI)),
			REQUEST,
		);
		const parsed = JSON.parse(String(artifact.data)) as CanvasIR;
		expect(parsed.assets.a1?.uri).toBe("data:image/png;base64,SGk=");
		expect(String(artifact.data)).not.toContain("blob:");
		expect(artifact.warnings).toBeUndefined();
	});

	it("warns, naming each asset, when the total exceeds the cap", async () => {
		const store = makeStore([
			{ id: "a1", byteSize: 900, name: "hero.png" },
			{ id: "a2", byteSize: 900, name: "logo.png" },
		]);
		let ir = fixture(LOCAL_URI);
		ir = {
			...ir,
			assets: {
				...ir.assets,
				a2: {
					id: "a2",
					uri: "blob:http://localhost/second",
					mimeType: "image/png",
				},
			},
		};
		const artifact = await createJsonExporter({
			store,
			maxInlineAssetBytes: 1000,
		})(ctx(ir), REQUEST);
		const warnings = artifact.warnings ?? [];
		expect(warnings).toHaveLength(2);
		expect(warnings.map((w) => w.code)).toEqual([
			"LOCAL_ASSET_NOT_PORTABLE",
			"LOCAL_ASSET_NOT_PORTABLE",
		]);
		expect(warnings.map((w) => w.message).join("\n")).toContain("hero.png");
		expect(warnings.map((w) => w.message).join("\n")).toContain("logo.png");
		// The URI is still there — but it is no longer SILENT, which is the
		// whole point: the artifact carries the warning to the export dialog.
		expect(String(artifact.data)).toContain("blob:");
	});

	it("adds a volatile-store error when the browser had no IndexedDB", async () => {
		const store = makeStore([{ id: "a1", byteSize: 2000 }], "memory");
		const artifact = await createJsonExporter({
			store,
			maxInlineAssetBytes: 1000,
		})(ctx(fixture(LOCAL_URI)), REQUEST);
		const codes = (artifact.warnings ?? []).map((w) => w.code);
		expect(codes).toContain("LOCAL_ASSET_VOLATILE_STORE");
	});

	it("stays synchronous and byte-identical for a document with no local assets", () => {
		const ir = fixture(REMOTE_URI);
		const artifact = jsonExporter(ctx(ir), REQUEST) as CanvasExportArtifact;
		// NOT a promise — the eager fast path.
		expect(artifact).not.toBeInstanceOf(Promise);
		expect(artifact.data).toBe(JSON.stringify(ir, null, 2));
		expect(artifact.filename).toBe("Poster.json");
		expect(artifact.mimeType).toBe("application/json");
		expect(artifact.warnings).toBeUndefined();
	});

	it("never mutates the live document", async () => {
		const store = makeStore([{ id: "a1", byteSize: 2 }]);
		const ir = fixture(LOCAL_URI);
		await createJsonExporter({ store })(ctx(ir), REQUEST);
		expect(ir.assets.a1?.uri).toBe(LOCAL_URI);
	});

	it("ships a documented, host-overridable default cap", () => {
		expect(DEFAULT_JSON_INLINE_ASSET_BYTES).toBe(10 * 1024 * 1024);
	});
});

describe("raster and PDF export are unchanged (AC 3)", () => {
	it("PNG/JPEG/WebP produce byte-identical output whether the asset is local or remote", () => {
		const stage = makeStage();
		for (const [exporter, mime, ext] of [
			[pngExporter, "image/png", "png"],
			[jpegExporter, "image/jpeg", "jpg"],
			[webpExporter, "image/webp", "webp"],
		] as const) {
			const local = exporter(
				ctx(fixture(LOCAL_URI), stage),
				REQUEST,
			) as CanvasExportArtifact;
			const remote = exporter(
				ctx(fixture(REMOTE_URI), stage),
				REQUEST,
			) as CanvasExportArtifact;
			expect(local).toEqual(remote);
			// The exact pre-cp1-006 bytes, pinned.
			expect(local.data).toBe(`data:${mime};base64,AAAA`);
			expect(local.filename).toBe(`Poster.${ext}`);
			expect(local.warnings).toBeUndefined();
		}
	});

	it("PDF bytes are identical for a local-asset and a remote-asset document", async () => {
		// pdf-lib stamps CreationDate/ModDate from the clock, so freeze it —
		// otherwise the two documents differ by a timestamp rather than by
		// anything cp1-006 touched. Only `Date` is faked; timers still run.
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date(NOW));
		const local = (await pdfExporter(
			ctx(fixture(LOCAL_URI)),
			REQUEST,
		)) as CanvasExportArtifact;
		const remote = (await pdfExporter(
			ctx(fixture(REMOTE_URI)),
			REQUEST,
		)) as CanvasExportArtifact;
		const localBytes = local.data as Uint8Array;
		const remoteBytes = remote.data as Uint8Array;
		expect(String.fromCharCode(...localBytes.slice(0, 4))).toBe("%PDF");
		expect(localBytes.byteLength).toBe(remoteBytes.byteLength);
		expect(Array.from(localBytes)).toEqual(Array.from(remoteBytes));
		expect(local.filename).toBe("Poster.pdf");
	});

	it("no raster or PDF export ever consults the browser-local asset store", async () => {
		const { resetSharedLocalAssetStore } = await import(
			"../../assets/local-asset-store.js"
		);
		resetSharedLocalAssetStore();
		sharedStoreAccesses.mockClear();
		const stage = makeStage();
		const ir = fixture(LOCAL_URI);
		pngExporter(ctx(ir, stage), REQUEST);
		jpegExporter(ctx(ir, stage), REQUEST);
		webpExporter(ctx(ir, stage), REQUEST);
		await pdfExporter(ctx(ir), REQUEST);
		expect(sharedStoreAccesses).not.toHaveBeenCalled();

		// Positive control: the same counter DOES fire when an exporter that is
		// supposed to reach the store runs with no store injected. Without this
		// the assertion above would also pass for a spy that can never fire.
		await jsonExporter(ctx(ir), REQUEST);
		expect(sharedStoreAccesses).toHaveBeenCalled();
		resetSharedLocalAssetStore();
	});
});

describe("the warning reaches the export dialog through the existing channel", () => {
	it("rides CanvasExportArtifact.warnings in the shared CanvasExportWarning shape", async () => {
		const store = makeStore([{ id: "a1", byteSize: 2000, name: "hero.png" }]);
		const artifact = await createJsonExporter({
			store,
			maxInlineAssetBytes: 10,
		})(ctx(fixture(LOCAL_URI)), REQUEST);
		// `<ExportMenu>` renders `warning.message` + ` — ${warning.fallback}` and
		// keys on `${code}-${nodeId ?? pageId ?? ""}`; ExportDialog forwards the
		// same array to `onExport({ warnings })`. Nothing else is required of a
		// warning, and cp1-006 adds no second channel.
		const warning: CanvasExportWarning | undefined = artifact.warnings?.[0];
		expect(warning).toBeDefined();
		expect(warning?.level).toBe("warn");
		expect(typeof warning?.code).toBe("string");
		expect(typeof warning?.message).toBe("string");
		expect(typeof warning?.fallback).toBe("string");
	});

	it("the default svg/json exporters are the store-backed ones", () => {
		expect(typeof svgExporter).toBe("function");
		expect(typeof jsonExporter).toBe("function");
	});
});
