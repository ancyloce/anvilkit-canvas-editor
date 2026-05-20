import { reactLibraryPreset } from "@anvilkit/vitest-config/react-library";
import { defineConfig, mergeConfig } from "vitest/config";

export default mergeConfig(
	reactLibraryPreset,
	defineConfig({
		test: {
			name: "@anvilkit/canvas-editor",
			passWithNoTests: true,
		},
	}),
);
