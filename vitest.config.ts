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
		},
	}),
);
