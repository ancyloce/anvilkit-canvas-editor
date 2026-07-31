import { configure } from "@testing-library/dom";

/**
 * Package-local test setup (plan 0021 T-046).
 *
 * ## Why RTL's async timeout is raised here
 *
 * Three specs in this package assert that a dialog is **code-split** — that it
 * is absent until a `React.lazy` boundary resolves. They wait for the result
 * with `findBy*`/`waitFor`, whose default budget is 1000 ms.
 *
 * That budget is not a property of the application. In vitest + jsdom the first
 * `await import()` of a lazy chunk pays the transform cost of its entire
 * transitive graph, which for `ConfirmDialog` measured **1045 ms** on this
 * machine on 2026-07-30. So the specs were really asserting "this developer's
 * box transforms the editor's module graph in under a second", and they had
 * been recorded as intermittent since M1 for exactly that reason — the graph
 * grew across the plan until the margin disappeared and they failed 3/3.
 *
 * Raising the budget removes the machine-speed dependency and changes no
 * assertion: the dialog must still be absent before the boundary resolves and
 * present after, and a genuinely broken lazy import still fails — just later.
 *
 * The number comes from measurement, not from guessing upward: the
 * `ConfirmDialog` chunk imports in **1,045 ms** with the file run alone, and was
 * observed at **5,911 ms** inside a parallel full-suite run, where every worker
 * is transforming its own graph at once. 10 s is roughly 2x that observed worst
 * case. It is a cold-transform allowance for this environment, not an assertion
 * about how fast the application opens a dialog.
 *
 * This is set here rather than in `@anvilkit/vitest-config`'s shared preset
 * because the cause is this package's module-graph size; no other consumer
 * should inherit a laxer default on account of it.
 *
 * ## The invariant: this must stay well BELOW `testTimeout`
 *
 * Both were 5000 ms for one commit, and that is a trap rather than a
 * coincidence: an RTL wait could then consume the entire test budget, so a slow
 * chunk surfaced as `Test timed out in 5000ms` — an opaque failure naming
 * neither the query nor the element — instead of RTL's "Unable to find an
 * element by ...". Six specs failed that way at once. `vitest.config.ts` raises
 * `testTimeout` to 20000 to restore the margin; if you change either number,
 * keep the gap.
 */
configure({ asyncUtilTimeout: 10_000 });
