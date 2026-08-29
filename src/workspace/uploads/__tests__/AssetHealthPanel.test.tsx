import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CanvasEffectiveAssetEntry } from "@/assets/effective-asset-resolver.js";
import type { CanvasAssetMigrationResult } from "@/assets/host-asset-migration.js";
import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import { AssetHealthPanel } from "../AssetHealthPanel.js";

afterEach(cleanup);

function entry(
	id: string,
	status: CanvasEffectiveAssetEntry["status"],
	uri = `https://cdn.example.com/${id}.png`,
): CanvasEffectiveAssetEntry {
	return {
		id,
		source: uri.startsWith("blob:") ? "indexeddb" : "host",
		status,
		documentAsset: { id, uri },
		...(status === "ready" ? { asset: { id, uri } } : {}),
		...(status === "ready" ? {} : { message: `${id} message` }),
	};
}

function renderPanel(
	entries: Record<string, CanvasEffectiveAssetEntry>,
	configure?: (harness: ReturnType<typeof makeHarness>) => void,
) {
	const harness = makeHarness();
	harness.studioCtx.assetResolutions = entries;
	configure?.(harness);
	render(
		<CanvasStudioContext.Provider value={harness.studioCtx}>
			<AssetHealthPanel />
		</CanvasStudioContext.Provider>,
	);
	return harness;
}

describe("AssetHealthPanel", () => {
	it("shows uploading, unavailable, stale, unauthorized, and retrying health", () => {
		renderPanel({
			uploading: entry("uploading", "uploading"),
			unavailable: entry("unavailable", "unavailable"),
			stale: entry("stale", "stale"),
			unauthorized: entry("unauthorized", "unauthorized"),
			retrying: entry("retrying", "retrying"),
		});

		for (const status of [
			"uploading",
			"unavailable",
			"stale",
			"unauthorized",
			"retrying",
		]) {
			expect(screen.getByTestId(`asset-health-${status}`)).toHaveAttribute(
				"data-status",
				status,
			);
		}
		expect(screen.getByText("Uploading…")).toBeTruthy();
		expect(screen.getByText("Unavailable")).toBeTruthy();
		expect(screen.getByText("Stale link")).toBeTruthy();
		expect(screen.getByText("Unauthorized")).toBeTruthy();
		expect(screen.getByText("Retrying…")).toBeTruthy();
	});

	it("marks a resolver retry immediately without mutating the document", () => {
		const stale = entry("photo", "stale");
		const retryAssetResolution = vi.fn();
		const harness = renderPanel({ photo: stale }, (h) => {
			h.studioCtx.retryAssetResolution = retryAssetResolution;
		});
		const before = harness.studioCtx.getIR();

		fireEvent.click(screen.getByTestId("asset-health-retry-photo"));

		expect(screen.getByTestId("asset-health-photo")).toHaveAttribute(
			"data-status",
			"retrying",
		);
		expect(retryAssetResolution).toHaveBeenCalledWith("photo");
		expect(harness.studioCtx.getIR()).toBe(before);
	});

	it("shows replacement progress and commits one atomic asset migration", async () => {
		let finishPick:
			| ((value: readonly [{ id: string; uri: string }]) => void)
			| null = null;
		const pick = vi.fn(
			() =>
				new Promise<readonly [{ id: string; uri: string }]>((resolve) => {
					finishPick = resolve;
				}),
		);
		const harness = renderPanel(
			{ old: entry("old", "missing", "blob:canvas-local/old") },
			(h) => {
				const initial = {
					...h.studioCtx.getIR(),
					assets: { old: { id: "old", uri: "blob:canvas-local/old" } },
				};
				h.setIR(initial);
				h.studioCtx.assetPicker = { pick };
				h.studioCtx.commit = vi.fn((command) => {
					expect(command).toEqual({
						type: "asset.migrate",
						fromAssetId: "old",
						asset: { id: "new", uri: "https://cdn.example.com/new.png" },
					});
					const next = {
						...initial,
						assets: {
							new: { id: "new", uri: "https://cdn.example.com/new.png" },
						},
					};
					h.setIR(next);
					return next;
				});
			},
		);

		fireEvent.click(screen.getByTestId("asset-health-replace-old"));
		expect(screen.getByTestId("asset-health-old")).toHaveAttribute(
			"data-status",
			"replacing",
		);
		finishPick?.([{ id: "new", uri: "https://cdn.example.com/new.png" }]);
		await vi.waitFor(() =>
			expect(screen.getByTestId("asset-health-old")).toHaveAttribute(
				"data-status",
				"replaced",
			),
		);
		expect(harness.studioCtx.commit).toHaveBeenCalledTimes(1);
	});

	it("preserves migration retry state and exposes uploading then retrying", async () => {
		let finishFirst: ((value: CanvasAssetMigrationResult) => void) | null =
			null;
		let finishSecond: ((value: CanvasAssetMigrationResult) => void) | null =
			null;
		const migrate = vi
			.fn()
			.mockImplementationOnce(
				() =>
					new Promise<CanvasAssetMigrationResult>((resolve) => {
						finishFirst = resolve;
					}),
			)
			.mockImplementationOnce(
				() =>
					new Promise<CanvasAssetMigrationResult>((resolve) => {
						finishSecond = resolve;
					}),
			);
		const retryState = {
			uploadedAssets: {
				other: { id: "host-other", uri: "https://cdn.example.com/other.png" },
			},
		};
		renderPanel(
			{ local: entry("local", "ready", "blob:canvas-local/local") },
			(h) => {
				h.studioCtx.assetPortabilityMode = "hosted-reference";
				h.studioCtx.migrateAssetsForSharing = migrate;
			},
		);

		fireEvent.click(screen.getByTestId("asset-health-migrate"));
		expect(screen.getByTestId("asset-health-local")).toHaveAttribute(
			"data-status",
			"uploading",
		);
		finishFirst?.({
			status: "blocked",
			migratedAssetIds: [],
			unresolvedAssets: [
				{
					assetId: "local",
					uri: "blob:canvas-local/local",
					reason: "upload-failed",
					message: "CDN unavailable",
					retryable: true,
					replaceable: true,
				},
			],
			retryState,
		});
		await vi.waitFor(() =>
			expect(screen.getByText("CDN unavailable")).toBeTruthy(),
		);
		fireEvent.click(screen.getByTestId("asset-health-retry-local"));
		expect(screen.getByTestId("asset-health-local")).toHaveAttribute(
			"data-status",
			"retrying",
		);
		expect(migrate).toHaveBeenLastCalledWith(
			expect.objectContaining({ retryState }),
		);
		finishSecond?.({
			status: "migrated",
			migratedAssetIds: ["local"],
			unresolvedAssets: [],
		});
	});
});
