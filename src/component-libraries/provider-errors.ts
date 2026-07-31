/**
 * @file Host-error → presentation-state mapping (plan 0021 T-019, TD 0016 §7.4).
 *
 * ## Why a mapping exists at all
 *
 * A Provider is host code talking to a host service. It can fail in ways the
 * editor has no vocabulary for — an HTTP body, a vendor error object, a thrown
 * string. Rendering any of that would be two bugs at once: unreadable to the
 * user, and a disclosure risk, because auth failures are exactly the responses
 * most likely to echo a token back.
 *
 * So a failure becomes one of a closed set of states, each with its own
 * localized message and its own recovery affordance. Nothing from the raw error
 * is ever rendered.
 */

/**
 * The eight presentation states of a provider request.
 *
 * `empty` is deliberately distinct from `ready`: "your search matched nothing"
 * and "here are results" need different UI, and collapsing them makes the panel
 * look broken on a zero-result query. `offline` / `unauthorized` /
 * `rate-limited` are split out of `error` for the same reason — each has a
 * different remedy (retry, re-authenticate, wait), and a single "something went
 * wrong" hides which one applies.
 */
export type CanvasProviderRequestStatus =
	| "idle"
	| "loading"
	| "ready"
	| "empty"
	| "offline"
	| "unauthorized"
	| "rate-limited"
	| "error";

/** A failure state, i.e. everything a successful request cannot produce. */
export type CanvasProviderFailureStatus = Extract<
	CanvasProviderRequestStatus,
	"offline" | "unauthorized" | "rate-limited" | "error"
>;

/** An error carrying an HTTP-ish status, which most host clients surface. */
interface StatusBearing {
	readonly status?: unknown;
	readonly statusCode?: unknown;
	readonly response?: { readonly status?: unknown };
}

function statusOf(error: unknown): number | undefined {
	if (!error || typeof error !== "object") return undefined;
	const candidate = error as StatusBearing;
	for (const value of [
		candidate.status,
		candidate.statusCode,
		candidate.response?.status,
	]) {
		if (typeof value === "number" && Number.isFinite(value)) return value;
	}
	return undefined;
}

function nameOf(error: unknown): string {
	return error instanceof Error ? error.name : "";
}

/**
 * Was this rejection an abort?
 *
 * Callers use it to distinguish "the user moved on" — which must NOT become a
 * visible error — from a real failure. `AbortError` is the name both `fetch`
 * and `createStaticComponentProvider` reject with.
 */
export function isAbortRejection(error: unknown): boolean {
	return nameOf(error) === "AbortError";
}

/**
 * Classify a provider rejection.
 *
 * Deliberately total and deliberately dumb: it reads a status code and an error
 * name, and everything it cannot place becomes `error`. Guessing harder — by
 * pattern-matching message text, say — would make the state depend on a host's
 * wording, which is exactly the coupling this layer exists to remove.
 */
export function classifyProviderError(
	error: unknown,
): CanvasProviderFailureStatus {
	const status = statusOf(error);
	if (status === 401 || status === 403) return "unauthorized";
	if (status === 429) return "rate-limited";
	// 408 Request Timeout and 5xx are transport/service problems the user can
	// retry, which is the same affordance as being offline.
	if (status === 408 || (status !== undefined && status >= 500))
		return "offline";
	if (status !== undefined) return "error";

	const name = nameOf(error);
	if (name === "TimeoutError") return "offline";
	// `fetch` rejects with a bare TypeError for DNS/connection failures — the
	// single most common genuinely-offline signal in a browser.
	if (error instanceof TypeError) return "offline";
	return "error";
}

/**
 * The i18n key for a failure state's user-facing message.
 *
 * Returning a KEY rather than a string is what keeps this module free of
 * locale data and keeps every message in the four catalogs (CON-8).
 */
export function providerStatusMessageKey(
	status: CanvasProviderFailureStatus,
): string {
	switch (status) {
		case "offline":
			return "canvas.libraries.error.offline";
		case "unauthorized":
			return "canvas.libraries.error.unauthorized";
		case "rate-limited":
			return "canvas.libraries.error.rateLimited";
		case "error":
			return "canvas.libraries.error.generic";
	}
}
