import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
	type CanvasDialogs,
	useCanvasDialogs,
} from "@/context/dialog-context.js";
import { CanvasDialogHost } from "../CanvasDialogHost.js";

afterEach(cleanup);

function Probe({ capture }: { capture: (d: CanvasDialogs) => void }) {
	const dialogs = useCanvasDialogs();
	useEffect(() => {
		capture(dialogs);
	}, [capture, dialogs]);
	return null;
}

function mount() {
	let dialogs: CanvasDialogs | null = null;
	render(
		<CanvasDialogHost>
			<Probe
				capture={(d) => {
					dialogs = d;
				}}
			/>
		</CanvasDialogHost>,
	);
	if (!dialogs) throw new Error("dialogs not captured");
	return dialogs as CanvasDialogs;
}

describe("CanvasDialogHost (B-05, FR-171)", () => {
	it("confirm resolves true on accept (lazy-loaded dialog)", async () => {
		const dialogs = mount();
		let result: boolean | null = null;
		act(() => {
			void dialogs
				.confirm({ title: "Delete this page?", destructive: true })
				.then((ok) => {
					result = ok;
				});
		});
		// The dialog chunk is code-split — it appears after the lazy import.
		const accept = await screen.findByTestId("canvas-confirm-accept");
		expect(screen.getByText("Delete this page?")).toBeTruthy();
		fireEvent.click(accept);
		await waitFor(() => {
			expect(result).toBe(true);
		});
		expect(screen.queryByTestId("canvas-confirm-dialog")).toBeNull();
	});

	it("confirm resolves false on cancel", async () => {
		const dialogs = mount();
		let result: boolean | null = null;
		act(() => {
			void dialogs.confirm({ title: "Sure?" }).then((ok) => {
				result = ok;
			});
		});
		fireEvent.click(await screen.findByTestId("canvas-confirm-cancel"));
		await waitFor(() => {
			expect(result).toBe(false);
		});
	});

	it("a second confirm cancels the first (last-writer-wins)", async () => {
		const dialogs = mount();
		const results: Array<{ id: string; ok: boolean }> = [];
		act(() => {
			void dialogs
				.confirm({ title: "First" })
				.then((ok) => results.push({ id: "first", ok }));
		});
		await screen.findByTestId("canvas-confirm-dialog");
		act(() => {
			void dialogs
				.confirm({ title: "Second" })
				.then((ok) => results.push({ id: "second", ok }));
		});
		fireEvent.click(await screen.findByTestId("canvas-confirm-accept"));
		await waitFor(() => {
			expect(results).toEqual([
				{ id: "first", ok: false },
				{ id: "second", ok: true },
			]);
		});
	});

	it("without a host, useCanvasDialogs auto-confirms (headless contract)", async () => {
		let dialogs: CanvasDialogs | null = null;
		render(
			<Probe
				capture={(d) => {
					dialogs = d;
				}}
			/>,
		);
		await expect(
			(dialogs as CanvasDialogs | null)?.confirm({ title: "x" }),
		).resolves.toBe(true);
	});
});
