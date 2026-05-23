import { Awareness } from "y-protocols/awareness";
import { Doc as YDoc } from "yjs";
import { describe, expect, it, vi } from "vitest";
import { createCanvasPresence } from "../presence-bridge.js";
import type { CanvasPresenceState } from "../presence-types.js";

function makePresence(opts?: { maxPerSecond?: number }) {
	const awareness = new Awareness(new YDoc());
	const presence = createCanvasPresence(awareness, opts);
	return { awareness, presence };
}

describe("createCanvasPresence", () => {
	it("broadcasts local state to onPeerChange subscribers", () => {
		const { presence } = makePresence();
		const cb = vi.fn();
		presence.onPeerChange(cb);

		const state: CanvasPresenceState = {
			peer: { id: "alice", color: "#f43f5e" },
			cursor: { x: 12, y: 34 },
		};
		presence.update(state);

		expect(cb).toHaveBeenCalled();
		const last = cb.mock.calls.at(-1)?.[0] as CanvasPresenceState[];
		expect(last).toContainEqual(state);
	});

	it("replays current state to a late subscriber immediately", () => {
		const { presence } = makePresence();
		const state: CanvasPresenceState = {
			peer: { id: "alice", color: "#f43f5e" },
			selection: { nodeIds: ["n1", "n2"] },
		};
		presence.update(state);

		const cb = vi.fn();
		presence.onPeerChange(cb);
		expect(cb).toHaveBeenCalledWith([state]);
	});

	it("rate-limits update() via a token bucket", () => {
		const { awareness, presence } = makePresence({ maxPerSecond: 1 });
		const spy = vi.spyOn(awareness, "setLocalState");

		for (let i = 0; i < 5; i++) {
			presence.update({ peer: { id: "alice" }, cursor: { x: i, y: i } });
		}
		// Bucket capacity 1: first call passes, the rest are dropped.
		expect(spy).toHaveBeenCalledTimes(1);
		expect(presence.droppedUpdateCount()).toBe(4);
	});

	it("filters malformed peer states out of the validated view", () => {
		const { awareness, presence } = makePresence();
		// Simulate a hostile/corrupt peer writing directly to awareness
		// (bypasses our outbound rate-limit, like a real remote would).
		awareness.setLocalState({
			peer: { id: "evil", color: "javascript:alert(1)" },
		});
		const cb = vi.fn();
		presence.onPeerChange(cb);
		expect(cb).toHaveBeenCalledWith([]);
	});

	it("destroy() detaches peer-change listeners", () => {
		const { awareness, presence } = makePresence();
		const cb = vi.fn();
		presence.onPeerChange(cb);
		cb.mockClear();
		presence.destroy();
		awareness.setLocalState({ peer: { id: "alice" } });
		expect(cb).not.toHaveBeenCalled();
	});
});
