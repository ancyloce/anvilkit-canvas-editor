import {
	cleanup,
	createEvent,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import type Konva from "konva";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CanvasAssetUploader } from "@/assets/adapter-types.js";
import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import {
	CanvasToastContext,
	type CanvasToastInput,
} from "@/context/toast-context.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import { CanvasDropZone } from "../CanvasDropZone.js";
import { UploadsPanel } from "../UploadsPanel.js";

afterEach(cleanup);
afterEach(() => {
	vi.restoreAllMocks();
});

/**
 * E-17-R: both upload entry points are fire-and-forget, so a rejection that
 * escapes them is an uncaught `unhandledrejection` in the browser (and, in
 * this suite, an unhandled error attributed to whichever test file the event
 * loop happened to be in). These tests reject the pipeline AFTER the adapter
 * has already succeeded — i.e. outside every guard the handlers own — and
 * assert the failure is both OBSERVED and surfaced on the toaster seam.
 */

/** Succeeds every time: the failure under test happens after the upload. */
const uploader: CanvasAssetUploader = {
	upload: async (files) =>
		files.map((f) => ({ id: `up-${f.name}`, uri: `https://cdn/${f.name}` })),
};

const file = (name: string): File =>
	new File(["x"], name, { type: "image/png" });

/** Stage stub with the container origin at (0,0), as in `drop-replace`. */
function makeStage(): Konva.Stage {
	const container = document.createElement("div");
	container.getBoundingClientRect = () =>
		({
			left: 0,
			top: 0,
			width: 800,
			height: 600,
			right: 800,
			bottom: 600,
			x: 0,
			y: 0,
			toJSON() {
				return this;
			},
		}) as DOMRect;
	return { container: () => container } as unknown as Konva.Stage;
}

/**
 * Run `body`, then let the event loop turn twice. Node reports an unhandled
 * rejection only once the microtask queue has drained AND a tick has
 * completed, so the macrotask hops make the observation deterministic rather
 * than racing the assertion. Returns every rejection reason Node considered
 * unhandled during the window.
 */
async function unhandledDuring(body: () => void): Promise<unknown[]> {
	const seen: unknown[] = [];
	const onUnhandled = (reason: unknown): void => {
		seen.push(reason);
	};
	process.on("unhandledRejection", onUnhandled);
	try {
		body();
		await new Promise((resolve) => setTimeout(resolve, 0));
		await new Promise((resolve) => setTimeout(resolve, 0));
	} finally {
		process.off("unhandledRejection", onUnhandled);
	}
	return seen;
}

function harnessWithFailingCommit() {
	const h = makeHarness();
	h.studioCtx.stage = makeStage();
	h.studioCtx.assetUploader = uploader;
	// The insert commit that runs AFTER the upload resolves. It sits outside
	// the handler's `node-not-found` try/catch, so before E-17-R this rejected
	// the fire-and-forget promise with nobody observing it.
	h.studioCtx.commitBatch = vi.fn(() => {
		throw new Error("commit exploded");
	});
	const toasts: CanvasToastInput[] = [];
	const toaster = {
		add: (input: CanvasToastInput) => {
			toasts.push(input);
		},
	};
	// Also the telemetry half of the seam — asserted below to receive the Error
	// OBJECT (a pre-extracted `.message` would collapse the stack), and mocked
	// so the deliberate failure doesn't spam the reporter.
	const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
	return { h, toasts, toaster, logged };
}

/** A `drop` carrying files, with the client point jsdom's init would drop. */
function dropFilesOn(element: HTMLElement, files: readonly File[]): void {
	const event = createEvent.drop(element, {
		dataTransfer: { files, types: ["Files"], getData: () => "" },
	});
	for (const [key, value] of [
		["clientX", 750],
		["clientY", 50],
	] as const) {
		Object.defineProperty(event, key, { value, configurable: true });
	}
	fireEvent(element, event);
}

describe("upload rejections never escape unobserved (E-17-R)", () => {
	it("CanvasDropZone surfaces a post-upload failure on the toaster", async () => {
		const { h, toasts, toaster, logged } = harnessWithFailingCommit();
		render(
			<CanvasToastContext.Provider value={toaster}>
				<CanvasStudioContext.Provider value={h.studioCtx}>
					<CanvasDropZone>
						<div>content</div>
					</CanvasDropZone>
				</CanvasStudioContext.Provider>
			</CanvasToastContext.Provider>,
		);

		const seen = await unhandledDuring(() => {
			dropFilesOn(screen.getByTestId("canvas-drop-zone"), [file("new.png")]);
		});

		expect(seen).toEqual([]);
		expect(toasts).toEqual([
			{
				type: "error",
				title: "Upload failed",
				description: "commit exploded",
			},
		]);
		expect(logged).toHaveBeenCalledWith(
			"canvas upload failed",
			expect.any(Error),
		);
	});

	it("UploadsPanel surfaces a post-upload failure on the toaster", async () => {
		const { h, toasts, toaster } = harnessWithFailingCommit();
		render(
			<CanvasToastContext.Provider value={toaster}>
				<CanvasStudioContext.Provider value={h.studioCtx}>
					<UploadsPanel />
				</CanvasStudioContext.Provider>
			</CanvasToastContext.Provider>,
		);

		const seen = await unhandledDuring(() => {
			dropFilesOn(screen.getByTestId("uploads-panel"), [file("panel.png")]);
		});

		expect(seen).toEqual([]);
		expect(toasts).toEqual([
			{
				type: "error",
				title: "Upload failed",
				description: "commit exploded",
			},
		]);
	});
});
