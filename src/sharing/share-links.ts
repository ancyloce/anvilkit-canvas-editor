import type { CanvasProviderRequestContext } from "../component-libraries/component-provider.js";
import {
	type CanvasActivitySink,
	type CanvasShareActivityEvent,
	emitCanvasActivity,
} from "./activity-events.js";
import {
	CanvasAuthorizationError,
	assertCanvasSessionAuthorized,
	canvasDocumentAuthorizationResource,
	type CanvasAuthorizationAction,
	type CanvasAuthorizationSession,
	type CanvasCollaborationRole,
} from "./authorization.js";

export type CanvasShareLinkRole = Exclude<CanvasCollaborationRole, "owner">;
export type CanvasShareLinkStatus = "active" | "expired" | "revoked";

export type CanvasShareLinkRestrictions = Readonly<{
	requireAuthenticatedIdentity?: boolean;
	allowedIdentityIds?: readonly string[];
	allowedDomains?: readonly string[];
}>;

export type CanvasShareLinkRecord = Readonly<{
	id: string;
	documentId: string;
	role: CanvasShareLinkRole;
	createdAt: string;
	createdById: string;
	expiresAt: string | null;
	revokedAt: string | null;
	rotatedAt: string | null;
	tokenVersion: number;
	restrictions: CanvasShareLinkRestrictions;
}>;

export type CanvasShareLinkCreated = Readonly<{
	link: CanvasShareLinkRecord;
	url: string;
}>;

export type CanvasShareLinkIdentity = Readonly<{
	id?: string;
	/** A verified email supplied by the host. Canvas does not verify claims. */
	email?: string;
	/** A verified domain claim; preferred over parsing `email`. */
	domain?: string;
}>;

export type CanvasShareLinkAccessCode =
	| "allowed"
	| "link-not-found"
	| "link-revoked"
	| "link-expired"
	| "identity-required"
	| "identity-not-allowed"
	| "domain-not-allowed"
	| "host-policy-denied";

export type CanvasShareLinkAccessDecision = Readonly<{
	allowed: boolean;
	code: CanvasShareLinkAccessCode;
	link: CanvasShareLinkRecord | null;
}>;

export type CreateCanvasShareLinkRequest = Readonly<{
	documentId: string;
	role: CanvasShareLinkRole;
	createdById: string;
	expiresAt?: string | null;
	restrictions?: CanvasShareLinkRestrictions;
}>;

export type CanvasShareLinkAccessRequest = Readonly<{
	token: string;
	identity?: CanvasShareLinkIdentity;
}>;

export interface CanvasShareLinkHostPolicy {
	canCreate?(
		request: CreateCanvasShareLinkRequest,
		context: CanvasProviderRequestContext,
	): boolean | Promise<boolean>;
	canAccess?(
		link: CanvasShareLinkRecord,
		identity: CanvasShareLinkIdentity | undefined,
		context: CanvasProviderRequestContext,
	): boolean | Promise<boolean>;
}

export interface CanvasShareLinkProvider {
	create(
		request: CreateCanvasShareLinkRequest,
		context: CanvasProviderRequestContext,
	): Promise<CanvasShareLinkCreated>;
	list(
		documentId: string,
		context: CanvasProviderRequestContext,
	): Promise<readonly CanvasShareLinkRecord[]>;
	get(
		linkId: string,
		context: CanvasProviderRequestContext,
	): Promise<CanvasShareLinkRecord | null>;
	getCopyUrl(
		linkId: string,
		context: CanvasProviderRequestContext,
	): Promise<string>;
	expire(
		linkId: string,
		context: CanvasProviderRequestContext,
	): Promise<CanvasShareLinkRecord>;
	revoke(
		linkId: string,
		context: CanvasProviderRequestContext,
	): Promise<CanvasShareLinkRecord>;
	rotate(
		linkId: string,
		context: CanvasProviderRequestContext,
	): Promise<CanvasShareLinkCreated>;
	authorize(
		request: CanvasShareLinkAccessRequest,
		context: CanvasProviderRequestContext,
	): Promise<CanvasShareLinkAccessDecision>;
}

export type CanvasShareLinkErrorCode =
	| "aborted"
	| "invalid-request"
	| "invalid-expiration"
	| "link-not-found"
	| "link-inactive"
	| "host-policy-denied"
	| "secure-random-unavailable";

export class CanvasShareLinkError extends Error {
	readonly name = "CanvasShareLinkError";

	constructor(readonly code: CanvasShareLinkErrorCode) {
		super(`Canvas share-link operation failed (${code}).`);
	}
}

export interface CanvasClipboardTextWriter {
	writeText(text: string): Promise<void>;
}

export type CreateMemoryCanvasShareLinkProviderOptions = Readonly<{
	now?: () => Date;
	idFactory?: () => string;
	tokenFactory?: () => string;
	buildUrl?: (token: string) => string;
	hostPolicy?: CanvasShareLinkHostPolicy;
}>;

export type CreateAuthorizedCanvasShareLinkProviderOptions = Readonly<{
	provider: CanvasShareLinkProvider;
	documentId: string;
	/** Called for every operation so refreshed/revoked grants take effect now. */
	getSession: () => CanvasAuthorizationSession;
	activitySink?: CanvasActivitySink;
}>;

type StoredShareLink = {
	record: CanvasShareLinkRecord;
	token: string;
};

function abortIfNeeded(context: CanvasProviderRequestContext): void {
	if (context.signal.aborted) throw new CanvasShareLinkError("aborted");
}

function requireValue(value: string): string {
	const normalized = value.trim();
	if (!normalized) throw new CanvasShareLinkError("invalid-request");
	return normalized;
}

function normalizedUnique(values: readonly string[] | undefined): string[] {
	return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))].sort();
}

function normalizedDomains(values: readonly string[] | undefined): string[] {
	return normalizedUnique(values).map((domain) =>
		domain.replace(/^@/, "").toLowerCase(),
	);
}

function normalizeRestrictions(
	restrictions: CanvasShareLinkRestrictions | undefined,
): CanvasShareLinkRestrictions {
	return {
		requireAuthenticatedIdentity:
			restrictions?.requireAuthenticatedIdentity ?? false,
		allowedIdentityIds: normalizedUnique(restrictions?.allowedIdentityIds),
		allowedDomains: normalizedDomains(restrictions?.allowedDomains),
	};
}

function cloneRecord(record: CanvasShareLinkRecord): CanvasShareLinkRecord {
	return {
		...record,
		restrictions: {
			...record.restrictions,
			allowedIdentityIds: [
				...(record.restrictions.allowedIdentityIds ?? []),
			],
			allowedDomains: [...(record.restrictions.allowedDomains ?? [])],
		},
	};
}

function randomUuid(): string {
	const cryptoValue = (
		globalThis as { crypto?: { randomUUID?: () => string } }
	).crypto;
	if (!cryptoValue?.randomUUID) {
		throw new CanvasShareLinkError("secure-random-unavailable");
	}
	return cryptoValue.randomUUID();
}

function statusOf(record: CanvasShareLinkRecord, now: Date): CanvasShareLinkStatus {
	if (record.revokedAt !== null) return "revoked";
	if (record.expiresAt !== null && Date.parse(record.expiresAt) <= now.getTime()) {
		return "expired";
	}
	return "active";
}

function domainOf(identity: CanvasShareLinkIdentity | undefined): string {
	if (identity?.domain) return identity.domain.replace(/^@/, "").toLowerCase();
	const email = identity?.email?.trim().toLowerCase();
	if (!email) return "";
	const separator = email.lastIndexOf("@");
	return separator >= 0 ? email.slice(separator + 1) : "";
}

function accessDecision(
	code: CanvasShareLinkAccessCode,
	link: CanvasShareLinkRecord | null,
): CanvasShareLinkAccessDecision {
	return { allowed: code === "allowed", code, link };
}

/**
 * Deterministic fixture/local provider implementing the complete lifecycle.
 * Production hosts implement the same protocol at their service boundary.
 */
export function createMemoryCanvasShareLinkProvider(
	options: CreateMemoryCanvasShareLinkProviderOptions = {},
): CanvasShareLinkProvider {
	const now = options.now ?? (() => new Date());
	const idFactory = options.idFactory ?? randomUuid;
	const tokenFactory = options.tokenFactory ?? randomUuid;
	const buildUrl =
		options.buildUrl ??
		((token: string) => `/canvas/share/${encodeURIComponent(token)}`);
	const records = new Map<string, StoredShareLink>();
	const tokenIndex = new Map<string, string>();

	const stored = (linkId: string): StoredShareLink => {
		const value = records.get(linkId);
		if (!value) throw new CanvasShareLinkError("link-not-found");
		return value;
	};

	const active = (linkId: string): StoredShareLink => {
		const value = stored(linkId);
		if (statusOf(value.record, now()) !== "active") {
			throw new CanvasShareLinkError("link-inactive");
		}
		return value;
	};

	return {
		async create(request, context) {
			abortIfNeeded(context);
			if (
				options.hostPolicy?.canCreate &&
				!(await options.hostPolicy.canCreate(request, context))
			) {
				throw new CanvasShareLinkError("host-policy-denied");
			}
			abortIfNeeded(context);
			const createdAt = now();
			const expiresAt = request.expiresAt ?? null;
			if (
				expiresAt !== null &&
				(!Number.isFinite(Date.parse(expiresAt)) ||
					Date.parse(expiresAt) <= createdAt.getTime())
			) {
				throw new CanvasShareLinkError("invalid-expiration");
			}
			const id = requireValue(idFactory());
			const token = requireValue(tokenFactory());
			if (records.has(id) || tokenIndex.has(token)) {
				throw new CanvasShareLinkError("invalid-request");
			}
			const record: CanvasShareLinkRecord = {
				id,
				documentId: requireValue(request.documentId),
				role: request.role,
				createdAt: createdAt.toISOString(),
				createdById: requireValue(request.createdById),
				expiresAt,
				revokedAt: null,
				rotatedAt: null,
				tokenVersion: 1,
				restrictions: normalizeRestrictions(request.restrictions),
			};
			records.set(id, { record, token });
			tokenIndex.set(token, id);
			return { link: cloneRecord(record), url: buildUrl(token) };
		},

		async list(documentId, context) {
			abortIfNeeded(context);
			return [...records.values()]
				.map(({ record }) => record)
				.filter((record) => record.documentId === documentId)
				.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
				.map(cloneRecord);
		},

		async get(linkId, context) {
			abortIfNeeded(context);
			const value = records.get(linkId);
			return value ? cloneRecord(value.record) : null;
		},

		async getCopyUrl(linkId, context) {
			abortIfNeeded(context);
			return buildUrl(active(linkId).token);
		},

		async expire(linkId, context) {
			abortIfNeeded(context);
			const value = stored(linkId);
			if (value.record.expiresAt === null || statusOf(value.record, now()) === "active") {
				value.record = { ...value.record, expiresAt: now().toISOString() };
			}
			return cloneRecord(value.record);
		},

		async revoke(linkId, context) {
			abortIfNeeded(context);
			const value = stored(linkId);
			if (value.record.revokedAt === null) {
				value.record = { ...value.record, revokedAt: now().toISOString() };
			}
			return cloneRecord(value.record);
		},

		async rotate(linkId, context) {
			abortIfNeeded(context);
			const value = active(linkId);
			const token = requireValue(tokenFactory());
			if (tokenIndex.has(token)) throw new CanvasShareLinkError("invalid-request");
			tokenIndex.delete(value.token);
			value.token = token;
			value.record = {
				...value.record,
				rotatedAt: now().toISOString(),
				tokenVersion: value.record.tokenVersion + 1,
			};
			tokenIndex.set(token, linkId);
			return { link: cloneRecord(value.record), url: buildUrl(token) };
		},

		async authorize(request, context) {
			abortIfNeeded(context);
			const linkId = tokenIndex.get(request.token);
			if (!linkId) return accessDecision("link-not-found", null);
			const value = records.get(linkId);
			if (!value) return accessDecision("link-not-found", null);
			const link = cloneRecord(value.record);
			const status = statusOf(link, now());
			if (status === "revoked") return accessDecision("link-revoked", link);
			if (status === "expired") return accessDecision("link-expired", link);

			const restrictions = link.restrictions;
			const identityRequired =
				restrictions.requireAuthenticatedIdentity ||
				(restrictions.allowedIdentityIds?.length ?? 0) > 0 ||
				(restrictions.allowedDomains?.length ?? 0) > 0;
			if (identityRequired && !request.identity?.id && !request.identity?.email) {
				return accessDecision("identity-required", link);
			}
			if (
				(restrictions.allowedIdentityIds?.length ?? 0) > 0 &&
				(!request.identity?.id ||
					!restrictions.allowedIdentityIds?.includes(request.identity.id))
			) {
				return accessDecision("identity-not-allowed", link);
			}
			if (
				(restrictions.allowedDomains?.length ?? 0) > 0 &&
				!restrictions.allowedDomains?.includes(domainOf(request.identity))
			) {
				return accessDecision("domain-not-allowed", link);
			}
			if (
				options.hostPolicy?.canAccess &&
				!(await options.hostPolicy.canAccess(link, request.identity, context))
			) {
				return accessDecision("host-policy-denied", link);
			}
			abortIfNeeded(context);
			return accessDecision("allowed", link);
		},
	};
}

/**
 * Authorization-enforcing provider facade for client and service adapters.
 *
 * Management checks use the latest session for every call. The token
 * `authorize` operation remains link-driven and delegates to the provider.
 */
export function createAuthorizedCanvasShareLinkProvider(
	options: CreateAuthorizedCanvasShareLinkProviderOptions,
): CanvasShareLinkProvider {
	const resource = canvasDocumentAuthorizationResource(options.documentId);
	const assertAction = (
		action: CanvasAuthorizationAction,
	): CanvasAuthorizationSession => {
		const session = options.getSession();
		assertCanvasSessionAuthorized(session, action, resource);
		return session;
	};
	const assertDocument = (documentId: string, action: CanvasAuthorizationAction) => {
		if (documentId !== options.documentId) {
			throw new CanvasAuthorizationError("denied-invalid-resource", action);
		}
	};
	const readLink = async (
		linkId: string,
		action: CanvasAuthorizationAction,
		context: CanvasProviderRequestContext,
	): Promise<{
		link: CanvasShareLinkRecord | null;
		session: CanvasAuthorizationSession;
	}> => {
		const session = assertAction(action);
		const link = await options.provider.get(linkId, context);
		if (link) assertDocument(link.documentId, action);
		return { link, session };
	};
	const recordActivity = (
		kind: CanvasShareActivityEvent["kind"],
		link: CanvasShareLinkRecord,
		actorId: string,
		occurredAt: string,
	): void =>
		emitCanvasActivity(options.activitySink, {
			kind,
			idempotencyKey: `${link.id}:${kind}:${link.tokenVersion}:${occurredAt}`,
			documentId: link.documentId,
			actorId,
			occurredAt,
			linkId: link.id,
			linkRole: link.role,
			tokenVersion: link.tokenVersion,
		});

	return {
		async create(request, context) {
			assertDocument(request.documentId, "share.manage");
			const session = assertAction("share.manage");
			if (request.createdById !== session.subjectId) {
				throw new CanvasAuthorizationError(
					"denied-invalid-resource",
					"share.manage",
				);
			}
			const created = await options.provider.create(request, context);
			recordActivity(
				"share-link-created",
				created.link,
				session.subjectId,
				created.link.createdAt,
			);
			return created;
		},
		async list(documentId, context) {
			assertDocument(documentId, "share.read");
			assertAction("share.read");
			return options.provider.list(documentId, context);
		},
		async get(linkId, context) {
			return (await readLink(linkId, "share.read", context)).link;
		},
		async getCopyUrl(linkId, context) {
			await readLink(linkId, "share.read", context);
			return options.provider.getCopyUrl(linkId, context);
		},
		async expire(linkId, context) {
			const { session } = await readLink(linkId, "share.manage", context);
			const link = await options.provider.expire(linkId, context);
			recordActivity(
				"share-link-expired",
				link,
				session.subjectId,
				link.expiresAt ?? link.createdAt,
			);
			return link;
		},
		async revoke(linkId, context) {
			const { session } = await readLink(linkId, "share.manage", context);
			const link = await options.provider.revoke(linkId, context);
			recordActivity(
				"share-link-revoked",
				link,
				session.subjectId,
				link.revokedAt ?? link.createdAt,
			);
			return link;
		},
		async rotate(linkId, context) {
			const { session } = await readLink(linkId, "share.manage", context);
			const rotated = await options.provider.rotate(linkId, context);
			recordActivity(
				"share-link-rotated",
				rotated.link,
				session.subjectId,
				rotated.link.rotatedAt ?? rotated.link.createdAt,
			);
			return rotated;
		},
		authorize(request, context) {
			return options.provider.authorize(request, context);
		},
	};
}

/** Fetch the current active URL and copy it through a host-owned clipboard. */
export async function copyCanvasShareLink(
	provider: CanvasShareLinkProvider,
	linkId: string,
	clipboard: CanvasClipboardTextWriter,
	context: CanvasProviderRequestContext,
): Promise<void> {
	const url = await provider.getCopyUrl(linkId, context);
	abortIfNeeded(context);
	await clipboard.writeText(url);
}
