import { createHash } from "node:crypto";
import type {
	CanvasExternalComponentRef,
	CanvasIR,
} from "@anvilkit/canvas-core";
import { createCanvasRuntime } from "@anvilkit/canvas-core";
import {
	canonicalizeComponentPayload,
	createExternalInsertCommandHandlers,
	createSnapshotRecoveryCommandHandlers,
} from "@anvilkit/canvas-core/component-libraries";
import { describe, expect, it, vi } from "vitest";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";

import type {
	CanvasComponentCatalogEntry,
	CanvasComponentProvider,
} from "../component-provider.js";
import {
	insertExternalComponent,
	recoverExternalSnapshot,
} from "../use-external-component.js";

/**
 * T-022 / T-023 editor half — fetch → admit → command as one action.
 *
 * The acceptance criterion is "a failed insert produces no partial state", so
 * every failure case asserts the document is byte-identical afterwards, not
 * merely that an error was returned.
 */

function base64url(buf: Buffer): string {
	return buf
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

/** A real SHA-256 verifier over Node crypto — no mocking of the digest path. */
const verifier = {
	verify({
		canonicalBytes,
		expectedDigest,
	}: {
		canonicalBytes: Uint8Array;
		expectedDigest: string;
	}) {
		const actual = base64url(
			createHash("sha256").update(Buffer.from(canonicalBytes)).digest(),
		);
		return Promise.resolve(actual === expectedDigest);
	},
};

function definitionOf(componentId: string, name = componentId) {
	return {
		id: componentId,
		name,
		revision: 1,
		root: {
			id: `${componentId}-root`,
			type: "rect",
			transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
			bounds: { width: 120, height: 40 },
			zIndex: 0,
			fill: "#2563eb",
		},
		properties: [],
	};
}

/** Build an envelope whose declared integrity is the CORRECT digest. */
function authenticEnvelope(componentId: string, name?: string) {
	const definition = definitionOf(componentId, name);
	const draft = {
		kind: "library" as const,
		libraryId: "acme",
		componentId,
		version: "1.4.2",
		integrity: "sha256-placeholder",
	};
	const digest = base64url(
		createHash("sha256")
			.update(
				Buffer.from(
					canonicalizeComponentPayload({
						canonicalFormatVersion: 1,
						libraryId: draft.libraryId,
						componentId: draft.componentId,
						version: draft.version,
						definition,
						dependencies: [],
					}),
				),
			)
			.digest(),
	);
	const ref: CanvasExternalComponentRef = {
		...draft,
		integrity: `sha256-${digest}`,
	};
	return {
		ref,
		envelope: { ref, canonicalFormatVersion: 1, definition, dependencies: [] },
		entry: { ref, name: name ?? componentId } as CanvasComponentCatalogEntry,
	};
}

function providerReturning(envelope: unknown): CanvasComponentProvider {
	return {
		search: () => Promise.resolve({ entries: [] }),
		getEnvelope: () => Promise.resolve(envelope as never),
	};
}

function harnessCtx(options: { enabled?: boolean } = {}) {
	const h = makeHarness({});
	const runtime = createCanvasRuntime([
		{
			id: "plan-0021",
			commands: [
				...createExternalInsertCommandHandlers(),
				...createSnapshotRecoveryCommandHandlers(),
			],
		},
	]);
	let ir: CanvasIR = h.studioCtx.getIR();
	const ctx = {
		...h.studioCtx,
		externalComponentsEnabled: options.enabled ?? true,
		getIR: () => ir,
		commit: (cmd: { type: string }) => {
			// Real dispatch through the real runtime — the point is that the
			// command actually applies, not that a spy was called.
			ir = runtime.apply(ir, cmd as never, { now: () => "t0" }).ir;
			return ir;
		},
	} as unknown as Parameters<typeof insertExternalComponent>[1]["ctx"];
	return { ctx, getIr: () => ir };
}

describe("insertExternalComponent — success", () => {
	it("stores the snapshot and the instance in one commit", async () => {
		const { ctx, getIr } = harnessCtx();
		const { entry, envelope } = authenticEnvelope("button");

		const result = await insertExternalComponent(entry, {
			ctx,
			provider: providerReturning(envelope),
			verifier,
			newId: () => "inst-1",
		});

		expect(result.ok).toBe(true);
		const ir = getIr();
		expect(Object.keys(ir.externalComponentSnapshots ?? {})).toHaveLength(1);
	});

	it("drives the REAL digest path — a tampered envelope is refused", async () => {
		const { ctx, getIr } = harnessCtx();
		const before = structuredClone(getIr());
		const { entry, envelope } = authenticEnvelope("button");
		// Same declared integrity, different bytes.
		const tampered = {
			...envelope,
			definition: definitionOf("button", "Evil"),
		};

		const result = await insertExternalComponent(entry, {
			ctx,
			provider: providerReturning(tampered),
			verifier,
			newId: () => "inst-1",
		});

		expect(result.ok).toBe(false);
		expect(result.ok === false && result.reason).toBe("admission");
		expect(getIr()).toEqual(before);
	});
});

describe("insertExternalComponent — every failure leaves the document untouched", () => {
	it("refuses when the capability is disabled, WITHOUT calling the provider", async () => {
		const { ctx, getIr } = harnessCtx({ enabled: false });
		const before = structuredClone(getIr());
		const getEnvelope = vi.fn();
		const { entry } = authenticEnvelope("button");

		const result = await insertExternalComponent(entry, {
			ctx,
			provider: {
				search: () => Promise.resolve({ entries: [] }),
				getEnvelope,
			} as unknown as CanvasComponentProvider,
			verifier,
		});

		expect(result.ok === false && result.reason).toBe("capability-denied");
		// A disabled capability must not produce provider traffic.
		expect(getEnvelope).not.toHaveBeenCalled();
		expect(getIr()).toEqual(before);
	});

	it("reports a withdrawn version distinctly from a transport failure", async () => {
		const { ctx, getIr } = harnessCtx();
		const before = structuredClone(getIr());
		const { entry } = authenticEnvelope("button");

		const result = await insertExternalComponent(entry, {
			ctx,
			provider: providerReturning(null),
			verifier,
		});

		// Retry cannot help here, so it must not be reported as "try again".
		expect(result.ok === false && result.reason).toBe("version-unavailable");
		expect(getIr()).toEqual(before);
	});

	it("maps a provider failure onto a presentation state", async () => {
		const { ctx, getIr } = harnessCtx();
		const before = structuredClone(getIr());
		const { entry } = authenticEnvelope("button");

		const result = await insertExternalComponent(entry, {
			ctx,
			provider: {
				search: () => Promise.resolve({ entries: [] }),
				getEnvelope: () => Promise.reject({ status: 401 }),
			} as unknown as CanvasComponentProvider,
			verifier,
		});

		expect(result.ok === false && result.reason).toBe("provider");
		expect(result.ok === false && result.code).toBe("unauthorized");
		expect(getIr()).toEqual(before);
	});

	it("treats an abort as its own outcome, not an error to render", async () => {
		const { ctx } = harnessCtx();
		const { entry } = authenticEnvelope("button");
		const abort = new Error("aborted");
		abort.name = "AbortError";

		const result = await insertExternalComponent(entry, {
			ctx,
			provider: {
				search: () => Promise.resolve({ entries: [] }),
				getEnvelope: () => Promise.reject(abort),
			} as unknown as CanvasComponentProvider,
			verifier,
		});

		expect(result.ok === false && result.reason).toBe("aborted");
		// No messageKey: there is nothing to tell the user.
		expect("messageKey" in result).toBe(false);
	});

	it("never surfaces a raw error body", async () => {
		const { ctx } = harnessCtx();
		const { entry } = authenticEnvelope("button");

		const result = await insertExternalComponent(entry, {
			ctx,
			provider: {
				search: () => Promise.resolve({ entries: [] }),
				getEnvelope: () =>
					Promise.reject({ status: 401, body: "Bearer sk-live-SECRET" }),
			} as unknown as CanvasComponentProvider,
			verifier,
		});

		expect(JSON.stringify(result)).not.toContain("SECRET");
		expect(JSON.stringify(result)).not.toContain("Bearer");
	});
});

describe("recoverExternalSnapshot (T-023 editor half)", () => {
	it("restores a missing snapshot", async () => {
		const { ctx, getIr } = harnessCtx();
		const { ref, envelope } = authenticEnvelope("button");

		const result = await recoverExternalSnapshot(ref, {
			ctx,
			provider: providerReturning(envelope),
			verifier,
		});

		expect(result.ok).toBe(true);
		expect(Object.keys(getIr().externalComponentSnapshots ?? {})).toHaveLength(
			1,
		);
	});

	it("REFUSES a Provider that answers with a different version", async () => {
		// The failure recovery exists to prevent: a silent restyle to whatever
		// version happened to be available. Core rejects it; this asserts the
		// editor surfaces that rather than swallowing it.
		const { ctx, getIr } = harnessCtx();
		const before = structuredClone(getIr());
		const wanted = authenticEnvelope("button").ref;
		const other = authenticEnvelope("button", "Different");

		const result = await recoverExternalSnapshot(wanted, {
			ctx,
			provider: providerReturning(other.envelope),
			verifier,
		});

		expect(result.ok).toBe(false);
		expect(result.ok === false && result.reason).toBe("command");
		expect(getIr()).toEqual(before);
	});

	it("is refused when the capability is disabled", async () => {
		const { ctx } = harnessCtx({ enabled: false });
		const { ref, envelope } = authenticEnvelope("button");
		const result = await recoverExternalSnapshot(ref, {
			ctx,
			provider: providerReturning(envelope),
			verifier,
		});
		expect(result.ok === false && result.reason).toBe("capability-denied");
	});
});
