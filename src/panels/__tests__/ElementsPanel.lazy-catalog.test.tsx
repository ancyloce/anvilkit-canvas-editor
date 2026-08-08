/**
 * @file `cp3-003` acceptance criterion: "the catalog loads on first open, not
 * at mount (assert the import is not evaluated eagerly)".
 *
 * WHY THIS NEEDS TWO DIFFERENT KINDS OF TEST.
 *
 * The failure being guarded is a BUNDLING failure, not a behavioural one: a
 * static `import { DEFAULT_ELEMENTS } from "../elements/default-element-catalog.js"`
 * anywhere in the panel renders *identically* while putting 189 KB of icon
 * geometry into the eager editor chunk — `cp3-002` measured the counterfactual
 * at **+55,796 B gzipped, 13.6% of the whole budget**.
 *
 * 1. {@link describe} "static import graph" walks the panel's transitive
 *    STATIC imports across `src/` and asserts the catalog is not among them.
 *    Deterministic, and it fails with the offending path named.
 * 2. The runtime spy below asserts the timing: the module is evaluated on the
 *    panel's first query, and not before — including not at all when the host
 *    supplies its own provider.
 *
 * Both were verified to go red against a deliberately-eager panel (a static
 * catalog import added to `ElementsPanel.tsx`, then reverted). NOTE the shape
 * of the runtime failure in that state: the hoisted spy reports **0** calls
 * rather than "called too early", because a mocked module pulled in through the
 * test file's own static import graph is evaluated against a different instance
 * of the hoisted block. The test still fails — which is what it is for — but
 * test 1 is the one that says *why*, which is why both exist.
 *
 * The mock lives in its own file because it would otherwise apply to every test
 * in `ElementsPanel.test.tsx`, which deliberately uses explicit providers.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import type { CanvasElementEntry } from "@/elements/element-entry.js";
import { createStaticElementProvider } from "@/elements/element-provider.js";
import { ElementsPanel } from "@/panels/ElementsPanel.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";

const { catalogEvaluated, CATALOG_ENTRIES, HOST_ENTRIES } = vi.hoisted(() => {
	const make = (id: string, name: string): unknown => ({
		id,
		name,
		category: "shape",
		tags: [],
		preview: { kind: "path", d: "M0 0H24V24H0Z", viewBox: "0 0 24 24" },
		defaultSize: { width: 100, height: 100 },
		license: "MIT",
		recolor: "fill",
		build: () => ({ type: "rect" }),
	});
	return {
		catalogEvaluated: vi.fn(),
		CATALOG_ENTRIES: [make("from-default-catalog", "From default catalog")],
		HOST_ENTRIES: [make("from-host", "From host")],
	};
});

// The real module is ~189 KB of geometry; standing in for it also keeps this
// spec from paying to parse it.
vi.mock("@/elements/default-element-catalog.js", () => {
	catalogEvaluated();
	return { DEFAULT_ELEMENTS: CATALOG_ENTRIES };
});

// react-library vitest preset has globals:false — RTL auto-cleanup is OFF.
afterEach(cleanup);

// ── 1. The static import graph ───────────────────────────────────────────────

const SRC_DIR = resolve(__dirname, "../..");
const PANEL = resolve(SRC_DIR, "panels/ElementsPanel.tsx");
const PROVIDER_SEAM = resolve(SRC_DIR, "elements/default-element-provider.ts");
const CATALOG = resolve(SRC_DIR, "elements/default-element-catalog.ts");

/**
 * Every STATIC specifier in a module: `import … from`, `export … from`, and
 * bare side-effect `import "…"`. A dynamic `import("…")` matches neither —
 * there is no `from` clause and no whitespace after `import` — which is exactly
 * the distinction this whole test rests on.
 */
function staticSpecifiers(source: string): string[] {
	const out: string[] = [];
	// `[^;]*?` spans the newlines of a multi-line import but stops at the
	// statement terminator, so one match can never swallow the next statement.
	for (const m of source.matchAll(
		/(?:^|\n)\s*(?:import|export)\s[^;]*?\sfrom\s*["']([^"']+)["']/g,
	)) {
		if (m[1]) out.push(m[1]);
	}
	for (const m of source.matchAll(/(?:^|\n)\s*import\s*["']([^"']+)["']/g)) {
		if (m[1]) out.push(m[1]);
	}
	return out;
}

/** Resolve an in-package specifier to a file. Bare packages resolve to null. */
function resolveSpecifier(fromFile: string, spec: string): string | null {
	const base = spec.startsWith("@/")
		? join(SRC_DIR, spec.slice(2))
		: spec.startsWith(".")
			? resolve(dirname(fromFile), spec)
			: null;
	if (base === null) return null;
	const stem = base.replace(/\.jsx?$/, "");
	for (const candidate of [
		`${stem}.ts`,
		`${stem}.tsx`,
		join(stem, "index.ts"),
		join(stem, "index.tsx"),
	]) {
		if (existsSync(candidate)) return candidate;
	}
	return null;
}

function staticGraphFrom(entry: string): Set<string> {
	const seen = new Set<string>();
	const queue = [entry];
	while (queue.length > 0) {
		const file = queue.pop();
		if (!file || seen.has(file)) continue;
		seen.add(file);
		for (const spec of staticSpecifiers(readFileSync(file, "utf8"))) {
			const next = resolveSpecifier(file, spec);
			if (next && !seen.has(next)) queue.push(next);
		}
	}
	return seen;
}

describe("ElementsPanel — static import graph", () => {
	const graph = staticGraphFrom(PANEL);

	it("resolves a real graph (so the assertions below cannot pass vacuously)", () => {
		expect(existsSync(CATALOG)).toBe(true);
		expect(graph.size).toBeGreaterThan(20);
		expect(graph.has(PROVIDER_SEAM)).toBe(true);
	});

	it("never reaches the default catalog over a static edge", () => {
		const offenders = [...graph]
			.filter((file) => file.includes("default-element-catalog"))
			.map((file) => relative(SRC_DIR, file));
		expect(offenders).toEqual([]);
	});

	it("the seam's only edge to the catalog is a dynamic import()", () => {
		const seam = readFileSync(PROVIDER_SEAM, "utf8");
		// The one edge, and it is dynamic.
		expect(seam).toContain('await import("./default-element-catalog.js")');
		expect(
			staticSpecifiers(seam).filter((s) =>
				s.includes("default-element-catalog"),
			),
		).toEqual([]);
	});
});

// ── 2. Runtime evaluation timing ─────────────────────────────────────────────

function mount(node: React.ReactNode): void {
	const harness = makeHarness();
	render(
		<CanvasStudioContext.Provider value={harness.studioCtx}>
			{node}
		</CanvasStudioContext.Provider>,
	);
}

describe("ElementsPanel — the default catalog stays behind its dynamic import", () => {
	it("is not evaluated at module import, nor at a mount without the panel, nor when the host supplies a provider — only on first open", async () => {
		// 1. Importing `ElementsPanel` (top of this file) must not drag the
		//    catalog in.
		expect(catalogEvaluated).not.toHaveBeenCalled();

		// 2. An editor mount that does not render this panel must not either.
		//    The panel module is loaded and its module-scope initialisers have
		//    run; only the component body may reach the provider.
		mount(<div data-testid="other-panel" />);
		expect(screen.getByTestId("other-panel")).toBeTruthy();
		expect(catalogEvaluated).not.toHaveBeenCalled();
		cleanup();

		// 3. A host that supplies its own catalog pays nothing for the built-in
		//    one — the default provider is never constructed, so its chunk is
		//    never requested.
		mount(
			<ElementsPanel
				elementProvider={createStaticElementProvider(
					HOST_ENTRIES as unknown as readonly CanvasElementEntry[],
				)}
			/>,
		);
		await screen.findByTestId("elements-item-from-host");
		expect(catalogEvaluated).not.toHaveBeenCalled();
		cleanup();

		// 4. Opening the panel on the DEFAULT provider is what fetches it.
		mount(<ElementsPanel />);
		await waitFor(() => expect(catalogEvaluated).toHaveBeenCalledTimes(1));
		// …and the entries really did come through `createDefaultElementProvider`,
		// so this is the panel's own path and not an incidental import.
		expect(
			await screen.findByTestId("elements-item-from-default-catalog"),
		).toBeTruthy();
	});
});
