import type {
	CanvasDocumentBudgetPolicy,
	CanvasIR,
	CanvasRuntime,
} from "@anvilkit/canvas-core";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import {
	type DocumentSnapshotSource,
	type DocumentStores,
	replaceDocumentSnapshot,
} from "../stores/replace-document.js";
import type { SceneStoreApi } from "../stores/scene-store.js";
import {
	type CanvasActivitySink,
	emitCanvasActivity,
} from "../sharing/activity-events.js";
import type { CanvasAuthorizationDecision } from "../sharing/authorization.js";
import {
	CANVAS_COLLAB_SCHEMA_VERSION,
	CANVAS_COLLAB_SCHEMA_VERSION_KEY,
	CanvasCrdtProjectionError,
	type CanvasCrdtProjectionErrorCode,
	getCanvasCrdtRoot,
	readCanvasIRFromCrdt,
	writeCanvasIRToCrdt,
} from "./crdt-document.js";
import { DEFAULT_CANVAS_MAP_NAME, LAST_PEER_KEY } from "./keys.js";
import {
	type CanvasPresence,
	createCanvasPresence,
} from "./presence-bridge.js";
import { validateCanvasPeerInfo } from "./presence-schema.js";
import type {
	CanvasBindingUnsubscribe,
	CanvasPeerInfo,
} from "./presence-types.js";
import {
	LEGACY_RECOVERY_SNAPSHOT_KEY,
	LEGACY_ROOM_SCHEMA_VERSION_KEY,
	migrateCanvasCollaborationRoom,
	seedEmptyCanvasCollaborationRoom,
	watchLegacyCanvasRoomWrites,
} from "./room-migration.js";

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
	/** Optional host override for remote snapshot admission limits. */
	readonly documentBudgetPolicy?: Partial<CanvasDocumentBudgetPolicy>;
	/**
	 * Optional transport lifecycle bridge. The Y.Doc remains the local work
	 * queue; this source tells the binding when work is offline, reconnecting,
	 * or acknowledged as synchronized.
	 */
	readonly connectionSource?: CanvasCollabConnectionSource;
	/**
	 * Opt in to local collaborative undo/redo. The manager is scoped to the
	 * schema-v2 document root and tracks only transactions authored by
	 * {@link peer}; transport and other-peer origins never enter this stack.
	 */
	readonly undo?: CanvasCollabUndoOptions;
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
	/**
	 * Synchronous provider-boundary recheck for every local scene-store write.
	 * Return a current decision; a denial is reverted before it reaches Yjs.
	 */
	readonly authorizeLocalWrite?: (ir: CanvasIR) => CanvasAuthorizationDecision;
	/** Content-free observer for a provider-boundary write rejection. */
	readonly onAuthorizationDenied?: (
		decision: CanvasAuthorizationDecision,
	) => void;
	/** Content-free, non-load-bearing activity stream for recovery outcomes. */
	readonly activitySink?: CanvasActivitySink;
}

export interface CanvasCollabUndoOptions {
	/**
	 * Milliseconds in which adjacent local commits are combined. Defaults to
	 * Yjs's 500 ms window. Set to 0 for one undo step per editor commit.
	 */
	readonly captureTimeout?: number;
}

export interface CanvasCollabUndoController {
	/** Undo the latest locally authored schema-v2 transaction. */
	readonly undo: () => void;
	/** Redo the latest locally undone schema-v2 transaction. */
	readonly redo: () => void;
	/** Whether the local collaboration stack contains an undo step. */
	readonly canUndo: () => boolean;
	/** Whether the local collaboration stack contains a redo step. */
	readonly canRedo: () => boolean;
	/** Drop all local collaboration undo and redo steps. */
	readonly clearUndo: () => void;
	/** Subscribe to stack mutations; returns an unsubscribe function. */
	readonly onUndoStackChange: (
		callback: () => void,
	) => CanvasBindingUnsubscribe;
}

export type CanvasCollabConnectionStatus =
	| { readonly kind: "connecting" }
	| { readonly kind: "synced"; readonly since: string }
	| { readonly kind: "offline"; readonly since: string }
	| {
			readonly kind: "reconnecting";
			readonly attempt: number;
			readonly backoffMs: number;
	  }
	| {
			readonly kind: "error";
			readonly message: string;
			readonly recoverable: boolean;
	  };

/** Transport hook that emits its current state on attach and returns cleanup. */
export type CanvasCollabConnectionSource = (
	emit: (status: CanvasCollabConnectionStatus) => void,
) => CanvasBindingUnsubscribe;

/** Transport state plus local transactions retained since the last sync. */
export type CanvasCollabSyncState = CanvasCollabConnectionStatus & {
	readonly pendingLocalTransactions: number;
};

export interface CanvasCollabSyncController {
	/** Read current transport and local-queue state synchronously. */
	readonly getSyncState: () => CanvasCollabSyncState;
	/** Subscribe to state/queue changes. The current state is emitted at once. */
	readonly onSyncStateChange: (
		callback: (state: CanvasCollabSyncState) => void,
	) => CanvasBindingUnsubscribe;
}

export type CanvasCollabDiagnosticCode =
	| "invalid-projection"
	| "incompatible-schema"
	| "mixed-schema"
	| "corrupt-legacy"
	| "repair-succeeded"
	| "repair-failed";

export type CanvasCollabDiagnosticAction =
	| "upgrade-client"
	| "export-recovery"
	| "repair-from-last-valid"
	| "none";

export interface CanvasCollabDiagnostic {
	readonly sequence: number;
	readonly code: CanvasCollabDiagnosticCode;
	readonly severity: "info" | "warning" | "error";
	readonly message: string;
	readonly action: CanvasCollabDiagnosticAction;
	readonly occurredAt: string;
	readonly projectionCode?: CanvasCrdtProjectionErrorCode;
	readonly path?: string;
}

export interface CanvasCollabRecoveryPackage {
	readonly format: "anvilkit-canvas-collaboration-recovery";
	readonly version: 1;
	readonly exportedAt: string;
	readonly collaborationSchemaVersion: unknown;
	readonly yjsStateUpdate: Uint8Array;
	readonly legacySnapshot?: string;
	readonly diagnostics: readonly CanvasCollabDiagnostic[];
	readonly lastValidIR: CanvasIR;
}

export type CanvasCollabRepairResult =
	| { readonly ok: true; readonly ir: CanvasIR }
	| { readonly ok: false; readonly error: string };

export interface CanvasCollabRecoveryState {
	readonly writable: boolean;
	readonly requiresRepair: boolean;
	readonly latestDiagnostic?: CanvasCollabDiagnostic;
}

export interface CanvasCollabRecoveryController {
	readonly getDiagnostics: () => readonly CanvasCollabDiagnostic[];
	readonly onDiagnostic: (
		callback: (diagnostic: CanvasCollabDiagnostic) => void,
	) => CanvasBindingUnsubscribe;
	readonly getRecoveryState: () => CanvasCollabRecoveryState;
	readonly exportRecoveryPackage: () => CanvasCollabRecoveryPackage;
	readonly repairFromLastValid: () => CanvasCollabRepairResult;
}

/**
 * Minimal, transport- and consistency-model-agnostic surface a canvas
 * collaboration adapter exposes to a host (P0-10). `createCanvasYjsBinding`
 * below is the schema-v2 granular Yjs implementation. The interface stays
 * consistency-model-agnostic so another compatible replicated store can be
 * substituted without changing editor call sites.
 */
export interface CanvasCollabAdapter {
	/** Fires on REMOTE writes only (origin != localPeer) with the decoded IR
	 *  and the authoring peer, when the peer is known. Local pushes never fire
	 *  this. */
	subscribe(
		onRemote: (ir: CanvasIR, peer?: CanvasPeerInfo) => void,
	): CanvasBindingUnsubscribe;
	/** The current document snapshot, or `undefined` if not yet available/parseable. */
	current(): CanvasIR | undefined;
	/** Detach all observers/listeners this adapter registered. Idempotent. */
	destroy(): void;
}

export interface CanvasYjsBinding
	extends CanvasCollabAdapter,
		CanvasCollabUndoController,
		CanvasCollabSyncController,
		CanvasCollabRecoveryController {
	/** Presence / awareness bridge. Yjs-specific — not part of the
	 *  transport-agnostic {@link CanvasCollabAdapter} surface. */
	readonly presence: CanvasPresence;
}

/**
 * Bind a canvas {@link SceneStoreApi} to a `Y.Doc` (I3-1 prototype). Mirrors
 * `plugin-collab-yjs`'s `createYjsAdapter`, adapted for `CanvasIR` and a
 * zustand store rather than the PageIR snapshot contract.
 *
 * ## Consistency model
 *
 * Schema v2 stores document fields, pages, nodes, ordered children, assets,
 * components, and rich text in independently addressable Yjs shared types.
 * Different-node and same-node/different-field edits merge; same-field edits
 * use Yjs's deterministic conflict rule. Parent registers select one parent
 * after concurrent structural edits, and every projected result re-enters the
 * bounded Canvas load pipeline before editor adoption.
 *
 * Echo loops are prevented two ways:
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
	const { doc, sceneStore, peer, runtime, documentBudgetPolicy } = options;
	const mapName = options.mapName ?? DEFAULT_CANVAS_MAP_NAME;
	const root = getCanvasCrdtRoot(doc, mapName);
	const awareness = options.awareness ?? new Awareness(doc);
	const presence = createCanvasPresence(awareness, options.presenceRateLimit);

	let destroyed = false;
	let applyingRemote = false;
	let recoveryRequired = false;
	let lastValidIR = structuredClone(sceneStore.getState().ir);
	let diagnosticSequence = 0;
	const diagnostics: CanvasCollabDiagnostic[] = [];
	const diagnosticListeners = new Set<
		(diagnostic: CanvasCollabDiagnostic) => void
	>();
	const remoteSubscribers = new Set<
		(ir: CanvasIR, peer?: CanvasPeerInfo) => void
	>();
	const syncStateListeners = new Set<(state: CanvasCollabSyncState) => void>();
	let syncState: CanvasCollabSyncState = options.connectionSource
		? { kind: "connecting", pendingLocalTransactions: 0 }
		: {
				kind: "synced",
				since: new Date().toISOString(),
				pendingLocalTransactions: 0,
			};

	function recordDiagnostic(
		input: Omit<CanvasCollabDiagnostic, "sequence" | "occurredAt">,
	): CanvasCollabDiagnostic {
		const diagnostic: CanvasCollabDiagnostic = {
			...input,
			sequence: (diagnosticSequence += 1),
			occurredAt: new Date().toISOString(),
		};
		diagnostics.push(diagnostic);
		if (diagnostics.length > 100) diagnostics.shift();
		for (const listener of diagnosticListeners) {
			try {
				listener(diagnostic);
			} catch {
				// Host callbacks cannot break recovery state transitions.
			}
		}
		emitCanvasActivity(options.activitySink, {
			kind: "collaboration-recovery",
			idempotencyKey: `${lastValidIR.id}:collaboration:${diagnostic.sequence}:${diagnostic.code}`,
			documentId: lastValidIR.id,
			actorId: peer.id,
			occurredAt: diagnostic.occurredAt,
			diagnosticCode: diagnostic.code,
			outcome:
				diagnostic.code === "repair-succeeded"
					? "succeeded"
					: diagnostic.code === "repair-failed"
						? "failed"
						: "required",
		});
		return diagnostic;
	}

	function recordProjectionFailure(error: unknown): void {
		recoveryRequired = true;
		const projectionError =
			error instanceof CanvasCrdtProjectionError ? error : undefined;
		const incompatible = projectionError?.code === "incompatible-schema";
		recordDiagnostic({
			code: incompatible ? "incompatible-schema" : "invalid-projection",
			severity: "error",
			message: incompatible
				? `${messageOf(error)} Upgrade this client or export recovery data before repairing.`
				: `${messageOf(error)} The invalid Yjs state was retained; export it or explicitly repair from the last valid document.`,
			action: incompatible ? "upgrade-client" : "repair-from-last-valid",
			...(projectionError
				? {
						projectionCode: projectionError.code,
						...(projectionError.path ? { path: projectionError.path } : {}),
					}
				: {}),
		});
	}

	function publishSyncState(next: CanvasCollabSyncState): void {
		syncState = next;
		for (const listener of syncStateListeners) {
			try {
				listener(next);
			} catch {
				// Host callbacks cannot break CRDT writes or sibling listeners.
			}
		}
	}

	function noteQueuedLocalTransaction(): void {
		if (syncState.kind === "synced") return;
		publishSyncState({
			...syncState,
			pendingLocalTransactions: syncState.pendingLocalTransactions + 1,
		});
	}

	function pushLocal(ir: CanvasIR): void {
		if (recoveryRequired || !legacyWriteGuard.isWritable()) return;
		const authorization = options.authorizeLocalWrite?.(ir);
		if (authorization && !authorization.allowed) {
			try {
				options.onAuthorizationDenied?.(authorization);
			} catch {
				// Host observers cannot break the authoritative rollback.
			}
			applySnapshot(structuredClone(lastValidIR), "recovery");
			return;
		}
		doc.transact(() => {
			writeCanvasIRToCrdt(root, ir);
			root.set(LAST_PEER_KEY, JSON.stringify(peer));
		}, peer);
		lastValidIR = structuredClone(ir);
		noteQueuedLocalTransaction();
	}

	function projectCurrent(recordFailure: boolean): CanvasIR | undefined {
		try {
			return readCanvasIRFromCrdt(root, {
				...(runtime ? { runtime } : {}),
				...(documentBudgetPolicy ? { documentBudgetPolicy } : {}),
			});
		} catch (error) {
			if (recordFailure) recordProjectionFailure(error);
			return undefined;
		}
	}

	function readCurrent(): CanvasIR | undefined {
		return projectCurrent(false);
	}

	function readAuthorPeer(): CanvasPeerInfo | undefined {
		const raw = root.get(LAST_PEER_KEY);
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
	// Deliberate AC-010 bypass (review 0022 P2-3): remote snapshots apply even
	// to capability-read-only documents. The read-only guard blocks LOCAL
	// mutating commands only; collaborative conflict semantics are excluded
	// from v1 (PRD §7). Revisit before any collab+layout release.
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
		lastValidIR = structuredClone(ir);
	}

	// Migrate before observers attach, so the one-shot legacy conversion cannot
	// echo through the editor. A genuinely empty room is seeded directly in v2.
	const migration = migrateCanvasCollaborationRoom({
		doc,
		mapName,
		...(runtime ? { runtime } : {}),
		...(documentBudgetPolicy ? { documentBudgetPolicy } : {}),
		origin: peer,
	});
	if (migration.status === "incompatible-schema") {
		recoveryRequired = true;
		recordDiagnostic({
			code: "incompatible-schema",
			severity: "error",
			message: `${migration.error ?? "The room uses an incompatible collaboration schema."} Upgrade this client or export recovery data before repairing.`,
			action: "upgrade-client",
		});
	} else if (migration.status === "corrupt-legacy") {
		recoveryRequired = true;
		recordDiagnostic({
			code: "corrupt-legacy",
			severity: "error",
			message: `${migration.error ?? "The legacy room snapshot is corrupt."} The exact legacy value was preserved for export.`,
			action: "export-recovery",
		});
	}
	if (migration.status === "empty") {
		seedEmptyCanvasCollaborationRoom({
			doc,
			ir: sceneStore.getState().ir,
			mapName,
			origin: peer,
		});
	}
	const legacyWriteGuard = watchLegacyCanvasRoomWrites({
		doc,
		mapName,
		onMixedSchemaWrite: () => {
			recoveryRequired = true;
			recordDiagnostic({
				code: "mixed-schema",
				severity: "error",
				message:
					"A legacy whole-document writer modified this schema-v2 room. Local writes are paused; upgrade the stale client, export recovery data, then repair explicitly.",
				action: "upgrade-client",
			});
		},
	});
	const joined = migration.writable ? projectCurrent(true) : undefined;
	if (migration.status !== "empty" && joined !== undefined) {
		applySnapshot(joined, "initial-load");
	}

	// Scope history to the persisted schema-v2 root and the exact local peer
	// origin used by pushLocal(). Remote transport origins and other peers are
	// deliberately absent, so local undo cannot erase their work. Yjs's default
	// map behavior also refuses to overwrite a newer remote value.
	const undoStackListeners = new Set<() => void>();
	const undoManager = options.undo
		? new Y.UndoManager(root, {
				trackedOrigins: new Set([peer]),
				...(options.undo.captureTimeout !== undefined
					? { captureTimeout: options.undo.captureTimeout }
					: {}),
			})
		: undefined;
	const notifyUndoStackChange = () => {
		for (const listener of undoStackListeners) {
			try {
				listener();
			} catch {
				// Host callbacks cannot break Yjs's undo observer chain.
			}
		}
	};
	if (undoManager) {
		undoManager.on("stack-item-added", notifyUndoStackChange);
		undoManager.on("stack-item-popped", notifyUndoStackChange);
		undoManager.on("stack-item-updated", notifyUndoStackChange);
		undoManager.on("stack-cleared", notifyUndoStackChange);
	}

	// Local -> remote: push on every store change that is not a remote apply.
	const unsubStore = sceneStore.subscribe(() => {
		if (applyingRemote || destroyed) return;
		pushLocal(sceneStore.getState().ir);
	});

	// Remote -> local: one deep callback per foreign schema-v2 transaction.
	const observer = (
		_events: Y.YEvent<Y.AbstractType<unknown>>[],
		transaction: Y.Transaction,
	) => {
		if (isLocalOrigin(transaction.origin, peer)) return;
		const ir = projectCurrent(true);
		if (ir === undefined || recoveryRequired) return;
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
	root.observeDeep(observer);
	const unsubscribeConnection = options.connectionSource?.((status) => {
		if (destroyed) return;
		publishSyncState({
			...status,
			pendingLocalTransactions:
				status.kind === "synced" ? 0 : syncState.pendingLocalTransactions,
		});
	});

	function repairFromLastValid(): CanvasCollabRepairResult {
		if (destroyed) {
			const error = "Cannot repair a destroyed Canvas collaboration binding.";
			recordDiagnostic({
				code: "repair-failed",
				severity: "error",
				message: error,
				action: "export-recovery",
			});
			return { ok: false, error };
		}

		try {
			const candidate = structuredClone(lastValidIR);
			const preservedLegacy = root.get(LEGACY_RECOVERY_SNAPSHOT_KEY);
			const legacy = doc.getMap<unknown>(mapName);
			doc.transact(() => {
				root.clear();
				if (typeof preservedLegacy === "string") {
					root.set(LEGACY_RECOVERY_SNAPSHOT_KEY, preservedLegacy);
				}
				writeCanvasIRToCrdt(root, candidate);
				root.set(LAST_PEER_KEY, JSON.stringify(peer));
				legacy.set(
					LEGACY_ROOM_SCHEMA_VERSION_KEY,
					CANVAS_COLLAB_SCHEMA_VERSION,
				);
			}, peer);
			const repaired = readCanvasIRFromCrdt(root, {
				...(runtime ? { runtime } : {}),
				...(documentBudgetPolicy ? { documentBudgetPolicy } : {}),
			});
			legacyWriteGuard.resetAfterRepair();
			recoveryRequired = false;
			undoManager?.clear();
			applySnapshot(repaired, "recovery");
			recordDiagnostic({
				code: "repair-succeeded",
				severity: "info",
				message:
					"Collaboration schema v2 was explicitly rebuilt from the last valid editor document.",
				action: "none",
			});
			return { ok: true, ir: structuredClone(repaired) };
		} catch (error) {
			recoveryRequired = true;
			const message = `Canvas collaboration repair failed: ${messageOf(error)}`;
			recordDiagnostic({
				code: "repair-failed",
				severity: "error",
				message,
				action: "export-recovery",
			});
			return { ok: false, error: message };
		}
	}

	return {
		subscribe(onRemote) {
			remoteSubscribers.add(onRemote);
			return () => {
				remoteSubscribers.delete(onRemote);
			};
		},
		current: readCurrent,
		presence,
		undo() {
			undoManager?.undo();
		},
		redo() {
			undoManager?.redo();
		},
		canUndo() {
			return undoManager?.canUndo() ?? false;
		},
		canRedo() {
			return undoManager?.canRedo() ?? false;
		},
		clearUndo() {
			undoManager?.clear();
		},
		onUndoStackChange(callback) {
			undoStackListeners.add(callback);
			return () => {
				undoStackListeners.delete(callback);
			};
		},
		getSyncState() {
			return syncState;
		},
		onSyncStateChange(callback) {
			syncStateListeners.add(callback);
			try {
				callback(syncState);
			} catch {
				// A faulty initial callback must not break registration.
			}
			return () => {
				syncStateListeners.delete(callback);
			};
		},
		getDiagnostics() {
			return diagnostics.map((diagnostic) => ({ ...diagnostic }));
		},
		onDiagnostic(callback) {
			diagnosticListeners.add(callback);
			return () => {
				diagnosticListeners.delete(callback);
			};
		},
		getRecoveryState() {
			const latestDiagnostic = diagnostics.at(-1);
			return {
				writable:
					!destroyed && !recoveryRequired && legacyWriteGuard.isWritable(),
				requiresRepair: recoveryRequired,
				...(latestDiagnostic
					? { latestDiagnostic: { ...latestDiagnostic } }
					: {}),
			};
		},
		exportRecoveryPackage() {
			const legacySnapshot = root.get(LEGACY_RECOVERY_SNAPSHOT_KEY);
			return {
				format: "anvilkit-canvas-collaboration-recovery",
				version: 1,
				exportedAt: new Date().toISOString(),
				collaborationSchemaVersion: root.get(CANVAS_COLLAB_SCHEMA_VERSION_KEY),
				yjsStateUpdate: Y.encodeStateAsUpdateV2(doc),
				...(typeof legacySnapshot === "string" ? { legacySnapshot } : {}),
				diagnostics: diagnostics.map((diagnostic) => ({ ...diagnostic })),
				lastValidIR: structuredClone(lastValidIR),
			};
		},
		repairFromLastValid,
		destroy() {
			if (destroyed) return;
			destroyed = true;
			unsubStore();
			root.unobserveDeep(observer);
			legacyWriteGuard.destroy();
			if (undoManager) {
				undoManager.off("stack-item-added", notifyUndoStackChange);
				undoManager.off("stack-item-popped", notifyUndoStackChange);
				undoManager.off("stack-item-updated", notifyUndoStackChange);
				undoManager.off("stack-cleared", notifyUndoStackChange);
				undoManager.destroy();
			}
			undoStackListeners.clear();
			unsubscribeConnection?.();
			syncStateListeners.clear();
			diagnosticListeners.clear();
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

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
