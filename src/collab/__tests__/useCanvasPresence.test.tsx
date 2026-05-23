import { act, cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";

afterEach(cleanup);

import type { CanvasPresenceState } from "../presence-types.js";
import {
	CanvasPresenceContext,
	type CanvasPresenceSource,
	useCanvasPresence,
} from "../useCanvasPresence.js";

function makeFakeSource() {
	let cb: ((peers: readonly CanvasPresenceState[]) => void) | null = null;
	const source: CanvasPresenceSource = {
		onPeerChange(callback) {
			cb = callback;
			callback([]); // immediate replay, like the real bridge
			return () => {
				cb = null;
			};
		},
	};
	return {
		source,
		emit(peers: readonly CanvasPresenceState[]) {
			cb?.(peers);
		},
	};
}

function Probe(): React.JSX.Element {
	const peers = useCanvasPresence();
	return <div data-testid="peers">{peers.map((p) => p.peer.id).join(",")}</div>;
}

describe("useCanvasPresence", () => {
	it("returns [] when no provider is mounted", () => {
		render(<Probe />);
		expect(screen.getByTestId("peers").textContent).toBe("");
	});

	it("reflects peer states from the context source and updates reactively", () => {
		const fake = makeFakeSource();
		render(
			<CanvasPresenceContext.Provider value={fake.source}>
				<Probe />
			</CanvasPresenceContext.Provider>,
		);
		expect(screen.getByTestId("peers").textContent).toBe("");

		act(() => {
			fake.emit([
				{ peer: { id: "alice" } },
				{ peer: { id: "bob" }, cursor: { x: 1, y: 2 } },
			]);
		});
		expect(screen.getByTestId("peers").textContent).toBe("alice,bob");

		act(() => {
			fake.emit([{ peer: { id: "carol" } }]);
		});
		expect(screen.getByTestId("peers").textContent).toBe("carol");
	});
});
