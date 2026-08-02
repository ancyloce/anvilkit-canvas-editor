import type { CanvasT } from "../../context/canvas-studio-context.js";
import type { CanvasToaster } from "../../context/toast-context.js";

/**
 * E-17-R: every upload entry point is fire-and-forget — a `drop` handler and
 * two button handlers have nowhere to `await`. Voiding the promise (`void
 * uploadFilesImpl(...)`) leaves any rejection UNOBSERVED: in a browser that
 * becomes an uncaught `unhandledrejection` event, and under test it fails
 * whichever suite happens to be running when the microtask queue drains.
 *
 * `uploadSingleFile`/`retryUploadImpl` already convert *adapter* failures into
 * tracked task state, so what reaches here is everything OUTSIDE those guards
 * — a `commitBatch` that rejects against a document which moved under the
 * upload, a throwing selection subscriber, a host `getIR()` that blew up.
 * Those are real failures, so this OBSERVES them instead of swallowing them:
 * the same `canvas.upload.failed` toast the upload path already raises for the
 * user (the A-09 feedback seam), plus a `console.error` carrying the Error
 * ITSELF for host telemetry — pre-extracting `.message` would throw the stack
 * away — exactly like `collab/binding.ts` and `header/ExportMenu.tsx` do.
 *
 * Deliberately not a `try`/`catch` inside each action: the actions are shared
 * with callers that DO await them (and want the rejection), and the hole is
 * created by the `void`, so the guard belongs at the `void`.
 */
export function runUploadWork(
	work: Promise<unknown>,
	toaster: CanvasToaster,
	t: CanvasT,
): void {
	work.catch((error: unknown) => {
		console.error("canvas upload failed", error);
		toaster.add({
			type: "error",
			title: t("canvas.upload.failed", "Upload failed"),
			description: error instanceof Error ? error.message : String(error),
		});
	});
}
