import type {
	CanvasExternalComponentSnapshot,
	CanvasIR,
} from "@anvilkit/canvas-core";
import type {
	CanvasComponentDiagnostic,
	CanvasIntegrityVerifier,
} from "@anvilkit/canvas-core/component-libraries";
import {
	canonicalizeComponentPayload,
	componentDiagnostic,
	parseIntegrity,
	snapshotKey,
} from "@anvilkit/canvas-core/component-libraries";

/**
 * @file Load-time snapshot re-verification (plan 0021 T-045, TD 0016 §21.1).
 *
 * ## The proportionality rule, and why it is a default rather than a policy
 *
 * TD §21.1: "Cryptographic re-verification on every load may be configurable for
 * performance, but a snapshot must be verified at insertion/import... Untrusted
 * imported files should reverify all snapshots."
 *
 * So the default is **off for host-persisted documents** and **on for imported
 * files**, and {@link resolveVerificationMode} is the one place that decides.
 * The asymmetry is not laziness: a host-persisted document already passed
 * verification at insertion and has since been under the host's own integrity
 * controls, while an imported file arrived from somewhere with none. Verifying
 * every snapshot on every open of a 200-component document costs real time on
 * the critical path for a threat the host has already mitigated.
 *
 * A host that disagrees passes `mode: "all"` explicitly. What a host CANNOT do
 * is turn verification off for an import — {@link resolveVerificationMode}
 * accepts no such combination, because "trust this file because I said so" is
 * exactly the request that should not have an API.
 *
 * ## Quarantine, never delete
 *
 * A failed snapshot stays in the document and is added to the quarantine set.
 * Deleting it would destroy the exact ref the user needs in order to re-fetch
 * the right version, and would silently shrink a document that the user never
 * asked to edit. The instance renders as a placeholder, is not editable, and
 * blocks export until the exact version is restored or the instance removed.
 */

/**
 * Where a document came from — the only input the default policy needs.
 *
 * `host-persisted` covers a persistence adapter's `load`, a recovery snapshot,
 * and a collaborating peer: all three are inside the host's trust boundary.
 * `imported` covers a user-supplied file.
 */
export type CanvasDocumentOrigin = "host-persisted" | "imported";

/** What to re-verify. `none` is only reachable for host-persisted documents. */
export type CanvasVerificationMode = "none" | "all";

export interface LoadVerificationOptions {
	/** Host-supplied verifier. Omitting it disables verification entirely. */
	readonly verifier?: CanvasIntegrityVerifier;
	readonly origin?: CanvasDocumentOrigin;
	/** Explicit override. `"none"` is IGNORED for an imported document. */
	readonly mode?: CanvasVerificationMode;
}

/**
 * The mode that will actually run.
 *
 * An import always verifies. That is deliberate and is asserted by a test: the
 * override exists to let a host verify MORE than the default, never less on the
 * one path where the bytes are untrusted.
 */
export function resolveVerificationMode(
	options: LoadVerificationOptions,
): CanvasVerificationMode {
	if (options.origin === "imported") return "all";
	return options.mode ?? "none";
}

export interface LoadVerificationResult {
	/** Snapshot keys that must not resolve. Empty when everything verified. */
	readonly quarantinedKeys: readonly string[];
	/** One diagnostic per quarantined snapshot, in key order. */
	readonly diagnostics: readonly CanvasComponentDiagnostic[];
	/** How many snapshots were actually hashed — 0 when the mode is `none`. */
	readonly verifiedCount: number;
}

const CLEAN: LoadVerificationResult = {
	quarantinedKeys: [],
	diagnostics: [],
	verifiedCount: 0,
};

/**
 * The canonical subject, mirrored from core's `admission.ts`.
 *
 * Mirrored rather than imported because core keeps `canonicalSubject` private:
 * it is admission's internal notion of what gets hashed, not a public contract.
 * `load-verification.test.ts` pins the agreement by round-tripping a snapshot
 * that `admitExternalSnapshot` produced — so a drift between the two shows up
 * as a failing test rather than as every document suddenly failing to verify.
 */
function canonicalSubject(snapshot: CanvasExternalComponentSnapshot): unknown {
	return {
		canonicalFormatVersion: snapshot.canonicalFormatVersion,
		libraryId: snapshot.ref.libraryId,
		componentId: snapshot.ref.componentId,
		version: snapshot.ref.version,
		definition: snapshot.definition,
		dependencies: snapshot.dependencies,
	};
}

/**
 * Re-verify a loaded document's snapshot registry.
 *
 * Never throws and never rejects: a load must always mount (T-045 step 3), so
 * every failure mode — a malformed integrity string, an unkeyable ref, a
 * verifier that itself throws — resolves to a quarantine entry plus a
 * diagnostic rather than taking the document down.
 */
export async function verifyDocumentSnapshots(
	ir: CanvasIR,
	options: LoadVerificationOptions = {},
): Promise<LoadVerificationResult> {
	const mode = resolveVerificationMode(options);
	const verifier = options.verifier;
	if (mode === "none" || !verifier) return CLEAN;

	const registry = ir.externalComponentSnapshots;
	if (!registry) return CLEAN;
	// Own enumerable properties only — an inherited key is not document content.
	const entries = Object.entries(registry);
	if (entries.length === 0) return CLEAN;

	const quarantinedKeys: string[] = [];
	const diagnostics: CanvasComponentDiagnostic[] = [];
	let verifiedCount = 0;

	// Sorted so the diagnostic list is deterministic across runs regardless of
	// object insertion order — the same reason the compliance report sorts.
	for (const [storedKey, snapshot] of entries.sort(([a], [b]) =>
		a < b ? -1 : a > b ? 1 : 0,
	)) {
		const quarantine = (message: string): void => {
			quarantinedKeys.push(storedKey);
			diagnostics.push(
				componentDiagnostic("component-integrity-mismatch", message),
			);
		};

		// The key a document was saved under must still be the key its ref
		// derives to. A mismatch means the registry was edited by hand or by a
		// tool that did not understand the key codec, and the stored bytes can no
		// longer be addressed by the ref that names them.
		let derivedKey: string;
		try {
			derivedKey = snapshotKey(snapshot.ref);
		} catch {
			quarantine(
				`Snapshot stored under "${storedKey}" has a malformed reference and cannot be keyed.`,
			);
			continue;
		}
		if (derivedKey !== storedKey) {
			quarantine(
				`Snapshot stored under "${storedKey}" declares a reference that keys to "${derivedKey}".`,
			);
			continue;
		}

		const parsed = parseIntegrity(snapshot.ref.integrity);
		if (!parsed.ok) {
			quarantine(`Snapshot "${storedKey}" has an unparseable integrity value.`);
			continue;
		}

		let ok: boolean;
		try {
			verifiedCount += 1;
			ok = await verifier.verify({
				algorithm: parsed.value.algorithm,
				canonicalBytes: canonicalizeComponentPayload(
					canonicalSubject(snapshot),
				),
				expectedDigest: parsed.value.digest,
			});
		} catch {
			// A verifier that throws is treated as a failure, not as an absent
			// check. Falling through to "verified" on an exception is how an
			// integrity gate silently becomes a no-op in production.
			ok = false;
		}
		if (!ok) {
			quarantine(
				`Snapshot "${storedKey}" does not match its recorded integrity digest.`,
			);
		}
	}

	return { quarantinedKeys, diagnostics, verifiedCount };
}
