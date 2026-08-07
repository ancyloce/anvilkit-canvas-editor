import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	CanvasAssetPickOptions,
	CanvasPickedAsset,
	CanvasUploadedAsset,
} from "../adapter-types.js";
import { LocalAssetStoreError } from "../local-asset-store.js";
import type { LocalAssetPickerOptions } from "../local-picker.js";

/**
 * cp1-004 — the lazy shim that turns `cp1-002`'s uploader and `cp1-003`'s
 * picker into two adapter objects `<CanvasStudio>` can put in context on the
 * FIRST render without importing either module eagerly.
 *
 * The two heavy modules are mocked at their module boundary rather than
 * faked deeper down. That is the only way to assert the two properties this
 * module actually owns — that nothing is constructed until first use, and
 * that exactly one uploader and one picker are ever built — and it keeps
 * these tests off the store, the file dialog and the object-URL mint, all of
 * which `cp1-001`/`cp1-002`/`cp1-003` already cover against their own doubles.
 */

const mocks = vi.hoisted(() => ({
	createUploader: vi.fn(),
	createPicker: vi.fn(),
	upload: vi.fn(),
	pick: vi.fn(),
	dispose: vi.fn(),
}));

vi.mock("../local-uploader.js", () => ({
	createLocalAssetUploader: (...args: unknown[]) =>
		mocks.createUploader(...args),
}));

vi.mock("../local-picker.js", () => ({
	createLocalAssetPicker: (...args: unknown[]) => mocks.createPicker(...args),
}));

const { createLocalAssetFallback } = await import("../local-fallback.js");
type Fallback = ReturnType<typeof createLocalAssetFallback>;

/** The options the fallback handed `createLocalAssetPicker`, once loaded. */
let pickerOptions: LocalAssetPickerOptions | undefined;

const described: string[] = [];
const reported: Array<{ code?: string; message: string }> = [];

function makeFallback(overrides: { documentId?: string } = {}): Fallback {
	return createLocalAssetFallback({
		getDocumentId: () => overrides.documentId ?? "doc-1",
		describeFailure: (failure) => {
			const message = `described:${failure.code ?? "unknown"}:${failure.limitBytes ?? "-"}`;
			described.push(message);
			return message;
		},
		reportFailure: (failure, message) => {
			reported.push({
				...(failure.code ? { code: failure.code } : {}),
				message,
			});
		},
	});
}

const file = (name: string): File =>
	new File(["x"], name, { type: "image/png" });

const capError = (code: "asset-too-large" | "store-full") =>
	new LocalAssetStoreError({
		code,
		assetId: "a1",
		byteSize: 30 * 1024 * 1024,
		limitBytes: 25 * 1024 * 1024,
		message: "developer-facing English",
	});

beforeEach(() => {
	pickerOptions = undefined;
	described.length = 0;
	reported.length = 0;
	mocks.createUploader.mockReset();
	mocks.createPicker.mockReset();
	mocks.upload.mockReset();
	mocks.pick.mockReset();
	mocks.dispose.mockReset();
	mocks.createUploader.mockImplementation(() => ({ upload: mocks.upload }));
	mocks.createPicker.mockImplementation((options: LocalAssetPickerOptions) => {
		pickerOptions = options;
		return { pick: mocks.pick, dispose: mocks.dispose };
	});
	mocks.upload.mockImplementation(
		async (files: readonly File[]): Promise<readonly CanvasUploadedAsset[]> =>
			files.map((f, i) => ({ id: `up-${i}`, uri: `blob:${f.name}` })),
	);
	mocks.pick.mockImplementation(
		async (): Promise<readonly CanvasPickedAsset[]> => [],
	);
});

describe("createLocalAssetFallback — laziness", () => {
	it("constructs neither adapter until the first upload or pick", async () => {
		const fallback = makeFallback();
		expect(mocks.createUploader).not.toHaveBeenCalled();
		expect(mocks.createPicker).not.toHaveBeenCalled();
		// The proxies exist from the start — that is what makes `hasImagePicker`
		// true on the first render.
		expect(typeof fallback.uploader.upload).toBe("function");
		expect(typeof fallback.picker.pick).toBe("function");

		await fallback.picker.pick({ multiple: false, kind: "image" });

		expect(mocks.createUploader).toHaveBeenCalledTimes(1);
		expect(mocks.createPicker).toHaveBeenCalledTimes(1);
	});

	it("builds exactly one uploader and one picker across many operations", async () => {
		const fallback = makeFallback();
		await fallback.picker.pick({ multiple: false });
		await fallback.uploader.upload([file("a.png")], { documentId: "doc-1" });
		await fallback.picker.pick({ multiple: true });
		await fallback.uploader.upload([file("b.png")], { documentId: "doc-1" });

		expect(mocks.createUploader).toHaveBeenCalledTimes(1);
		expect(mocks.createPicker).toHaveBeenCalledTimes(1);
	});

	it("loads once even when two operations start concurrently", async () => {
		const fallback = makeFallback();
		await Promise.all([
			fallback.picker.pick({ multiple: false }),
			fallback.uploader.upload([file("a.png")], { documentId: "doc-1" }),
		]);
		expect(mocks.createUploader).toHaveBeenCalledTimes(1);
		expect(mocks.createPicker).toHaveBeenCalledTimes(1);
	});

	it("forwards pick options and upload context untouched", async () => {
		const fallback = makeFallback();
		const options: CanvasAssetPickOptions = { multiple: true, kind: "svg" };
		await fallback.picker.pick(options);
		expect(mocks.pick).toHaveBeenCalledWith(options);

		const controller = new AbortController();
		const onProgress = vi.fn();
		const files = [file("a.png")];
		await fallback.uploader.upload(files, {
			documentId: "doc-9",
			signal: controller.signal,
			onProgress,
		});
		expect(mocks.upload).toHaveBeenCalledWith(files, {
			documentId: "doc-9",
			signal: controller.signal,
			onProgress,
		});
	});
});

describe("createLocalAssetFallback — one ingest implementation", () => {
	it("routes picked files through the uploader, not a second storage path", async () => {
		const fallback = makeFallback({ documentId: "doc-42" });
		await fallback.picker.pick({ multiple: true });
		const ingest = pickerOptions?.ingest;
		expect(ingest).toBeTypeOf("function");

		const files = [file("a.png"), file("b.png")];
		const picked = await ingest?.(files);

		expect(mocks.upload).toHaveBeenCalledWith(files, { documentId: "doc-42" });
		expect(picked).toEqual([
			{ id: "up-0", uri: "blob:a.png" },
			{ id: "up-1", uri: "blob:b.png" },
		]);
	});

	it("reads the document id at ingest time, not at construction time", async () => {
		let documentId = "doc-before";
		const fallback = createLocalAssetFallback({
			getDocumentId: () => documentId,
			describeFailure: () => "",
			reportFailure: () => undefined,
		});
		await fallback.picker.pick({ multiple: false });
		documentId = "doc-after";
		await pickerOptions?.ingest?.([file("a.png")]);
		expect(mocks.upload).toHaveBeenCalledWith(expect.anything(), {
			documentId: "doc-after",
		});
	});
});

describe("createLocalAssetFallback — the error-contract mismatch", () => {
	it("reports a cap breach on the PICK path and resolves empty", async () => {
		// Without this, `pick()` would reject and `imageTool` would swallow the
		// rejection as "user cancelled" — the user would see nothing at all.
		mocks.upload.mockRejectedValueOnce(capError("asset-too-large"));
		const fallback = makeFallback();
		await fallback.picker.pick({ multiple: false });

		const picked = await pickerOptions?.ingest?.([file("huge.png")]);

		expect(picked).toEqual([]);
		expect(reported).toEqual([
			{
				code: "asset-too-large",
				message: `described:asset-too-large:${25 * 1024 * 1024}`,
			},
		]);
	});

	it("reports a store-full breach with its own code", async () => {
		mocks.upload.mockRejectedValueOnce(capError("store-full"));
		const fallback = makeFallback();
		await fallback.picker.pick({ multiple: false });
		await pickerOptions?.ingest?.([file("a.png")]);
		expect(reported[0]?.code).toBe("store-full");
	});

	it("describes a NON-cap pick failure generically, with no size numbers", async () => {
		mocks.upload.mockRejectedValueOnce(
			new Error("URL.createObjectURL is gone"),
		);
		const fallback = makeFallback();
		await fallback.picker.pick({ multiple: false });

		const picked = await pickerOptions?.ingest?.([file("a.png")]);

		expect(picked).toEqual([]);
		expect(reported).toEqual([{ message: "described:unknown:-" }]);
	});

	it("rethrows a cap breach on the UPLOAD path with the described message", async () => {
		const cause = capError("asset-too-large");
		mocks.upload.mockRejectedValueOnce(cause);
		const fallback = makeFallback();

		const rejection = await fallback.uploader
			.upload([file("huge.png")], { documentId: "doc-1" })
			.then(
				() => undefined,
				(err: unknown) => err,
			);

		// The editor's existing `canvas.upload.failed` toast shows `.message`,
		// so this is what makes the drop path localized rather than showing
		// the store's developer-facing English.
		expect((rejection as Error).message).toBe(
			`described:asset-too-large:${25 * 1024 * 1024}`,
		);
		expect((rejection as Error).cause).toBe(cause);
		// The upload path must NOT also report: `uploadFilesImpl` already
		// toasts the rejection, and reporting here would double it.
		expect(reported).toEqual([]);
	});

	it("passes a NON-cap upload rejection through unchanged, so a cancel stays a cancel", async () => {
		// `uploadSingleFile` decides "cancelled, not failed" from the signal, but
		// any rewriting here would still change what a host or a later handler
		// sees. Identity, not just message, must survive.
		const abort = new DOMException("The user aborted a request.", "AbortError");
		mocks.upload.mockRejectedValueOnce(abort);
		const fallback = makeFallback();

		const rejection = await fallback.uploader
			.upload([file("a.png")], { documentId: "doc-1" })
			.then(
				() => undefined,
				(err: unknown) => err,
			);

		expect(rejection).toBe(abort);
		expect(described).toEqual([]);
	});
});

describe("createLocalAssetFallback — disposal", () => {
	it("is a no-op before anything has loaded", () => {
		const fallback = makeFallback();
		fallback.dispose();
		expect(mocks.createPicker).not.toHaveBeenCalled();
		expect(mocks.dispose).not.toHaveBeenCalled();
	});

	it("releases the picker's hidden input after a load", async () => {
		const fallback = makeFallback();
		await fallback.picker.pick({ multiple: false });
		fallback.dispose();
		await Promise.resolve();
		expect(mocks.dispose).toHaveBeenCalledTimes(1);
	});

	it("releases a picker whose load was still in flight when dispose ran", async () => {
		// The unmount-during-first-pick race: without riding the same promise,
		// the input would be created AFTER teardown and never removed.
		const fallback = makeFallback();
		const pending = fallback.picker.pick({ multiple: false });
		fallback.dispose();
		await pending;
		await Promise.resolve();
		expect(mocks.dispose).toHaveBeenCalled();
	});

	it("is not terminal — a later use reconstructs the pair", async () => {
		const fallback = makeFallback();
		await fallback.picker.pick({ multiple: false });
		fallback.dispose();
		await fallback.picker.pick({ multiple: false });
		expect(mocks.createPicker).toHaveBeenCalledTimes(2);
		expect(mocks.createUploader).toHaveBeenCalledTimes(2);
	});

	it("tolerates being disposed twice", async () => {
		const fallback = makeFallback();
		await fallback.picker.pick({ multiple: false });
		fallback.dispose();
		fallback.dispose();
		await Promise.resolve();
		expect(mocks.dispose).toHaveBeenCalledTimes(1);
	});
});
