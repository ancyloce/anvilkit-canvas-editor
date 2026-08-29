import { createCanvasIR, createPage } from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import { Awareness } from "y-protocols/awareness";
import { Doc as YDoc } from "yjs";
import { createMemoryCanvasCommentThreadProvider } from "../../comments/comment-threads.js";
import { createCanvasPresence } from "../presence-bridge.js";

const context = () => ({ signal: new AbortController().signal });

describe("presence disconnection isolation", () => {
	it("does not delete persisted comments or design content", async () => {
		const ir = createCanvasIR({
			id: "document-1",
			title: "Persisted design",
			pages: [createPage({ id: "page-1" })],
		});
		const originalIR = JSON.stringify(ir);
		let sequence = 0;
		const comments = createMemoryCanvasCommentThreadProvider({
			idFactory: () => `id-${++sequence}`,
		});
		const thread = await comments.create(
			{
				documentId: ir.id,
				anchor: { kind: "page", version: "1", pageId: "page-1" },
				authorId: "user-1",
				body: "Persist this comment",
			},
			ir,
			context(),
		);
		const doc = new YDoc();
		const awareness = new Awareness(doc);
		const presence = createCanvasPresence(awareness);
		presence.update({
			peer: { id: "user-1", displayName: "Avery" },
			cursor: { x: 10, y: 20 },
		});

		awareness.setLocalState(null);
		presence.destroy();

		expect(JSON.stringify(ir)).toBe(originalIR);
		expect(await comments.get(thread.id, ir, context())).toMatchObject({
			messages: [{ body: "Persist this comment" }],
		});
		awareness.destroy();
		doc.destroy();
	});
});
