"use client";

import type {
	CanvasExternalComponentRef,
	CanvasIR,
} from "@anvilkit/canvas-core";
import { sanitizeProviderUrl } from "@anvilkit/canvas-core/component-libraries";

import type {
	CanvasComponentCatalogEntry,
	CanvasComponentProvider,
} from "./component-provider.js";
import { classifyProviderError, isAbortRejection } from "./provider-errors.js";

/**
 * @file Read-only update discovery (plan 0021 T-028, §12.2).
 *
 * ## Discovery must not touch the document
 *
 * "Is a newer version available?" is a question about a catalog, not about the
 * document — so nothing here writes IR, and the acceptance criterion (AC-002)
 * is literally "no visual change on discovery". A provider failure likewise
 * must not invalidate the snapshot the document already has: being unable to
 * ask about updates is not evidence that the installed version is bad.
 *
 * ## Explicitly triggered
 *
 * Never on a timer and never on render. It runs on user action, on panel open
 * with host opt-in, or on a host-scheduled scan — because a background poll
 * against a host's catalog is the host's cost to authorize, not ours to take.
 */

export interface CanvasComponentUpdateInfo {
	readonly current: CanvasExternalComponentRef;
	readonly latest: CanvasComponentCatalogEntry;
	/** How many instances in the document carry `current`. */
	readonly affectedInstanceCount: number;
	/** Sanitized; `undefined` when the catalog gave an unsafe or absent URL. */
	readonly releaseNotesUrl: string | undefined;
	readonly deprecationNotice: string | undefined;
}

export type CanvasUpdateCheckResult =
	| {
			readonly ok: true;
			readonly updates: readonly CanvasComponentUpdateInfo[];
	  }
	| { readonly ok: false; readonly reason: "aborted" }
	| { readonly ok: false; readonly reason: "provider"; readonly code: string };

/** Every distinct external ref the document uses, with instance counts. */
export function collectExternalRefUsage(
	ir: CanvasIR,
): ReadonlyMap<string, { ref: CanvasExternalComponentRef; count: number }> {
	const usage = new Map<
		string,
		{ ref: CanvasExternalComponentRef; count: number }
	>();
	const visit = (node: unknown): void => {
		if (!node || typeof node !== "object") return;
		const typed = node as {
			type?: string;
			source?: CanvasExternalComponentRef;
			children?: unknown[];
		};
		if (
			typed.type === "component-instance" &&
			typed.source?.kind === "library"
		) {
			const key = `${typed.source.libraryId}/${typed.source.componentId}/${typed.source.version}/${typed.source.integrity}`;
			const entry = usage.get(key);
			if (entry) entry.count += 1;
			else usage.set(key, { ref: typed.source, count: 1 });
		}
		for (const child of typed.children ?? []) visit(child);
	};
	for (const page of ir.pages) visit(page.root);
	for (const definition of Object.values(ir.components ?? {})) {
		visit(definition.root);
	}
	return usage;
}

/**
 * Ask the Provider whether newer versions exist for what this document uses.
 *
 * Pure with respect to the document: it reads `ir` and returns findings. The
 * caller decides whether to show them.
 */
export async function checkForComponentUpdates(
	ir: CanvasIR,
	provider: CanvasComponentProvider,
	options: { readonly signal?: AbortSignal } = {},
): Promise<CanvasUpdateCheckResult> {
	if (provider.listVersions === undefined) {
		// A Provider that cannot enumerate versions simply reports nothing —
		// not an error, since `listVersions` is optional in the contract.
		return { ok: true, updates: [] };
	}

	const controller = new AbortController();
	const signal = options.signal ?? controller.signal;
	const updates: CanvasComponentUpdateInfo[] = [];

	try {
		for (const { ref, count } of collectExternalRefUsage(ir).values()) {
			const result = await provider.listVersions(
				{ libraryId: ref.libraryId, componentId: ref.componentId },
				{ signal },
			);
			// "Newest" is whatever the Provider put first — Canvas never orders
			// opaque version strings itself (TD §5.1).
			const latest = result.entries[0];
			if (!latest) continue;
			if (
				latest.ref.version === ref.version &&
				latest.ref.integrity === ref.integrity
			) {
				continue;
			}
			updates.push({
				current: ref,
				latest,
				affectedInstanceCount: count,
				releaseNotesUrl:
					latest.releaseNotesUrl === undefined
						? undefined
						: sanitizeProviderUrl(latest.releaseNotesUrl),
				deprecationNotice: latest.deprecationNotice,
			});
		}
	} catch (error) {
		if (isAbortRejection(error)) return { ok: false, reason: "aborted" };
		// A failed check leaves the document, and its stored snapshots, exactly
		// as they were — being unable to ask is not evidence of a bad version.
		return {
			ok: false,
			reason: "provider",
			code: classifyProviderError(error),
		};
	}

	return { ok: true, updates };
}
