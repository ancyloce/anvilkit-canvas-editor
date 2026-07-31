import type {
	CanvasComponentDefinition,
	CanvasExternalComponentSnapshot,
	CanvasIR,
} from "@anvilkit/canvas-core";
import {
	createCanvasIR,
	createComponentInstance,
	createGroup,
	createPage,
	createRect,
} from "@anvilkit/canvas-core";
import {
	admitExternalSnapshot,
	buildExternalSnapshotIndex,
	getDefinition,
	snapshotKey,
} from "@anvilkit/canvas-core/component-libraries";
import { describe, expect, it, vi } from "vitest";
import {
	resolveVerificationMode,
	verifyDocumentSnapshots,
} from "../load-verification.js";
import {
	createWebCryptoIntegrityVerifier,
	sha256Base64Url,
} from "../web-crypto-verifier.js";

/**
 * T-045 — the load pipeline's integrity half.
 *
 * The claim that matters most is negative: a bad snapshot must NOT take the
 * document down, and must not quietly look like a benign cache miss either.
 */

const DEFINITION = {
	id: "card",
	name: "Card",
	revision: 1,
	root: createGroup({
		id: "card-root",
		children: [
			createRect({ id: "card-inner", bounds: { width: 4, height: 4 } }),
		],
	}),
	properties: [],
} as unknown as CanvasComponentDefinition;

const REF = {
	kind: "library" as const,
	libraryId: "acme",
	componentId: "card",
	version: "1.0.0",
};

/** Build a genuinely-admitted snapshot, so its digest is real. */
async function admitted(): Promise<CanvasExternalComponentSnapshot> {
	const verifier = createWebCryptoIntegrityVerifier();
	// Admission computes the digest; we hand it back the digest it computes by
	// first admitting with a placeholder and reading the canonical bytes.
	const envelope = {
		canonicalFormatVersion: 1,
		// A syntactically valid 43-char sha256 digest that is not the real one:
		// admission validates digest LENGTH before it verifies, so a short
		// placeholder is rejected before the canonical bytes are ever produced.
		ref: { ...REF, integrity: `sha256-${"A".repeat(43)}` },
		definition: DEFINITION,
		dependencies: [],
	};
	const probe = await admitExternalSnapshot(envelope, {
		verifier: { verify: async () => true },
	});
	if (!probe.ok)
		throw new Error(`probe admission failed: ${probe.diagnostic.code}`);
	const digest = await sha256Base64Url(probe.canonicalBytes);
	const real = await admitExternalSnapshot(
		{ ...envelope, ref: { ...REF, integrity: `sha256-${digest}` } },
		{ verifier },
	);
	if (!real.ok) throw new Error(`admission failed: ${real.diagnostic.code}`);
	return real.snapshot as unknown as CanvasExternalComponentSnapshot;
}

function docWith(snapshot: CanvasExternalComponentSnapshot): CanvasIR {
	const instance = createComponentInstance({
		id: "inst-1",
		componentId: "card",
		bounds: { width: 10, height: 10 },
	});
	const withSource = {
		...instance,
		source: { kind: "library" as const, ...snapshot.ref },
	};
	return {
		...createCanvasIR({
			id: "doc",
			pages: [
				createPage({
					id: "p1",
					root: createGroup({ id: "p1-root", children: [withSource] }),
				}),
			],
		}),
		externalComponentSnapshots: { [snapshotKey(snapshot.ref)]: snapshot },
	} as CanvasIR;
}

describe("resolveVerificationMode (TD §21.1 proportionality)", () => {
	it("defaults to OFF for a host-persisted document", () => {
		expect(resolveVerificationMode({ origin: "host-persisted" })).toBe("none");
		expect(resolveVerificationMode({})).toBe("none");
	});

	it("defaults to ON for an imported file", () => {
		expect(resolveVerificationMode({ origin: "imported" })).toBe("all");
	});

	it("an import CANNOT be opted out, even explicitly", () => {
		// "Trust this file because I said so" is the request that should not have
		// an API. The override exists to verify MORE, never less on this path.
		expect(resolveVerificationMode({ origin: "imported", mode: "none" })).toBe(
			"all",
		);
	});

	it("a host may opt a persisted document IN", () => {
		expect(
			resolveVerificationMode({ origin: "host-persisted", mode: "all" }),
		).toBe("all");
	});
});

describe("verifyDocumentSnapshots", () => {
	it("passes a genuinely-admitted snapshot", async () => {
		const snapshot = await admitted();
		const result = await verifyDocumentSnapshots(docWith(snapshot), {
			verifier: createWebCryptoIntegrityVerifier(),
			origin: "imported",
		});
		expect(result.quarantinedKeys).toEqual([]);
		expect(result.verifiedCount).toBe(1);
	});

	it("catches SAME-VERSION content substitution (§22.1)", async () => {
		// The threat: republish different bytes under the same ref. The digest is
		// over the definition, so swapping content cannot keep the digest.
		const snapshot = await admitted();
		const ir = docWith(snapshot);
		const key = snapshotKey(snapshot.ref);
		const tampered = {
			...ir,
			externalComponentSnapshots: {
				[key]: {
					...snapshot,
					definition: { ...DEFINITION, name: "Not A Card" },
				},
			},
		} as CanvasIR;
		const result = await verifyDocumentSnapshots(tampered, {
			verifier: createWebCryptoIntegrityVerifier(),
			origin: "imported",
		});
		expect(result.quarantinedKeys).toEqual([key]);
		expect(result.diagnostics[0]?.code).toBe("component-integrity-mismatch");
	});

	it("catches a snapshot filed under the wrong key", async () => {
		const snapshot = await admitted();
		const result = await verifyDocumentSnapshots(
			{
				...docWith(snapshot),
				externalComponentSnapshots: { "not/the/right/key": snapshot },
			} as CanvasIR,
			{ verifier: createWebCryptoIntegrityVerifier(), origin: "imported" },
		);
		expect(result.quarantinedKeys).toEqual(["not/the/right/key"]);
	});

	it("treats a THROWING verifier as failure, not as an absent check", async () => {
		// Falling through to "verified" on an exception is how an integrity gate
		// silently becomes a no-op in production.
		const snapshot = await admitted();
		const result = await verifyDocumentSnapshots(docWith(snapshot), {
			verifier: {
				verify: () => Promise.reject(new Error("HSM unavailable")),
			},
			origin: "imported",
		});
		expect(result.quarantinedKeys).toHaveLength(1);
	});

	it("does nothing without a verifier", async () => {
		const snapshot = await admitted();
		const result = await verifyDocumentSnapshots(docWith(snapshot), {
			origin: "imported",
		});
		expect(result).toEqual({
			quarantinedKeys: [],
			diagnostics: [],
			verifiedCount: 0,
		});
	});

	it("does not hash anything for a host-persisted document", async () => {
		const verify = vi.fn(() => Promise.resolve(true));
		const snapshot = await admitted();
		const result = await verifyDocumentSnapshots(docWith(snapshot), {
			verifier: { verify },
			origin: "host-persisted",
		});
		expect(verify).not.toHaveBeenCalled();
		expect(result.verifiedCount).toBe(0);
	});

	it("is deterministic in diagnostic order", async () => {
		const snapshot = await admitted();
		const bad = { ...snapshot, definition: { ...DEFINITION, name: "x" } };
		const ir = {
			...docWith(snapshot),
			externalComponentSnapshots: { "z/z/z/z": bad, "a/a/a/a": bad },
		} as CanvasIR;
		const a = await verifyDocumentSnapshots(ir, {
			verifier: createWebCryptoIntegrityVerifier(),
			origin: "imported",
		});
		expect(a.quarantinedKeys).toEqual(["a/a/a/a", "z/z/z/z"]);
	});
});

describe("quarantine changes what the RESOLVER sees (T-045 step 3)", () => {
	it("a quarantined snapshot resolves to integrity-failed, not snapshot-missing", async () => {
		const snapshot = await admitted();
		const key = snapshotKey(snapshot.ref);
		const source = { kind: "library" as const, ...snapshot.ref };

		const clean = buildExternalSnapshotIndex({ [key]: snapshot });
		expect(getDefinition(source, {}, clean).kind).toBe("external");

		const quarantined = buildExternalSnapshotIndex(
			{ [key]: snapshot },
			{ quarantinedKeys: [key] },
		);
		const lookup = getDefinition(source, {}, quarantined);
		expect(lookup.kind).toBe("unresolved");
		// The distinction that matters: "the bytes are wrong" must not present as
		// "we never fetched it", or the UI offers re-fetch and normalises tampering.
		expect(lookup.kind === "unresolved" && lookup.reason).toBe(
			"integrity-failed",
		);
	});

	it("an absent snapshot still reports snapshot-missing", async () => {
		const snapshot = await admitted();
		const source = { kind: "library" as const, ...snapshot.ref };
		const lookup = getDefinition(source, {}, buildExternalSnapshotIndex({}));
		expect(lookup.kind === "unresolved" && lookup.reason).toBe(
			"snapshot-missing",
		);
	});

	it("quarantining does NOT delete the snapshot from the document", async () => {
		// The exact ref is what the Libraries panel needs to re-fetch the right
		// version; deleting it makes the damage unrecoverable.
		const snapshot = await admitted();
		const key = snapshotKey(snapshot.ref);
		const ir = docWith(snapshot);
		await verifyDocumentSnapshots(ir, {
			verifier: createWebCryptoIntegrityVerifier(),
			origin: "imported",
		});
		expect(ir.externalComponentSnapshots?.[key]).toBeDefined();
	});
});
