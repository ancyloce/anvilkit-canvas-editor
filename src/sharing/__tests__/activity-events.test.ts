import { describe, expect, it } from "vitest";
import type { CanvasAuthorizationSession } from "../authorization.js";
import {
	type CanvasActivityEvent,
	createMemoryCanvasActivitySink,
	recordCanvasRoleChange,
} from "../activity-events.js";
import {
	createAuthorizedCanvasShareLinkProvider,
	createMemoryCanvasShareLinkProvider,
} from "../share-links.js";

const context = () => ({ signal: new AbortController().signal });
const owner: CanvasAuthorizationSession = {
	subjectId: "owner-1",
	grants: [
		{
			subjectId: "owner-1",
			role: "owner",
			scope: { kind: "document", id: "document-1" },
		},
	],
};

describe("Canvas activity events", () => {
	it("records share and role changes idempotently without secret or content fields", async () => {
		const activity = createMemoryCanvasActivitySink();
		let id = 0;
		let token = 0;
		const provider = createAuthorizedCanvasShareLinkProvider({
			provider: createMemoryCanvasShareLinkProvider({
				idFactory: () => `link-${++id}`,
				tokenFactory: () => `private-token-${++token}`,
				now: () => new Date("2026-08-28T12:00:00.000Z"),
				buildUrl: (value) => `https://secret.example/${value}`,
			}),
			documentId: "document-1",
			getSession: () => owner,
			activitySink: activity,
		});
		const first = await provider.create(
			{
				documentId: "document-1",
				role: "commenter",
				createdById: "owner-1",
			},
			context(),
		);
		await provider.rotate(first.link.id, context());
		await provider.revoke(first.link.id, context());
		const second = await provider.create(
			{
				documentId: "document-1",
				role: "viewer",
				createdById: "owner-1",
			},
			context(),
		);
		await provider.expire(second.link.id, context());

		const roleInput = {
			idempotencyKey: "role-change-1",
			documentId: "document-1",
			actorId: "owner-1",
			subjectId: "member-1",
			scopeKind: "document",
			scopeId: "document-1",
			previousRole: "viewer",
			nextRole: "commenter",
			occurredAt: "2026-08-28T12:00:00.000Z",
		} as const;
		recordCanvasRoleChange(activity, roleInput);
		recordCanvasRoleChange(activity, roleInput);

		const events = activity.list();
		expect(events.map((event) => event.kind)).toEqual([
			"share-link-created",
			"share-link-rotated",
			"share-link-revoked",
			"share-link-created",
			"share-link-expired",
			"role-changed",
		]);
		const serialized = JSON.stringify(events);
		for (const forbidden of [
			"private-token",
			"secret.example",
			'"url"',
			'"token"',
			'"body"',
			'"anchor"',
			'"content"',
			'"canvasIR"',
			'"email"',
		]) {
			expect(serialized).not.toContain(forbidden);
		}
	});

	it("rejects runtime-injected fields at deterministic storage", () => {
		const activity = createMemoryCanvasActivitySink();
		const injected = {
			idempotencyKey: "comment-1",
			kind: "comment-replied",
			documentId: "document-1",
			actorId: "user-1",
			occurredAt: "2026-08-28T12:00:00.000Z",
			threadId: "thread-1",
			body: "must not be stored",
		} as unknown as CanvasActivityEvent;
		expect(() => activity.record(injected)).toThrowError(
			expect.objectContaining({ code: "invalid-event" }),
		);
		expect(activity.list()).toEqual([]);
	});
});
