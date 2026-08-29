import { describe, expect, it } from "vitest";
import type { CanvasAuthorizationSession } from "../authorization.js";
import {
	createAuthorizedCanvasShareLinkProvider,
	createMemoryCanvasShareLinkProvider,
} from "../share-links.js";

const context = () => ({ signal: new AbortController().signal });
const documentScope = { kind: "document", id: "document-1" } as const;

function session(role: "owner" | "editor" | "commenter" | "viewer") {
	return {
		subjectId: "user-1",
		grants: [{ subjectId: "user-1", role, scope: documentScope }],
	} as const satisfies CanvasAuthorizationSession;
}

describe("authorized Canvas share-link provider", () => {
	it("rechecks refreshed roles for every read and management operation", async () => {
		let current: CanvasAuthorizationSession = session("owner");
		let sequence = 0;
		const base = createMemoryCanvasShareLinkProvider({
			idFactory: () => `link-${++sequence}`,
			tokenFactory: () => `token-${++sequence}`,
		});
		const provider = createAuthorizedCanvasShareLinkProvider({
			provider: base,
			documentId: "document-1",
			getSession: () => current,
		});
		const created = await provider.create(
			{
				documentId: "document-1",
				role: "viewer",
				createdById: "user-1",
			},
			context(),
		);

		current = session("editor");
		expect(await provider.list("document-1", context())).toHaveLength(1);
		await expect(provider.rotate(created.link.id, context())).rejects.toMatchObject({
			code: "denied-role",
			action: "share.manage",
		});

		current = session("viewer");
		await expect(provider.list("document-1", context())).rejects.toMatchObject({
			code: "denied-role",
			action: "share.read",
		});
	});

	it("rejects cross-document link IDs before mutation", async () => {
		let sequence = 0;
		const base = createMemoryCanvasShareLinkProvider({
			idFactory: () => `link-${++sequence}`,
			tokenFactory: () => `token-${++sequence}`,
		});
		const foreign = await base.create(
			{ documentId: "document-2", role: "viewer", createdById: "other" },
			context(),
		);
		const provider = createAuthorizedCanvasShareLinkProvider({
			provider: base,
			documentId: "document-1",
			getSession: () => session("owner"),
		});

		await expect(provider.revoke(foreign.link.id, context())).rejects.toMatchObject({
			code: "denied-invalid-resource",
		});
		const unchanged = await base.get(foreign.link.id, context());
		expect(unchanged?.revokedAt).toBeNull();
	});

	it("keeps token authorization link-driven", async () => {
		const base = createMemoryCanvasShareLinkProvider({
			idFactory: () => "link",
			tokenFactory: () => "secret",
		});
		await base.create(
			{ documentId: "document-1", role: "viewer", createdById: "owner" },
			context(),
		);
		const provider = createAuthorizedCanvasShareLinkProvider({
			provider: base,
			documentId: "document-1",
			getSession: () => session("viewer"),
		});
		expect(await provider.authorize({ token: "secret" }, context())).toMatchObject({
			allowed: true,
			code: "allowed",
		});
	});
});
