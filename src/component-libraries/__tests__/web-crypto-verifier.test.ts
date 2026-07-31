import { createHash, webcrypto } from "node:crypto";
import {
	admitExternalSnapshot,
	CANVAS_CANONICAL_FORMAT_VERSION,
	canonicalizeComponentPayload,
} from "@anvilkit/canvas-core/component-libraries";
import { describe, expect, it } from "vitest";

import {
	createWebCryptoIntegrityVerifier,
	sha256Base64Url,
} from "../web-crypto-verifier.js";

/**
 * T-007 — the default Web Crypto verifier.
 *
 * The "host contract" half of T-007 is that this adapter produces the **same
 * digest as a Node reference implementation** for the same bytes. That is asserted
 * here against `node:crypto`'s `createHash`, which is an entirely independent
 * SHA-256 implementation from the Web Crypto one the adapter drives — so agreement
 * between them is real evidence, not a tautology.
 */

/** Independent Node reference digest. */
function referenceDigest(bytes: Uint8Array): string {
	return createHash("sha256")
		.update(bytes)
		.digest("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

const subtle = webcrypto.subtle as unknown as SubtleCrypto;

describe("sha256Base64Url", () => {
	it('matches the NIST known-answer vector for "abc"', () => {
		// SHA-256("abc") = ba7816bf...15ad — the canonical FIPS 180-4 example.
		const expectedHex =
			"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
		const expected = Buffer.from(expectedHex, "hex")
			.toString("base64")
			.replace(/\+/g, "-")
			.replace(/\//g, "_")
			.replace(/=+$/, "");
		return expect(
			sha256Base64Url(new TextEncoder().encode("abc"), subtle),
		).resolves.toBe(expected);
	});

	it("matches the documented empty-input vector", async () => {
		await expect(sha256Base64Url(new Uint8Array(), subtle)).resolves.toBe(
			"47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU",
		);
	});

	it("agrees with the Node reference across many payloads (HCT)", async () => {
		const payloads: Uint8Array[] = [
			new Uint8Array(),
			new Uint8Array([0]),
			new Uint8Array([255, 254, 253]),
			new TextEncoder().encode("the quick brown fox"),
			new TextEncoder().encode("日本語とemoji🎨"),
			new Uint8Array(1024).fill(7),
			// Exercises the chunked base64 path.
			new Uint8Array(70_000).fill(42),
		];
		for (const payload of payloads) {
			await expect(sha256Base64Url(payload, subtle)).resolves.toBe(
				referenceDigest(payload),
			);
		}
	});

	it("hashes only the VIEW, not the whole backing buffer", async () => {
		// A Uint8Array over a larger/pooled ArrayBuffer is what Node's Buffer and
		// several transports hand you. Hashing the backing store instead of the view
		// would produce a digest that silently depends on unrelated memory.
		const backing = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
		const view = backing.subarray(2, 5); // [3, 4, 5]
		expect(view.byteLength).toBe(3);
		expect(view.buffer.byteLength).toBe(8);
		await expect(sha256Base64Url(view, subtle)).resolves.toBe(
			referenceDigest(new Uint8Array([3, 4, 5])),
		);
	});

	it("emits base64url, never standard base64", async () => {
		// Find a payload whose standard base64 contains + or /, and assert the
		// adapter translated both and dropped padding.
		let found = false;
		for (let seed = 0; seed < 200 && !found; seed += 1) {
			const bytes = new Uint8Array([seed, seed + 1, seed + 2, seed + 3]);
			const standard = createHash("sha256").update(bytes).digest("base64");
			if (!/[+/]/.test(standard)) continue;
			found = true;
			const actual = await sha256Base64Url(bytes, subtle);
			expect(actual).not.toMatch(/[+/=]/);
			expect(actual).toBe(referenceDigest(bytes));
		}
		expect(found).toBe(true);
	});
});

describe("createWebCryptoIntegrityVerifier", () => {
	const verifier = createWebCryptoIntegrityVerifier(subtle);
	const bytes = new TextEncoder().encode('{"a":1}');

	it("resolves true for a matching digest", async () => {
		await expect(
			verifier.verify({
				algorithm: "sha256",
				canonicalBytes: bytes,
				expectedDigest: referenceDigest(bytes),
			}),
		).resolves.toBe(true);
	});

	it("accepts a padded expected digest", async () => {
		await expect(
			verifier.verify({
				algorithm: "sha256",
				canonicalBytes: bytes,
				expectedDigest: `${referenceDigest(bytes)}=`,
			}),
		).resolves.toBe(true);
	});

	it("RESOLVES FALSE for a mismatch — it does not reject", async () => {
		// The split that lets admission distinguish "not authentic" from
		// "could not check".
		await expect(
			verifier.verify({
				algorithm: "sha256",
				canonicalBytes: bytes,
				expectedDigest: referenceDigest(new TextEncoder().encode('{"a":2}')),
			}),
		).resolves.toBe(false);
	});

	it("resolves false for a wrong-length digest instead of throwing", async () => {
		await expect(
			verifier.verify({
				algorithm: "sha256",
				canonicalBytes: bytes,
				expectedDigest: "AAAA",
			}),
		).resolves.toBe(false);
	});

	it("REJECTS when crypto.subtle is unavailable — 'could not check'", async () => {
		const unavailable = createWebCryptoIntegrityVerifier(
			undefined as unknown as SubtleCrypto,
		);
		const originalCrypto = globalThis.crypto;
		try {
			Object.defineProperty(globalThis, "crypto", {
				value: undefined,
				configurable: true,
			});
			await expect(
				unavailable.verify({
					algorithm: "sha256",
					canonicalBytes: bytes,
					expectedDigest: referenceDigest(bytes),
				}),
			).rejects.toThrow(/crypto\.subtle is unavailable/);
		} finally {
			Object.defineProperty(globalThis, "crypto", {
				value: originalCrypto,
				configurable: true,
			});
		}
	});

	it("rejects an algorithm it does not implement rather than hashing with the wrong one", async () => {
		await expect(
			verifier.verify({
				algorithm: "sha512" as unknown as "sha256",
				canonicalBytes: bytes,
				expectedDigest: referenceDigest(bytes),
			}),
		).rejects.toThrow(/unsupported algorithm/);
	});
});

describe("host contract: the Editor verifier drives Core's admission (HCT)", () => {
	/**
	 * The real end-to-end shape T-007 and T-008 exist to make work: Core owns
	 * canonicalization and the pipeline, the Editor supplies the async digest, and
	 * neither knows the other's internals. If the two ever disagree about bytes or
	 * digest encoding, this is what fails.
	 */
	const verifier = createWebCryptoIntegrityVerifier(subtle);

	// A real component definition: plan 0021 T-014 gave the Provider envelope the
	// actual definition schema (over the IR node union), so a stub no longer parses.
	const definition = {
		id: "button-primary",
		name: "Primary Button",
		revision: 1,
		root: {
			id: "button-root",
			type: "rect" as const,
			transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
			bounds: { width: 120, height: 40 },
			zIndex: 0,
			fill: "#2563eb",
		},
		properties: [],
	};

	async function buildAuthenticEnvelope() {
		const ref = {
			kind: "library" as const,
			libraryId: "acme-brand",
			componentId: "button-primary",
			version: "1.4.2",
			integrity: "sha256-placeholder",
		};
		const subject = {
			canonicalFormatVersion: CANVAS_CANONICAL_FORMAT_VERSION,
			libraryId: ref.libraryId,
			componentId: ref.componentId,
			version: ref.version,
			definition,
			dependencies: [] as unknown[],
		};
		// Core computes the preimage; the Editor hashes it. That is the whole seam.
		const digest = await sha256Base64Url(
			canonicalizeComponentPayload(subject),
			subtle,
		);
		return {
			ref: { ...ref, integrity: `sha256-${digest}` },
			canonicalFormatVersion: CANVAS_CANONICAL_FORMAT_VERSION,
			definition,
			dependencies: [] as unknown[],
		};
	}

	it("admits a genuinely authentic envelope", async () => {
		const envelope = await buildAuthenticEnvelope();
		const result = await admitExternalSnapshot(envelope, { verifier });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.key).toBe(
				`acme-brand/button-primary/1.4.2/${envelope.ref.integrity}`,
			);
		}
	});

	it("refuses a tampered definition even though the ref is unchanged", async () => {
		const envelope = await buildAuthenticEnvelope();
		const tampered = {
			...envelope,
			definition: { ...definition, name: "Injected Button" },
		};
		const result = await admitExternalSnapshot(tampered, { verifier });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.diagnostic.code).toBe("component-integrity-mismatch");
		}
	});

	it("refuses the same bytes relabelled under another library", async () => {
		const envelope = await buildAuthenticEnvelope();
		const relabelled = {
			...envelope,
			ref: { ...envelope.ref, libraryId: "evil-lib" },
		};
		const result = await admitExternalSnapshot(relabelled, { verifier });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.diagnostic.code).toBe("component-integrity-mismatch");
		}
	});
});
