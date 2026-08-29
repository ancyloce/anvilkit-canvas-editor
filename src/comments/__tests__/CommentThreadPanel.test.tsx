import { cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { CommentThreadPanel } from "../CommentThreadPanel.js";
import type { CanvasCommentThread } from "../comment-threads.js";

afterEach(cleanup);

const thread: CanvasCommentThread = {
	id: "thread-1",
	documentId: "document-1",
	anchor: {
		kind: "node",
		version: "1",
		pageId: "page-1",
		nodeId: "node-1",
	},
	anchorResolution: { status: "active" },
	messages: [
		{
			id: "message-1",
			threadId: "thread-1",
			authorId: "author",
			body: "Please review this layout.",
			mentions: ["reviewer"],
			createdAt: "2026-08-28T12:00:00.000Z",
		},
	],
	status: "open",
	resolvedAt: null,
	resolvedById: null,
	createdAt: "2026-08-28T12:00:00.000Z",
	createdById: "author",
};

describe("CommentThreadPanel", () => {
	it("is accessible and exposes replies, commenting, anchor navigation, and resolution", async () => {
		const user = userEvent.setup();
		const onReply = vi.fn();
		const onResolve = vi.fn();
		const onFocusAnchor = vi.fn();
		const view = render(
			<CommentThreadPanel
				canReply
				canResolve
				getUserLabel={(id) => (id === "author" ? "Avery" : "Riley")}
				onClose={vi.fn()}
				onFocusAnchor={onFocusAnchor}
				onReply={onReply}
				onResolve={onResolve}
				thread={thread}
			/>,
		);
		expect(view.getByRole("heading", { name: "Comment thread" })).toHaveFocus();
		expect(view.getByRole("list", { name: "Thread replies" })).toHaveTextContent(
			"Please review this layout.",
		);
		expect((await axe(view.container)).violations).toHaveLength(0);

		await user.click(view.getByRole("button", { name: "Go to anchor" }));
		expect(onFocusAnchor).toHaveBeenCalledOnce();
		await user.type(view.getByRole("textbox", { name: "Reply" }), "Looks good");
		await user.click(view.getByRole("button", { name: "Post reply" }));
		expect(onReply).toHaveBeenCalledWith("Looks good");
		await waitFor(() =>
			expect(view.getByRole("status")).toHaveTextContent("Reply posted."),
		);
		await user.click(view.getByRole("button", { name: "Resolve thread" }));
		expect(onResolve).toHaveBeenCalledOnce();
	});

	it("reopens a resolved thread and returns focus to the anchor on close", async () => {
		const user = userEvent.setup();
		const anchor = document.createElement("button");
		anchor.textContent = "Comment anchor";
		document.body.append(anchor);
		const onClose = vi.fn();
		const onReopen = vi.fn();
		const view = render(
			<CommentThreadPanel
				anchorElement={anchor}
				canResolve
				onClose={onClose}
				onReopen={onReopen}
				thread={{
					...thread,
					status: "resolved",
					resolvedAt: thread.createdAt,
					resolvedById: "author",
				}}
			/>,
		);
		await user.click(view.getByRole("button", { name: "Reopen thread" }));
		expect(onReopen).toHaveBeenCalledOnce();
		await user.click(
			view.getByRole("button", {
				name: "Close thread and return focus to its anchor",
			}),
		);
		expect(onClose).toHaveBeenCalledOnce();
		await waitFor(() => expect(anchor).toHaveFocus());
		anchor.remove();
	});
});
