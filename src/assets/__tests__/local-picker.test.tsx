import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import { ToolStrip } from "@/workspace/toolstrip/ToolStrip.js";
import type { CanvasAssetPickOptions } from "../adapter-types.js";
import type { LocalAssetMeta, LocalAssetStore } from "../local-asset-store.js";
import {
	createLocalAssetPicker,
	type LocalAssetPicker,
	type LocalAssetPickerOptions,
	resolveAcceptAttribute,
} from "../local-picker.js";

/**
 * ## What jsdom can and cannot prove here
 *
 * jsdom has no file dialog: `input.click()` dispatches a click event and stops
 * there, and `input.files` cannot be populated (there is no `DataTransfer`
 * constructor and the `files` setter demands a real `FileList`). So the OS
 * dialog is emulated by {@link attachFakeDialog}, which owns the two pieces of
 * state a real file input owns — `value` and the selected-file list — and
 * reproduces the ONE browser rule this task is about: **`change` fires only
 * when the selection changes**, so re-picking a file the input still holds
 * fires nothing.
 *
 * That means these tests prove the picker's *logic*: which attributes it puts
 * on the input, that it clears `value` so a repeated pick is a fresh
 * selection, that every path settles exactly once, and that picked files reach
 * the store. They do NOT prove that a real browser opens a dialog for a
 * `display:none` input, that `cancel` fires where we expect, or that the
 * window-focus fallback times out correctly against a real OS dialog. Those
 * belong to `cp6-004`'s zero-config smoke E2E.
 *
 * The {@link LocalAssetStore} is mocked at the interface rather than faked at
 * the IndexedDB level: this module depends on the store's contract, and
 * `cp1-001`'s own suite already covers the backend.
 */

/**
 * Every picker built by {@link setup} is disposed here. RTL's auto-cleanup is
 * off in this package (`globals: false`), and a picker's hidden input lives on
 * `document.body` OUTSIDE any RTL container — so without this a leaked input
 * from one test is what the next test's `querySelector` finds.
 */
const disposables: LocalAssetPicker[] = [];

afterEach(() => {
	for (const picker of disposables.splice(0)) picker.dispose();
	cleanup();
	for (const stray of document.body.querySelectorAll('input[type="file"]')) {
		stray.remove();
	}
});

// --------------------------------------------------------------------------
// Doubles
// --------------------------------------------------------------------------

function makeStoreMock() {
	const blobs = new Map<string, Blob>();
	const metas = new Map<string, LocalAssetMeta>();
	const deleted: string[] = [];
	const store: LocalAssetStore = {
		put(id, blob, meta) {
			const record: LocalAssetMeta = {
				id,
				mimeType: meta?.mimeType ?? (blob.type || "application/octet-stream"),
				byteSize: blob.size,
				createdAt: meta?.createdAt ?? 0,
				...(meta?.width !== undefined ? { width: meta.width } : {}),
				...(meta?.height !== undefined ? { height: meta.height } : {}),
				...(meta?.name !== undefined ? { name: meta.name } : {}),
			};
			blobs.set(id, blob);
			metas.set(id, record);
			return Promise.resolve(record);
		},
		get: (id) => Promise.resolve(blobs.get(id)),
		delete(id) {
			deleted.push(id);
			blobs.delete(id);
			metas.delete(id);
			return Promise.resolve();
		},
		list: () => Promise.resolve([...metas.values()]),
		has: (id) => Promise.resolve(metas.has(id)),
		usage: () =>
			Promise.resolve({
				count: metas.size,
				totalBytes: 0,
				maxAssetBytes: 0,
				maxTotalBytes: 0,
			}),
		clear() {
			blobs.clear();
			metas.clear();
			return Promise.resolve();
		},
		backend: () => Promise.resolve("memory" as const),
		close: () => undefined,
	};
	return { store, blobs, metas, deleted };
}

interface FakeDialog {
	/** How many `change` events the emulated dialog actually fired. */
	readonly changes: number;
	/** Emulate the user choosing files and confirming. */
	choose(files: readonly File[]): void;
	/** Emulate a dismissal on an engine that fires `cancel`. */
	cancel(): void;
	/** Emulate the window regaining focus after the dialog closed. */
	refocus(): void;
}

function sameSelection(a: readonly File[], b: readonly File[]): boolean {
	return a.length === b.length && a.every((file, i) => file === b[i]);
}

/**
 * Take over the two pieces of state a real `<input type="file">` owns, so the
 * emulated dialog obeys the browser's change-only-on-change rule.
 */
function attachFakeDialog(input: HTMLInputElement): FakeDialog {
	let selection: File[] = [];
	let value = "";
	let changes = 0;
	Object.defineProperty(input, "value", {
		configurable: true,
		get: () => value,
		set: (next: unknown) => {
			value = String(next);
			// Real semantics: assigning "" empties the selected-file list.
			if (value === "") selection = [];
		},
	});
	Object.defineProperty(input, "files", {
		configurable: true,
		get: () => selection,
	});
	return {
		get changes() {
			return changes;
		},
		choose(files) {
			// The classic bug this task exists to defeat: a browser fires
			// `change` only when the selection CHANGES, so re-picking a file the
			// input still holds fires nothing at all.
			if (sameSelection(selection, files)) return;
			selection = [...files];
			value = `C:\\fakepath\\${files[0]?.name ?? ""}`;
			changes += 1;
			input.dispatchEvent(new Event("change"));
		},
		cancel() {
			input.dispatchEvent(new Event("cancel"));
		},
		refocus() {
			window.dispatchEvent(new Event("focus"));
		},
	};
}

function requireInput(): HTMLInputElement {
	const el =
		document.body.querySelector<HTMLInputElement>('input[type="file"]');
	if (!el) throw new Error("the picker did not create a hidden file input");
	return el;
}

function makeFile(name: string, type = "image/png", bytes = "abc"): File {
	return new File([bytes], name, { type });
}

interface Setup {
	picker: LocalAssetPicker;
	store: ReturnType<typeof makeStoreMock>;
	warn: ReturnType<typeof vi.fn>;
}

function setup(overrides: Partial<LocalAssetPickerOptions> = {}): Setup {
	const store = makeStoreMock();
	const warn = vi.fn();
	let seq = 0;
	const picker = createLocalAssetPicker({
		store: store.store,
		createId: () => `asset-${++seq}`,
		createObjectURL: (blob) => `blob:mock/${blob.size}`,
		// jsdom has no `createImageBitmap`; the default probe would return {}
		// anyway, so state it explicitly rather than depend on the environment.
		measure: () => Promise.resolve({}),
		cancelFallbackMs: 5,
		warn,
		...overrides,
	});
	disposables.push(picker);
	return { picker, store, warn };
}

/**
 * Open a dialog and hand back the emulated one. The input is created on the
 * first `pick()`, and `pick()` runs synchronously up to its first `await`, so
 * the element exists by the time this returns.
 */
function open(
	picker: LocalAssetPicker,
	options: CanvasAssetPickOptions = {},
): { picked: ReturnType<LocalAssetPicker["pick"]>; input: HTMLInputElement } {
	const picked = picker.pick(options);
	return { picked, input: requireInput() };
}

/** Fail loudly instead of hanging when a pick never settles. */
function withDeadline<T>(promise: Promise<T>, ms = 1000): Promise<T> {
	return Promise.race([
		promise,
		new Promise<never>((_, reject) => {
			setTimeout(
				() => reject(new Error(`pick() did not settle within ${ms}ms`)),
				ms,
			);
		}),
	]);
}

// --------------------------------------------------------------------------

describe("resolveAcceptAttribute (cp1-003: kind -> accept)", () => {
	it("maps every kind onto an input-accept value", () => {
		expect(resolveAcceptAttribute({ kind: "image" })).toBe("image/*");
		expect(resolveAcceptAttribute({ kind: "svg" })).toBe("image/svg+xml,.svg");
		expect(resolveAcceptAttribute({ kind: "video" })).toBe("video/*");
		expect(resolveAcceptAttribute({ kind: "audio" })).toBe("audio/*");
	});

	it("leaves the dialog unfiltered when neither accept nor kind is given", () => {
		expect(resolveAcceptAttribute({})).toBe("");
		expect(resolveAcceptAttribute({ accept: [] })).toBe("");
	});

	it("joins an explicit accept list and prefers it over kind", () => {
		expect(resolveAcceptAttribute({ accept: ["image/png", ".webp"] })).toBe(
			"image/png,.webp",
		);
		expect(
			resolveAcceptAttribute({ accept: ["image/png"], kind: "video" }),
		).toBe("image/png");
	});
});

describe("createLocalAssetPicker: option mapping onto the hidden input", () => {
	it("creates one hidden, non-focusable input on the first pick", () => {
		const { picker } = setup();
		expect(document.body.querySelector('input[type="file"]')).toBeNull();
		const { input } = open(picker, { kind: "image" });
		expect(input.style.display).toBe("none");
		expect(input.tabIndex).toBe(-1);
		expect(input.getAttribute("aria-hidden")).toBe("true");
		expect(input.isConnected).toBe(true);
		picker.dispose();
	});

	it("reuses the same input across picks and removes it on dispose", () => {
		const { picker } = setup();
		const first = open(picker).input;
		const second = open(picker).input;
		expect(second).toBe(first);
		picker.dispose();
		expect(first.isConnected).toBe(false);
		expect(document.body.querySelector('input[type="file"]')).toBeNull();
	});

	it("mirrors multiple/kind onto the input", () => {
		const { picker } = setup();
		const { input } = open(picker, { multiple: true, kind: "image" });
		expect(input.multiple).toBe(true);
		expect(input.accept).toBe("image/*");
		picker.dispose();
	});

	it("mirrors an explicit accept list and defaults multiple to false", () => {
		const { picker } = setup();
		const { input } = open(picker, { accept: ["image/png", ".webp"] });
		expect(input.multiple).toBe(false);
		expect(input.accept).toBe("image/png,.webp");
		picker.dispose();
	});

	it("removes a stale accept attribute when the next pick is unfiltered", () => {
		const { picker } = setup();
		const { input } = open(picker, { kind: "svg" });
		expect(input.accept).toBe("image/svg+xml,.svg");
		open(picker, {});
		expect(input.hasAttribute("accept")).toBe(false);
		picker.dispose();
	});
});

describe("createLocalAssetPicker: selection routes through the store", () => {
	it("stores one picked file and returns it as a CanvasPickedAsset", async () => {
		const { picker, store } = setup();
		const { picked, input } = open(picker, { kind: "image" });
		const dialog = attachFakeDialog(input);
		const file = makeFile("photo.png");
		dialog.choose([file]);
		const assets = await withDeadline(picked);

		expect(assets).toEqual([
			{ id: "asset-1", uri: "blob:mock/3", mimeType: "image/png" },
		]);
		expect(store.blobs.get("asset-1")).toBe(file);
		expect(store.metas.get("asset-1")?.name).toBe("photo.png");
		picker.dispose();
	});

	it("stores several picked files in order under multiple", async () => {
		const { picker, store } = setup();
		const { picked, input } = open(picker, { multiple: true, kind: "image" });
		const dialog = attachFakeDialog(input);
		const a = makeFile("a.png");
		const b = makeFile("b.png", "image/png", "abcd");
		dialog.choose([a, b]);
		const assets = await withDeadline(picked);

		expect(assets.map((asset) => asset.id)).toEqual(["asset-1", "asset-2"]);
		expect(store.blobs.get("asset-1")).toBe(a);
		expect(store.blobs.get("asset-2")).toBe(b);
		expect(assets[1]?.uri).toBe("blob:mock/4");
	});

	it("carries measured intrinsic size onto the asset", async () => {
		const { picker } = setup({
			measure: () => Promise.resolve({ width: 800, height: 600 }),
		});
		const { picked, input } = open(picker, { kind: "image" });
		attachFakeDialog(input).choose([makeFile("photo.png")]);
		const assets = await withDeadline(picked);
		expect(assets[0]).toMatchObject({ width: 800, height: 600 });
	});

	it("skips a file the store rejects and keeps the rest of the selection", async () => {
		const { picker, store, warn } = setup();
		const rejected = new Error("asset too large");
		// Only the FIRST put fails; the spy falls back to the real double after.
		const put = vi.spyOn(store.store, "put").mockRejectedValueOnce(rejected);
		const { picked, input } = open(picker, { multiple: true, kind: "image" });
		attachFakeDialog(input).choose([makeFile("big.png"), makeFile("ok.png")]);
		const assets = await withDeadline(picked);

		expect(put).toHaveBeenCalledTimes(2);
		expect(assets.map((asset) => asset.id)).toEqual(["asset-2"]);
		expect(warn).toHaveBeenCalledWith(
			'Could not store the picked file "big.png".',
			rejected,
		);
	});

	it("drops the stored blob when the URI cannot be minted", async () => {
		const { picker, store, warn } = setup({
			createObjectURL: () => {
				throw new Error("no URL.createObjectURL");
			},
		});
		const { picked, input } = open(picker, { kind: "image" });
		attachFakeDialog(input).choose([makeFile("photo.png")]);

		expect(await withDeadline(picked)).toEqual([]);
		// The orphan must not keep charging the user's storage cap.
		expect(store.deleted).toEqual(["asset-1"]);
		expect(store.blobs.size).toBe(0);
		expect(warn).toHaveBeenCalled();
	});

	it("hands selection to an injected ingest instead of the store", async () => {
		const ingest = vi.fn(() =>
			Promise.resolve([{ id: "from-uploader", uri: "blob:uploader" }]),
		);
		const { picker, store } = setup({ ingest });
		const { picked, input } = open(picker, { kind: "image" });
		const file = makeFile("photo.png");
		attachFakeDialog(input).choose([file]);

		expect(await withDeadline(picked)).toEqual([
			{ id: "from-uploader", uri: "blob:uploader" },
		]);
		expect(ingest).toHaveBeenCalledWith([file]);
		expect(store.blobs.size).toBe(0);
	});
});

describe("createLocalAssetPicker: cancelling never rejects and never hangs", () => {
	it("resolves [] on the cancel event", async () => {
		const { picker, store } = setup();
		const { picked, input } = open(picker, { kind: "image" });
		attachFakeDialog(input).cancel();
		expect(await withDeadline(picked)).toEqual([]);
		expect(store.blobs.size).toBe(0);
		picker.dispose();
	});

	it("resolves [] via the window-focus fallback on engines without cancel", async () => {
		const { picker } = setup({ cancelFallbackMs: 5 });
		const { picked, input } = open(picker, { kind: "image" });
		// No `cancel` event at all — only the window coming back.
		attachFakeDialog(input).refocus();
		expect(await withDeadline(picked)).toEqual([]);
		picker.dispose();
	});

	it("discards a change that lands after the focus fallback gave up", async () => {
		const { picker, store } = setup({ cancelFallbackMs: 5 });
		const { picked, input } = open(picker, { kind: "image" });
		const dialog = attachFakeDialog(input);
		dialog.refocus();
		expect(await withDeadline(picked)).toEqual([]);

		// The documented failure mode: the late selection is dropped rather
		// than surfacing as an asset nobody asked for.
		dialog.choose([makeFile("late.png")]);
		await Promise.resolve();
		expect(store.blobs.size).toBe(0);
	});

	it("does not fire the fallback when the window regains focus after a real pick", async () => {
		const { picker } = setup({ cancelFallbackMs: 5 });
		const { picked, input } = open(picker, { kind: "image" });
		const dialog = attachFakeDialog(input);
		dialog.choose([makeFile("photo.png")]);
		dialog.refocus();
		const assets = await withDeadline(picked);
		expect(assets).toHaveLength(1);
		picker.dispose();
	});

	it("supersedes a pending pick with [] rather than leaving it awaiting", async () => {
		const { picker } = setup();
		const first = open(picker, { kind: "image" }).picked;
		const { picked: second, input } = open(picker, { kind: "image" });
		expect(await withDeadline(first)).toEqual([]);
		attachFakeDialog(input).choose([makeFile("photo.png")]);
		expect(await withDeadline(second)).toHaveLength(1);
		picker.dispose();
	});

	it("settles a pending pick with [] on dispose", async () => {
		const { picker } = setup();
		const { picked } = open(picker, { kind: "image" });
		picker.dispose();
		expect(await withDeadline(picked)).toEqual([]);
	});

	it("recreates the input after dispose so a remounted host still works", async () => {
		const { picker } = setup();
		open(picker, { kind: "image" });
		picker.dispose();
		const { picked, input } = open(picker, { kind: "image" });
		expect(input.isConnected).toBe(true);
		attachFakeDialog(input).choose([makeFile("photo.png")]);
		expect(await withDeadline(picked)).toHaveLength(1);
		picker.dispose();
	});

	it("resolves [] and warns once with no document (SSR / worker)", async () => {
		const { picker, warn } = setup({ document: null });
		expect(await withDeadline(picker.pick({ kind: "image" }))).toEqual([]);
		expect(await withDeadline(picker.pick({ kind: "image" }))).toEqual([]);
		expect(document.body.querySelector('input[type="file"]')).toBeNull();
		expect(warn).toHaveBeenCalledTimes(1);
	});
});

describe("createLocalAssetPicker: repeated selection of the same file", () => {
	it("fires both picks when the same file is chosen twice in a row", async () => {
		const { picker, store } = setup();
		const file = makeFile("photo.png");

		const first = open(picker, { kind: "image" });
		const dialog = attachFakeDialog(first.input);
		dialog.choose([file]);
		expect(await withDeadline(first.picked)).toHaveLength(1);

		// Same File instance, same input. Without the `value` reset the browser
		// fires NO second `change`, and this pick would only ever settle as a
		// spurious cancel.
		const second = open(picker, { kind: "image" });
		dialog.choose([file]);
		expect(dialog.changes).toBe(2);
		const assets = await withDeadline(second.picked);

		expect(assets.map((asset) => asset.id)).toEqual(["asset-2"]);
		expect(store.blobs.get("asset-1")).toBe(file);
		expect(store.blobs.get("asset-2")).toBe(file);
		picker.dispose();
	});

	it("clears the input's value after reading a selection", async () => {
		const { picker } = setup();
		const { picked, input } = open(picker, { kind: "image" });
		const dialog = attachFakeDialog(input);
		dialog.choose([makeFile("photo.png")]);
		await withDeadline(picked);
		// Also drops the picker's reference to the File, which pins its blob.
		expect(input.value).toBe("");
		expect(input.files).toHaveLength(0);
		picker.dispose();
	});
});

describe("createLocalAssetPicker un-gates the image tool (cp1-003 integration)", () => {
	/**
	 * The real predicate, copied verbatim from `CanvasStudio.tsx:1278`:
	 * `const hasImagePicker = Boolean(assetPicker) || Boolean(onPickAsset);`
	 * This suite must not edit that file — `cp1-004` owns the wiring — so the
	 * expression is evaluated here against the same two inputs and the result
	 * is fed to the component that consumes it.
	 */
	const hasImagePickerFor = (
		assetPicker: unknown,
		onPickAsset: unknown,
	): boolean => Boolean(assetPicker) || Boolean(onPickAsset);

	function renderToolStrip(hasImagePicker: boolean) {
		const h = makeHarness();
		h.studioCtx.hasImagePicker = hasImagePicker;
		render(
			<CanvasStudioContext.Provider value={h.studioCtx}>
				<ToolStrip />
			</CanvasStudioContext.Provider>,
		);
		return screen.getByTestId("tool-strip-image") as HTMLButtonElement;
	}

	it("leaves the image tool disabled with neither adapter (the status quo)", () => {
		expect(hasImagePickerFor(undefined, undefined)).toBe(false);
		expect(
			renderToolStrip(hasImagePickerFor(undefined, undefined)).disabled,
		).toBe(true);
	});

	it("satisfies hasImagePicker as the fallback assetPicker, enabling the tool", () => {
		const { picker } = setup();
		expect(hasImagePickerFor(picker, undefined)).toBe(true);
		expect(renderToolStrip(hasImagePickerFor(picker, undefined)).disabled).toBe(
			false,
		);
		picker.dispose();
	});

	it("returns the shape CanvasStudio.pickAsset reads (picked[0].id)", async () => {
		const { picker } = setup();
		// Exactly the call `CanvasStudio.pickAsset` makes.
		const { picked, input } = open(picker, { multiple: false, kind: "image" });
		expect(input.multiple).toBe(false);
		expect(input.accept).toBe("image/*");
		attachFakeDialog(input).choose([makeFile("photo.png")]);
		const assets = await withDeadline(picked);
		expect(assets[0]?.id).toBe("asset-1");
		expect(typeof assets[0]?.uri).toBe("string");
		picker.dispose();
	});
});
