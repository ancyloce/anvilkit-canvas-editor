import { createCanvasIR, createPage } from "@anvilkit/canvas-core";
import { cleanup, render } from "@testing-library/react";
import * as React from "react";
import { useSyncExternalStore } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFieldPreviewStore } from "../../stores/field-preview-store.js";
import {
	createResolvedDocumentStore,
	type ResolvedDocumentStoreApi,
} from "../../stores/resolved-document-store.js";
import { createSceneStore } from "../../stores/scene-store.js";
import {
	fontManifestHash,
	resetFontStatusesForTests,
	useFontStatus,
} from "../font-status.js";

/**
 * @file Regression: observing a font family is a STORE WRITE, and the font
 * manifest drives a synchronous re-resolution of the whole document
 * (`resolved-document-store.connect`). Doing it during render therefore updates
 * every already-mounted resolved-document consumer — `DesignBackground` via
 * `useActivePage` — from inside another component's render pass, which React
 * reports as "Cannot update a component (`DesignBackground`) while rendering a
 * different component (`CanvasTextNodeRenderer`)".
 *
 * jsdom has no `document.fonts`, so observation settles to `fallback`
 * immediately — still a real status transition, so the manifest bumps and the
 * fan-out is identical to a browser's `loading` write. No stub needed.
 */

let disconnect: (() => void) | undefined;

afterEach(() => {
	disconnect?.();
	disconnect = undefined;
	// The react-library preset runs with `globals: false`, so RTL's automatic
	// cleanup is off and multi-render files must unmount explicitly.
	cleanup();
	resetFontStatusesForTests();
	vi.restoreAllMocks();
});

function makeResolvedStore(): ResolvedDocumentStoreApi {
	const sceneStore = createSceneStore({
		initialIR: createCanvasIR({
			id: "doc",
			title: "t",
			pages: [createPage({ id: "p1" })],
		}),
	});
	const store = createResolvedDocumentStore({
		sceneStore,
		fieldPreviewStore: createFieldPreviewStore(),
	});
	disconnect = store.connect();
	return store;
}

/** Stands in for `DesignBackground`/`useActivePage` — a mounted subscriber. */
function ResolvedConsumer({ store }: { store: ResolvedDocumentStoreApi }) {
	useSyncExternalStore(
		store.subscribe,
		() => store.getState().resolved,
		() => store.getState().resolved,
	);
	return <div data-testid="consumer" />;
}

/** Stands in for `CanvasTextNodeRenderer` — mounts and tracks a font family. */
function TextRenderer({
	onRender,
}: {
	onRender?: (manifestHash: string) => void;
}) {
	useFontStatus("Regression Font");
	onRender?.(fontManifestHash());
	return null;
}

describe("useFontStatus render safety (FR-083 C-11)", () => {
	it("does not touch the font manifest during render", () => {
		const before = fontManifestHash();
		const seen: string[] = [];
		render(<TextRenderer onRender={(hash) => seen.push(hash)} />);

		// The value read after `useFontStatus` returned, still inside the render
		// pass: unchanged. Observation belongs to the commit phase.
		expect(seen[0]).toBe(before);
		// ...and it did happen — the family is tracked once effects flushed.
		expect(fontManifestHash()).not.toBe(before);
	});

	it("mounting a text renderer never updates a resolved-document consumer mid-render", () => {
		const store = makeResolvedStore();
		const errors: string[] = [];
		vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
			errors.push(args.map(String).join(" "));
		});

		// Two passes on purpose: `useSyncExternalStore` subscribes in an effect,
		// so the consumer is only exposed to a mid-render store write once it is
		// already mounted — which is exactly when the reported warning fired.
		const { rerender } = render(<ResolvedConsumer store={store} />);
		rerender(
			<>
				<ResolvedConsumer store={store} />
				<TextRenderer />
			</>,
		);

		expect(errors.join("\n")).not.toContain(
			"while rendering a different component",
		);
	});
});
