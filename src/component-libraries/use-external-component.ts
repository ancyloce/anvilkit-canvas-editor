"use client";

import type { CanvasExternalComponentRef } from "@anvilkit/canvas-core";
import {
	admitExternalSnapshot,
	type CanvasComponentInsertExternalCommand,
	type CanvasComponentRecoverSnapshotCommand,
	INSERT_EXTERNAL_COMMAND,
	RECOVER_SNAPSHOT_COMMAND,
} from "@anvilkit/canvas-core/component-libraries";
import { useCallback } from "react";

import {
	type CanvasStudioContextValue,
	useCanvasStudio,
} from "../context/canvas-studio-context.js";
import type {
	CanvasComponentCatalogEntry,
	CanvasComponentProvider,
} from "./component-provider.js";
import {
	classifyProviderError,
	isAbortRejection,
	providerStatusMessageKey,
} from "./provider-errors.js";
import { createWebCryptoIntegrityVerifier } from "./web-crypto-verifier.js";

/**
 * @file fetch → admit → command, as ONE user action (plan 0021 T-022/T-023).
 *
 * ## Why the three steps live together
 *
 * They are one transaction from the user's point of view and they must fail as
 * one. Splitting them across call sites is how you get a document that stored a
 * snapshot for a component it never inserted, or an instance pointing at bytes
 * that were never verified. Everything before `commit` is read-only, so any
 * failure — offline, withdrawn version, bad digest, rejected command — leaves
 * the document untouched by construction rather than by cleanup.
 *
 * ## Verification is async, command application is sync
 *
 * That is the whole reason admission is a separate phase (M0/T-008): the digest
 * check needs `crypto.subtle`, and `applyCommand` cannot await. This module is
 * the async half; it hands the command a value the type system already proves
 * was verified.
 */

/** Why an insert or recovery did not happen. Never carries a raw error. */
export type ExternalComponentFailure =
	| { readonly reason: "aborted" }
	| {
			readonly reason:
				| "capability-denied"
				| "version-unavailable"
				| "provider"
				| "admission"
				| "command";
			/** i18n key — resolved by the caller, so no locale data lives here. */
			readonly messageKey: string;
			/** Diagnostic code or command-error code, for logs. Never rendered raw. */
			readonly code?: string;
	  };

export type InsertExternalComponentResult =
	| { readonly ok: true; readonly instanceId: string }
	| ({ readonly ok: false } & ExternalComponentFailure);

export interface ExternalComponentDeps {
	readonly ctx: CanvasStudioContextValue;
	readonly provider: CanvasComponentProvider;
	readonly signal?: AbortSignal;
	/** Injectable for tests; production uses Web Crypto. */
	readonly verifier?: Parameters<typeof admitExternalSnapshot>[1]["verifier"];
	readonly now?: () => string;
	/** Instance id factory; defaults to `crypto.randomUUID`. */
	readonly newId?: () => string;
}

function verifierOf(deps: ExternalComponentDeps) {
	return deps.verifier ?? createWebCryptoIntegrityVerifier();
}

/**
 * Fetch + admit one exact reference.
 *
 * Shared by insert and recovery because they differ only in the command they
 * then dispatch — a second copy would be two places to get digest handling
 * wrong.
 */
async function fetchAndAdmit(
	ref: CanvasExternalComponentRef,
	deps: ExternalComponentDeps,
): Promise<
	| {
			readonly ok: true;
			readonly candidate: Awaited<ReturnType<typeof admitExternalSnapshot>>;
	  }
	| ({ readonly ok: false } & ExternalComponentFailure)
> {
	const controller = new AbortController();
	const signal = deps.signal ?? controller.signal;

	let envelope: unknown;
	try {
		envelope = await deps.provider.getEnvelope(ref, { signal });
	} catch (error) {
		if (isAbortRejection(error)) return { ok: false, reason: "aborted" };
		const status = classifyProviderError(error);
		return {
			ok: false,
			reason: "provider",
			messageKey: providerStatusMessageKey(status),
			code: status,
		};
	}

	if (envelope === null || envelope === undefined) {
		// A catalog answer, not a transport failure: this version is gone. Retry
		// cannot help, so it gets its own message rather than "try again".
		return {
			ok: false,
			reason: "version-unavailable",
			messageKey: "canvas.libraries.error.versionUnavailable",
		};
	}

	const result = await admitExternalSnapshot(envelope, {
		verifier: verifierOf(deps),
		...(deps.now ? { fetchedAt: deps.now() } : {}),
	});
	if (!result.ok) {
		return {
			ok: false,
			reason: "admission",
			messageKey: "canvas.libraries.error.admission",
			code: result.diagnostic.code,
		};
	}
	return { ok: true, candidate: result };
}

/**
 * Insert one catalog component: fetch its envelope, verify it, and commit the
 * snapshot plus the instance as a single Undo entry.
 */
export async function insertExternalComponent(
	entry: CanvasComponentCatalogEntry,
	deps: ExternalComponentDeps,
	placement: { readonly parentId?: string; readonly index?: number } = {},
): Promise<InsertExternalComponentResult> {
	if (deps.ctx.externalComponentsEnabled !== true) {
		// Checked FIRST, before any network call: a disabled capability should
		// not produce provider traffic (T-022 step 1).
		return {
			ok: false,
			reason: "capability-denied",
			messageKey: "canvas.libraries.error.disabled",
		};
	}

	const admitted = await fetchAndAdmit(entry.ref, deps);
	if (!admitted.ok) return admitted;
	if (!admitted.candidate.ok) {
		return {
			ok: false,
			reason: "admission",
			messageKey: "canvas.libraries.error.admission",
		};
	}

	const ir = deps.ctx.getIR();
	const page =
		ir.pages.find((p) => p.id === deps.ctx.activePageId) ?? ir.pages[0];
	if (!page) {
		return {
			ok: false,
			reason: "command",
			messageKey: "canvas.libraries.error.insertFailed",
		};
	}
	const bounds = admitted.candidate.snapshot.definition.root.bounds;
	const instanceId = (deps.newId ?? (() => crypto.randomUUID()))();

	// Built as a typed const, not passed as a literal: `AnyCanvasCommand`'s
	// extension arm is `{ readonly type: string }`, and a fresh literal would
	// trip excess-property checking on every field the command actually needs.
	const command: CanvasComponentInsertExternalCommand = {
		type: INSERT_EXTERNAL_COMMAND,
		candidate: admitted.candidate.snapshot,
		source: entry.ref,
		instanceId,
		bounds,
		// Centred on the active page, matching the local insert action so the
		// two feel like one gesture rather than two features.
		transform: {
			x: (page.size.width - bounds.width) / 2,
			y: (page.size.height - bounds.height) / 2,
		},
		parentId: placement.parentId ?? page.root.id,
		...(placement.index !== undefined ? { index: placement.index } : {}),
	};
	try {
		deps.ctx.commit(command);
	} catch (error) {
		return {
			ok: false,
			reason: "command",
			messageKey: "canvas.libraries.error.insertFailed",
			...(error && typeof error === "object" && "code" in error
				? { code: String((error as { code: unknown }).code) }
				: {}),
		};
	}

	deps.ctx.selectionStore.getState().setSelection([instanceId]);
	return { ok: true, instanceId };
}

/**
 * Re-fetch a snapshot the document references but does not store (T-023).
 *
 * Exact-version by construction: it fetches `ref` and passes the same `ref` as
 * `expectedRef`, and Core refuses the command if the two disagree — so a
 * Provider that answered with a different version cannot silently restyle the
 * document.
 */
export async function recoverExternalSnapshot(
	ref: CanvasExternalComponentRef,
	deps: ExternalComponentDeps,
): Promise<
	{ readonly ok: true } | ({ readonly ok: false } & ExternalComponentFailure)
> {
	if (deps.ctx.externalComponentsEnabled !== true) {
		return {
			ok: false,
			reason: "capability-denied",
			messageKey: "canvas.libraries.error.disabled",
		};
	}

	const admitted = await fetchAndAdmit(ref, deps);
	if (!admitted.ok) return admitted;
	if (!admitted.candidate.ok) {
		return {
			ok: false,
			reason: "admission",
			messageKey: "canvas.libraries.error.admission",
		};
	}

	const command: CanvasComponentRecoverSnapshotCommand = {
		type: RECOVER_SNAPSHOT_COMMAND,
		candidate: admitted.candidate.snapshot,
		expectedRef: ref,
	};
	try {
		deps.ctx.commit(command);
	} catch (error) {
		return {
			ok: false,
			reason: "command",
			messageKey: "canvas.libraries.error.recoverFailed",
			...(error && typeof error === "object" && "code" in error
				? { code: String((error as { code: unknown }).code) }
				: {}),
		};
	}
	return { ok: true };
}

/** React binding: the same two operations, with `ctx` and the provider bound. */
export function useExternalComponent(): {
	insert: (
		entry: CanvasComponentCatalogEntry,
		placement?: { parentId?: string; index?: number },
	) => Promise<InsertExternalComponentResult>;
	recover: (
		ref: CanvasExternalComponentRef,
	) => Promise<{ ok: true } | ({ ok: false } & ExternalComponentFailure)>;
	available: boolean;
} {
	const ctx = useCanvasStudio();
	const provider = ctx.componentProvider;
	const available =
		provider !== undefined && ctx.externalComponentsEnabled === true;

	const insert = useCallback(
		async (
			entry: CanvasComponentCatalogEntry,
			placement: { parentId?: string; index?: number } = {},
		) => {
			if (!provider) {
				return {
					ok: false as const,
					reason: "capability-denied" as const,
					messageKey: "canvas.libraries.error.disabled",
				};
			}
			return insertExternalComponent(entry, { ctx, provider }, placement);
		},
		[ctx, provider],
	);

	const recover = useCallback(
		async (ref: CanvasExternalComponentRef) => {
			if (!provider) {
				return {
					ok: false as const,
					reason: "capability-denied" as const,
					messageKey: "canvas.libraries.error.disabled",
				};
			}
			return recoverExternalSnapshot(ref, { ctx, provider });
		},
		[ctx, provider],
	);

	return { insert, recover, available };
}
