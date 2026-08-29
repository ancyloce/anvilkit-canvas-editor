import { defineConfig } from "vitest/config";

/**
 * PLAN-0039 E4-T6 interaction benchmark project.
 *
 * Kept out of `pnpm test`: wall-clock gates run alone on one worker so build
 * fan-out cannot turn CPU contention into a false performance regression.
 */
export default defineConfig({
	test: {
		name: "@anvilkit/canvas-editor:interaction-bench",
		include: ["bench/**/*.bench.ts"],
		environment: "node",
		isolate: false,
		fileParallelism: false,
		pool: "threads",
		maxWorkers: 1,
		minWorkers: 1,
		disableConsoleIntercept: true,
		testTimeout: 900_000,
		hookTimeout: 900_000,
	},
});
