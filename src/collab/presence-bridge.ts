import type { Awareness } from "y-protocols/awareness";
import { validateCanvasPresenceState } from "./presence-schema.js";
import type {
	CanvasBindingUnsubscribe,
	CanvasPresenceState,
} from "./presence-types.js";

export interface CanvasPresence {
	/** Set local presence (cursor / selection / display name). Token-bucket
	 *  rate-limited; calls beyond the budget are dropped. */
	update(state: CanvasPresenceState): void;
	/** Subscribe to validated remote+local peer states. Fires immediately with
	 *  the current set, then on every awareness change. */
	onPeerChange(
		callback: (peers: readonly CanvasPresenceState[]) => void,
	): CanvasBindingUnsubscribe;
	/** Test/telemetry hook — count of `update()` calls dropped by the limiter. */
	droppedUpdateCount(): number;
	destroy(): void;
}

export interface CreateCanvasPresenceOptions {
	/** Outbound `update()` budget. Default 30/sec. Use `Infinity` to disable. */
	maxPerSecond?: number;
}

const DEFAULT_PRESENCE_RATE_PER_SECOND = 30;

function nowMs(): number {
	return typeof performance !== "undefined" &&
		typeof performance.now === "function"
		? performance.now()
		: Date.now();
}

/**
 * Bridge between a `y-protocols/awareness` instance and the canvas presence
 * contract. Ported from `plugin-collab-yjs`'s `createAwarenessBridge`, minus
 * the metrics coupling:
 *
 * - outbound `update()` is token-bucket rate-limited (L3, default 30/sec) so a
 *   cursor-on-every-mousemove host can't flood awareness traffic;
 * - inbound peer states are filtered through {@link validateCanvasPresenceState}
 *   so a malformed payload never poisons the local view;
 * - `onPeerChange` keeps a validated cache keyed by client id and revalidates
 *   only the clients in each change delta — O(changed), not O(peers);
 * - `destroy()` removes every awareness listener this bridge registered.
 */
export function createCanvasPresence(
	awareness: Awareness,
	options?: CreateCanvasPresenceOptions,
): CanvasPresence {
	const peerChangeHandlers = new Set<() => void>();

	const maxPerSecond =
		options?.maxPerSecond ?? DEFAULT_PRESENCE_RATE_PER_SECOND;
	const bucketCapacity = Number.isFinite(maxPerSecond)
		? Math.max(1, maxPerSecond)
		: Number.POSITIVE_INFINITY;
	let tokens = bucketCapacity;
	// Monotonic clock so a wall-clock step can't make the refill negative.
	let lastRefillTs = nowMs();
	let droppedUpdates = 0;

	function takeToken(): boolean {
		if (!Number.isFinite(bucketCapacity)) return true;
		const now = nowMs();
		const elapsed = now - lastRefillTs;
		if (elapsed > 0) {
			tokens = Math.min(
				bucketCapacity,
				tokens + (elapsed * maxPerSecond) / 1000,
			);
			lastRefillTs = now;
		}
		if (tokens >= 1) {
			tokens -= 1;
			return true;
		}
		return false;
	}

	return {
		update(state: CanvasPresenceState): void {
			if (!takeToken()) {
				droppedUpdates += 1;
				return;
			}
			awareness.setLocalState(state as unknown as Record<string, unknown>);
		},
		onPeerChange(
			callback: (peers: readonly CanvasPresenceState[]) => void,
		): CanvasBindingUnsubscribe {
			const cache = new Map<number, CanvasPresenceState>();
			let seeded = false;

			const refreshClient = (clientId: number): void => {
				const value = awareness.getStates().get(clientId);
				if (value === undefined) {
					cache.delete(clientId);
					return;
				}
				const validated = validateCanvasPresenceState(value);
				if (validated !== null) {
					cache.set(clientId, validated);
				} else {
					cache.delete(clientId);
				}
			};

			const handler = (changes?: {
				added: number[];
				updated: number[];
				removed: number[];
			}) => {
				if (!seeded || !changes) {
					cache.clear();
					for (const clientId of awareness.getStates().keys()) {
						refreshClient(clientId);
					}
					seeded = true;
				} else {
					for (const clientId of changes.added) refreshClient(clientId);
					for (const clientId of changes.updated) refreshClient(clientId);
					for (const clientId of changes.removed) cache.delete(clientId);
				}
				callback([...cache.values()]);
			};
			awareness.on("change", handler);
			peerChangeHandlers.add(handler);
			handler();
			return () => {
				awareness.off("change", handler);
				peerChangeHandlers.delete(handler);
			};
		},
		droppedUpdateCount: () => droppedUpdates,
		destroy(): void {
			for (const handler of peerChangeHandlers) {
				awareness.off("change", handler);
			}
			peerChangeHandlers.clear();
		},
	};
}
