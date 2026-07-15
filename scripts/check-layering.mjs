#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_ROOT = resolve(__dirname, "..");
const SOURCE_DIR = resolve(PACKAGE_ROOT, "src");

/**
 * Dependency-direction gate for the Editor (P1-2), mirroring
 * `@anvilkit/canvas-core`'s `check-layering.mjs`. A module may only import
 * strictly lower-ranked domains (or its own domain — including every OTHER
 * directory folded into the SAME domain, see `interaction-core` below).
 * `__tests__` and *.test.tsx/*.spec.tsx files are exempt importers.
 *
 * A source file that matches no layer fails the check on purpose: new
 * top-level files/directories must be added here so their layer assignment
 * is a conscious decision.
 *
 * UNLIKE core's layering (a genuine strict acyclic hierarchy — verified by
 * `pnpm check:circular`), the Editor's `actions/brand/context/extensions/
 * perf/render/selection/snap/stage/stores/tools` directories are a real,
 * FILE-CYCLE-FREE (madge passes) but DIRECTORY-LEVEL mutually-referencing
 * cluster: tools dispatch through context, context's types reference store/
 * tool APIs, stores reference snap geometry, stage rendering reads brand/
 * context/text, selection/perf/render close the loop back through stage, and
 * the unified action layer (`actions/`, M0-01) composes context + selection
 * so every UI surface above the cluster dispatches through one place.
 * This is inherent to how an interactive editor's advanced/internal layer
 * works, not an accident to "fix" by re-splitting it here — so this checker
 * folds all eleven into ONE domain (`interaction-core`) where intra-domain
 * imports in any direction are allowed, exactly like core's checker already
 * allows same-domain imports. Cross-domain edges (e.g. a store importing a
 * panel) are still caught precisely — merging only relaxes ordering WITHIN
 * the verified cluster, never across it.
 */
const LAYERS = [
	// Genuine leaves: no directory here imports across `src/` at all.
	{
		domain: "leaf",
		rank: 0,
		match: (p) =>
			p.startsWith("text/") ||
			p.startsWith("templates/") ||
			p === "CanvasErrorBoundary.tsx",
	},
	// See the module doc comment above: a verified, file-cycle-free but
	// directory-level mutually-referencing cluster of interactive-editing
	// primitives, folded into one domain on purpose.
	{
		domain: "interaction-core",
		rank: 1,
		match: (p) =>
			p.startsWith("actions/") ||
			p.startsWith("brand/") ||
			p.startsWith("context/") ||
			p.startsWith("extensions/") ||
			p.startsWith("perf/") ||
			p.startsWith("render/") ||
			p.startsWith("selection/") ||
			p.startsWith("snap/") ||
			p.startsWith("stage/") ||
			p.startsWith("stores/") ||
			p.startsWith("tools/"),
	},
	// Editor-chrome surfaces built ON the interaction core: a11y overlays,
	// legacy chrome primitives, the collab prototype, header plugin
	// contracts, and page actions. None of these are imported BACK from
	// `interaction-core` — verified from the current import graph.
	{
		domain: "editor-surfaces",
		rank: 2,
		match: (p) =>
			p.startsWith("a11y/") ||
			p.startsWith("chrome/") ||
			p.startsWith("collab/") ||
			p.startsWith("header/") ||
			p.startsWith("pages/"),
	},
	// Composed UI (mountable panels) and the `<CanvasStudio>` root component
	// itself — both sit above every editor-surface and interaction-core
	// directory, and neither imports the other.
	{
		domain: "composition",
		rank: 3,
		match: (p) => p.startsWith("panels/") || p === "CanvasStudio.tsx",
	},
	{ domain: "workspace", rank: 4, match: (p) => p.startsWith("workspace/") },
	// The two public entry points (stable `index.ts`, advanced `internal.ts`)
	// — may import anything below.
	{
		domain: "root",
		rank: 5,
		match: (p) => p === "index.ts" || p === "internal.ts",
	},
];

const TEST_FILE_PATTERN = /\.(test|spec)\.[cm]?tsx?$/;
const IMPORT_SPECIFIER_PATTERN =
	/\b(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g;

function classify(srcRelativePath) {
	return LAYERS.find((layer) => layer.match(srcRelativePath)) ?? null;
}

/** Returns a violation message for edge importer→importee, or null if legal. */
function checkEdge(importerPath, importeePath) {
	const importer = classify(importerPath);
	const importee = classify(importeePath);
	if (!importer) {
		return `${importerPath} matches no layer in check-layering.mjs — assign it one.`;
	}
	if (!importee) {
		return `${importerPath} imports ${importeePath}, which matches no layer in check-layering.mjs — assign it one.`;
	}
	if (importer.domain === importee.domain) return null;
	if (importer.rank > importee.rank) return null;
	return `${importerPath} -> ${importeePath}  (${importer.domain}, rank ${importer.rank}, must not depend on ${importee.domain}, rank ${importee.rank})`;
}

async function* walkSourceFiles(dir) {
	const entries = await readdir(dir, { withFileTypes: true });
	for (const entry of entries) {
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === "__tests__" || entry.name === "node_modules") {
				continue;
			}
			yield* walkSourceFiles(fullPath);
			continue;
		}
		if (
			entry.isFile() &&
			(extname(entry.name) === ".ts" || extname(entry.name) === ".tsx") &&
			!TEST_FILE_PATTERN.test(entry.name)
		) {
			yield fullPath;
		}
	}
}

/** Resolve a relative specifier to a src-relative .ts(x) path (posix separators). */
function resolveSpecifier(importerSrcRelative, specifier) {
	const joined = join(dirname(importerSrcRelative), specifier);
	const normalized = joined.split("\\").join("/");
	if (normalized.startsWith("..")) return null; // escapes src/ (not an internal edge)
	return normalized.replace(/\.js$/, "");
}

/** A specifier's extension-stripped path may resolve to `.ts` or `.tsx` on
 *  disk; classification only inspects the directory prefix / bare filename,
 *  so the exact extension never matters — try both against the known files
 *  set built once up front. */
function toKnownPath(strippedPath, knownPaths) {
	if (knownPaths.has(`${strippedPath}.ts`)) return `${strippedPath}.ts`;
	if (knownPaths.has(`${strippedPath}.tsx`)) return `${strippedPath}.tsx`;
	// Directory index import (e.g. "../stores/index") or an already-precise
	// path (top-level files matched by exact name in LAYERS) — classify as-is.
	return strippedPath;
}

async function collectViolations() {
	const violations = [];
	let edgeCount = 0;
	const knownPaths = new Set();
	const files = [];
	for await (const filePath of walkSourceFiles(SOURCE_DIR)) {
		files.push(filePath);
		knownPaths.add(relative(SOURCE_DIR, filePath).split("\\").join("/"));
	}

	for (const filePath of files) {
		const importerSrcRelative = relative(SOURCE_DIR, filePath)
			.split("\\")
			.join("/");
		const text = await readFile(filePath, "utf8");
		for (const match of text.matchAll(IMPORT_SPECIFIER_PATTERN)) {
			const stripped = resolveSpecifier(importerSrcRelative, match[1]);
			if (!stripped) continue;
			const importeeSrcRelative = toKnownPath(stripped, knownPaths);
			edgeCount += 1;
			const violation = checkEdge(importerSrcRelative, importeeSrcRelative);
			if (violation) violations.push(violation);
		}
	}

	return { violations, edgeCount };
}

function selfTest() {
	const cases = [
		// [importer, importee, expectViolation]
		["stores/scene-store.ts", "snap/snap-types.ts", false], // same domain (interaction-core)
		["tools/tool-registry.ts", "context/canvas-studio-context.tsx", false], // same domain
		["panels/LayerPanel.tsx", "stores/scene-store.ts", false], // downward
		["stores/scene-store.ts", "panels/LayerPanel.tsx", true], // upward violation
		["text/canvas-text-measurer.ts", "stage/CanvasStage.tsx", true], // leaf importing up
		["workspace/index.ts", "panels/PropertyInspector.tsx", false], // downward
		["index.ts", "workspace/index.ts", false], // root -> workspace
		["a11y/ToolAnnouncer.tsx", "unmapped-thing.ts", true], // unmapped importee
	];
	const failures = cases.filter(
		([importer, importee, expectViolation]) =>
			Boolean(checkEdge(importer, importee)) !== expectViolation,
	);
	if (failures.length > 0) {
		console.error("check-layering: SELF-TEST FAIL");
		for (const [importer, importee] of failures) {
			console.error(`  unexpected verdict for ${importer} -> ${importee}`);
		}
		process.exit(1);
	}
	console.log(`check-layering: self-test OK (${cases.length} cases).`);
}

async function main() {
	if (process.argv.includes("--self-test")) {
		selfTest();
		return;
	}

	const { violations, edgeCount } = await collectViolations();
	if (violations.length === 0) {
		console.log(
			`check-layering: OK — ${edgeCount} internal import edges respect the layer order.`,
		);
		return;
	}

	console.error("check-layering: FAIL");
	console.error("");
	console.error("The following imports point at an equal or higher layer:");
	console.error("");
	for (const violation of violations) {
		console.error(`  ${violation}`);
	}
	console.error("");
	console.error(
		"Lower layers must not depend on higher ones (see this file's module doc comment).",
	);
	process.exit(1);
}

main().catch((error) => {
	console.error("check-layering: crashed unexpectedly");
	console.error(error);
	process.exit(2);
});
