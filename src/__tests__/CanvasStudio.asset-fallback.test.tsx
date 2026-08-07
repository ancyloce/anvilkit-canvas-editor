import {
	type CanvasImageNode,
	type CanvasIR,
	createCanvasIR,
	createPage,
} from "@anvilkit/canvas-core";
import { act, cleanup, render } from "@testing-library/react";
import { type ReactNode, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalAssetFallbackOptions } from "../assets/local-fallback.js";
import type { CanvasStudioContextValue } from "../context/canvas-studio-context.js";
import {
	CanvasToastContext,
	type CanvasToaster,
	type CanvasToastInput,
} from "../context/toast-context.js";

/**
 * cp1-004 — default adapter wiring and `disableLocalAssetFallback`.
 *
 * The load-bearing assertion in here is the NEGATIVE one: a host that passes
 * any asset adapter must not merely "win" — the fallback must never be
 * constructed at all, so there is no second storage path in existence and
 * nothing to accidentally prefer later. That is asserted by spying on the
 * factory itself rather than on the adapter that ends up in context, because
 * only the factory spy can tell "the host's adapter was used" apart from "the
 * host's adapter was used AND a hidden <input> was created behind it".
 */

const mocks = vi.hoisted(() => ({ createFallback: vi.fn() }));

vi.mock("../assets/local-fallback.js", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../assets/local-fallback.js")>();
	return {
		...actual,
		// Delegates to the real implementation: the end-to-end upload test below
		// exercises the genuine store/uploader/picker chain through this spy.
		createLocalAssetFallback: (options: LocalAssetFallbackOptions) => {
			mocks.createFallback(options);
			return actual.createLocalAssetFallback(options);
		},
	};
});

function makeMock(type: string) {
	return (props: Record<string, unknown>) => {
		const { children } = props as { children?: ReactNode };
		return <div data-testid={type.toLowerCase()}>{children}</div>;
	};
}

vi.mock("react-konva", () => {
	type StageProps = { children?: ReactNode; ref?: { current: object | null } };
	const Stage = (props: StageProps) => {
		if (props.ref && "current" in props.ref) {
			const container = document.createElement("div");
			props.ref.current = {
				destroy: vi.fn(),
				on: vi.fn(),
				off: vi.fn(),
				container: () => container,
				getPointerPosition: () => null,
			};
		}
		return <div data-testid="stage">{props.children}</div>;
	};
	return {
		Stage,
		Layer: makeMock("Layer"),
		Group: makeMock("Group"),
		Rect: makeMock("Rect"),
		Ellipse: makeMock("Ellipse"),
		Line: makeMock("Line"),
		Path: makeMock("Path"),
		Text: makeMock("Text"),
		Image: makeMock("Image"),
		Label: makeMock("Label"),
		Tag: makeMock("Tag"),
		Transformer: makeMock("Transformer"),
	};
});

vi.mock("use-image", () => ({ default: () => [null, "loading"] }));

vi.mock("../render/rasterize-page.js", () => ({
	rasterizePage: vi.fn(async ({ page }: { page: { id: string } }) => ({
		url: `data:thumb/${page.id}`,
		mimeType: "image/png",
	})),
}));

import { resetSharedLocalAssetStore } from "../assets/local-asset-store.js";
import { uploadFilesImpl } from "../assets/upload-actions.js";
import { CanvasStudio, useCanvasStudio } from "../index.js";

const NO_UPLOADER_TITLE = "This workspace has no upload service configured";
const ASSET_LIMIT_BYTES = 25 * 1024 * 1024;

function fixtureIR(): CanvasIR {
	return createCanvasIR({
		id: "doc-1",
		pages: [createPage({ id: "p1", size: { width: 800, height: 600 } })],
		now: () => "2026-05-20T00:00:00.000Z",
	});
}

let ctx: CanvasStudioContextValue | undefined;
function CaptureCtx(): null {
	const value = useCanvasStudio();
	useEffect(() => {
		ctx = value;
	});
	ctx = value;
	return null;
}

const toasts: CanvasToastInput[] = [];
const toaster: CanvasToaster = { add: (input) => toasts.push(input) };

function mount(props: Record<string, unknown> = {}) {
	return render(
		<CanvasToastContext.Provider value={toaster}>
			<CanvasStudio initialIR={fixtureIR()} initialActivePageId="p1" {...props}>
				<CaptureCtx />
			</CanvasStudio>
		</CanvasToastContext.Provider>,
	);
}

const file = (name: string): File =>
	new File(["x"], name, { type: "image/png" });

const hostUploader = { upload: vi.fn(async () => []) };
const hostPicker = { pick: vi.fn(async () => []) };

/** The options the studio handed the (spied) fallback factory. */
function fallbackOptions(): LocalAssetFallbackOptions {
	const first = mocks.createFallback.mock.calls[0]?.[0] as
		| LocalAssetFallbackOptions
		| undefined;
	if (!first) throw new Error("the fallback factory was never called");
	return first;
}

beforeEach(() => {
	ctx = undefined;
	toasts.length = 0;
	mocks.createFallback.mockClear();
	hostUploader.upload.mockClear();
	hostPicker.pick.mockClear();
	resetSharedLocalAssetStore();
});

// The react-library preset runs `globals: false`, so RTL auto-cleanup is OFF.
afterEach(cleanup);

describe("cp1-004 precedence — the fallback is a floor, never an override", () => {
	it("never constructs the fallback when the host passed an assetUploader", () => {
		mount({ assetUploader: hostUploader });
		expect(mocks.createFallback).not.toHaveBeenCalled();
		expect(ctx?.assetUploader).toBe(hostUploader);
		// Byte-identical to the pre-cp1-004 build: an uploader alone has never
		// un-gated the image tool, and must not start now.
		expect(ctx?.assetPicker).toBeUndefined();
		expect(ctx?.hasImagePicker).toBe(false);
	});

	it("never constructs the fallback when the host passed an assetPicker", () => {
		mount({ assetPicker: hostPicker });
		expect(mocks.createFallback).not.toHaveBeenCalled();
		expect(ctx?.assetPicker).toBe(hostPicker);
		expect(ctx?.assetUploader).toBeUndefined();
		expect(ctx?.hasImagePicker).toBe(true);
	});

	it("never constructs the fallback when the host passed the legacy onPickAsset", async () => {
		const onPickAsset = vi.fn(async () => "legacy-asset");
		mount({ onPickAsset });
		expect(mocks.createFallback).not.toHaveBeenCalled();
		expect(ctx?.assetPicker).toBeUndefined();
		expect(ctx?.hasImagePicker).toBe(true);
		// The legacy single-uri path still runs, untouched.
		await expect(ctx?.pickAsset()).resolves.toBe("legacy-asset");
		expect(onPickAsset).toHaveBeenCalledTimes(1);
	});

	it("never constructs the fallback when it is explicitly disabled", () => {
		mount({ disableLocalAssetFallback: true });
		expect(mocks.createFallback).not.toHaveBeenCalled();
		expect(ctx?.assetPicker).toBeUndefined();
		expect(ctx?.assetUploader).toBeUndefined();
		expect(ctx?.hasImagePicker).toBe(false);
	});

	it("constructs it on a bare mount and puts BOTH adapters in context", () => {
		mount();
		expect(mocks.createFallback).toHaveBeenCalledTimes(1);
		expect(ctx?.assetPicker).toBeDefined();
		expect(ctx?.assetUploader).toBeDefined();
		expect(ctx?.pickAssets).toBeTypeOf("function");
		// Deliverable 3: this is what un-gates the Image tool in `ToolStrip`.
		expect(ctx?.hasImagePicker).toBe(true);
	});
});

describe("cp1-004 lifecycle — constructed once, disposed on unmount", () => {
	it("survives re-renders with fresh inline props without rebuilding", () => {
		const { rerender } = render(
			<CanvasStudio
				initialIR={fixtureIR()}
				initialActivePageId="p1"
				messages={{ "canvas.upload.failed": "A" }}
				onChange={() => undefined}
			>
				<CaptureCtx />
			</CanvasStudio>,
		);
		const first = ctx?.assetPicker;
		// New object identities for both, exactly what an inline literal does
		// on every host render. The fallback owns a DOM node — rebuilding it
		// here would leak one hidden <input> per render.
		rerender(
			<CanvasStudio
				initialIR={fixtureIR()}
				initialActivePageId="p1"
				messages={{ "canvas.upload.failed": "B" }}
				onChange={() => undefined}
			>
				<CaptureCtx />
			</CanvasStudio>,
		);
		expect(mocks.createFallback).toHaveBeenCalledTimes(1);
		expect(ctx?.assetPicker).toBe(first);
	});

	it("disposes the fallback when the editor unmounts", async () => {
		const { unmount } = mount();
		const studio = ctx;
		if (!studio) throw new Error("no context");

		// An empty upload is the deterministic way to force the lazy load: it
		// resolves as soon as the modules are in, with no store write and no
		// dialog. `pick()` cannot be used for that — jsdom opens no file dialog,
		// so a pick stays pending until something settles it.
		await act(async () => {
			await studio.assetUploader?.upload([], { documentId: "doc-1" });
		});
		const pending = studio.assetPicker?.pick({
			multiple: false,
			kind: "image",
		});
		await act(async () => {
			/* let pick() reach ensureInput() */
		});
		expect(document.querySelectorAll('input[type="file"]')).toHaveLength(1);

		unmount();
		// The unmount is the "dialog still open" case: dispose must settle the
		// pending pick as well as remove the input, or the caller's await is
		// stranded forever.
		await act(async () => {
			await expect(pending).resolves.toEqual([]);
		});

		expect(document.querySelectorAll('input[type="file"]')).toHaveLength(0);
	});
});

describe("cp1-004 zero-config ingest", () => {
	beforeEach(() => {
		// jsdom has neither, and both are what the default uploader needs to
		// produce a URI and intrinsic bounds. Stubbing them here is what makes
		// this an integration test of the WIRING rather than of jsdom.
		vi.stubGlobal("createImageBitmap", async () => ({
			width: 120,
			height: 80,
			close: () => undefined,
		}));
		// Added ONTO the real `URL` rather than replacing the global: a
		// replacement object is not constructible, and `new URL(…)` is used
		// elsewhere in the commit path — swapping it turns this into a test of
		// the stub instead of a test of the wiring.
		Object.assign(URL, {
			createObjectURL: (blob: Blob) => `blob:local/${blob.size}`,
			revokeObjectURL: () => undefined,
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		Reflect.deleteProperty(URL, "createObjectURL");
		Reflect.deleteProperty(URL, "revokeObjectURL");
	});

	it("a bare mount ingests a dropped file into an image node with intrinsic bounds", async () => {
		mount();
		const studio = ctx;
		if (!studio) throw new Error("no context");

		let ids: string[] = [];
		await act(async () => {
			ids = await uploadFilesImpl(
				studio,
				[file("photo.png")],
				{ x: 40, y: 60 },
				toaster,
			);
		});

		expect(ids).toHaveLength(1);
		const ir = studio.getIR();
		const node = ir.pages[0]?.root.children[0] as CanvasImageNode | undefined;
		expect(node?.type).toBe("image");
		// Intrinsic size from the decoder, anchored at the drop point — not the
		// 240x180 default box the insert path falls back to without a size.
		expect(node?.bounds).toMatchObject({ width: 120, height: 80 });
		expect(node?.transform).toMatchObject({ x: 40, y: 60 });

		const assetId = node?.assetId ?? "";
		expect(ir.assets[assetId]).toMatchObject({
			mimeType: "image/png",
			width: 120,
			height: 80,
		});
		// A real, resolvable URI — this is what makes the node RENDER rather
		// than fall through to the missing-asset state.
		expect(ir.assets[assetId]?.uri).toMatch(/^blob:local\//);

		// Deliverable 4: the hard-stop toast must NOT fire in the default path.
		expect(toasts.map((toast) => toast.title)).not.toContain(NO_UPLOADER_TITLE);
	});

	it("restores the pre-cp1-004 hard stop when the fallback is disabled", async () => {
		mount({ disableLocalAssetFallback: true });
		const studio = ctx;
		if (!studio) throw new Error("no context");

		let ids: string[] = [];
		await act(async () => {
			ids = await uploadFilesImpl(
				studio,
				[file("photo.png")],
				undefined,
				toaster,
			);
		});

		expect(ids).toEqual([]);
		expect(studio.getIR().pages[0]?.root.children).toHaveLength(0);
		expect(toasts).toEqual([{ type: "info", title: NO_UPLOADER_TITLE }]);
	});
});

describe("cp1-004 failure messages", () => {
	it("localizes a cap breach and delivers it through the shell's toaster", () => {
		mount({
			messages: {
				"canvas.upload.failed": "アップロードに失敗しました",
				"canvas.upload.localAssetTooLarge":
					"このファイルはサイズが大きすぎます（上限 {limit}）。",
			},
		});
		const options = fallbackOptions();
		const failure = {
			code: "asset-too-large" as const,
			byteSize: 30 * 1024 * 1024,
			limitBytes: ASSET_LIMIT_BYTES,
			error: new Error("developer-facing English"),
		};

		const message = options.describeFailure(failure);
		expect(message).toBe("このファイルはサイズが大きすぎます（上限 25 MB）。");

		options.reportFailure(failure, message);
		expect(toasts).toEqual([
			{
				type: "error",
				title: "アップロードに失敗しました",
				description: message,
			},
		]);
	});

	it("describes a store-full breach and a generic failure distinctly", () => {
		mount();
		const options = fallbackOptions();
		expect(
			options.describeFailure({
				code: "store-full",
				limitBytes: 200 * 1024 * 1024,
				error: new Error("x"),
			}),
		).toBe(
			"Local image storage is full (limit 200 MB). Remove some images and try again.",
		);
		// No code, no numbers: a decoder throw is not a size problem and must
		// not be reported as one.
		expect(
			options.describeFailure({ error: new Error("URL.createObjectURL gone") }),
		).toBe("This file could not be added.");
	});

	it("uses the document id live, so an upload targets the current document", () => {
		mount();
		expect(fallbackOptions().getDocumentId()).toBe("doc-1");
	});
});
