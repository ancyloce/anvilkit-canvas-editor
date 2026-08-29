/** The four collaboration roles exposed by Canvas sharing. */
export const CANVAS_COLLABORATION_ROLES = [
	"owner",
	"editor",
	"commenter",
	"viewer",
] as const;

export type CanvasCollaborationRole =
	(typeof CANVAS_COLLABORATION_ROLES)[number];

/**
 * Stable authorization actions shared by editor commands and host providers.
 *
 * `document.write` deliberately covers every design mutation. A caller must
 * not invent a narrower action for clipboard, keyboard, API, or stale-UI
 * writes because doing so could create a commenter bypass.
 */
export const CANVAS_AUTHORIZATION_ACTIONS = [
	"document.read",
	"document.write",
	"comment.read",
	"comment.create",
	"comment.reply",
	"comment.resolve",
	"comment.reopen",
	"share.read",
	"share.manage",
	"role.manage",
	"presence.read",
	"presence.publish",
	"audit.read",
] as const;

export type CanvasAuthorizationAction =
	(typeof CANVAS_AUTHORIZATION_ACTIONS)[number];

const COMMENT_ACTIONS = [
	"comment.read",
	"comment.create",
	"comment.reply",
	"comment.resolve",
	"comment.reopen",
] as const satisfies readonly CanvasAuthorizationAction[];

const PRESENCE_ACTIONS = [
	"presence.read",
	"presence.publish",
] as const satisfies readonly CanvasAuthorizationAction[];

/** The closed, auditable role-permission matrix. */
export const CANVAS_ROLE_PERMISSIONS = {
	viewer: ["document.read", "comment.read", ...PRESENCE_ACTIONS],
	commenter: ["document.read", ...COMMENT_ACTIONS, ...PRESENCE_ACTIONS],
	editor: [
		"document.read",
		"document.write",
		...COMMENT_ACTIONS,
		"share.read",
		...PRESENCE_ACTIONS,
	],
	owner: [...CANVAS_AUTHORIZATION_ACTIONS],
} as const satisfies Record<
	CanvasCollaborationRole,
	readonly CanvasAuthorizationAction[]
>;

export type CanvasAuthorizationScopeKind =
	| "document"
	| "page"
	| "node"
	| "comment";

export type CanvasAuthorizationScope = Readonly<{
	kind: CanvasAuthorizationScopeKind;
	id: string;
}>;

/**
 * Ordered ancestry for the resource being authorized.
 *
 * The first entry is the document. A page may follow it, zero or more nested
 * nodes may follow the page, and a comment thread may be the final entry.
 */
export type CanvasAuthorizationResource = Readonly<{
	scopes: readonly CanvasAuthorizationScope[];
}>;

export type CanvasAuthorizationGrant = Readonly<{
	subjectId: string;
	role: CanvasCollaborationRole;
	scope: CanvasAuthorizationScope;
}>;

export type CanvasAuthorizationDeny = Readonly<{
	subjectId: string | "*";
	scope: CanvasAuthorizationScope;
	actions: readonly (CanvasAuthorizationAction | "*")[];
}>;

export type CanvasAuthorizationDecisionCode =
	| "allowed"
	| "denied-explicit"
	| "denied-no-grant"
	| "denied-role"
	| "denied-invalid-resource"
	| "denied-conflicting-grants"
	| "denied-invalid-grant";

export type CanvasAuthorizationDecision = Readonly<{
	allowed: boolean;
	code: CanvasAuthorizationDecisionCode;
	role: CanvasCollaborationRole | null;
	matchedScope: CanvasAuthorizationScope | null;
}>;

export type ResolveCanvasAuthorizationOptions = Readonly<{
	subjectId: string;
	action: CanvasAuthorizationAction;
	resource: CanvasAuthorizationResource;
	grants: readonly CanvasAuthorizationGrant[];
	denies?: readonly CanvasAuthorizationDeny[];
}>;

/** The current host-issued grants for one authenticated collaboration user. */
export type CanvasAuthorizationSession = Readonly<{
	subjectId: string;
	grants: readonly CanvasAuthorizationGrant[];
	denies?: readonly CanvasAuthorizationDeny[];
}>;

function scopesEqual(
	left: CanvasAuthorizationScope,
	right: CanvasAuthorizationScope,
): boolean {
	return left.kind === right.kind && left.id === right.id;
}

function resourceScopeIndex(
	resource: CanvasAuthorizationResource,
	scope: CanvasAuthorizationScope,
): number {
	for (let index = resource.scopes.length - 1; index >= 0; index -= 1) {
		const candidate = resource.scopes[index];
		if (candidate && scopesEqual(candidate, scope)) return index;
	}
	return -1;
}

function isValidResource(resource: CanvasAuthorizationResource): boolean {
	const { scopes } = resource;
	if (scopes[0]?.kind !== "document") return false;

	let sawPage = false;
	let sawNode = false;
	let sawComment = false;
	for (let index = 0; index < scopes.length; index += 1) {
		const scope = scopes[index];
		if (!scope) return false;
		if (scope.id.trim().length === 0) return false;
		switch (scope.kind) {
			case "document":
				if (index !== 0) return false;
				break;
			case "page":
				if (sawPage || sawNode || sawComment) return false;
				sawPage = true;
				break;
			case "node":
				if (sawComment) return false;
				sawNode = true;
				break;
			case "comment":
				if (sawComment || index !== scopes.length - 1) return false;
				sawComment = true;
				break;
		}
	}
	return true;
}

function decision(
	code: CanvasAuthorizationDecisionCode,
	role: CanvasCollaborationRole | null = null,
	matchedScope: CanvasAuthorizationScope | null = null,
): CanvasAuthorizationDecision {
	return { allowed: code === "allowed", code, role, matchedScope };
}

export function isCanvasActionAllowedForRole(
	role: CanvasCollaborationRole,
	action: CanvasAuthorizationAction,
): boolean {
	return (CANVAS_ROLE_PERMISSIONS[role] as readonly CanvasAuthorizationAction[]).includes(
		action,
	);
}

/**
 * Resolve one authorization check without trusting client UI state.
 *
 * Grants inherit down the supplied resource ancestry and the closest grant
 * wins. Any matching explicit deny at any ancestor wins over every grant.
 * Missing, malformed, or ambiguous configuration fails closed.
 */
export function resolveCanvasAuthorization(
	options: ResolveCanvasAuthorizationOptions,
): CanvasAuthorizationDecision {
	if (!isValidResource(options.resource)) {
		return decision("denied-invalid-resource");
	}

	const denies = options.denies ?? [];
	const explicitlyDenied = denies.some(
		(deny) =>
			(deny.subjectId === "*" || deny.subjectId === options.subjectId) &&
			resourceScopeIndex(options.resource, deny.scope) >= 0 &&
			(deny.actions.includes("*") || deny.actions.includes(options.action)),
	);
	if (explicitlyDenied) return decision("denied-explicit");

	const candidates = options.grants
		.filter((grant) => grant.subjectId === options.subjectId)
		.map((grant) => ({
			grant,
			depth: resourceScopeIndex(options.resource, grant.scope),
		}))
		.filter((candidate) => candidate.depth >= 0);

	if (candidates.length === 0) return decision("denied-no-grant");
	if (
		candidates.some(
			({ grant }) =>
				grant.role === "owner" && grant.scope.kind !== "document",
		)
	) {
		return decision("denied-invalid-grant");
	}

	const closestDepth = Math.max(...candidates.map(({ depth }) => depth));
	const closest = candidates.filter(({ depth }) => depth === closestDepth);
	const roles = new Set(closest.map(({ grant }) => grant.role));
	if (roles.size !== 1) return decision("denied-conflicting-grants");

	const matched = closest[0]?.grant;
	if (!matched) return decision("denied-conflicting-grants");
	return isCanvasActionAllowedForRole(matched.role, options.action)
		? decision("allowed", matched.role, matched.scope)
		: decision("denied-role", matched.role, matched.scope);
}

export function canvasDocumentAuthorizationResource(
	documentId: string,
): CanvasAuthorizationResource {
	return { scopes: [{ kind: "document", id: documentId }] };
}

/** Resolve against the latest host session without duplicating request shape. */
export function resolveCanvasSessionAuthorization(
	session: CanvasAuthorizationSession,
	action: CanvasAuthorizationAction,
	resource: CanvasAuthorizationResource,
): CanvasAuthorizationDecision {
	return resolveCanvasAuthorization({
		subjectId: session.subjectId,
		action,
		resource,
		grants: session.grants,
		...(session.denies ? { denies: session.denies } : {}),
	});
}

/**
 * Bind a current session to the lightweight resolver accepted by
 * `CanvasStudio`. Keeping this factory on the optional `/collaboration`
 * entrypoint prevents the role matrix and provider runtime from entering the
 * editor's eager bundle when sharing is disabled.
 */
export function isCanvasDocumentWriteAllowed(
	session: CanvasAuthorizationSession,
	documentId: string,
): boolean {
	return resolveCanvasSessionAuthorization(
		session,
		"document.write",
		canvasDocumentAuthorizationResource(documentId),
	).allowed;
}

export function assertCanvasSessionAuthorized(
	session: CanvasAuthorizationSession,
	action: CanvasAuthorizationAction,
	resource: CanvasAuthorizationResource,
): CanvasAuthorizationDecision {
	return assertCanvasAuthorized({
		subjectId: session.subjectId,
		action,
		resource,
		grants: session.grants,
		...(session.denies ? { denies: session.denies } : {}),
	});
}

/** A stable, content-free authorization error for command/provider boundaries. */
export class CanvasAuthorizationError extends Error {
	readonly name = "CanvasAuthorizationError";

	constructor(
		readonly code: Exclude<CanvasAuthorizationDecisionCode, "allowed">,
		readonly action: CanvasAuthorizationAction,
	) {
		super(`Canvas action ${action} was denied (${code}).`);
	}
}

export function assertCanvasAuthorized(
	options: ResolveCanvasAuthorizationOptions,
): CanvasAuthorizationDecision {
	const result = resolveCanvasAuthorization(options);
	if (!result.allowed) {
		throw new CanvasAuthorizationError(
			result.code as Exclude<CanvasAuthorizationDecisionCode, "allowed">,
			options.action,
		);
	}
	return result;
}
