import type { CanvasIR, CanvasRuntime } from "@anvilkit/canvas-core";
import { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";
import {
	type DocumentSnapshotSource,
	type DocumentStores,
	replaceDocumentSnapshot,
} from "../stores/replace-document.js";
import type { SceneStoreApi } from "../stores/scene-store.js";
import { decodeCanvasIR, encodeCanvasIR } from "./encode.js";
import {
	CANVAS_IR_KEY,
	DEFAULT_CANVAS_MAP_NAME,
	LAST_PEER_KEY,
} from "./keys.js";
import {
	type CanvasPresence,
	createCanvasPresence,
} from "./presence-bridge.js";
import { validateCanvasPeerInfo } from "./presence-schema.js";
import type {
	CanvasBindingUnsubscribe,
	CanvasPeerInfo,
} from "./presence-types.js";

export interface CreateCanvasYjsBindingOptions {
	/** Shared document. The caller owns the transport (provider, or the
	 *  two-doc `applyUpdate` wiring used in tests). */
	readonly doc: Y.Doc;
	/** The scene store to bind. Local changes push to the doc; remote changes
	 *  are applied back via `setIR` (bypassing the undo stack). */
	readonly sceneStore: SceneStoreApi;
	/** Local peer identity. Used as the Yjs transaction origin tag. */
	readonly peer: CanvasPeerInfo;
	/** Awareness instance for presence. Defaults to `new Awareness(doc)`. */
	readonly awareness?: Awareness;
	/** Y.Map name scoping the binding keys. Default {@link DEFAULT_CANVAS_MAP_NAME}. */
	readonly mapName?: string;
	/** Presence outbound rate limit (default 30/sec). */
	readonly presenceRateLimit?: { readonly maxPerSecond: number };
	/**
	 * Core runtime (P0-8) used to migrate + validate every remote/joined
	 * payload via `decodeCanvasIR`. Pass the SAME runtime the host built with
	 * `createCanvasRuntime(...)` for custom node kinds — otherwise a peer's
	 * custom nodes are rejected by the closed built-in schema. Omit to decode
	 * with core's default (built-in-only, but still migration-aware) path.
	 */
	readonly runtime?: CanvasRuntime;
	/**
	 * The full editor store bundle (P0-9). When supplied, a joined or remote
	 * snapshot replacement routes through `replaceDocumentSnapshot` — resetting
	 * history, clearing selection/focus/draft/editing/crop/pen/path-edit/
	 * guides, aborting stale AI jobs, and reconciling the active page — instead
	 * of touching only `sceneStore.ir`. Every field is available off
	 * `useCanvasStudio()`'s context value. Optional for backward compatibility:
	 * omit it to keep the pre-P0-9 `sceneStore`-only replacement behavior.
	 */
	readonly stores?: DocumentStores;
}

export interface CanvasYjsBinding {
	/** Fires on REMOTE writes only (origin != localPeer) with the decoded IR
	 *  and the authoring peer. Local pushes never fire this. */
	subscribe(
		onRemote: (ir: CanvasIR, peer?: CanvasPeerInfo) => void,
	): CanvasBindingUnsubscribe;
	/** Decode the current IR from the doc, or `undefined` if empty/unparseable. */
	current(): CanvasIR | undefined;
	/** Presence / awareness bridge. */
	readonly presence: CanvasPresence;
	/** Detach all observers + awareness listeners. Idempotent. */
	destroy(): void;
}

/**
 * Bind a canvas {@link SceneStoreApi} to a `Y.Doc` (I3-1 prototype). Mirrors
 * `plugin-collab-yjs`'s `createYjsAdapter`, adapted for `CanvasIR` and a
 * zustand store rather than the PageIR snapshot contract.
 *
 * Encoding is whole-document JSON-blob last-writer-wins under
 * {@link CANVAS_IR_KEY} (the documented alpha posture; native per-node merge is
 * the GA follow-up). Echo loops are prevented two ways:
 *
 * - the Yjs observer ignores transactions whose origin is the local peer
 *   ({@link isLocalOrigin}), so our own writes never re-apply;
 * - an `applyingRemote` flag suppresses the store subscription while a remote
 *   update is being written via `setIR`, so remote → `setIR` → subscription
 *   does not re-push to the doc.
 *
 * Architectural only: no UI is wired here. Verified by a two-doc convergence
 * test (`__tests__/binding.test.ts`).
 */
export function createCanvasYjsBinding(
	options: CreateCanvasYjsBindingOptions,
): CanvasYjsBinding {
	const { doc, sceneStore, peer, runtime } = options;
	const map = doc.getMap<string>(options.mapName ?? DEFAULT_CANVAS_MAP_NAME);
	const awareness = options.awareness ?? new Awareness(doc);
	const presence = createCanvasPresence(awareness, options.presenceRateLimit);

	let destroyed = false;
	let applyingRemote = false;
	const remoteSubscribers = new Set<
		(ir: CanvasIR, peer?: CanvasPeerInfo) => void
	>();

	function pushLocal(ir: CanvasIR): void {
		doc.transact(() => {
			map.set(CANVAS_IR_KEY, encodeCanvasIR(ir));
			map.set(LAST_PEER_KEY, JSON.stringify(peer));
		}, peer);
	}

	function readCurrent(): CanvasIR | undefined {
		const raw = map.get(CANVAS_IR_KEY);
		if (typeof raw !== "string") return undefined;
		try {
			return decodeCanvasIR(raw, runtime);
		} catch {
			return undefined;
		}
	}

	function readAuthorPeer(): CanvasPeerInfo | undefined {
		const raw = map.get(LAST_PEER_KEY);
		if (typeof raw !== "string") return undefined;
		try {
			return validateCanvasPeerInfo(JSON.parse(raw)) ?? undefined;
		} catch {
			return undefined;
		}
	}

	// P0-9: a joined or remote IR is an UNRELATED snapshot, not a delta of the
	// current document — `sceneStore.setIR` alone would leave history,
	// selection, and every other transient store holding state computed
	// against the document that's about to disappear. Route through the
	// coordinator when the host supplied the full store bundle; fall back to
	// the pre-P0-9 `setIR`-only behavior when it didn't (back-compat for a
	// binding constructed before `stores` existed).
	function applySnapshot(ir: CanvasIR, source: DocumentSnapshotSource): void {
		applyingRemote = true;
		try {
			if (options.stores) {
				replaceDocumentSnapshot(options.stores, ir, { source });
			} else {
				sceneStore.getState().setIR(ir);
			}
		} finally {
			applyingRemote = false;
		}
	}

	// Join: remote-wins if the doc already holds an IR; otherwise seed it from
	// the local scene. Runs before observers are attached, so no echo.
	const joined = readCurrent();
	if (joined !== undefined) {
		applySnapshot(joined, "initial-load");
	} else {
		pushLocal(sceneStore.getState().ir);
	}

	// Local -> remote: push on every store change that is not a remote apply.
	const unsubStore = sceneStore.subscribe(() => {
		if (applyingRemote || destroyed) return;
		pushLocal(sceneStore.getState().ir);
	});

	// Remote -> local: apply foreign writes; ignore our own (origin guard).
	const observer = (event: Y.YMapEvent<string>, transaction: Y.Transaction) => {
		if (!event.keysChanged.has(CANVAS_IR_KEY)) return;
		if (isLocalOrigin(transaction.origin, peer)) return;
		const ir = readCurrent();
		if (ir === undefined) return;
		const author = readAuthorPeer();
		applySnapshot(ir, "remote-update");
		// This observer runs synchronously inside the Yjs transaction commit
		// (`applyUpdate`). A throwing subscriber would escape the observer and
		// could abort the transaction, leaving the doc/observer set inconsistent
		// — a desync vector under a buggy or hostile peer. Isolate each callback.
		for (const cb of remoteSubscribers) {
			try {
				cb(ir, author);
			} catch (err) {
				console.error("canvas collab remote subscriber threw", err);
			}
		}
	};
	map.observe(observer);

	return {
		subscribe(onRemote) {
			remoteSubscribers.add(onRemote);
			return () => {
				remoteSubscribers.delete(onRemote);
			};
		},
		current: readCurrent,
		presence,
		destroy() {
			if (destroyed) return;
			destroyed = true;
			unsubStore();
			map.unobserve(observer);
			presence.destroy();
		},
	};
}

/** Match a Yjs transaction origin against the local peer (id or PeerInfo
 *  object). Ported verbatim from `plugin-collab-yjs`. */
function isLocalOrigin(origin: unknown, localPeer: CanvasPeerInfo): boolean {
	if (origin === localPeer.id) return true;
	const peer = validateCanvasPeerInfo(origin);
	return peer !== null && peer.id === localPeer.id;
}
