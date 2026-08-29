import {
	type CanvasCommentAnchor,
	createCanvasIR,
	createPage,
	createRect,
	insertNode,
} from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import type { CanvasAuthorizationSession } from "../../sharing/authorization.js";
import { createMemoryCanvasActivitySink } from "../../sharing/activity-events.js";
import {
	createAuthorizedCanvasCommentThreadProvider,
	createMemoryCanvasCommentNotificationProvider,
	createMemoryCanvasCommentThreadProvider,
} from "../comment-threads.js";

const context = () => ({ signal: new AbortController().signal });

function makeIR() {
	const page = createPage({ id: "page-1" });
	let ir = createCanvasIR({ id: "document-1", title: "Test", pages: [page] });
	ir = insertNode(ir, {
		parentId: page.root.id,
		node: createRect({
			id: "node-1",
			bounds: { width: 10, height: 10 },
			transform: { x: 0, y: 0 },
		}),
	});
	return { ir, page };
}

function session(role: "commenter" | "viewer"): CanvasAuthorizationSession {
	return {
		subjectId: "user-1",
		grants: [
			{
				subjectId: "user-1",
				role,
				scope: { kind: "document", id: "document-1" },
			},
		],
	};
}

describe("Canvas comment threads", () => {
	it("creates document, page, and node anchored threads outside Canvas IR", async () => {
		const { ir } = makeIR();
		const original = JSON.stringify(ir);
		let sequence = 0;
		const provider = createMemoryCanvasCommentThreadProvider({
			idFactory: () => `comment-${++sequence}`,
			now: () => new Date("2026-08-28T12:00:00.000Z"),
		});
		const anchors: CanvasCommentAnchor[] = [
			{ kind: "document", version: "1", documentId: "document-1" },
			{ kind: "page", version: "1", pageId: "page-1" },
			{ kind: "node", version: "1", pageId: "page-1", nodeId: "node-1" },
		];
		for (const anchor of anchors) {
			await provider.create(
				{
					documentId: "document-1",
					anchor,
					authorId: "user-1",
					body: "Review this",
				},
				ir,
				context(),
			);
		}

		const threads = await provider.list("document-1", ir, context());
		expect(threads).toHaveLength(3);
		expect(threads.every((thread) => thread.anchorResolution.status === "active")).toBe(true);
		expect(JSON.stringify(ir)).toBe(original);
		expect(JSON.stringify(ir)).not.toContain("Review this");
	});

	it("follows node ids across pages and archives/restores a deleted target", async () => {
		const { ir: ir0 } = makeIR();
		let sequence = 0;
		const provider = createMemoryCanvasCommentThreadProvider({
			idFactory: () => `id-${++sequence}`,
		});
		const created = await provider.create(
			{
				documentId: "document-1",
				anchor: {
					kind: "node",
					version: "1",
					pageId: "page-1",
					nodeId: "node-1",
				},
				authorId: "user-1",
				body: "Keep this thread",
			},
			ir0,
			context(),
		);
		const page2 = createPage({ id: "page-2" });
		const withoutNode = {
			...ir0,
			pages: [
				{ ...ir0.pages[0]!, root: { ...ir0.pages[0]!.root, children: [] } },
				page2,
			],
		};
		expect(
			(await provider.get(created.id, withoutNode, context()))?.anchorResolution,
		).toEqual({ status: "archived", reason: "node-deleted" });
		const restored = insertNode(withoutNode, {
			parentId: page2.root.id,
			node: createRect({
				id: "node-1",
				bounds: { width: 10, height: 10 },
				transform: { x: 4, y: 5 },
			}),
		});
		const reopened = await provider.get(created.id, restored, context());
		expect(reopened?.anchorResolution).toEqual({
			status: "active",
			resolvedPageId: "page-2",
		});
		expect(reopened?.messages[0]?.body).toBe("Keep this thread");
	});

	it("permits commenters to create and keeps viewers read-only", async () => {
		const { ir } = makeIR();
		let current = session("commenter");
		let sequence = 0;
		const provider = createAuthorizedCanvasCommentThreadProvider({
			provider: createMemoryCanvasCommentThreadProvider({
				idFactory: () => `id-${++sequence}`,
			}),
			documentId: "document-1",
			getSession: () => current,
		});
		await provider.create(
			{
				documentId: "document-1",
				anchor: { kind: "page", version: "1", pageId: "page-1" },
				authorId: "user-1",
				body: "Allowed",
			},
			ir,
			context(),
		);
		current = session("viewer");
		expect(await provider.list("document-1", ir, context())).toHaveLength(1);
		await expect(
			provider.create(
				{
					documentId: "document-1",
					anchor: { kind: "page", version: "1", pageId: "page-1" },
					authorId: "user-1",
					body: "Denied",
				},
				ir,
				context(),
			),
		).rejects.toMatchObject({ code: "denied-role", action: "comment.create" });
	});

	it("supports replies, mentions, resolution, reopen, and unread state", async () => {
		const { ir } = makeIR();
		let sequence = 0;
		const notifications = createMemoryCanvasCommentNotificationProvider({
			preferences: { muted: { mentions: false } },
		});
		const activity = createMemoryCanvasActivitySink();
		const provider = createMemoryCanvasCommentThreadProvider({
			activitySink: activity,
			idFactory: () => `id-${++sequence}`,
			notificationProvider: notifications,
			now: () => new Date("2026-08-28T12:00:00.000Z"),
		});
		const created = await provider.create(
			{
				documentId: "document-1",
				anchor: {
					kind: "node",
					version: "1",
					pageId: "page-1",
					nodeId: "node-1",
				},
				authorId: "author",
				body: "Initial private body",
				mentions: ["responder", "muted", "responder"],
			},
			ir,
			context(),
		);
		expect(
			await provider.getUnreadState(created.id, "responder", ir, context()),
		).toMatchObject({ count: 1, lastReadAt: null });
		expect(
			await provider.markRead(created.id, "responder", ir, context()),
		).toMatchObject({ count: 0 });

		const replied = await provider.reply(
			created.id,
			{
				authorId: "responder",
				body: "Reply private body",
				mentions: ["reviewer"],
			},
			ir,
			context(),
		);
		expect(replied.messages).toHaveLength(2);
		expect(replied.messages[1]?.mentions).toEqual(["reviewer"]);
		expect(
			await provider.getUnreadState(created.id, "author", ir, context()),
		).toMatchObject({ count: 1 });
		expect(
			await provider.getUnreadState(created.id, "reviewer", ir, context()),
		).toMatchObject({ count: 1 });

		const resolved = await provider.resolve(
			created.id,
			{ actorId: "author" },
			ir,
			context(),
		);
		expect(resolved).toMatchObject({
			status: "resolved",
			resolvedById: "author",
		});
		await expect(
			provider.reply(
				created.id,
				{ authorId: "responder", body: "Blocked while resolved" },
				ir,
				context(),
			),
		).rejects.toMatchObject({ code: "thread-resolved" });
		expect(
			await provider.reopen(
				created.id,
				{ actorId: "author" },
				ir,
				context(),
			),
		).toMatchObject({ status: "open", resolvedAt: null, resolvedById: null });

		const events = notifications.list();
		expect(
			events.some(
				(event) =>
					event.kind === "comment-mention" && event.recipientId === "reviewer",
			),
		).toBe(true);
		expect(
			events.some(
				(event) =>
					event.kind === "comment-mention" && event.recipientId === "muted",
			),
		).toBe(false);
		expect(events.some((event) => event.kind === "comment-resolved")).toBe(true);
		expect(events.some((event) => event.kind === "comment-reopened")).toBe(true);
		expect(JSON.stringify(events)).not.toContain("private body");
		expect(activity.list().map((event) => event.kind)).toEqual([
			"comment-thread-created",
			"comment-replied",
			"comment-resolved",
			"comment-reopened",
		]);
		expect(JSON.stringify(activity.list())).not.toContain("private body");
	});

	it("delivers notifications idempotently and exposes host preferences", async () => {
		const notifications = createMemoryCanvasCommentNotificationProvider({
			preferences: {
				user: { replies: false, mentions: false, resolution: false },
			},
		});
		const notification = {
			idempotencyKey: "operation:mention:user",
			kind: "comment-mention",
			documentId: "document-1",
			threadId: "thread-1",
			actorId: "author",
			recipientId: "user",
			occurredAt: "2026-08-28T12:00:00.000Z",
		} as const;
		await notifications.notify(notification, context());
		await notifications.notify(notification, context());
		expect(notifications.list()).toEqual([notification]);
		expect(await notifications.getPreferences("user", context())).toEqual({
			replies: false,
			mentions: false,
			resolution: false,
		});
	});

	it("rechecks actor identity and role for reply and resolution operations", async () => {
		const { ir } = makeIR();
		let current = session("commenter");
		let sequence = 0;
		const provider = createAuthorizedCanvasCommentThreadProvider({
			provider: createMemoryCanvasCommentThreadProvider({
				idFactory: () => `id-${++sequence}`,
			}),
			documentId: "document-1",
			getSession: () => current,
		});
		const thread = await provider.create(
			{
				documentId: "document-1",
				anchor: { kind: "page", version: "1", pageId: "page-1" },
				authorId: "user-1",
				body: "Initial",
			},
			ir,
			context(),
		);
		expect(
			await provider.reply(
				thread.id,
				{ authorId: "user-1", body: "Allowed" },
				ir,
				context(),
			),
		).toMatchObject({ messages: [{ body: "Initial" }, { body: "Allowed" }] });
		await expect(
			provider.resolve(
				thread.id,
				{ actorId: "spoofed-user" },
				ir,
				context(),
			),
		).rejects.toMatchObject({
			code: "denied-invalid-resource",
			action: "comment.resolve",
		});
		current = session("viewer");
		await expect(
			provider.reply(
				thread.id,
				{ authorId: "user-1", body: "Denied" },
				ir,
				context(),
			),
		).rejects.toMatchObject({ code: "denied-role", action: "comment.reply" });
	});
});
