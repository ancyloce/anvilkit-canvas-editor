import type { CanvasAssetRef } from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import {
	assessCanvasDocumentPortability,
	CANVAS_DOCUMENT_PORTABILITY_BEHAVIORS,
} from "../asset-portability.js";
import type {
	CanvasAssetResolutionStatus,
	CanvasEffectiveAssetEntry,
} from "../effective-asset-resolver.js";

function entry(
	id: string,
	uri: string,
	status: CanvasAssetResolutionStatus = "ready",
): CanvasEffectiveAssetEntry {
	const asset: CanvasAssetRef = { id, uri };
	return {
		id,
		source: uri.startsWith("blob:") ? "indexeddb" : "document",
		status,
		documentAsset: asset,
		...(status === "ready" ? { asset } : {}),
	};
}

describe("Canvas document portability modes", () => {
	it("publishes explicit, distinct product behavior for all three modes", () => {
		expect(CANVAS_DOCUMENT_PORTABILITY_BEHAVIORS).toEqual({
			"local-only": {
				crossDevice: false,
				assetForm: "local-or-portable",
				sharing: "migrate-local-assets-or-block",
				ingress: "browser-local",
			},
			"hosted-reference": {
				crossDevice: true,
				assetForm: "absolute-http-reference",
				sharing: "preserve-hosted-references",
				ingress: "host-required",
			},
			packaged: {
				crossDevice: true,
				assetForm: "embedded-data",
				sharing: "emit-self-contained-artifact",
				ingress: "package-on-output",
			},
		});
	});

	it("accepts healthy browser-local assets in local-only mode", () => {
		const result = assessCanvasDocumentPortability(
			{ photo: entry("photo", "blob:https://canvas/photo") },
			"local-only",
		);
		expect(result.ready).toBe(true);
		expect(result.unresolvedAssets).toEqual([]);
	});

	it("names every local or non-hosted reference required for hosted sharing", () => {
		const result = assessCanvasDocumentPortability(
			{
				local: entry("local", "blob:https://canvas/local"),
				relative: entry("relative", "/assets/relative.png"),
				remote: entry("remote", "https://cdn.example.com/remote.png"),
			},
			"hosted-reference",
		);
		expect(result.ready).toBe(false);
		expect(result.unresolvedAssets).toMatchObject([
			{
				assetId: "local",
				reason: "browser-local-reference",
				action: "upload",
			},
			{
				assetId: "relative",
				reason: "non-hosted-reference",
				action: "upload",
			},
		]);
	});

	it("requires every packaged reference to contain its own bytes", () => {
		const result = assessCanvasDocumentPortability(
			{
				embedded: entry("embedded", "data:image/png;base64,SGk="),
				remote: entry("remote", "https://cdn.example.com/remote.png"),
			},
			"packaged",
		);
		expect(result.ready).toBe(false);
		expect(result.unresolvedAssets).toMatchObject([
			{
				assetId: "remote",
				reason: "non-embedded-reference",
				action: "embed",
			},
		]);
	});

	it("reports health before URI migration and preserves deterministic order", () => {
		const result = assessCanvasDocumentPortability(
			{
				unauthorized: {
					...entry(
						"unauthorized",
						"blob:https://canvas/private",
						"unauthorized",
					),
					message: "Sign in to refresh this asset.",
				},
				missing: entry("missing", "blob:https://canvas/missing", "missing"),
			},
			"hosted-reference",
		);
		expect(result.unresolvedAssets).toMatchObject([
			{
				assetId: "unauthorized",
				reason: "unauthorized",
				action: "reauthorize",
				message: "Sign in to refresh this asset.",
			},
			{ assetId: "missing", reason: "missing", action: "replace" },
		]);
	});
});
