import { describe, expect, it, vi } from "vitest";
import {
	CanvasShareLinkError,
	copyCanvasShareLink,
	createMemoryCanvasShareLinkProvider,
} from "../share-links.js";

const context = () => ({ signal: new AbortController().signal });

function providerHarness() {
	let instant = new Date("2026-08-28T00:00:00.000Z");
	let sequence = 0;
	const provider = createMemoryCanvasShareLinkProvider({
		now: () => new Date(instant),
		idFactory: () => `link-${++sequence}`,
		tokenFactory: () => `token-${++sequence}`,
		buildUrl: (token) => `https://canvas.example/share/${token}`,
	});
	return {
		provider,
		advance(hours: number) {
			instant = new Date(instant.getTime() + hours * 60 * 60 * 1_000);
		},
	};
}

describe("Canvas share-link lifecycle", () => {
	it("creates, lists, and copies an active link", async () => {
		const { provider } = providerHarness();
		const created = await provider.create(
			{
				documentId: "document-1",
				role: "commenter",
				createdById: "owner-1",
			},
			context(),
		);
		expect(created.link).toMatchObject({
			id: "link-1",
			documentId: "document-1",
			role: "commenter",
			tokenVersion: 1,
		});
		expect(created.url).toBe("https://canvas.example/share/token-2");
		expect(await provider.list("document-1", context())).toHaveLength(1);

		const writeText = vi.fn(async () => undefined);
		await copyCanvasShareLink(provider, created.link.id, { writeText }, context());
		expect(writeText).toHaveBeenCalledWith(created.url);
	});

	it("expires immediately and rejects the next authorization check and copy", async () => {
		const { provider } = providerHarness();
		const created = await provider.create(
			{ documentId: "d", role: "viewer", createdById: "owner" },
			context(),
		);
		await provider.expire(created.link.id, context());
		expect(
			await provider.authorize({ token: "token-2" }, context()),
		).toMatchObject({ allowed: false, code: "link-expired" });
		await expect(provider.getCopyUrl(created.link.id, context())).rejects.toMatchObject({
			code: "link-inactive",
		});
	});

	it("revokes idempotently and stops granting access", async () => {
		const { provider } = providerHarness();
		const created = await provider.create(
			{ documentId: "d", role: "viewer", createdById: "owner" },
			context(),
		);
		const first = await provider.revoke(created.link.id, context());
		const second = await provider.revoke(created.link.id, context());
		expect(second.revokedAt).toBe(first.revokedAt);
		expect(
			await provider.authorize({ token: "token-2" }, context()),
		).toMatchObject({ allowed: false, code: "link-revoked" });
	});

	it("rotates the secret while preserving the link identity", async () => {
		const { provider } = providerHarness();
		const created = await provider.create(
			{ documentId: "d", role: "editor", createdById: "owner" },
			context(),
		);
		const rotated = await provider.rotate(created.link.id, context());
		expect(rotated.link.id).toBe(created.link.id);
		expect(rotated.link.tokenVersion).toBe(2);
		expect(rotated.url).toContain("token-3");
		expect(
			await provider.authorize({ token: "token-2" }, context()),
		).toMatchObject({ allowed: false, code: "link-not-found" });
		expect(
			await provider.authorize({ token: "token-3" }, context()),
		).toMatchObject({ allowed: true, code: "allowed" });
	});

	it("enforces identity and domain restrictions conjunctively", async () => {
		const { provider } = providerHarness();
		await provider.create(
			{
				documentId: "d",
				role: "commenter",
				createdById: "owner",
				restrictions: {
					allowedIdentityIds: ["user-1"],
					allowedDomains: ["@Example.COM"],
				},
			},
			context(),
		);
		expect(
			await provider.authorize({ token: "token-2" }, context()),
		).toMatchObject({ code: "identity-required" });
		expect(
			await provider.authorize(
				{ token: "token-2", identity: { id: "user-2", domain: "example.com" } },
				context(),
			),
		).toMatchObject({ code: "identity-not-allowed" });
		expect(
			await provider.authorize(
				{ token: "token-2", identity: { id: "user-1", email: "u@other.test" } },
				context(),
			),
		).toMatchObject({ code: "domain-not-allowed" });
		expect(
			await provider.authorize(
				{ token: "token-2", identity: { id: "user-1", email: "u@example.com" } },
				context(),
			),
		).toMatchObject({ allowed: true, code: "allowed" });
	});

	it("honors host policy and request cancellation", async () => {
		const policyProvider = createMemoryCanvasShareLinkProvider({
			idFactory: () => "link",
			tokenFactory: () => "token",
			hostPolicy: { canCreate: () => false },
		});
		await expect(
			policyProvider.create(
				{ documentId: "d", role: "viewer", createdById: "owner" },
				context(),
			),
		).rejects.toMatchObject({ code: "host-policy-denied" });

		const controller = new AbortController();
		controller.abort();
		await expect(
			policyProvider.list("d", { signal: controller.signal }),
		).rejects.toBeInstanceOf(CanvasShareLinkError);
	});

	it("rejects past expiration at creation", async () => {
		const { provider, advance } = providerHarness();
		advance(1);
		await expect(
			provider.create(
				{
					documentId: "d",
					role: "viewer",
					createdById: "owner",
					expiresAt: "2026-08-28T00:30:00.000Z",
				},
				context(),
			),
		).rejects.toMatchObject({ code: "invalid-expiration" });
	});
});
