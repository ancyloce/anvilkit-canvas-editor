/**
 * @file FR-090/091 asset adapters (B-10, PRD 0012 §11.1). The editor owns
 * selection UI, drag-and-drop, progress and node creation; the host owns
 * storage, CDN, validation, security scanning and the actual transfer.
 */

export interface CanvasAssetPickOptions {
	multiple?: boolean;
	/** Accepted MIME types / extensions (input-accept syntax). */
	accept?: readonly string[];
	kind?: "image" | "svg" | "video" | "audio";
}

export interface CanvasPickedAsset {
	/** Asset id — becomes the `ir.assets` key and node `assetId`. */
	id: string;
	uri: string;
	mimeType?: string;
	width?: number;
	height?: number;
}

/** FR-090: host-provided asset browser/picker. */
export interface CanvasAssetPicker {
	pick(options: CanvasAssetPickOptions): Promise<readonly CanvasPickedAsset[]>;
}

/** FR-091: one progress tick for one file of an `upload()` call. */
export interface CanvasUploadProgressEvent {
	/** Index into the `files` array passed to `upload()`. */
	fileIndex: number;
	/**
	 * 0–1 completed fraction when the transport can measure it. Omit for
	 * transports that cannot — the editor shows indeterminate progress then.
	 */
	fraction?: number;
}

export interface CanvasAssetUploadContext {
	documentId: string;
	/**
	 * FR-091/092 (additive): aborts when the user cancels the task, the
	 * document is replaced, or the editor unmounts. Honoring it lets the
	 * adapter cancel the underlying transfer; a legacy adapter that ignores it
	 * still behaves correctly — the editor discards the eventual result
	 * (logical cancellation) and never creates a node or asset entry for it.
	 */
	signal?: AbortSignal;
	/**
	 * FR-091 (additive): per-file progress reporting. Optional — adapters that
	 * never call it get an accessible indeterminate progress UI instead of a
	 * percentage. Events arriving after the task settled are ignored.
	 */
	onProgress?: (event: CanvasUploadProgressEvent) => void;
}

export type CanvasUploadedAsset = CanvasPickedAsset;

/**
 * FR-091: host-provided upload transport.
 *
 * Compatibility note: the contract is batch-shaped, but the editor invokes
 * `upload()` once per file so progress and cancellation attribute to a single
 * task (`fileIndex` is 0 in editor-initiated calls). Adapters written against
 * the original batch contract remain valid — a one-element `files` array is a
 * legal batch — and both new context fields are optional, so pre-progress
 * adapters keep compiling and working unchanged.
 */
export interface CanvasAssetUploader {
	upload(
		files: readonly File[],
		context: CanvasAssetUploadContext,
	): Promise<readonly CanvasUploadedAsset[]>;
}
