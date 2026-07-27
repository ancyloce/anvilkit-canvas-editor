import {
	type CanvasIR,
	createCanvasIR,
	createGroup,
	createPage,
	createRect,
} from "@anvilkit/canvas-core";
import { act, cleanup, render } from "@testing-library/react";
import { type ReactNode, useEffect, useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * @file T-M0-04 (plan 0022 M0) — host-driven document load.
 *
 * `CanvasPersistenceAdapter.load` shipped in 0.1.2-rc.1 as an optional method
 * that **nothing ever called**: `<CanvasStudio>` mounted `initialIR` directly,
 * so a host had no way to hand the editor a stored document, and there was no
 * entry path on which to hang migration or validation. These cover the three
 * behaviours that fix has to preserve — load is used when offered, ignored
 * when absent, and a failure never takes the editor down.
 */

function makeMock(type: string) {
	return (props: Record<string, unknown>) => {
		const { children } = props as { children?: ReactNode };
		return <div data-testid={type.toLowerCase()}>{children}</div>;
	};
}

vi.mock("react-konva", () => {
	type StageProps = { children?: ReactNode; ref?: { current: object | null } };
	const Stage = (props: StageProps) => {
		if (props.ref && "current" in props.ref) {
			const container = document.createElement("div");
			props.ref.current = {
				destroy: vi.fn(),
				on: vi.fn(),
				off: vi.fn(),
				container: () => container,
				getPointerPosition: () => null,
			};
		}
		return <div data-testid="stage">{props.children}</div>;
	};
	return {
		Stage,
		Layer: makeMock("Layer"),
		Group: makeMock("Group"),
		Rect: makeMock("Rect"),
		Ellipse: makeMock("Ellipse"),
		Line: makeMock("Line"),
		Path: makeMock("Path"),
		Text: makeMock("Text"),
		Image: makeMock("Image"),
		Label: makeMock("Label"),
		Tag: makeMock("Tag"),
		Transformer: makeMock("Transformer"),
	};
});

vi.mock("use-image", () => ({
	default: () => [null, "loading"],
}));

vi.mock("../render/rasterize-page.js", () => ({
	rasterizePage: vi.fn(async ({ page }: { page: { id: string } }) => ({
		url: `data:thumb/${page.id}`,
		mimeType: "image/png",
	})),
}));

import { CanvasStudio, useCanvasStudio } from "../index.js";
import type { CanvasSaveInput } from "../persistence/types.js";

function fixtureIR(id = "doc-1", rectId = "r1"): CanvasIR {
	const page = createPage({ id: "p1" });
	page.root = createGroup({
		id: "root",
		bounds: page.root.bounds,
		children: [
			createRect({
				id: rectId,
				transform: { x: 0 },
				bounds: { width: 10, height: 10 },
			}),
		],
	});
	return createCanvasIR({
		id,
		pages: [page],
		now: () => "2026-07-27T00:00:00.000Z",
	});
}

/** Mirrors the live IR out so a test can assert what is actually mounted. */
function IRProbe({ onIR }: { onIR: (ir: CanvasIR) => void }): null {
	const ctx = useCanvasStudio();
	const seen = useRef<CanvasIR | null>(null);
	useEffect(() => {
		if (seen.current !== ctx.ir) {
			seen.current = ctx.ir;
			onIR(ctx.ir);
		}
	});
	return null;
}

const noopSave = vi.fn(async (_input: CanvasSaveInput) => ({}));

// The shared react-library preset runs with `globals: false`, so RTL's
// auto-cleanup is NOT installed — without this, each `render` leaves its tree
// in the document and `queryByTestId` throws "found multiple elements".
afterEach(cleanup);

describe("T-M0-04 host-driven load", () => {
	it("calls adapter.load and mounts the document it resolves", async () => {
		const stored = fixtureIR("doc-1", "loaded-rect");
		const load = vi.fn(async () => stored);
		const seen: CanvasIR[] = [];

		render(
			<CanvasStudio
				initialIR={fixtureIR("doc-1", "initial-rect")}
				initialActivePageId="p1"
				persistenceAdapter={{ save: noopSave, load }}
			>
				<IRProbe onIR={(ir) => seen.push(ir)} />
			</CanvasStudio>,
		);
		await act(async () => {
			await Promise.resolve();
		});

		expect(load).toHaveBeenCalledTimes(1);
		// Called with the document id, so a host can key its storage by it.
		expect(load).toHaveBeenCalledWith("doc-1");

		const mounted = seen.at(-1) as CanvasIR;
		const root = mounted.pages[0]?.root as
			| { children: readonly { id: string }[] }
			| undefined;
		const children = root?.children ?? [];
		expect(children[0]?.id).toBe("loaded-rect");
	});

	it("does not call load when the adapter omits it (no behaviour change)", async () => {
		// The compatibility guarantee: every host on 0.1.2-rc.1 supplies only
		// `save`, and must keep mounting `initialIR` exactly as before.
		const seen: CanvasIR[] = [];
		render(
			<CanvasStudio
				initialIR={fixtureIR("doc-1", "initial-rect")}
				initialActivePageId="p1"
				persistenceAdapter={{ save: noopSave }}
			>
				<IRProbe onIR={(ir) => seen.push(ir)} />
			</CanvasStudio>,
		);
		await act(async () => {
			await Promise.resolve();
		});

		const mounted = seen.at(-1) as CanvasIR;
		const root = mounted.pages[0]?.root as
			| { children: readonly { id: string }[] }
			| undefined;
		const children = root?.children ?? [];
		expect(children[0]?.id).toBe("initial-rect");
	});

	it("reports a rejected load through onLoadError without breaking the mount", async () => {
		const load = vi.fn(async () => {
			throw new Error("network down");
		});
		const onLoadError = vi.fn();

		const { queryByTestId } = render(
			<CanvasStudio
				initialIR={fixtureIR()}
				initialActivePageId="p1"
				persistenceAdapter={{ save: noopSave, load }}
				onLoadError={onLoadError}
			/>,
		);
		await act(async () => {
			await Promise.resolve();
		});

		expect(onLoadError).toHaveBeenCalledTimes(1);
		const reported = onLoadError.mock.calls[0]?.[0] as Error | undefined;
		expect(reported?.message).toBe("network down");
		// The editor stays up and editable on `initialIR` — a transport error
		// must not cost the user their session.
		expect(queryByTestId("stage")).not.toBeNull();
	});

	it("reports a malformed stored document through onLoadError", async () => {
		// The load path's whole purpose: a document that cannot parse, migrate,
		// or validate is rejected at the seam instead of reaching the scene.
		const load = vi.fn(async () => ({ version: "3", nope: true }) as never);
		const onLoadError = vi.fn();

		const { queryByTestId } = render(
			<CanvasStudio
				initialIR={fixtureIR()}
				initialActivePageId="p1"
				persistenceAdapter={{ save: noopSave, load }}
				onLoadError={onLoadError}
			/>,
		);
		await act(async () => {
			await Promise.resolve();
		});

		expect(onLoadError).toHaveBeenCalledTimes(1);
		expect(queryByTestId("stage")).not.toBeNull();
	});

	it("survives a load that resolves after unmount", async () => {
		// The response outliving the component is the ordinary case for a slow
		// network; writing into torn-down stores would throw in a floating
		// promise, where React cannot surface it.
		let settle: ((ir: CanvasIR) => void) | undefined;
		const load = vi.fn(
			() =>
				new Promise<CanvasIR>((resolve) => {
					settle = resolve;
				}),
		);
		const onLoadError = vi.fn();

		const { unmount } = render(
			<CanvasStudio
				initialIR={fixtureIR()}
				initialActivePageId="p1"
				persistenceAdapter={{ save: noopSave, load }}
				onLoadError={onLoadError}
			/>,
		);
		unmount();
		await act(async () => {
			settle?.(fixtureIR("doc-1", "late-rect"));
			await Promise.resolve();
		});

		expect(onLoadError).not.toHaveBeenCalled();
	});
});
