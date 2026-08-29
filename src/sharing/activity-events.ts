import type {
	CanvasAuthorizationScopeKind,
	CanvasCollaborationRole,
} from "./authorization.js";

export type CanvasActivityEventBase = Readonly<{
	idempotencyKey: string;
	documentId: string;
	actorId: string;
	occurredAt: string;
}>;

export type CanvasShareActivityEvent = CanvasActivityEventBase &
	Readonly<{
		kind:
			| "share-link-created"
			| "share-link-expired"
			| "share-link-revoked"
			| "share-link-rotated";
		linkId: string;
		linkRole: Exclude<CanvasCollaborationRole, "owner">;
		tokenVersion: number;
	}>;

export type CanvasRoleActivityEvent = CanvasActivityEventBase &
	Readonly<{
		kind: "role-changed";
		subjectId: string;
		scopeKind: CanvasAuthorizationScopeKind;
		scopeId: string;
		previousRole: CanvasCollaborationRole | null;
		nextRole: CanvasCollaborationRole | null;
	}>;

export type CanvasCommentActivityEvent = CanvasActivityEventBase &
	Readonly<{
		kind:
			| "comment-thread-created"
			| "comment-replied"
			| "comment-resolved"
			| "comment-reopened";
		threadId: string;
		messageId?: string;
	}>;

export type CanvasCollaborationRecoveryCode =
	| "invalid-projection"
	| "incompatible-schema"
	| "mixed-schema"
	| "corrupt-legacy"
	| "repair-succeeded"
	| "repair-failed";

export type CanvasCollaborationActivityEvent = CanvasActivityEventBase &
	Readonly<{
		kind: "collaboration-recovery";
		diagnosticCode: CanvasCollaborationRecoveryCode;
		outcome: "required" | "succeeded" | "failed";
	}>;

/** Closed, content-free activity vocabulary for host audit storage. */
export type CanvasActivityEvent =
	| CanvasShareActivityEvent
	| CanvasRoleActivityEvent
	| CanvasCommentActivityEvent
	| CanvasCollaborationActivityEvent;

export interface CanvasActivitySink {
	/** MUST append idempotently by `event.idempotencyKey`. */
	record(event: CanvasActivityEvent): void;
}

export interface CanvasMemoryActivitySink extends CanvasActivitySink {
	list(): readonly CanvasActivityEvent[];
}

export type RecordCanvasRoleChangeInput = Readonly<{
	idempotencyKey: string;
	documentId: string;
	actorId: string;
	subjectId: string;
	scopeKind: CanvasAuthorizationScopeKind;
	scopeId: string;
	previousRole: CanvasCollaborationRole | null;
	nextRole: CanvasCollaborationRole | null;
	occurredAt: string;
}>;

export class CanvasActivityError extends Error {
	readonly name = "CanvasActivityError";

	constructor(readonly code: "invalid-event") {
		super(`Canvas activity operation failed (${code}).`);
	}
}

const BASE_KEYS = [
	"idempotencyKey",
	"kind",
	"documentId",
	"actorId",
	"occurredAt",
] as const;

const ALLOWED_KEYS: Record<CanvasActivityEvent["kind"], ReadonlySet<string>> = {
	"share-link-created": new Set([...BASE_KEYS, "linkId", "linkRole", "tokenVersion"]),
	"share-link-expired": new Set([...BASE_KEYS, "linkId", "linkRole", "tokenVersion"]),
	"share-link-revoked": new Set([...BASE_KEYS, "linkId", "linkRole", "tokenVersion"]),
	"share-link-rotated": new Set([...BASE_KEYS, "linkId", "linkRole", "tokenVersion"]),
	"role-changed": new Set([
		...BASE_KEYS,
		"subjectId",
		"scopeKind",
		"scopeId",
		"previousRole",
		"nextRole",
	]),
	"comment-thread-created": new Set([...BASE_KEYS, "threadId", "messageId"]),
	"comment-replied": new Set([...BASE_KEYS, "threadId", "messageId"]),
	"comment-resolved": new Set([...BASE_KEYS, "threadId", "messageId"]),
	"comment-reopened": new Set([...BASE_KEYS, "threadId", "messageId"]),
	"collaboration-recovery": new Set([
		...BASE_KEYS,
		"diagnosticCode",
		"outcome",
	]),
};

function required(value: string): string {
	const normalized = value.trim();
	if (!normalized) throw new CanvasActivityError("invalid-event");
	return normalized;
}

/** Reject runtime-injected fields before an event reaches deterministic storage. */
export function assertCanvasActivityEvent(
	event: CanvasActivityEvent,
): CanvasActivityEvent {
	const allowed = ALLOWED_KEYS[event.kind];
	if (!allowed || Object.keys(event).some((key) => !allowed.has(key))) {
		throw new CanvasActivityError("invalid-event");
	}
	required(event.idempotencyKey);
	required(event.documentId);
	required(event.actorId);
	required(event.occurredAt);
	return event;
}

function cloneEvent(event: CanvasActivityEvent): CanvasActivityEvent {
	return { ...event };
}

export function createMemoryCanvasActivitySink(): CanvasMemoryActivitySink {
	const events = new Map<string, CanvasActivityEvent>();
	return {
		record(event) {
			assertCanvasActivityEvent(event);
			if (!events.has(event.idempotencyKey)) {
				events.set(event.idempotencyKey, cloneEvent(event));
			}
		},
		list() {
			return [...events.values()].map(cloneEvent);
		},
	};
}

/** Sink failures are isolated from the user operation that produced the event. */
export function emitCanvasActivity(
	sink: CanvasActivitySink | undefined,
	event: CanvasActivityEvent,
): void {
	if (!sink) return;
	try {
		sink.record(assertCanvasActivityEvent(event));
	} catch {
		// Hosts queue durable delivery behind this synchronous boundary.
	}
}

export function recordCanvasRoleChange(
	sink: CanvasActivitySink | undefined,
	input: RecordCanvasRoleChangeInput,
): CanvasRoleActivityEvent {
	const event: CanvasRoleActivityEvent = {
		...input,
		kind: "role-changed",
		idempotencyKey: required(input.idempotencyKey),
		documentId: required(input.documentId),
		actorId: required(input.actorId),
		subjectId: required(input.subjectId),
		scopeId: required(input.scopeId),
		occurredAt: required(input.occurredAt),
	};
	emitCanvasActivity(sink, event);
	return event;
}
