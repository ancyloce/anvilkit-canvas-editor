import type { CanvasIntegrityVerifier } from "@anvilkit/canvas-core/component-libraries";

/**
 * The default Web Crypto integrity verifier (plan 0021 T-007, TD 0016 §6.3).
 *
 * # Why this lives in the Editor and not in Core
 *
 * `crypto.subtle.digest` is **async**, and `@anvilkit/canvas-core` applies commands
 * **synchronously** end to end, so Core cannot compute a digest inside a command
 * even if it wanted to. Core therefore owns canonicalization and declares the
 * `CanvasIntegrityVerifier` port; the runtime-specific implementation sits here, on
 * the side of the boundary that already has a DOM and an event loop to wait on.
 *
 * T-007's DoD is literally "Core contains no direct `crypto.subtle` call" — this
 * file is why that holds. A host with different requirements (Node crypto, an
 * approved HSM, a FIPS module) supplies its own implementation of the same port
 * without touching Core.
 */

const SUBTLE_ALGORITHM = "SHA-256" as const;

/** Base64url-encode bytes: standard base64, then `+/` → `-_`, padding stripped. */
function toBase64Url(bytes: Uint8Array): string {
	let binary = "";
	// Chunked to stay clear of the argument-count limit on very large inputs;
	// a SHA-256 digest is 32 bytes, but this helper is also used on canonical
	// bytes in tests and by hosts.
	const CHUNK = 0x8000;
	for (let index = 0; index < bytes.length; index += CHUNK) {
		binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK));
	}
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

/**
 * SHA-256 the bytes and return the base64url digest.
 *
 * Exported because it is the one piece a host integrating a different transport
 * still needs: computing the digest it will publish alongside a component.
 */
export async function sha256Base64Url(
	bytes: Uint8Array,
	subtle: SubtleCrypto = globalThis.crypto.subtle,
): Promise<string> {
	// `.slice()` hands `digest` a standalone ArrayBuffer: a Uint8Array view over a
	// larger/pooled buffer (which is what Node's Buffer and some transports give
	// you) would otherwise hash the whole backing store, not the view.
	const digest = await subtle.digest(
		SUBTLE_ALGORITHM,
		bytes.slice().buffer as ArrayBuffer,
	);
	return toBase64Url(new Uint8Array(digest));
}

/**
 * Constant-time-ish base64url digest comparison.
 *
 * Mirrors Core's `digestsEqual` deliberately rather than importing it, because the
 * two must agree about padding normalization and duplicating four lines is cheaper
 * than a cross-package coupling for a string compare. Neither operand is secret
 * (the expected digest is stored in the document and shipped by the Provider), so
 * timing is not an actual concern here — the form is used so that "compare digests
 * with ===" does not become the local idiom and get copied somewhere it matters.
 */
function digestsEqual(a: string, b: string): boolean {
	const left = a.replace(/=+$/, "");
	const right = b.replace(/=+$/, "");
	if (left.length !== right.length) return false;
	let difference = 0;
	for (let index = 0; index < left.length; index += 1) {
		difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
	}
	return difference === 0;
}

/**
 * Create the default verifier over Web Crypto.
 *
 * Resolves `false` for a genuine mismatch and **rejects** only when the digest
 * could not be computed at all (no `crypto.subtle` — e.g. a page served over plain
 * HTTP, where Web Crypto is unavailable outside a secure context). Admission
 * reports those two cases differently: "not authentic" versus "could not check".
 */
export function createWebCryptoIntegrityVerifier(
	subtle?: SubtleCrypto,
): CanvasIntegrityVerifier {
	return {
		async verify({ algorithm, canonicalBytes, expectedDigest }) {
			if (algorithm !== "sha256") {
				// Unreachable through Core, which only ever passes "sha256" — but a
				// host could call the port directly, and silently hashing with the
				// wrong algorithm would be worse than refusing.
				throw new Error(
					`web-crypto-verifier: unsupported algorithm "${algorithm}"; only "sha256" is implemented`,
				);
			}

			const resolved = subtle ?? globalThis.crypto?.subtle;
			if (!resolved) {
				throw new Error(
					"web-crypto-verifier: crypto.subtle is unavailable (Web Crypto requires a secure context — https or localhost)",
				);
			}

			const actual = await sha256Base64Url(canonicalBytes, resolved);
			return digestsEqual(actual, expectedDigest);
		},
	};
}
