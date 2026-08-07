/**
 * @file cp1-003 (PLAN-0035 §5 P1) — the default {@link CanvasAssetPicker},
 * implemented over a hidden `<input type="file">`.
 *
 * ## Why this un-gates the image tool
 *
 * `CanvasStudio.tsx` computes `hasImagePicker = Boolean(assetPicker) ||
 * Boolean(onPickAsset)` and hands it to the Tool Strip, which renders the
 * `image` tool as a disabled button when it is `false`. So a host that mounts
 * `<CanvasStudio>` with no adapters cannot reach the image tool AT ALL — not
 * even once uploads work. Drop-to-canvas is a second ingress; this is the one
 * the toolbar depends on.
 *
 * ## One storage path, not two
 *
 * Picked bytes go through `cp1-001`'s {@link LocalAssetStore} — the same store
 * the default uploader (`cp1-002`) writes to and that rehydration (`cp1-005`)
 * and export portability (`cp1-006`) read back. There is deliberately no
 * picker-private storage. The {@link LocalAssetPickerOptions.ingest} seam
 * exists so `cp1-004` can go one better and route picked files through the
 * uploader's `upload()`, leaving exactly ONE implementation of
 * file → {@link CanvasPickedAsset} in a wired editor; the default below is
 * what a standalone `createLocalAssetPicker()` uses.
 *
 * ## Cancelling a file dialog
 *
 * A file input fires NO event when the user dismisses the OS dialog on older
 * engines, which is why so many "upload" flows hang on cancel. Two mechanisms
 * cover it — see {@link LocalAssetPickerOptions.cancelFallbackMs} for the
 * fallback's one failure mode:
 *
 * 1. The `cancel` event (Chrome 113+, Firefox 109+, Safari 16.4+), which is
 *    exact and immediate.
 * 2. A window-`focus` fallback for everything older: when the window regains
 *    focus and neither `change` nor `cancel` has arrived within a grace
 *    period, the dialog is treated as dismissed.
 *
 * Either way `pick()` RESOLVES `[]`. It never rejects and never hangs, because
 * an `await` that never settles is an unrecoverable UI state, whereas a
 * spurious empty result costs the user one more click.
 *
 * No new dependency: `HTMLInputElement`, `Blob`, `crypto.randomUUID`,
 * `URL.createObjectURL` and `createImageBitmap` are platform built-ins.
 */

import type {
	CanvasAssetPicker,
	CanvasAssetPickOptions,
	CanvasPickedAsset,
} from "./adapter-types.js";
import {
	getSharedLocalAssetStore,
	type LocalAssetStore,
} from "./local-asset-store.js";

/**
 * `kind` → `accept` mapping.
 *
 * - `image` → `image/*`: the wildcard, not an enumerated list, because every
 *   raster format the browser can decode is one the canvas can draw — and an
 *   enumeration would silently exclude whatever the engine adds next (AVIF,
 *   JPEG XL). It subsumes `image/svg+xml`; `svg` exists to NARROW to vectors,
 *   not to add them.
 * - `svg` → `image/svg+xml` **plus the `.svg` extension**. The extension token
 *   is not redundant: an SVG served or stored with a `text/xml`, `text/plain`
 *   or empty type — routine for files produced by design tools and for local
 *   files on systems with a thin MIME database — is invisible to a MIME-only
 *   filter, and the user then sees their own file greyed out in the dialog.
 * - `video` / `audio` → the matching wildcards, for the same reason as `image`.
 *
 * `accept` is a dialog FILTER, not validation: every browser lets the user
 * switch to "All files", so nothing downstream may assume the returned files
 * match. Enforcement belongs to the store's caps and the uploader.
 */
const KIND_ACCEPT: Record<
	NonNullable<CanvasAssetPickOptions["kind"]>,
	readonly string[]
> = {
	image: ["image/*"],
	svg: ["image/svg+xml", ".svg"],
	video: ["video/*"],
	audio: ["audio/*"],
};

/**
 * The `accept` attribute value for one {@link CanvasAssetPickOptions}, or `""`
 * when the dialog should be unfiltered.
 *
 * An explicit `accept` WINS over `kind` rather than intersecting with it: the
 * attribute has no intersection syntax, and a caller who spelled out MIME
 * types was being more specific than the coarse `kind` hint, not less.
 */
export function resolveAcceptAttribute(
	options: CanvasAssetPickOptions,
): string {
	if (options.accept && options.accept.length > 0) {
		return options.accept.join(",");
	}
	if (options.kind) return KIND_ACCEPT[options.kind].join(",");
	return "";
}

/**
 * Grace period for the window-`focus` cancel fallback. 500 ms is long enough
 * for a `change` event queued behind the dialog's own teardown on a slow
 * machine, and short enough that a user who cancelled does not think the app
 * froze.
 */
const DEFAULT_CANCEL_FALLBACK_MS = 500;

export interface LocalAssetPickerOptions {
	/**
	 * Store picked bytes here. Defaults to the shared store, so the picker and
	 * the default uploader share one database and one metadata cache — which
	 * `cp1-001` requires, since that cache is per-instance and two instances
	 * over one database drift.
	 */
	store?: LocalAssetStore;
	/**
	 * Turn selected files into assets. Defaults to storing each file in
	 * {@link LocalAssetPickerOptions.store} and minting an object URL.
	 *
	 * `cp1-004` should pass the default uploader's `upload()` here so a wired
	 * editor has exactly one ingest implementation; the picker then owns only
	 * file SELECTION, which is all that is genuinely picker-specific.
	 */
	ingest?: (files: readonly File[]) => Promise<readonly CanvasPickedAsset[]>;
	/**
	 * Document that owns the hidden input. Omit to read `globalThis.document`;
	 * pass `null` to force the no-document path (how a test covers it
	 * deterministically). With no document — SSR, a worker — `pick()` warns
	 * once and resolves `[]` rather than throwing.
	 */
	document?: Document | null;
	/**
	 * Grace period in ms for the window-`focus` cancel fallback.
	 *
	 * **Failure mode.** On an engine WITHOUT the `cancel` event, a genuine
	 * selection whose `change` event lands more than this long after the window
	 * regains focus is misread as a cancel: `pick()` resolves `[]` and the late
	 * `change` is discarded (nothing is stored and no node is created — a
	 * ghost asset appearing after the fact would be worse than a no-op). On an
	 * engine WITH `cancel` — every current browser — the fallback never wins,
	 * because `cancel` settles the pick before the timer is even armed.
	 */
	cancelFallbackMs?: number;
	/** Asset id factory. Defaults to `crypto.randomUUID`. */
	createId?: () => string;
	/**
	 * Object-URL mint for the default ingest. Defaults to
	 * `URL.createObjectURL`, which is absent in jsdom and in workers.
	 */
	createObjectURL?: (blob: Blob) => string;
	/**
	 * Intrinsic-size probe for the default ingest. Defaults to
	 * `createImageBitmap`, guarded. Without a size the insert path falls back
	 * to a fixed 240x180 box, which distorts every picked photo — so this is
	 * worth the one decode.
	 */
	measure?: (file: File) => Promise<{ width?: number; height?: number }>;
	/** Reporter for non-fatal problems. Defaults to `console.warn`. */
	warn?: (message: string, cause?: unknown) => void;
}

export interface LocalAssetPicker extends CanvasAssetPicker {
	/**
	 * Detach the hidden input and settle any in-flight `pick()` with `[]`.
	 *
	 * Not terminal: a later `pick()` lazily recreates the input. A terminal
	 * dispose would permanently break a picker that a host constructed once at
	 * module scope and unmounted/remounted around.
	 */
	dispose(): void;
}

function defaultCreateId(): string {
	const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
	if (c && typeof c.randomUUID === "function") return c.randomUUID();
	return `asset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function defaultCreateObjectURL(blob: Blob): string {
	const url = (
		globalThis as { URL?: { createObjectURL?: (b: Blob) => string } }
	).URL;
	if (typeof url?.createObjectURL !== "function") {
		throw new Error(
			"URL.createObjectURL is unavailable, so a picked file cannot be given a URI.",
		);
	}
	return url.createObjectURL(blob);
}

async function defaultMeasure(
	file: File,
): Promise<{ width?: number; height?: number }> {
	const create = (
		globalThis as {
			createImageBitmap?: (blob: Blob) => Promise<ImageBitmap>;
		}
	).createImageBitmap;
	if (typeof create !== "function") return {};
	if (!file.type.startsWith("image/")) return {};
	try {
		const bitmap = await create(file);
		const size = { width: bitmap.width, height: bitmap.height };
		bitmap.close();
		return size;
	} catch {
		// An SVG with no intrinsic size, or a format this engine cannot decode.
		// The insert path's default box is the right answer then, not a throw.
		return {};
	}
}

/**
 * Build the editor's default asset picker. Touches no DOM until the first
 * `pick()`, so it is safe to construct during module evaluation and on the
 * server.
 */
export function createLocalAssetPicker(
	options: LocalAssetPickerOptions = {},
): LocalAssetPicker {
	const cancelFallbackMs =
		options.cancelFallbackMs ?? DEFAULT_CANCEL_FALLBACK_MS;
	const createId = options.createId ?? defaultCreateId;
	const createObjectURL = options.createObjectURL ?? defaultCreateObjectURL;
	const measure = options.measure ?? defaultMeasure;
	const warn =
		options.warn ??
		((message: string, cause?: unknown) => {
			if (cause === undefined) console.warn(`[canvas-editor] ${message}`);
			else console.warn(`[canvas-editor] ${message}`, cause);
		});

	let input: HTMLInputElement | null = null;
	let pending: ((files: File[]) => void) | null = null;
	let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
	let focusTarget: Window | null = null;
	let warnedNoDocument = false;

	function disarmCancelFallback(): void {
		if (fallbackTimer !== null) {
			clearTimeout(fallbackTimer);
			fallbackTimer = null;
		}
		focusTarget?.removeEventListener("focus", handleWindowFocus);
		focusTarget = null;
	}

	/**
	 * Settle the in-flight pick exactly once. A no-op when nothing is pending —
	 * which is how a `change` arriving after the focus fallback already gave up
	 * gets discarded rather than resurfacing as an asset out of nowhere.
	 */
	function settle(files: File[]): void {
		disarmCancelFallback();
		const resolve = pending;
		pending = null;
		resolve?.(files);
	}

	/**
	 * THE reset. A file input remembers its selection in `value`; re-picking
	 * the SAME file leaves `value` unchanged, so the browser fires no `change`
	 * and the second pick would hang until the cancel fallback gave up on it.
	 * Assigning `""` empties the selected-file list, so every selection is a
	 * change.
	 *
	 * Called before opening a dialog AND after reading a selection — the second
	 * call also drops the input's references to the selected `File`s, which pin
	 * their blobs in memory for as long as the input holds them.
	 */
	function resetSelection(el: HTMLInputElement): void {
		el.value = "";
	}

	function handleChange(): void {
		const el = input;
		if (!el) return;
		// Read BEFORE the reset: clearing `value` empties `files`.
		const list = el.files;
		const files = list ? Array.from(list) : [];
		resetSelection(el);
		settle(files);
	}

	function handleCancel(): void {
		settle([]);
	}

	function handleWindowFocus(): void {
		if (!pending) return;
		if (fallbackTimer !== null) clearTimeout(fallbackTimer);
		fallbackTimer = setTimeout(() => {
			fallbackTimer = null;
			if (pending) settle([]);
		}, cancelFallbackMs);
	}

	function ensureInput(): HTMLInputElement | null {
		if (input) return input;
		const doc =
			options.document === undefined
				? (globalThis as { document?: Document }).document
				: options.document;
		if (!doc?.body) return null;
		const el = doc.createElement("input");
		el.type = "file";
		el.tabIndex = -1;
		el.setAttribute("aria-hidden", "true");
		// The only inline style in this module, and it is behaviour rather than
		// design: the element exists solely to be `click()`ed, must never take
		// layout or focus, and lives on `document.body` — outside any Tailwind
		// scope the editor controls. It is attached rather than detached
		// because a detached input does not open a dialog in every engine.
		el.style.display = "none";
		el.addEventListener("change", handleChange);
		el.addEventListener("cancel", handleCancel);
		doc.body.appendChild(el);
		input = el;
		return el;
	}

	function selectFiles(pickOptions: CanvasAssetPickOptions): Promise<File[]> {
		const el = ensureInput();
		if (!el) {
			if (!warnedNoDocument) {
				warnedNoDocument = true;
				warn(
					"No document is available, so the built-in asset picker cannot open a file dialog.",
				);
			}
			return Promise.resolve([]);
		}
		// One dialog at a time. A second `pick()` supersedes the first, whose
		// caller must not be left awaiting a dialog that will never reopen.
		settle([]);
		el.multiple = pickOptions.multiple === true;
		const accept = resolveAcceptAttribute(pickOptions);
		if (accept === "") el.removeAttribute("accept");
		else el.accept = accept;
		resetSelection(el);
		return new Promise<File[]>((resolve) => {
			// Assigned before `click()` because a test double — and a
			// synthetic-event environment — can dispatch `change` synchronously.
			pending = resolve;
			focusTarget = el.ownerDocument.defaultView;
			focusTarget?.addEventListener("focus", handleWindowFocus);
			el.click();
		});
	}

	async function storeOne(
		store: LocalAssetStore,
		file: File,
	): Promise<CanvasPickedAsset | null> {
		const id = createId();
		try {
			const size = await measure(file);
			const meta = await store.put(id, file, {
				...(file.type ? { mimeType: file.type } : {}),
				...(file.name ? { name: file.name } : {}),
				...(size.width !== undefined ? { width: size.width } : {}),
				...(size.height !== undefined ? { height: size.height } : {}),
			});
			return {
				id,
				uri: createObjectURL(file),
				mimeType: meta.mimeType,
				...(meta.width !== undefined ? { width: meta.width } : {}),
				...(meta.height !== undefined ? { height: meta.height } : {}),
			};
		} catch (cause) {
			// Every failure here is per-file and non-fatal: a cap breach
			// (`LocalAssetStoreError`), a store that could not be written, or a
			// missing `URL.createObjectURL`. `pick()` returns the files that DID
			// land instead of rejecting the whole selection.
			warn(`Could not store the picked file "${file.name}".`, cause);
			// The blob may already be in the store under an id nothing will ever
			// reference; drop it rather than charge the user's cap for it.
			await store.delete(id).catch(() => undefined);
			return null;
		}
	}

	/**
	 * Sequential on purpose: `measure()` decodes a full-resolution bitmap, and
	 * N simultaneous decodes of a large multi-select is exactly the pattern
	 * that stalls the main thread on a low-end machine.
	 */
	async function storePickedFiles(
		files: readonly File[],
	): Promise<readonly CanvasPickedAsset[]> {
		const store = options.store ?? getSharedLocalAssetStore();
		const picked: CanvasPickedAsset[] = [];
		for (const file of files) {
			const asset = await storeOne(store, file);
			if (asset) picked.push(asset);
		}
		return picked;
	}

	const ingest = options.ingest ?? storePickedFiles;

	return {
		async pick(pickOptions) {
			const files = await selectFiles(pickOptions);
			if (files.length === 0) return [];
			return ingest(files);
		},

		dispose() {
			settle([]);
			const el = input;
			input = null;
			if (!el) return;
			el.removeEventListener("change", handleChange);
			el.removeEventListener("cancel", handleCancel);
			el.remove();
		},
	};
}
