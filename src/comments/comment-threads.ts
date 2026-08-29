import {
	type CanvasCommentAnchor,
	CanvasCommentAnchorSchema,
	type CanvasCommentAnchorResolution,
	type CanvasIR,
	resolveCommentAnchor,
} from "@anvilkit/canvas-core";
import type { CanvasProviderRequestContext } from "../component-libraries/component-provider.js";
import {
	type CanvasActivitySink,
	type CanvasCommentActivityEvent,
	emitCanvasActivity,
} from "../sharing/activity-events.js";
import {
	CanvasAuthorizationError,
	assertCanvasSessionAuthorized,
	canvasDocumentAuthorizationResource,
	type CanvasAuthorizationResource,
	type CanvasAuthorizationScope,
	type CanvasAuthorizationSession,
} from "../sharing/authorization.js";

export type CanvasCommentMessage = Readonly<{
	id: string;
	threadId: string;
	authorId: string;
	body: string;
	mentions: readonly string[];
	createdAt: string;
}>;

export type CanvasCommentThreadStatus = "open" | "resolved";

export type CanvasCommentThread = Readonly<{
	id: string;
	documentId: string;
	anchor: CanvasCommentAnchor;
	anchorResolution: CanvasCommentAnchorResolution;
	messages: readonly CanvasCommentMessage[];
	status: CanvasCommentThreadStatus;
	resolvedAt: string | null;
	resolvedById: string | null;
	createdAt: string;
	createdById: string;
}>;

export type CreateCanvasCommentThreadRequest = Readonly<{
	documentId: string;
	anchor: CanvasCommentAnchor;
	authorId: string;
	body: string;
	mentions?: readonly string[];
}>;

export type ReplyCanvasCommentThreadRequest = Readonly<{
	authorId: string;
	body: string;
	mentions?: readonly string[];
}>;

export type TransitionCanvasCommentThreadRequest = Readonly<{
	actorId: string;
}>;

export type CanvasCommentUnreadState = Readonly<{
	threadId: string;
	userId: string;
	count: number;
	lastReadAt: string | null;
}>;

export type CanvasCommentNotificationKind =
	| "comment-reply"
	| "comment-mention"
	| "comment-resolved"
	| "comment-reopened";

/** Content-free notification envelope; bodies and anchor data are excluded. */
export type CanvasCommentNotification = Readonly<{
	idempotencyKey: string;
	kind: CanvasCommentNotificationKind;
	documentId: string;
	threadId: string;
	actorId: string;
	recipientId: string;
	occurredAt: string;
}>;

export type CanvasCommentNotificationPreferences = Readonly<{
	replies: boolean;
	mentions: boolean;
	resolution: boolean;
}>;

export interface CanvasCommentNotificationProvider {
	getPreferences(
		userId: string,
		context: CanvasProviderRequestContext,
	): Promise<CanvasCommentNotificationPreferences>;
	/** MUST deliver idempotently by `notification.idempotencyKey`. */
	notify(
		notification: CanvasCommentNotification,
		context: CanvasProviderRequestContext,
	): Promise<void>;
}

export interface CanvasMemoryCommentNotificationProvider
	extends CanvasCommentNotificationProvider {
	list(): readonly CanvasCommentNotification[];
}

export interface CanvasCommentThreadProvider {
	create(
		request: CreateCanvasCommentThreadRequest,
		ir: CanvasIR,
		context: CanvasProviderRequestContext,
	): Promise<CanvasCommentThread>;
	list(
		documentId: string,
		ir: CanvasIR,
		context: CanvasProviderRequestContext,
	): Promise<readonly CanvasCommentThread[]>;
	get(
		threadId: string,
		ir: CanvasIR,
		context: CanvasProviderRequestContext,
	): Promise<CanvasCommentThread | null>;
	reply(
		threadId: string,
		request: ReplyCanvasCommentThreadRequest,
		ir: CanvasIR,
		context: CanvasProviderRequestContext,
	): Promise<CanvasCommentThread>;
	resolve(
		threadId: string,
		request: TransitionCanvasCommentThreadRequest,
		ir: CanvasIR,
		context: CanvasProviderRequestContext,
	): Promise<CanvasCommentThread>;
	reopen(
		threadId: string,
		request: TransitionCanvasCommentThreadRequest,
		ir: CanvasIR,
		context: CanvasProviderRequestContext,
	): Promise<CanvasCommentThread>;
	getUnreadState(
		threadId: string,
		userId: string,
		ir: CanvasIR,
		context: CanvasProviderRequestContext,
	): Promise<CanvasCommentUnreadState>;
	markRead(
		threadId: string,
		userId: string,
		ir: CanvasIR,
		context: CanvasProviderRequestContext,
	): Promise<CanvasCommentUnreadState>;
}

export type CanvasCommentThreadErrorCode =
	| "aborted"
	| "invalid-request"
	| "invalid-anchor"
	| "document-mismatch"
	| "thread-not-found"
	| "thread-resolved";

export class CanvasCommentThreadError extends Error {
	readonly name = "CanvasCommentThreadError";

	constructor(readonly code: CanvasCommentThreadErrorCode) {
		super(`Canvas comment operation failed (${code}).`);
	}
}

export type CreateMemoryCanvasCommentThreadProviderOptions = Readonly<{
	now?: () => Date;
	idFactory?: () => string;
	notificationProvider?: CanvasCommentNotificationProvider;
	activitySink?: CanvasActivitySink;
}>;

export type CreateMemoryCanvasCommentNotificationProviderOptions = Readonly<{
	preferences?: Readonly<
		Record<string, Partial<CanvasCommentNotificationPreferences>>
	>;
}>;

export type CreateAuthorizedCanvasCommentThreadProviderOptions = Readonly<{
	provider: CanvasCommentThreadProvider;
	documentId: string;
	getSession: () => CanvasAuthorizationSession;
}>;

function abortIfNeeded(context: CanvasProviderRequestContext): void {
	if (context.signal.aborted) throw new CanvasCommentThreadError("aborted");
}

function required(value: string): string {
	const normalized = value.trim();
	if (!normalized) throw new CanvasCommentThreadError("invalid-request");
	return normalized;
}

function normalizedMentions(values: readonly string[] | undefined): string[] {
	return [
		...new Set((values ?? []).map((value) => value.trim()).filter(Boolean)),
	].sort();
}

function randomUuid(): string {
	const randomUUID = globalThis.crypto?.randomUUID;
	if (!randomUUID) throw new CanvasCommentThreadError("invalid-request");
	return randomUUID.call(globalThis.crypto);
}

function cloneAnchor(anchor: CanvasCommentAnchor): CanvasCommentAnchor {
	return CanvasCommentAnchorSchema.parse(anchor);
}

function resolveThread(
	thread: Omit<CanvasCommentThread, "anchorResolution">,
	ir: CanvasIR,
): CanvasCommentThread {
	return {
		...thread,
		anchor: cloneAnchor(thread.anchor),
		anchorResolution: resolveCommentAnchor(thread.anchor, ir),
		messages: thread.messages.map((message) => ({
			...message,
			mentions: [...message.mentions],
		})),
	};
}

function assertDocumentMatch(documentId: string, ir: CanvasIR): void {
	if (documentId !== ir.id) {
		throw new CanvasCommentThreadError("document-mismatch");
	}
}

function assertAnchorDocument(
	anchor: CanvasCommentAnchor,
	documentId: string,
): void {
	if (anchor.kind === "document" && anchor.documentId !== documentId) {
		throw new CanvasCommentThreadError("document-mismatch");
	}
}

function anchorAuthorizationResource(
	documentId: string,
	anchor: CanvasCommentAnchor,
): CanvasAuthorizationResource {
	const scopes: CanvasAuthorizationScope[] = [
		{ kind: "document", id: documentId },
	];
	if (anchor.kind === "document") return { scopes };
	scopes.push({ kind: "page", id: anchor.pageId });
	if (anchor.kind === "node") {
		scopes.push({ kind: "node", id: anchor.nodeId });
	}
	return { scopes };
}

function threadAuthorizationResource(
	thread: CanvasCommentThread,
): CanvasAuthorizationResource {
	return {
		scopes: [
			...anchorAuthorizationResource(thread.documentId, thread.anchor).scopes,
			{ kind: "comment", id: thread.id },
		],
	};
}

const DEFAULT_NOTIFICATION_PREFERENCES: CanvasCommentNotificationPreferences = {
	replies: true,
	mentions: true,
	resolution: true,
};

export function createMemoryCanvasCommentNotificationProvider(
	options: CreateMemoryCanvasCommentNotificationProviderOptions = {},
): CanvasMemoryCommentNotificationProvider {
	const delivered = new Map<string, CanvasCommentNotification>();
	return {
		async getPreferences(userId, context) {
			abortIfNeeded(context);
			return {
				...DEFAULT_NOTIFICATION_PREFERENCES,
				...(options.preferences?.[userId] ?? {}),
			};
		},
		async notify(notification, context) {
			abortIfNeeded(context);
			if (!delivered.has(notification.idempotencyKey)) {
				delivered.set(notification.idempotencyKey, { ...notification });
			}
		},
		list() {
			return [...delivered.values()].map((notification) => ({
				...notification,
			}));
		},
	};
}

export function createMemoryCanvasCommentThreadProvider(
	options: CreateMemoryCanvasCommentThreadProviderOptions = {},
): CanvasCommentThreadProvider {
	const now = options.now ?? (() => new Date());
	const idFactory = options.idFactory ?? randomUuid;
	type StoredThread = {
		-readonly [Key in keyof Omit<
			CanvasCommentThread,
			"anchorResolution"
		>]: Omit<CanvasCommentThread, "anchorResolution">[Key];
	};
	const threads = new Map<
		string,
		StoredThread
	>();
	const unread = new Map<
		string,
		Map<string, { count: number; lastReadAt: string | null }>
	>();

	const storedThread = (threadId: string): StoredThread => {
		const thread = threads.get(required(threadId));
		if (!thread) throw new CanvasCommentThreadError("thread-not-found");
		return thread;
	};
	const participants = (thread: StoredThread): Set<string> =>
		new Set(
			thread.messages.flatMap((message) => [
				message.authorId,
				...message.mentions,
			]),
		);
	const unreadState = (
		threadId: string,
		userId: string,
	): CanvasCommentUnreadState => {
		const value = unread.get(threadId)?.get(userId);
		return {
			threadId,
			userId,
			count: value?.count ?? 0,
			lastReadAt: value?.lastReadAt ?? null,
		};
	};
	const incrementUnread = (
		threadId: string,
		recipientIds: ReadonlySet<string>,
		actorId: string,
	): void => {
		const perUser = unread.get(threadId) ?? new Map();
		for (const recipientId of recipientIds) {
			if (recipientId === actorId) continue;
			const current = perUser.get(recipientId);
			perUser.set(recipientId, {
				count: (current?.count ?? 0) + 1,
				lastReadAt: current?.lastReadAt ?? null,
			});
		}
		perUser.set(actorId, { count: 0, lastReadAt: now().toISOString() });
		unread.set(threadId, perUser);
	};
	const notify = async (
		thread: StoredThread,
		kind: CanvasCommentNotificationKind,
		actorId: string,
		recipientIds: ReadonlySet<string>,
		eventId: string,
		occurredAt: string,
		context: CanvasProviderRequestContext,
	): Promise<void> => {
		if (!options.notificationProvider) return;
		for (const recipientId of [...recipientIds].sort()) {
			if (recipientId === actorId) continue;
			const preferences =
				await options.notificationProvider.getPreferences(recipientId, context);
			const enabled =
				kind === "comment-mention"
					? preferences.mentions
					: kind === "comment-reply"
						? preferences.replies
						: preferences.resolution;
			if (!enabled) continue;
			await options.notificationProvider.notify(
				{
					idempotencyKey: `${eventId}:${kind}:${recipientId}`,
					kind,
					documentId: thread.documentId,
					threadId: thread.id,
					actorId,
					recipientId,
					occurredAt,
				},
				context,
			);
		}
	};
	const notifyUpdate = async (
		thread: StoredThread,
		kind: Exclude<CanvasCommentNotificationKind, "comment-mention">,
		actorId: string,
		recipients: Set<string>,
		eventId: string,
		occurredAt: string,
		context: CanvasProviderRequestContext,
		mentions: readonly string[] = [],
	): Promise<void> => {
		const mentioned = new Set(mentions);
		await notify(
			thread,
			"comment-mention",
			actorId,
			mentioned,
			eventId,
			occurredAt,
			context,
		);
		for (const userId of mentioned) recipients.delete(userId);
		await notify(
			thread,
			kind,
			actorId,
			recipients,
			eventId,
			occurredAt,
			context,
		);
	};
	const recordActivity = (
		kind: CanvasCommentActivityEvent["kind"],
		thread: StoredThread,
		actorId: string,
		occurredAt: string,
		operationId: string,
		messageId?: string,
	): void =>
		emitCanvasActivity(options.activitySink, {
			kind,
			idempotencyKey: `${operationId}:${kind}`,
			documentId: thread.documentId,
			actorId,
			occurredAt,
			threadId: thread.id,
			...(messageId ? { messageId } : {}),
		});

	return {
		async create(request, ir, context) {
			abortIfNeeded(context);
			const documentId = required(request.documentId);
			assertDocumentMatch(documentId, ir);
			const parsed = CanvasCommentAnchorSchema.safeParse(request.anchor);
			if (!parsed.success) throw new CanvasCommentThreadError("invalid-anchor");
			assertAnchorDocument(parsed.data, documentId);
			const authorId = required(request.authorId);
			const body = required(request.body);
			const mentions = normalizedMentions(request.mentions);
			const threadId = required(idFactory());
			const messageId = required(idFactory());
			const createdAt = now().toISOString();
			const thread = {
				id: threadId,
				documentId,
				anchor: cloneAnchor(parsed.data),
				messages: [
					{
						id: messageId,
						threadId,
						authorId,
						body,
						mentions,
						createdAt,
					},
				],
				status: "open",
				resolvedAt: null,
				resolvedById: null,
				createdAt,
				createdById: authorId,
			} satisfies Omit<CanvasCommentThread, "anchorResolution">;
			threads.set(thread.id, thread);
			recordActivity(
				"comment-thread-created",
				thread,
				authorId,
				createdAt,
				thread.id,
				messageId,
			);
			incrementUnread(thread.id, new Set(mentions), authorId);
			await notifyUpdate(
				thread,
				"comment-reply",
				authorId,
				new Set(),
				messageId,
				createdAt,
				context,
				mentions,
			);
			return resolveThread(thread, ir);
		},

		async list(documentId, ir, context) {
			abortIfNeeded(context);
			const normalizedDocumentId = required(documentId);
			assertDocumentMatch(normalizedDocumentId, ir);
			return [...threads.values()]
				.filter((thread) => thread.documentId === normalizedDocumentId)
				.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
				.map((thread) => resolveThread(thread, ir));
		},

		async get(threadId, ir, context) {
			abortIfNeeded(context);
			const thread = threads.get(required(threadId));
			if (!thread) return null;
			assertDocumentMatch(thread.documentId, ir);
			return resolveThread(thread, ir);
		},

		async reply(threadId, request, ir, context) {
			abortIfNeeded(context);
			const thread = storedThread(threadId);
			assertDocumentMatch(thread.documentId, ir);
			if (thread.status === "resolved") {
				throw new CanvasCommentThreadError("thread-resolved");
			}
			const authorId = required(request.authorId);
			const body = required(request.body);
			const mentions = normalizedMentions(request.mentions);
			const recipients = participants(thread);
			const messageId = required(idFactory());
			const createdAt = now().toISOString();
			thread.messages = [
				...thread.messages,
				{
					id: messageId,
					threadId: thread.id,
					authorId,
					body,
					mentions,
					createdAt,
				},
			];
			recordActivity(
				"comment-replied",
				thread,
				authorId,
				createdAt,
				messageId,
				messageId,
			);
			for (const userId of mentions) recipients.add(userId);
			incrementUnread(thread.id, recipients, authorId);
			await notifyUpdate(
				thread,
				"comment-reply",
				authorId,
				recipients,
				messageId,
				createdAt,
				context,
				mentions,
			);
			return resolveThread(thread, ir);
		},

		async resolve(threadId, request, ir, context) {
			abortIfNeeded(context);
			const thread = storedThread(threadId);
			assertDocumentMatch(thread.documentId, ir);
			const actorId = required(request.actorId);
			if (thread.status === "resolved") return resolveThread(thread, ir);
			const recipients = participants(thread);
			const eventId = required(idFactory());
			const occurredAt = now().toISOString();
			thread.status = "resolved";
			thread.resolvedAt = occurredAt;
			thread.resolvedById = actorId;
			recordActivity(
				"comment-resolved",
				thread,
				actorId,
				occurredAt,
				eventId,
			);
			incrementUnread(thread.id, recipients, actorId);
			await notifyUpdate(
				thread,
				"comment-resolved",
				actorId,
				recipients,
				eventId,
				occurredAt,
				context,
			);
			return resolveThread(thread, ir);
		},

		async reopen(threadId, request, ir, context) {
			abortIfNeeded(context);
			const thread = storedThread(threadId);
			assertDocumentMatch(thread.documentId, ir);
			const actorId = required(request.actorId);
			if (thread.status === "open") return resolveThread(thread, ir);
			const recipients = participants(thread);
			const eventId = required(idFactory());
			const occurredAt = now().toISOString();
			thread.status = "open";
			thread.resolvedAt = null;
			thread.resolvedById = null;
			recordActivity(
				"comment-reopened",
				thread,
				actorId,
				occurredAt,
				eventId,
			);
			incrementUnread(thread.id, recipients, actorId);
			await notifyUpdate(
				thread,
				"comment-reopened",
				actorId,
				recipients,
				eventId,
				occurredAt,
				context,
			);
			return resolveThread(thread, ir);
		},

		async getUnreadState(threadId, userId, ir, context) {
			abortIfNeeded(context);
			const thread = storedThread(threadId);
			assertDocumentMatch(thread.documentId, ir);
			return unreadState(thread.id, required(userId));
		},

		async markRead(threadId, userId, ir, context) {
			abortIfNeeded(context);
			const thread = storedThread(threadId);
			assertDocumentMatch(thread.documentId, ir);
			const normalizedUserId = required(userId);
			const perUser = unread.get(thread.id) ?? new Map();
			perUser.set(normalizedUserId, {
				count: 0,
				lastReadAt: now().toISOString(),
			});
			unread.set(thread.id, perUser);
			return unreadState(thread.id, normalizedUserId);
		},
	};
}

/** Client-side defense in depth; production services repeat authorization. */
export function createAuthorizedCanvasCommentThreadProvider(
	options: CreateAuthorizedCanvasCommentThreadProviderOptions,
): CanvasCommentThreadProvider {
	const invalidResource = (
		action: "comment.read" | "comment.create" | "comment.reply" | "comment.resolve" | "comment.reopen",
	): never => {
		throw new CanvasAuthorizationError("denied-invalid-resource", action);
	};
	const authorizeDocumentRead = () =>
		assertCanvasSessionAuthorized(
			options.getSession(),
			"comment.read",
			canvasDocumentAuthorizationResource(options.documentId),
		);
	const getOwnedThread = async (
		threadId: string,
		ir: CanvasIR,
		context: CanvasProviderRequestContext,
	): Promise<CanvasCommentThread | null> => {
		const thread = await options.provider.get(threadId, ir, context);
		if (thread && thread.documentId !== options.documentId) {
			throw new CanvasAuthorizationError(
				"denied-invalid-resource",
				"comment.read",
			);
		}
		return thread;
	};

	return {
		async create(request, ir, context) {
			if (request.documentId !== options.documentId) {
				return invalidResource("comment.create");
			}
			const session = options.getSession();
			if (request.authorId !== session.subjectId) {
				return invalidResource("comment.create");
			}
			assertCanvasSessionAuthorized(
				session,
				"comment.create",
				anchorAuthorizationResource(options.documentId, request.anchor),
			);
			return options.provider.create(request, ir, context);
		},
		async list(documentId, ir, context) {
			if (documentId !== options.documentId) {
				return invalidResource("comment.read");
			}
			authorizeDocumentRead();
			return options.provider.list(documentId, ir, context);
		},
		async get(threadId, ir, context) {
			authorizeDocumentRead();
			return getOwnedThread(threadId, ir, context);
		},
		async reply(threadId, request, ir, context) {
			const session = options.getSession();
			if (request.authorId !== session.subjectId) {
				return invalidResource("comment.reply");
			}
			const thread = await getOwnedThread(threadId, ir, context);
			if (!thread) throw new CanvasCommentThreadError("thread-not-found");
			assertCanvasSessionAuthorized(
				session,
				"comment.reply",
				threadAuthorizationResource(thread),
			);
			return options.provider.reply(threadId, request, ir, context);
		},
		async resolve(threadId, request, ir, context) {
			const session = options.getSession();
			if (request.actorId !== session.subjectId) {
				return invalidResource("comment.resolve");
			}
			const thread = await getOwnedThread(threadId, ir, context);
			if (!thread) throw new CanvasCommentThreadError("thread-not-found");
			assertCanvasSessionAuthorized(
				session,
				"comment.resolve",
				threadAuthorizationResource(thread),
			);
			return options.provider.resolve(threadId, request, ir, context);
		},
		async reopen(threadId, request, ir, context) {
			const session = options.getSession();
			if (request.actorId !== session.subjectId) {
				return invalidResource("comment.reopen");
			}
			const thread = await getOwnedThread(threadId, ir, context);
			if (!thread) throw new CanvasCommentThreadError("thread-not-found");
			assertCanvasSessionAuthorized(
				session,
				"comment.reopen",
				threadAuthorizationResource(thread),
			);
			return options.provider.reopen(threadId, request, ir, context);
		},
		async getUnreadState(threadId, userId, ir, context) {
			const session = options.getSession();
			if (userId !== session.subjectId) return invalidResource("comment.read");
			const thread = await getOwnedThread(threadId, ir, context);
			if (!thread) throw new CanvasCommentThreadError("thread-not-found");
			assertCanvasSessionAuthorized(
				session,
				"comment.read",
				threadAuthorizationResource(thread),
			);
			return options.provider.getUnreadState(threadId, userId, ir, context);
		},
		async markRead(threadId, userId, ir, context) {
			const session = options.getSession();
			if (userId !== session.subjectId) return invalidResource("comment.read");
			const thread = await getOwnedThread(threadId, ir, context);
			if (!thread) throw new CanvasCommentThreadError("thread-not-found");
			assertCanvasSessionAuthorized(
				session,
				"comment.read",
				threadAuthorizationResource(thread),
			);
			return options.provider.markRead(threadId, userId, ir, context);
		},
	};
}
