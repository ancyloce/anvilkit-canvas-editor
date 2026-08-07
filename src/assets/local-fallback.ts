/**
 * @file cp1-004 (PLAN-0035 §5 P1) — the zero-config asset adapters, reached
 * lazily.
 *
 * ## What this module is for
 *
 * `cp1-001`/`cp1-002`/`cp1-003` built a local store, a default uploader and a
 * default picker. Each is deliberately unreferenced: a static import from
 * `CanvasStudio.tsx` would drag all three — plus their transitive graph — into
 * the editor's eager chunk, which every host pays for whether or not it ever
 * uses them. This module is the ~one-screen shim that keeps that weight behind
 * a dynamic `import()` while still handing `<CanvasStudio>` two adapter
 * objects it can put in context **synchronously**, on the very first render.
 *
 * That synchronous handoff is the whole point. `hasImagePicker`
 * (`CanvasStudio.tsx`) gates the Image tool on the *presence* of an
 * `assetPicker`, and `uploadFilesImpl` (`assets/upload-actions.ts`) shows
 * "This workspace has no upload service configured" on the *absence* of an
 * `assetUploader`. Both read the value that exists at the moment of the user's
 * action, so an adapter that only materialises after an `await` would leave
 * the Image tool greyed out and a fast drop toasting "no upload service" —
 * the exact two failures this task exists to remove. The proxies below are
 * present from render zero; the modules behind them load on first *use*.
 *
 * ## One ingest implementation
 *
 * The picker is constructed with `ingest` wired to the uploader's `upload()`,
 * so picking and dropping share one storage path (`cp1-003`'s handoff note).
 * There is no second ingress.
 *
 * ## The error-contract mismatch this module resolves
 *
 * The two adapters disagree about cap breaches, and wiring them together
 * naively loses the message entirely:
 *
 * - `upload()` (`cp1-002`) **rejects** with `cp1-001`'s `LocalAssetStoreError`.
 * - `pick()` (`cp1-003`) does not catch, so an `ingest` that rejects makes
 *   `pick()` reject — and `imageTool` (`tools/image-tool.ts`) catches a
 *   rejected pick as "user cancelled the picker" and returns silently.
 *
 * So: the pick path catches inside `ingest`, reports through
 * {@link LocalAssetFallbackOptions.reportFailure}, and resolves `[]`; the
 * upload path rethrows with a localized message so the editor's existing
 * `canvas.upload.failed` toast carries it. Both paths describe the failure
 * through the same {@link LocalAssetFallbackOptions.describeFailure} seam,
 * because this module has no `t()` of its own — localization belongs at the
 * wiring site, which is the only place a message catalog exists.
 *
 * No new dependency: dynamic `import()` and `Promise` are platform built-ins.
 */

import type {
	CanvasAssetPicker,
	CanvasAssetUploader,
	CanvasPickedAsset,
} from "./adapter-types.js";
import type { LocalAssetStoreErrorCode } from "./local-asset-store.js";
import type { LocalAssetPicker } from "./local-picker.js";

/**
 * A failed local ingest, reduced to what a user-facing message needs.
 *
 * `code` is present only for a cap breach — the sole failure `cp1-001`'s store
 * surfaces as an error at all (every environmental failure degrades to an
 * in-memory backend instead). Anything else — a missing `URL.createObjectURL`,
 * a decoder throw, a host uploader bug — arrives with `code` undefined and no
 * numbers, and must be described generically rather than as a size problem.
 */
export interface LocalAssetFallbackFailure {
	readonly code?: LocalAssetStoreErrorCode;
	/** Size of the rejected blob, when the failure was a cap breach. */
	readonly byteSize?: number;
	/** Cap that would have been exceeded, when the failure was a cap breach. */
	readonly limitBytes?: number;
	/** The original rejection, unmodified. */
	readonly error: unknown;
}

export interface LocalAssetFallbackOptions {
	/** Document id for the `upload()` context on the pick path. */
	getDocumentId: () => string;
	/** Localized, user-facing description of a failure. */
	describeFailure: (failure: LocalAssetFallbackFailure) => string;
	/**
	 * Show `message` to the user. Called for pick-path failures ONLY: the
	 * upload path rethrows instead, because `uploadFilesImpl` already turns a
	 * rejection into a toast and reporting here too would double it.
	 */
	reportFailure: (failure: LocalAssetFallbackFailure, message: string) => void;
}

export interface LocalAssetFallback {
	/** Stable object; the real uploader loads on first `upload()`. */
	readonly uploader: CanvasAssetUploader;
	/** Stable object; the real picker loads on first `pick()`. */
	readonly picker: CanvasAssetPicker;
	/**
	 * Release the picker's hidden `<input>` and settle any in-flight pick.
	 * Safe before, during and after the lazy load, and safe to call twice.
	 *
	 * Not terminal, mirroring {@link LocalAssetPicker.dispose}: a later use
	 * reloads and reconstructs. That matters because React can unmount and
	 * remount a subtree around a fallback the host holds onto.
	 */
	dispose(): void;
}

/** The adapters, once their modules have loaded. */
interface LoadedAdapters {
	readonly uploader: CanvasAssetUploader;
	readonly picker: LocalAssetPicker;
	readonly isCapError: (value: unknown) => boolean;
}

/**
 * Build the lazy zero-config adapter pair.
 *
 * Constructing this is free — no module is fetched, no DOM node is created and
 * no IndexedDB connection is opened until the first `upload()` or `pick()`.
 * It is still meant to be constructed ONCE per editor instance (`useMemo`),
 * not per render: the picker it eventually creates owns a DOM element, and a
 * per-render instance would leak one input per render.
 */
export function createLocalAssetFallback(
	options: LocalAssetFallbackOptions,
): LocalAssetFallback {
	let adapters: Promise<LoadedAdapters> | undefined;

	const toFailure = (
		isCapError: LoadedAdapters["isCapError"],
		error: unknown,
	): LocalAssetFallbackFailure => {
		if (!isCapError(error)) return { error };
		const capped = error as {
			code: LocalAssetStoreErrorCode;
			byteSize: number;
			limitBytes: number;
		};
		return {
			code: capped.code,
			byteSize: capped.byteSize,
			limitBytes: capped.limitBytes,
			error,
		};
	};

	const load = (): Promise<LoadedAdapters> => {
		adapters ??= (async () => {
			// One `Promise.all` rather than three awaits: the three modules have
			// no ordering relationship, and the picker's own graph already
			// contains the store, so this is one chunk boundary in practice.
			const [uploaderModule, pickerModule, storeModule] = await Promise.all([
				import("./local-uploader.js"),
				import("./local-picker.js"),
				import("./local-asset-store.js"),
			]);
			// Realm-safe narrowing (`cp1-001`): this package ships dual ESM/CJS,
			// so `instanceof LocalAssetStoreError` can be false across copies.
			const isCapError = storeModule.isLocalAssetStoreError;
			const uploader = uploaderModule.createLocalAssetUploader();
			const picker = pickerModule.createLocalAssetPicker({
				// THE single ingest implementation: picked files take exactly the
				// same route to storage as dropped ones.
				ingest: async (files): Promise<readonly CanvasPickedAsset[]> => {
					try {
						return await uploader.upload(files, {
							documentId: options.getDocumentId(),
						});
					} catch (error) {
						// `imageTool` reads a rejected `pick()` as a cancel, so a
						// rejection here is a silent failure. Report and resolve
						// empty instead — the user gets a message and the tool
						// behaves exactly as if nothing was chosen.
						const failure = toFailure(isCapError, error);
						options.reportFailure(failure, options.describeFailure(failure));
						return [];
					}
				},
			});
			return { uploader, picker, isCapError };
		})();
		return adapters;
	};

	return {
		uploader: {
			async upload(files, context) {
				const loaded = await load();
				try {
					return await loaded.uploader.upload(files, context);
				} catch (error) {
					const failure = toFailure(loaded.isCapError, error);
					// Only a cap breach is rewritten. Everything else — above all
					// the abort `uploadSingleFile` raises when the user cancels a
					// task — must reach the caller UNCHANGED, or a cancel turns
					// into an error toast.
					if (failure.code === undefined) throw error;
					throw new Error(options.describeFailure(failure), { cause: error });
				}
			},
		},

		picker: {
			async pick(pickOptions) {
				const loaded = await load();
				return loaded.picker.pick(pickOptions);
			},
		},

		dispose() {
			const pending = adapters;
			adapters = undefined;
			if (!pending) return;
			// A dispose that lands WHILE the modules are loading still has to
			// release the picker that load is about to create, so the teardown
			// rides the same promise rather than racing it.
			void pending.then(
				(loaded) => loaded.picker.dispose(),
				() => undefined,
			);
		},
	};
}
