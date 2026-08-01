import {
	type CanvasPage,
	createGroup,
	createPage,
	createRect,
} from "@anvilkit/canvas-core";
import { describe, expect, it, vi } from "vitest";
import type { rasterizePage } from "@/render/rasterize-page.js";
import { pageThumbnailKey, usePageThumbnails } from "../page-thumbnails.js";

function pageWith(id: string, rectIds: string[]): CanvasPage {
	const page = createPage({ id });
	page.root = createGroup({
		id: `${id}-root`,
		bounds: page.root.bounds,
		children: rectIds.map((rid) =>
			createRect({ id: rid, bounds: { width: 10, height: 10 } }),
		),
	});
	return page;
}

describe("pageThumbnailKey", () => {
	it("is stable for identical content and changes when content changes", () => {
		const a = pageWith("p1", ["r1"]);
		const b = pageWith("p1", ["r1"]);
		expect(pageThumbnailKey(a)).toBe(pageThumbnailKey(b));

		const moved = pageWith("p1", ["r1"]);
		(moved.root as { children: { transform: { x: number } }[] })
			.children[0]!.transform.x = 99;
		expect(pageThumbnailKey(moved)).not.toBe(pageThumbnailKey(a));

		const added = pageWith("p1", ["r1", "r2"]);
		expect(pageThumbnailKey(added)).not.toBe(pageThumbnailKey(a));
	});

	it("differs across page ids", () => {
		expect(pageThumbnailKey(pageWith("p1", ["r1"]))).not.toBe(
			pageThumbnailKey(pageWith("p2", ["r1"])),
		);
	});
});

const stubRasterize = (() =>
	vi.fn(async ({ page }: { page: CanvasPage }) => ({
		url: `data:thumb/${page.id}`,
		mimeType: "image/png",
	}))) as unknown as () => typeof rasterizePage;

describe("usePageThumbnails", () => {
	it("rasterizes non-active pages, skips the active page, and caches", async () => {
		const { renderHook, act } = await import("@testing-library/react");
		const rasterize = stubRasterize();
		const pages = [pageWith("p1", ["r1"]), pageWith("p2", ["r2"])];

		const { result, rerender } = renderHook(
			(props: { pages: CanvasPage[] }) =>
				usePageThumbnails({
					pages: props.pages,
					activePageId: "p1",
					assets: {},
					rasterize,
				}),
			{ initialProps: { pages } },
		);
		await act(async () => {
			await Promise.resolve();
		});

		// p2 (non-active) rasterized; p1 (active) skipped.
		expect(result.current.get("p2")).toBe("data:thumb/p2");
		expect(result.current.has("p1")).toBe(false);
		expect(
			rasterize as unknown as ReturnType<typeof vi.fn>,
		).toHaveBeenCalledTimes(1);

		// Re-render with the SAME pages → cache hit, no new rasterize.
		rerender({ pages });
		await act(async () => {
			await Promise.resolve();
		});
		expect(
			rasterize as unknown as ReturnType<typeof vi.fn>,
		).toHaveBeenCalledTimes(1);

		// Mutate p2's content → key changes → re-rasterize.
		rerender({ pages: [pages[0]!, pageWith("p2", ["r2", "r3"])] });
		await act(async () => {
			await Promise.resolve();
		});
		expect(
			rasterize as unknown as ReturnType<typeof vi.fn>,
		).toHaveBeenCalledTimes(2);
	});

	/**
	 * Plan 0024 T-4.3. `resolvedDocument` changes identity on EVERY resolution,
	 * including every frame of a live preview, so it was moved out of the effect's
	 * dependency array into a latest-value ref. The risk that swap introduces is
	 * a STALE capture — a rasterize using the resolution from whenever the effect
	 * last ran. This pins the opposite: the rasterize sees the newest one.
	 */
	it("rasterizes with the LATEST resolvedDocument, not the one captured when the effect last ran", async () => {
		const { renderHook, act } = await import("@testing-library/react");
		const rasterize = stubRasterize();
		const first = { marker: "first" } as never;
		const second = { marker: "second" } as never;
		const p1 = pageWith("p1", ["r1"]);

		const { rerender } = renderHook(
			(props: { pages: CanvasPage[]; resolvedDocument: never }) =>
				usePageThumbnails({
					pages: props.pages,
					activePageId: "p1",
					assets: {},
					rasterize,
					resolvedDocument: props.resolvedDocument,
				}),
			{
				initialProps: {
					pages: [p1, pageWith("p2", ["r2"])],
					resolvedDocument: first,
				},
			},
		);
		await act(async () => {
			await Promise.resolve();
		});
		const spy = rasterize as unknown as ReturnType<typeof vi.fn>;
		expect(spy.mock.calls[0]?.[0]?.resolvedDocument).toBe(first);

		// New resolution AND changed inactive content: the re-rasterize must use
		// the new resolution even though it was never a dependency.
		rerender({
			pages: [p1, pageWith("p2", ["r2", "r3"])],
			resolvedDocument: second,
		});
		await act(async () => {
			await Promise.resolve();
		});
		expect(spy).toHaveBeenCalledTimes(2);
		expect(spy.mock.calls[1]?.[0]?.resolvedDocument).toBe(second);
	});

	/**
	 * Plan 0024 T-4.3, the actual perf claim. `pageThumbnailKey` is
	 * `JSON.stringify(page)`, so an enumerable counting getter records exactly
	 * how many times the effect fingerprinted this page. Before the fix the
	 * effect depended on `pages`, which `withPreviews` rebuilds on every preview
	 * frame — so every inactive page was re-serialized per frame just to conclude
	 * "still cached". Asserting on rasterize COUNT alone cannot see this (the
	 * cache hit suppresses the call either way); the fingerprint count can.
	 */
	it("does not re-fingerprint inactive pages when only the active page changed (plan 0024 T-4.3)", async () => {
		const { renderHook, act } = await import("@testing-library/react");
		const rasterize = stubRasterize();
		let fingerprints = 0;
		const counted: CanvasPage = { ...pageWith("p2", ["r2"]) };
		Object.defineProperty(counted, "name", {
			enumerable: true,
			configurable: true,
			get() {
				fingerprints += 1;
				return "p2";
			},
		});

		// Hoisted: an inline `{}` would be a new object every render and would
		// re-run the effect on its own, masking what this test measures.
		const assets = {};
		const { rerender } = renderHook(
			(props: { pages: CanvasPage[] }) =>
				usePageThumbnails({
					pages: props.pages,
					activePageId: "p1",
					assets,
					rasterize,
				}),
			{ initialProps: { pages: [pageWith("p1", ["r1"]), counted] } },
		);
		await act(async () => {
			await Promise.resolve();
		});
		const spy = rasterize as unknown as ReturnType<typeof vi.fn>;
		expect(spy).toHaveBeenCalledTimes(1);
		expect(fingerprints).toBe(1);

		// Three preview frames: the ACTIVE page is rebuilt with different content
		// each time (as `withPreviews` does), every other page reference-identical.
		for (const extra of ["a", "b", "c"]) {
			rerender({ pages: [pageWith("p1", ["r1", extra]), counted] });
			await act(async () => {
				await Promise.resolve();
			});
		}
		// Unchanged: the effect never re-ran, so p2 was never re-serialized.
		expect(fingerprints).toBe(1);
		expect(spy).toHaveBeenCalledTimes(1);
	});

	// E-15: no in-flight dedup meant every effect re-run while a page's
	// rasterize was still pending (e.g. a remote-collab commit stream
	// recreating the `pages` array) launched ANOTHER concurrent off-screen
	// rasterize for the same page at the same content version.
	it("does not launch a second rasterize for the same page+key while one is already in flight", async () => {
		const { renderHook, act } = await import("@testing-library/react");
		let resolveRasterize:
			| ((res: { url: string; mimeType: string }) => void)
			| null = null;
		const rasterize = vi.fn(
			() =>
				new Promise<{ url: string; mimeType: string }>((resolve) => {
					resolveRasterize = resolve;
				}),
		) as unknown as typeof rasterizePage;
		const pages = [pageWith("p1", ["r1"]), pageWith("p2", ["r2"])];

		const { rerender } = renderHook(
			(props: { pages: CanvasPage[] }) =>
				usePageThumbnails({
					pages: props.pages,
					activePageId: "p1",
					assets: {},
					rasterize,
				}),
			{ initialProps: { pages } },
		);
		await act(async () => {
			await Promise.resolve();
		});
		expect(rasterize).toHaveBeenCalledTimes(1);

		// A new `pages` ARRAY reference (unrelated churn elsewhere re-created
		// it), same p2 object/content, while p2's rasterize is still
		// unresolved — must not launch a second concurrent rasterize.
		rerender({ pages: [...pages] });
		await act(async () => {
			await Promise.resolve();
		});
		expect(rasterize).toHaveBeenCalledTimes(1);

		// Settle the stale in-flight rasterize (the array-reference rerender
		// above already cancelled ITS effect's own subscription per the
		// existing `cancelled`-flag cleanup — an unrelated, pre-existing
		// mechanism — so this is just proving it resolves without throwing).
		await act(async () => {
			resolveRasterize?.({ url: "data:thumb/p2-stale", mimeType: "image/png" });
			await Promise.resolve();
		});

		// Genuinely new content for p2 still gets its own fresh rasterize — the
		// dedup guard tracks per-key, not a permanent lock on the page id.
		rerender({ pages: [pages[0]!, pageWith("p2", ["r2", "r3"])] });
		await act(async () => {
			await Promise.resolve();
		});
		expect(rasterize).toHaveBeenCalledTimes(2);
	});

	it("prunes thumbnails for pages that disappear", async () => {
		const { renderHook, act } = await import("@testing-library/react");
		const rasterize = stubRasterize();
		const p1 = pageWith("p1", ["r1"]);
		const p2 = pageWith("p2", ["r2"]);

		const { result, rerender } = renderHook(
			(props: { pages: CanvasPage[] }) =>
				usePageThumbnails({
					pages: props.pages,
					activePageId: "p1",
					assets: {},
					rasterize,
				}),
			{ initialProps: { pages: [p1, p2] } },
		);
		await act(async () => {
			await Promise.resolve();
		});
		expect(result.current.has("p2")).toBe(true);

		rerender({ pages: [p1] });
		await act(async () => {
			await Promise.resolve();
		});
		expect(result.current.has("p2")).toBe(false);
	});
});
