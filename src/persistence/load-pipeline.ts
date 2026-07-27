import {
	type CanvasIR,
	type CanvasRuntime,
	migrateCanvasIR,
} from "@anvilkit/canvas-core";

/**
 * @file The editor's single document-load pipeline (plan 0022, T-M0-04).
 *
 * Every path that brings a document in from outside the editor — a host
 * persistence adapter's `load`, a recovery snapshot, a collaborating peer —
 * must run the same steps: parse, forward-migrate, validate. Before this
 * module they did not. `save`/`saveOnUnload` were wired but
 * `CanvasPersistenceAdapter.load` was never called at all, and the recovery
 * controller restored a snapshot with **no** parse and **no** migration,
 * mounting whatever had been written to IndexedDB — including a document
 * written by an older version of the app.
 *
 * Consolidating here is what makes the IR v3 migration (M1) trustworthy: a
 * migrate seam is only as good as the number of entry paths that route
 * through it, and a second implementation elsewhere in the editor would
 * silently opt that path out of every future migration.
 */

export interface LoadCanvasDocumentOptions {
	/**
	 * Runtime whose extension-aware schema validates the result. Omit to use
	 * core's built-in-only path — the same default the collab decoder has
	 * always used. Supplying it is what lets a document containing custom
	 * node kinds validate instead of being rejected by the closed built-in
	 * schema.
	 */
	readonly runtime?: CanvasRuntime;
}

/**
 * Parse (when given a string), forward-migrate, then validate an untrusted
 * document payload.
 *
 * Accepts `unknown` rather than `string` because the sources differ in shape:
 * a persistence adapter's `load` resolves an already-parsed object, while
 * recovery snapshots and collab payloads arrive as JSON text. Normalising
 * here keeps every caller on one code path instead of each deciding when to
 * parse.
 *
 * **Throws** on malformed JSON, an unsupported version, or a
 * structurally-invalid document — migration ends in the same Zod validation
 * the editor has always run, so a corrupt or hostile payload cannot reach the
 * scene. Callers are responsible for catching: a load failure must be
 * reported to the host, never allowed to break the mount, and never allowed
 * to escape a Yjs observer.
 */
export function loadCanvasDocument(
	raw: unknown,
	options: LoadCanvasDocumentOptions = {},
): CanvasIR {
	const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
	return options.runtime
		? options.runtime.migrate(parsed)
		: migrateCanvasIR(parsed);
}
