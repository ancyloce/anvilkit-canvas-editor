#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_ROOT = resolve(__dirname, "..");
const OUT_FILE = resolve(PACKAGE_ROOT, "docs", "shortcut-reference.md");

/**
 * Keyboard-shortcut reference generator (PRD 0012 §23: "Keyboard shortcut
 * reference (generated from the registry)"). Reads the BUILT registry from
 * `dist` — the same `createCoreShortcutBindings()`/`formatShortcut()` the
 * workspace and the FR-042 shortcut-help dialog use at runtime — so the
 * document can never drift from the shipped bindings without a rebuild.
 *
 * Run `pnpm build` first, then `pnpm docs:shortcuts`.
 */
const registry = await import(
	new URL("../dist/workspace/shortcuts/shortcut-registry.js", import.meta.url)
		.href
);

const bindings = registry.createCoreShortcutBindings();

const CATEGORY_TITLES = {
	edit: "Editing",
	view: "View and navigation",
	tools: "Tools",
};

const categories = [...new Set(bindings.map((b) => b.category))];

const lines = [
	"# Keyboard shortcut reference",
	"",
	"<!-- GENERATED FILE — do not edit by hand.",
	"     Source: src/workspace/shortcuts/shortcut-registry.ts",
	"     Regenerate: pnpm build && pnpm docs:shortcuts -->",
	"",
	"Default bindings installed by `CanvasWorkspace` (disable wholesale with",
	"`shortcuts={false}`, extend or replace per action id via",
	"`shortcuts={{ extraBindings }}`). Headless `<CanvasStudio>` embeds install",
	"none of these. Labels below are the exact strings",
	"`formatShortcut()` produces for each platform; the in-app shortcut-help",
	"dialog renders the same registry.",
	"",
];

for (const category of categories) {
	lines.push(`## ${CATEGORY_TITLES[category] ?? category}`, "");
	lines.push("| Action | Windows / Linux | macOS | Action id |");
	lines.push("| --- | --- | --- | --- |");
	for (const b of bindings.filter((x) => x.category === category)) {
		// Dedupe after formatting: Delete/Backspace are distinct combos but both
		// render as ⌫ on mac.
		const format = (platform) =>
			[
				...new Set(
					b.combos.map((c) => `\`${registry.formatShortcut(c, platform)}\``),
				),
			].join(" or ");
		lines.push(
			`| ${b.label} | ${format("other")} | ${format("mac")} | \`${b.id}\` |`,
		);
	}
	lines.push("");
}

lines.push(
	`Generated from ${bindings.length} registry bindings across ${categories.length} categories.`,
	"",
);

await mkdir(dirname(OUT_FILE), { recursive: true });
await writeFile(OUT_FILE, lines.join("\n"), "utf8");
console.log(
	`generate-shortcut-reference: wrote ${bindings.length} bindings to docs/shortcut-reference.md`,
);
