import type { CanvasAssetRef } from "@anvilkit/canvas-core";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEffectiveAssetTable } from "../effective-asset-rehydration.js";
import type { CanvasAssetResolver } from "../effective-asset-resolver.js";

const remote: Record<string, CanvasAssetRef> = {
	photo: {
		id: "photo",
		uri: "https://signed.example.com/expired.png",
		width: 800,
		height: 600,
	},
};

afterEach(cleanup);

describe("useEffectiveAssetTable", () => {
	it("publishes a host-refreshed asset without mutating document metadata", async () => {
		const hostResolver: CanvasAssetResolver = {
			resolve: vi.fn().mockResolvedValue({
				status: "ready",
				asset: {
					id: "host-id",
					uri: "https://cdn.example.com/fresh.png",
				},
			}),
		};
		const { result } = renderHook(() =>
			useEffectiveAssetTable({
				documentId: "doc-1",
				assets: remote,
				loadedAssets: remote,
				localEnabled: false,
				hostResolver,
			}),
		);

		await waitFor(() => {
			expect(result.current.assets.photo?.uri).toBe(
				"https://cdn.example.com/fresh.png",
			);
		});
		expect(result.current.assets.photo).toMatchObject({
			id: "photo",
			width: 800,
			height: 600,
		});
		expect(remote.photo?.uri).toContain("expired");
	});

	it("keeps a current-session upload ahead of the host", async () => {
		const hostResolver: CanvasAssetResolver = {
			resolve: vi.fn().mockResolvedValue({ status: "missing" }),
		};
		const live = {
			photo: { ...remote.photo!, uri: "blob:https://current/upload" },
		};
		const { result } = renderHook(() =>
			useEffectiveAssetTable({
				documentId: "doc-1",
				assets: live,
				loadedAssets: remote,
				localEnabled: false,
				hostResolver,
			}),
		);

		await waitFor(() => {
			expect(result.current.entries.photo?.source).toBe("memory");
		});
		expect(result.current.assets.photo?.uri).toBe(
			"blob:https://current/upload",
		);
		expect(hostResolver.resolve).not.toHaveBeenCalled();
	});

	it("removes an authoritative unauthorized asset from every consumer table", async () => {
		const hostResolver: CanvasAssetResolver = {
			resolve: vi.fn().mockResolvedValue({
				status: "unauthorized",
				message: "Sign in to refresh this asset.",
			}),
		};
		const { result } = renderHook(() =>
			useEffectiveAssetTable({
				documentId: "doc-1",
				assets: remote,
				loadedAssets: remote,
				localEnabled: false,
				hostResolver,
			}),
		);

		await waitFor(() => {
			expect(result.current.entries.photo?.status).toBe("unauthorized");
		});
		expect(result.current.assets.photo).toBeUndefined();
	});

	it("re-runs the resolver chain when the refresh epoch advances", async () => {
		const resolve = vi
			.fn()
			.mockResolvedValueOnce({ status: "stale", message: "Expired" })
			.mockResolvedValueOnce({
				status: "ready",
				asset: { id: "photo", uri: "https://cdn.example.com/refreshed.png" },
			});
		const hostResolver: CanvasAssetResolver = { resolve };
		const { result, rerender } = renderHook(
			({ refreshEpoch }) =>
				useEffectiveAssetTable({
					documentId: "doc-1",
					assets: remote,
					loadedAssets: remote,
					localEnabled: false,
					hostResolver,
					refreshEpoch,
				}),
			{ initialProps: { refreshEpoch: 0 } },
		);

		await waitFor(() =>
			expect(result.current.entries.photo?.status).toBe("stale"),
		);
		rerender({ refreshEpoch: 1 });
		await waitFor(() =>
			expect(result.current.assets.photo?.uri).toBe(
				"https://cdn.example.com/refreshed.png",
			),
		);
		expect(resolve).toHaveBeenCalledTimes(2);
	});
});
