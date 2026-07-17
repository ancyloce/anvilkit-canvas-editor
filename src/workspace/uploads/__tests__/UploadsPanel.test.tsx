import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CanvasAssetUploader } from "@/assets/adapter-types.js";
import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import { createUploadStore } from "@/stores/upload-store.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import { UploadsPanel } from "../UploadsPanel.js";

afterEach(cleanup);

function setup(uploader?: CanvasAssetUploader) {
	const h = makeHarness();
	const uploadStore = createUploadStore();
	h.studioCtx.uploadStore = uploadStore;
	if (uploader) h.studioCtx.assetUploader = uploader;
	render(
		<CanvasStudioContext.Provider value={h.studioCtx}>
			<UploadsPanel />
		</CanvasStudioContext.Provider>,
	);
	return { h, uploadStore };
}

const file = (name: string): File =>
	new File(["x"], name, { type: "image/png" });

describe("UploadsPanel retry (FR-091)", () => {
	it("shows no retry button for an in-progress or successful task", async () => {
		let resolveUpload: (() => void) | null = null;
		const uploader: CanvasAssetUploader = {
			upload: () =>
				new Promise((resolve) => {
					resolveUpload = () => resolve([{ id: "up", uri: "https://x" }]);
				}),
		};
		const { uploadStore } = setup(uploader);
		const input = screen.getByTestId("uploads-input") as HTMLInputElement;
		fireEvent.change(input, { target: { files: [file("a.png")] } });
		const task = uploadStore.getState().tasks[0];
		if (!task) throw new Error("no task");
		expect(screen.queryByTestId(`upload-retry-${task.id}`)).toBeNull();
		resolveUpload?.();
		await vi.waitFor(() =>
			expect(uploadStore.getState().tasks[0]?.status).toBe("done"),
		);
		expect(screen.queryByTestId(`upload-retry-${task.id}`)).toBeNull();
	});

	it("shows a retry button on a failed task; clicking it resubmits the same file", async () => {
		let attempt = 0;
		const uploader: CanvasAssetUploader = {
			upload: async (files) => {
				attempt += 1;
				if (attempt === 1) throw new Error("cdn down");
				return files.map((f) => ({ id: "up-1", uri: `https://cdn/${f.name}` }));
			},
		};
		const { uploadStore } = setup(uploader);
		const input = screen.getByTestId("uploads-input") as HTMLInputElement;
		fireEvent.change(input, { target: { files: [file("a.png")] } });
		await vi.waitFor(() =>
			expect(uploadStore.getState().tasks[0]?.status).toBe("failed"),
		);
		const task = uploadStore.getState().tasks[0];
		if (!task) throw new Error("no task");
		const retryButton = screen.getByTestId(`upload-retry-${task.id}`);

		fireEvent.click(retryButton);

		await vi.waitFor(() =>
			expect(uploadStore.getState().tasks[0]?.status).toBe("done"),
		);
		expect(uploadStore.getState().tasks).toHaveLength(1); // same task, not a new one
		expect(attempt).toBe(2);
	});

	it("does not show retry when there is no uploader configured", () => {
		const { uploadStore } = setup();
		let taskId = "";
		act(() => {
			taskId = uploadStore.getState().begin(file("a.png"));
			uploadStore.getState().fail(taskId, "x");
		});
		expect(screen.queryByTestId(`upload-retry-${taskId}`)).toBeNull();
	});
});
