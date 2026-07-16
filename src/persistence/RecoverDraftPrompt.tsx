"use client";

import * as React from "react";
import { useEffect, useRef } from "react";
import {
	useCanvasStores,
	useCanvasT,
} from "../context/canvas-studio-context.js";
import { useCanvasDialogs } from "../context/dialog-context.js";
import type { CanvasRecoveryAdapter } from "./recovery.js";

/**
 * FR-164 recover-draft dialog (C-10). On mount, reads the recovery adapter's
 * snapshot for the current document; when it is NEWER than the loaded
 * document, offers to restore it (one `replaceDocument`, undo-history reset
 * like any document swap) or discard it (clears the snapshot). Renders
 * nothing itself — the workspace's dialog host presents the choice; headless
 * embeds fall back to the dialog context's documented auto-confirm, i.e.
 * the newer local draft wins (the data-preserving direction).
 */
export function RecoverDraftPrompt({
	adapter,
}: {
	adapter: CanvasRecoveryAdapter;
}): React.JSX.Element | null {
	const stores = useCanvasStores();
	const dialogs = useCanvasDialogs();
	const t = useCanvasT();
	const promptedFor = useRef<string | null>(null);

	useEffect(() => {
		const documentId = stores.getIR().id;
		if (promptedFor.current === documentId) return;
		promptedFor.current = documentId;
		let cancelled = false;
		void adapter
			.read(documentId)
			.then(async (snapshot) => {
				if (cancelled || !snapshot) return;
				const loadedAt = stores.getIR().metadata.updatedAt;
				if (snapshot.savedAt <= loadedAt) return;
				const restore = await dialogs.confirm({
					title: t("canvas.recovery.title", "Recover unsaved changes?"),
					description: t(
						"canvas.recovery.body",
						"A newer local draft of this design was found. Restore it, or discard it and keep the loaded version?",
					),
					confirmLabel: t("canvas.recovery.restore", "Restore draft"),
					cancelLabel: t("canvas.recovery.discard", "Discard draft"),
				});
				if (cancelled) return;
				if (restore) {
					stores.replaceDocument?.(snapshot.ir, "recovery");
				} else {
					await adapter.clear(documentId);
				}
			})
			.catch(() => {
				// Best-effort: a broken adapter must never block mounting.
			});
		return () => {
			cancelled = true;
		};
	}, [adapter, stores, dialogs, t]);

	return null;
}
