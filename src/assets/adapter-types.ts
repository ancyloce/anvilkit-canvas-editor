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

export interface CanvasAssetUploadContext {
	documentId: string;
}

export type CanvasUploadedAsset = CanvasPickedAsset;

/** FR-091: host-provided upload transport. */
export interface CanvasAssetUploader {
	upload(
		files: readonly File[],
		context: CanvasAssetUploadContext,
	): Promise<readonly CanvasUploadedAsset[]>;
}
