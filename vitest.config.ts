import { fileURLToPath } from "node:url";
import { reactLibraryPreset } from "@anvilkit/vitest-config/react-library";
import { defineConfig, mergeConfig } from "vitest/config";

export default mergeConfig(
	reactLibraryPreset,
	defineConfig({
		// Mirror the `@/*` -> `./src/*` alias from tsconfig.json so tests (which
		// tsc excludes) resolve the same alias as the rslib build. This config has
		// no Vite plugins, so the alias is declared explicitly.
		resolve: {
			alias: {
				"@": fileURLToPath(new URL("./src", import.meta.url)),
			},
		},
		test: {
			name: "@anvilkit/canvas-editor",
			passWithNoTests: true,
			/**
			 * T-M0-08 (plan 0022 M0): a coverage floor so later work cannot
			 * silently reduce it. This package had **no** threshold at all,
			 * while `canvas-core` has had one since PRD 0012 — which mattered
			 * because the Auto Layout milestones add far more editor code than
			 * core code, and an ungated package is where coverage quietly
			 * erodes.
			 *
			 * Measured on 2026-07-27 at 1,402 tests / 161 files:
			 *   statements 83.10% · branches 74.42% · functions 78.63% ·
			 *   lines 85.46%
			 *
			 * Thresholds sit ~3 points under those figures, matching the
			 * convention `canvas-core`'s config already documents: a real
			 * regression fails the gate, a trivial refactor does not. The
			 * headroom is not slack — this suite has known load-sensitive
			 * specs (lazy-loaded dialogs/popovers, an axe scan) that time out
			 * under v8 instrumentation on a slow host, and a threshold pinned
			 * to the exact measurement would fail on that variance rather than
			 * on a real drop.
			 *
			 * Raise these as coverage improves; never lower them.
			 */
			coverage: {
				provider: "v8",
				reporter: ["text", "html", "lcov"],
				include: ["src/**/*.ts", "src/**/*.tsx"],
				exclude: [
					"src/**/*.test.ts",
					"src/**/*.test.tsx",
					"src/**/__tests__/**",
					// Re-export barrels carry no executable logic of their own.
					"src/index.ts",
					"src/internal.ts",
					"src/**/index.ts",
				],
				// Without this the report is suppressed on a failing run — the
				// run where the numbers are most useful for diagnosis.
				reportOnFailure: true,
				thresholds: {
					statements: 80,
					branches: 71,
					functions: 75,
					lines: 82,
				},
			},
		},
	}),
);
