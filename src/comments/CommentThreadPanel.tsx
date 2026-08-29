"use client";

import { Button } from "@anvilkit/ui/button";
import { Textarea } from "@anvilkit/ui/textarea";
import {
	type FormEvent,
	type JSX,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import type { CanvasCommentThread } from "./comment-threads.js";

export interface CommentThreadPanelProps {
	thread: CanvasCommentThread;
	canReply?: boolean;
	canResolve?: boolean;
	anchorElement?: HTMLElement | null;
	onReply?: (body: string) => void | Promise<void>;
	onResolve?: () => void | Promise<void>;
	onReopen?: () => void | Promise<void>;
	onFocusAnchor?: () => void;
	onClose: () => void;
	getUserLabel?: (userId: string) => string;
	formatTimestamp?: (timestamp: string) => string;
}

/** Accessible host-facing thread surface; persistence remains provider-owned. */
export function CommentThreadPanel({
	thread,
	canReply = false,
	canResolve = false,
	anchorElement,
	onReply,
	onResolve,
	onReopen,
	onFocusAnchor,
	onClose,
	getUserLabel = (userId) => userId,
	formatTimestamp = (timestamp) => timestamp,
}: CommentThreadPanelProps): JSX.Element {
	const headingId = useId();
	const replyLabelId = useId();
	const headingRef = useRef<HTMLHeadingElement>(null);
	const [draft, setDraft] = useState("");
	const [pending, setPending] = useState(false);
	const [announcement, setAnnouncement] = useState("");

	useEffect(() => {
		headingRef.current?.focus();
	}, []);

	const returnToAnchor = (): void => {
		onClose();
		queueMicrotask(() => anchorElement?.focus());
	};

	const focusAnchor = (): void => {
		onFocusAnchor?.();
		queueMicrotask(() => anchorElement?.focus());
	};

	const submitReply = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
		event.preventDefault();
		const body = draft.trim();
		if (!body || !onReply || pending) return;
		setPending(true);
		setAnnouncement("");
		try {
			await onReply(body);
			setDraft("");
			setAnnouncement("Reply posted.");
		} catch {
			setAnnouncement("Reply could not be posted.");
		} finally {
			setPending(false);
		}
	};

	const transitionThread = async (): Promise<void> => {
		const transition = thread.status === "resolved" ? onReopen : onResolve;
		if (!transition || pending) return;
		setPending(true);
		setAnnouncement("");
		try {
			await transition();
			setAnnouncement(
				thread.status === "resolved" ? "Thread reopened." : "Thread resolved.",
			);
		} catch {
			setAnnouncement("Thread status could not be changed.");
		} finally {
			setPending(false);
		}
	};

	return (
		<section
			aria-labelledby={headingId}
			className="flex min-h-0 flex-col gap-3 rounded-xl bg-background p-3 shadow-sm ring-1 ring-border"
		>
			<header className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<h2
						className="text-sm font-semibold text-foreground outline-none"
						id={headingId}
						ref={headingRef}
						tabIndex={-1}
					>
						Comment thread
					</h2>
					<p className="text-xs text-muted-foreground">
						{thread.status === "resolved" ? "Resolved" : "Open"} · {thread.messages.length}{" "}
						{thread.messages.length === 1 ? "comment" : "comments"}
					</p>
				</div>
				<Button
					aria-label="Close thread and return focus to its anchor"
					onClick={returnToAnchor}
					size="sm"
					type="button"
					variant="ghost"
				>
					Close
				</Button>
			</header>

			{onFocusAnchor ? (
				<Button
					className="self-start"
					onClick={focusAnchor}
					size="sm"
					type="button"
					variant="outline"
				>
					Go to anchor
				</Button>
			) : null}

			<ol aria-label="Thread replies" className="min-h-0 space-y-2 overflow-y-auto">
				{thread.messages.map((message) => (
					<li className="rounded-lg bg-muted/60 p-2" key={message.id}>
						<div className="flex flex-wrap items-baseline justify-between gap-2">
							<strong className="text-xs font-semibold text-foreground">
								{getUserLabel(message.authorId)}
							</strong>
							<time
								className="text-xs tabular-nums text-muted-foreground"
								dateTime={message.createdAt}
							>
								{formatTimestamp(message.createdAt)}
							</time>
						</div>
						<p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground">
							{message.body}
						</p>
						{message.mentions.length > 0 ? (
							<p className="mt-1 text-xs text-muted-foreground">
								Mentioned: {message.mentions.map(getUserLabel).join(", ")}
							</p>
						) : null}
					</li>
				))}
			</ol>

			{canReply && thread.status === "open" && onReply ? (
				<form className="space-y-2" onSubmit={submitReply}>
					<label className="text-xs font-medium text-foreground" id={replyLabelId}>
						Reply
					</label>
					<Textarea
						aria-labelledby={replyLabelId}
						disabled={pending}
						onChange={(event) => setDraft(event.currentTarget.value)}
						placeholder="Write a reply"
						rows={3}
						value={draft}
					/>
					<Button disabled={pending || draft.trim().length === 0} type="submit">
						{pending ? "Posting…" : "Post reply"}
					</Button>
				</form>
			) : null}

			{canResolve ? (
				<Button
					className="self-start"
					disabled={pending}
					onClick={transitionThread}
					type="button"
					variant="secondary"
				>
					{thread.status === "resolved" ? "Reopen thread" : "Resolve thread"}
				</Button>
			) : null}

			<p aria-live="polite" className="sr-only" role="status">
				{announcement}
			</p>
		</section>
	);
}
