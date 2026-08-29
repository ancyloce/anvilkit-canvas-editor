import { describe, expect, it } from "vitest";
import {
	CANVAS_AUTHORIZATION_ACTIONS,
	CANVAS_COLLABORATION_ROLES,
	CANVAS_ROLE_PERMISSIONS,
	CanvasAuthorizationError,
	assertCanvasAuthorized,
	resolveCanvasAuthorization,
} from "../authorization.js";

const documentScope = { kind: "document", id: "document-1" } as const;
const pageScope = { kind: "page", id: "page-1" } as const;
const groupScope = { kind: "node", id: "group-1" } as const;
const nodeScope = { kind: "node", id: "node-1" } as const;
const commentScope = { kind: "comment", id: "thread-1" } as const;
const nodeResource = {
	scopes: [documentScope, pageScope, groupScope, nodeScope],
} as const;

describe("Canvas authorization model", () => {
	it("keeps the role matrix closed and owner-only administration explicit", () => {
		expect(Object.keys(CANVAS_ROLE_PERMISSIONS).sort()).toEqual(
			[...CANVAS_COLLABORATION_ROLES].sort(),
		);
		expect(CANVAS_ROLE_PERMISSIONS.owner).toEqual(
			CANVAS_AUTHORIZATION_ACTIONS,
		);
		expect(CANVAS_ROLE_PERMISSIONS.editor).toContain("document.write");
		expect(CANVAS_ROLE_PERMISSIONS.commenter).not.toContain("document.write");
		expect(CANVAS_ROLE_PERMISSIONS.viewer).not.toContain("comment.create");
		expect(CANVAS_ROLE_PERMISSIONS.editor).not.toContain("share.manage");
	});

	it.each([
		["owner", "document.write", true],
		["editor", "document.write", true],
		["commenter", "document.write", false],
		["viewer", "document.write", false],
		["commenter", "comment.create", true],
		["viewer", "comment.create", false],
		["viewer", "document.read", true],
	] as const)("resolves %s performing %s", (role, action, allowed) => {
		const result = resolveCanvasAuthorization({
			subjectId: "user-1",
			action,
			resource: nodeResource,
			grants: [{ subjectId: "user-1", role, scope: documentScope }],
		});
		expect(result.allowed).toBe(allowed);
		expect(result.code).toBe(allowed ? "allowed" : "denied-role");
	});

	it("inherits document grants and lets the closest assignment downgrade access", () => {
		const result = resolveCanvasAuthorization({
			subjectId: "user-1",
			action: "document.write",
			resource: nodeResource,
			grants: [
				{ subjectId: "user-1", role: "editor", scope: documentScope },
				{ subjectId: "user-1", role: "viewer", scope: pageScope },
			],
		});
		expect(result).toEqual({
			allowed: false,
			code: "denied-role",
			role: "viewer",
			matchedScope: pageScope,
		});
	});

	it("makes an explicit ancestor deny override a more specific grant", () => {
		const result = resolveCanvasAuthorization({
			subjectId: "user-1",
			action: "comment.reply",
			resource: { scopes: [...nodeResource.scopes, commentScope] },
			grants: [
				{ subjectId: "user-1", role: "commenter", scope: commentScope },
			],
			denies: [
				{
					subjectId: "*",
					scope: documentScope,
					actions: ["comment.reply"],
				},
			],
		});
		expect(result.code).toBe("denied-explicit");
	});

	it("fails closed for no grant, malformed ancestry, and conflicting grants", () => {
		expect(
			resolveCanvasAuthorization({
				subjectId: "unknown",
				action: "document.read",
				resource: nodeResource,
				grants: [],
			}).code,
		).toBe("denied-no-grant");
		expect(
			resolveCanvasAuthorization({
				subjectId: "user-1",
				action: "document.read",
				resource: { scopes: [pageScope, documentScope] },
				grants: [
					{ subjectId: "user-1", role: "viewer", scope: documentScope },
				],
			}).code,
		).toBe("denied-invalid-resource");
		expect(
			resolveCanvasAuthorization({
				subjectId: "user-1",
				action: "document.read",
				resource: nodeResource,
				grants: [
					{ subjectId: "user-1", role: "viewer", scope: pageScope },
					{ subjectId: "user-1", role: "editor", scope: pageScope },
				],
			}).code,
		).toBe("denied-conflicting-grants");
	});

	it("rejects owner grants below the document scope", () => {
		expect(
			resolveCanvasAuthorization({
				subjectId: "user-1",
				action: "document.write",
				resource: nodeResource,
				grants: [
					{ subjectId: "user-1", role: "owner", scope: nodeScope },
				],
			}).code,
		).toBe("denied-invalid-grant");
	});

	it("throws only the stable, content-free denial at guarded boundaries", () => {
		expect(() =>
			assertCanvasAuthorized({
				subjectId: "commenter-1",
				action: "document.write",
				resource: nodeResource,
				grants: [
					{
						subjectId: "commenter-1",
						role: "commenter",
						scope: documentScope,
					},
				],
			}),
		).toThrowError(CanvasAuthorizationError);
		try {
			assertCanvasAuthorized({
				subjectId: "commenter-1",
				action: "document.write",
				resource: nodeResource,
				grants: [
					{
						subjectId: "commenter-1",
						role: "commenter",
						scope: documentScope,
					},
				],
			});
		} catch (error) {
			expect(error).toMatchObject({
				code: "denied-role",
				action: "document.write",
			});
		}
	});
});
