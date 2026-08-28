"use client";

import type {
	CanvasDocumentBudgetPolicy,
	CanvasIR,
} from "@anvilkit/canvas-core";
import * as React from "react";
import { useEffect, useRef } from "react";
import {
	useCanvasStores,
	useCanvasT,
} from "../context/canvas-studio-context.js";
import { useCanvasDialogs } from "../context/dialog-context.js";
import { loadCanvasDocument } from "./load-pipeline.js";
import type { CanvasRecoveryAdapter } from "./recovery.js";

/**
 * FR-164 recover-draft dialog (C-10). On mount, reads the recovery adapter's
 * snapshot for the current document; when it is NEWER than the loaded
 * document, offers to restore it (one `replaceDocument`, undo-history reset
 * like any document swap) or discard it (clears the snapshot). Renders
 * nothing itself — the workspace's dialog host presents the choice; headless
 * embeds fall back to the dialog context's documented auto-confirm, i.e.
 * the newer local draft wins (the data-preserving direction).
 *
 * T-M0-05: the snapshot goes through the same load pipeline as
 * {@link CanvasPersistenceAdapter.load}. It previously did not — a snapshot
 * was handed straight to `replaceDocument`, so whatever sat in IndexedDB was
 * mounted unvalidated, including a draft written by an older version of the
 * app whose IR predates the current one. Recovery storage is long-lived by
 * design (it exists to survive a crash), which makes it the entry path most
 * likely to hold a stale document version, and it was the only one with no
 * migrate seam at all.
 *
 * A snapshot that cannot parse, migrate, or validate is **discarded and
 * reported**, not offered: prompting someone to restore a draft that cannot
 * load only converts a silent failure into a confusing one.
 */
export function RecoverDraftPrompt({
	adapter,
	documentBudgetPolicy,
	onRecoveryError,
}: {
	adapter: CanvasRecoveryAdapter;
	documentBudgetPolicy?: Partial<CanvasDocumentBudgetPolicy>;
	/** Reports a snapshot that had to be discarded because it failed to load. */
	onRecoveryError?: (error: Error) => void;
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

				// Validate BEFORE prompting (T-M0-05). A snapshot that cannot
				// load is discarded outright: offering to restore a draft that
				// will then fail turns a silent problem into a confusing one,
				// and leaving it in storage means re-prompting on every mount.
				let recovered: CanvasIR;
				try {
					recovered = loadCanvasDocument(snapshot.ir, {
						...(stores.runtime ? { runtime: stores.runtime } : {}),
						...(documentBudgetPolicy ? { documentBudgetPolicy } : {}),
					});
				} catch (error) {
					await adapter.clear(documentId).catch(() => {
						// Best-effort, as everywhere else in this path.
					});
					if (!cancelled) {
						onRecoveryError?.(
							error instanceof Error ? error : new Error(String(error)),
						);
					}
					return;
				}

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
					// The migrated/validated document — never `snapshot.ir` raw.
					stores.replaceDocument?.(recovered, "recovery");
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
	}, [adapter, stores, dialogs, t, documentBudgetPolicy, onRecoveryError]);

	return null;
}
