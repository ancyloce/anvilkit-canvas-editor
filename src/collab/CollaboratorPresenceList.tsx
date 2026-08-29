"use client";

import type { JSX } from "react";
import type { CanvasCollabSyncState } from "./binding.js";
import type { CanvasPresenceState } from "./presence-types.js";
import { useCanvasPresence } from "./useCanvasPresence.js";

export interface CollaboratorPresenceListProps {
	connectionState: CanvasCollabSyncState;
	/** Optional controlled snapshot for hosts that already subscribe upstream. */
	peers?: readonly CanvasPresenceState[];
	className?: string;
}

function peerLabel(presence: CanvasPresenceState): string {
	return presence.peer.displayName?.trim() || presence.peer.id;
}

function initialOf(label: string): string {
	return Array.from(label.trim())[0]?.toLocaleUpperCase() ?? "?";
}

function connectionLabel(state: CanvasCollabSyncState): string {
	switch (state.kind) {
		case "connecting":
			return "Connecting to collaboration.";
		case "synced":
			return `Connected since ${state.since}.`;
		case "offline":
			return `Offline since ${state.since}.`;
		case "reconnecting":
			return `Reconnecting, attempt ${state.attempt}.`;
		case "error":
			return state.recoverable
				? "Collaboration connection error. Retrying is available."
				: "Collaboration connection error. Host action is required.";
	}
}

/** Accessible text counterpart to the canvas cursor/selection overlays. */
export function CollaboratorPresenceList({
	connectionState,
	peers: controlledPeers,
	className,
}: CollaboratorPresenceListProps): JSX.Element {
	const subscribedPeers = useCanvasPresence();
	const peers = [...(controlledPeers ?? subscribedPeers)].sort((left, right) =>
		peerLabel(left).localeCompare(peerLabel(right)),
	);
	const pending = connectionState.pendingLocalTransactions;

	return (
		<section
			aria-labelledby="canvas-collaborators-heading"
			className={className}
		>
			<h2 className="text-sm font-semibold" id="canvas-collaborators-heading">
				Collaborators
			</h2>
			<p aria-live="polite" className="text-xs text-muted-foreground" role="status">
				{connectionLabel(connectionState)}{" "}
				{pending === 0
					? "All local changes are synchronized."
					: `${pending} local ${pending === 1 ? "change is" : "changes are"} waiting to synchronize.`}
			</p>
			{peers.length === 0 ? (
				<p className="mt-2 text-sm text-muted-foreground">
					No collaborators connected.
				</p>
			) : (
				<ul aria-label="Connected collaborators" className="mt-2 space-y-1.5">
					{peers.map((presence) => {
						const label = peerLabel(presence);
						const selected = presence.selection?.nodeIds.length ?? 0;
						return (
							<li
								className="flex items-center gap-2 rounded-lg bg-muted/60 px-2 py-1.5"
								key={presence.peer.id}
							>
								<span
									aria-hidden="true"
									className="flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white shadow-sm ring-1 ring-black/10 dark:ring-white/10"
									style={{ backgroundColor: presence.peer.color ?? "#2563eb" }}
								>
									{initialOf(label)}
								</span>
								<span className="min-w-0">
									<strong className="block truncate text-sm font-medium">{label}</strong>
									<span className="block text-xs text-muted-foreground">
										{presence.cursor
											? `Cursor at ${Math.round(presence.cursor.x)}, ${Math.round(presence.cursor.y)}. `
											: "Cursor position unavailable. "}
										{selected === 0
											? "No selection."
											: `${selected} ${selected === 1 ? "object" : "objects"} selected.`}
									</span>
								</span>
							</li>
						);
					})}
				</ul>
			)}
		</section>
	);
}
