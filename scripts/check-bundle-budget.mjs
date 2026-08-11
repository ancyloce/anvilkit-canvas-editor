#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import { build } from "esbuild";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_ROOT = resolve(__dirname, "..");
const PACKAGE_JSON = resolve(PACKAGE_ROOT, "package.json");
// Budget + externals come from .size-limit.json so the two gates cannot drift.
const SIZE_LIMIT_JSON = resolve(PACKAGE_ROOT, ".size-limit.json");
const DIST_ENTRY = resolve(PACKAGE_ROOT, "dist/index.js");
const TMP_DIR = resolve(PACKAGE_ROOT, ".bundle-check");
const ENTRY_FILE = resolve(TMP_DIR, "entry.mjs");
const OUT_DIR = resolve(TMP_DIR, "out");
const PLATFORM = "browser";

const PNPM_BIN = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

/**
 * ---------------------------------------------------------------------------
 * cp6-002 — the EAGER-CLOSURE guard
 * ---------------------------------------------------------------------------
 *
 * The budget check above measures `entry.js` ALONE, and `entry.js` statically
 * imports several `chunk-*.js` files that esbuild nevertheless lists under the
 * label "async chunks". `cp4-003` measured a change that cost +254 gzipped
 * bytes of real eager payload while this gate reported −2 B. A passing budget
 * number is therefore not sufficient evidence about what a host downloads
 * before first paint.
 *
 * So everything below walks the metafile's `kind === "import-statement"` edges
 * out from the true entry chunk and asserts on that closure:
 *
 *   A. LAZY_ONLY_MODULES / FORBIDDEN_MODULES — named payloads that must stay
 *      behind a dynamic import(), or stay out of the package entirely.
 *   B. EAGER_GROUP_CEILINGS — per-directory eager byte ceilings, so a catalog
 *                             cannot leak in under a different module name.
 *   C. EAGER_TOTAL_GZIP_CEILING — a backstop for weight nothing else names.
 *
 * (A) FAILS CLOSED: a listed module that is not in the build at all is reported
 * as a STALE RULE, not as passing. A guard that silently stops matching after a
 * rename is exactly how a one-time manual check decays, which is the failure
 * mode this exists to prevent.
 */

/**
 * Payloads that must stay behind a dynamic `import()`, listed as EXACT metafile
 * module ids — one entry per module, never an alternation.
 *
 * The one-entry-per-module rule is not style. The first draft of this guard
 * used `/(catalog-icons|catalog-primitives|…)\.js$/`, and the probe for the
 * stale-rule path showed why that is unsafe: renaming `catalog-icons.ts` alone
 * still leaves the alternation matching its three siblings, so the rule looks
 * healthy while it has silently stopped protecting the single largest module in
 * the package. Listed individually, each one either resolves or reports itself
 * as stale.
 */
const LAZY_ONLY_MODULES = [
	{
		module: "dist/elements/catalog-icons.js",
		why: "cp3-002: 307 vendored icon paths, the bulk of the 189,020 B / ~55.9 kB gz catalog chunk.",
	},
	{
		module: "dist/elements/catalog-primitives.js",
		why: "cp3-002: authored primitive geometry, same catalog chunk.",
	},
	{
		module: "dist/elements/catalog-builders.js",
		why: "cp3-002: catalog entry builders, same catalog chunk.",
	},
	{
		module: "dist/elements/default-element-catalog.js",
		why: "cp3-002: the 425-entry assembly. Importing it statically moves the entry chunk by ~+56 kB gz — 13.8% of the whole budget (cp6-002 re-measured the control at +56,723 B).",
	},
	{
		module: "dist/assets/local-asset-store.js",
		why: "cp1-004/cp1-005: the zero-config asset fallback costs +812 B gz eager only because the store is reached through import().",
	},
	{
		module: "dist/assets/local-uploader.js",
		why: "cp1-004: async-only. Static reach turns the 812 B fallback story into ~3.4 kB.",
	},
	{
		module: "dist/assets/local-picker.js",
		why: "cp1-004: async-only, same reason as the uploader.",
	},
	{
		module: "dist/assets/local-asset-export.js",
		why: "cp1-006: export-time rehydration only; nothing at mount needs it.",
	},
	{
		module: "dist/text/export-font-manifest.js",
		why: "cp2-006: export-time only. docs/export-capability-matrix.md states the exporters' weight is code-split so the eager editor bundle is unaffected.",
	},
];

/**
 * Modules that must not appear in the build AT ALL, eager or lazy.
 */
const FORBIDDEN_MODULES = [
	{
		id: "AI job client (@anvilkit/plugin-ai-*)",
		pattern: /plugin-ai-/,
		why: "The AI job client lives in @anvilkit/plugin-ai-image (extensions layer). canvas-editor is a capability and must never depend on it — check:layering enforces the direction, this enforces the bytes.",
	},
];

/**
 * Eager byte ceilings per source directory (`bytesInOutput`, i.e. minified and
 * un-gzipped). These catch a catalog that leaks in under a *different* module
 * name, which a name-matched rule in (A) cannot see.
 */
const EAGER_GROUP_CEILINGS = [
	{
		id: "src/elements (provider seam only)",
		pattern: /^dist\/elements\//,
		maxBytes: 4_000,
		why: "Only the contract, the entry type and the import() seam belong here (863 B at cp6-002). The catalog data is 189,020 B minified, so any of it landing eagerly overshoots by ~46x.",
	},
	{
		id: "src/chrome (hand-rolled icons)",
		pattern: /^dist\/chrome\//,
		maxBytes: 4_000,
		why: "cp0-007 §3.5 asked for exactly this: src/chrome/** eager bytes stay within tolerance of 1,811 B rather than asserting icons are absent. A 300-500 entry icon set cannot fit under this ceiling.",
	},
	{
		id: "src/text (font catalog data is DELIBERATELY eager)",
		pattern: /^dist\/text\//,
		maxBytes: 24_000,
		why: "cp2-007 landed default-font-catalog.ts eager on purpose (12,394 B of the 17,923 B here at cp6-002) so text nodes paint with real metrics on the first frame instead of flashing fallback. cp6-002 re-approved that; this ceiling bounds it so the catalog cannot quietly double.",
	},
];

/**
 * Backstop for eager weight no rule above names. Measured 141,031 B at cp6-002
 * (9 chunks); the ceiling is that + ~5%. Rationale for the tolerance:
 * rebuild-to-rebuild gzip noise is ~2 B (content-hash filename length), one
 * ordinary feature task costs 100 B - 2 kB, and the smallest lazy payload this
 * file guards is 55.9 kB gz. 5% is therefore far above the noise floor, leaves
 * room for a few normal tasks before a deliberate review, and is ~8x smaller
 * than a single catalog regression.
 *
 * Basis: the SUM of per-chunk gzip streams, because that is what a browser
 * actually transfers - each chunk is compressed on its own connection.
 */
const EAGER_TOTAL_GZIP_CEILING = 148_000;

function parseLimitToBytes(limit) {
	const match = /^([\d.]+)\s*(B|KB|MB)$/i.exec(String(limit).trim());
	if (!match) {
		throw new Error(
			`check-bundle-budget: cannot parse size-limit "limit" value: ${limit}`,
		);
	}
	const value = Number.parseFloat(match[1]);
	const unit = match[2].toUpperCase();
	const factor = unit === "B" ? 1 : unit === "KB" ? 1024 : 1024 * 1024;
	return Math.round(value * factor);
}

async function loadInputs() {
	const [pkgRaw, sizeLimitRaw] = await Promise.all([
		readFile(PACKAGE_JSON, "utf8"),
		readFile(SIZE_LIMIT_JSON, "utf8"),
	]);

	const pkg = JSON.parse(pkgRaw);
	const sizeLimit = JSON.parse(sizeLimitRaw);
	const entry = Array.isArray(sizeLimit) ? sizeLimit[0] : sizeLimit;

	if (!entry || typeof entry.limit !== "string") {
		throw new Error(
			"check-bundle-budget: .size-limit.json must contain an entry with a string `limit`",
		);
	}

	return {
		pkg,
		budget: parseLimitToBytes(entry.limit),
		ignore: Array.isArray(entry.ignore) ? entry.ignore : [],
	};
}

async function ensureDistExists() {
	try {
		await stat(DIST_ENTRY);
	} catch {
		console.log(
			"check-bundle-budget: dist/index.js missing — running `pnpm build`",
		);
		execFileSync(PNPM_BIN, ["build"], {
			cwd: PACKAGE_ROOT,
			stdio: "inherit",
		});
	}
}

async function prepareEntry(packageName) {
	await rm(TMP_DIR, { recursive: true, force: true });
	await mkdir(TMP_DIR, { recursive: true });
	await writeFile(ENTRY_FILE, `export * from ${JSON.stringify(packageName)};\n`, "utf8");
}

async function bundle(packageName, peerDependencies, ignore) {
	const bases = [
		...new Set([
			...Object.keys(peerDependencies),
			...ignore,
			"react/jsx-runtime",
			"react/jsx-dev-runtime",
		]),
	];
	// Externalize subpaths too (esbuild externals are exact-match otherwise).
	const external = bases.flatMap((name) =>
		name.includes("/") && !name.startsWith("@")
			? [name]
			: [name, `${name}/*`],
	);

	const result = await build({
		absWorkingDir: PACKAGE_ROOT,
		bundle: true,
		entryPoints: [ENTRY_FILE],
		external,
		format: "esm",
		logLevel: "error",
		metafile: true,
		minify: true,
		outdir: OUT_DIR,
		platform: PLATFORM,
		splitting: true,
		target: "es2022",
		treeShaking: true,
		write: true,
	});

	if (result.errors.length > 0) {
		for (const error of result.errors) {
			console.error(error);
		}
		throw new Error("check-bundle-budget: esbuild reported errors");
	}

	return result.metafile;
}

/**
 * The chunk built from OUR entry file — matched by name, not by "the first
 * output that has an `entryPoint`".
 *
 * With `splitting: true`, esbuild marks every dynamic-import boundary as an
 * entry point too, so the naive first-match returns whichever code-split
 * chunk happens to come first in the metafile's iteration order. On
 * 2026-08-07 (cp1-004) that silently became `ErrorDetailsDialog-*.js` — 884
 * gzipped bytes against a 409,600 byte budget — which is a gate that can
 * never fail rather than a gate that passes. The same fix is already in
 * `@anvilkit/core`'s copy of this script.
 */
function findEntryChunk(metafile, entryFile) {
	const wanted = basename(entryFile);
	for (const [outputPath, output] of Object.entries(metafile.outputs)) {
		if (output.entryPoint !== undefined && basename(output.entryPoint) === wanted) {
			// The metafile key (package-relative) — the closure walk keys off it.
			return outputPath;
		}
	}

	throw new Error("check-bundle-budget: could not locate the bundled entry chunk");
}

/**
 * Every output chunk reachable from `entryOutput` over `import-statement`
 * edges. That, and only that, is what a host downloads before first paint.
 */
function collectEagerChunks(metafile, entryOutput) {
	const eager = new Set();
	const queue = [entryOutput];

	while (queue.length > 0) {
		const current = queue.shift();
		if (eager.has(current)) continue;
		eager.add(current);

		for (const imported of metafile.outputs[current]?.imports ?? []) {
			if (imported.kind !== "import-statement") continue;
			if (metafile.outputs[imported.path] === undefined) continue;
			queue.push(imported.path);
		}
	}

	return eager;
}

/** `input path -> bytesInOutput`, summed across the given output chunks. */
function collectInputs(metafile, outputPaths) {
	const inputs = new Map();
	for (const outputPath of outputPaths) {
		for (const [input, meta] of Object.entries(
			metafile.outputs[outputPath]?.inputs ?? {},
		)) {
			inputs.set(input, (inputs.get(input) ?? 0) + meta.bytesInOutput);
		}
	}
	return inputs;
}

async function measureChunks(outputPaths) {
	const rows = [];
	let totalRaw = 0;
	let totalGzip = 0;

	for (const outputPath of outputPaths) {
		const raw = await readFile(resolve(PACKAGE_ROOT, outputPath));
		const gzipped = gzipSync(raw, { level: 9 }).length;
		totalRaw += raw.length;
		totalGzip += gzipped;
		rows.push({ name: basename(outputPath), raw: raw.length, gzipped });
	}

	rows.sort((a, b) => b.gzipped - a.gzipped);
	return { rows, totalRaw, totalGzip };
}

/**
 * Assertions A, B and C. Returns a list of human-readable failures; an empty
 * list means the eager closure still looks the way cp6-002 certified it.
 */
function auditEagerClosure({ eagerInputs, lazyInputs, eagerTotalGzip }) {
	const failures = [];

	for (const rule of LAZY_ONLY_MODULES) {
		if (eagerInputs.has(rule.module)) {
			failures.push(
				`LEAK — "${rule.module}" is reachable over a static import edge.\n` +
					`    why it must stay lazy: ${rule.why}\n` +
					"    Fix the import (use a dynamic import()), do not raise a budget.",
			);
			continue;
		}

		if (!lazyInputs.has(rule.module)) {
			failures.push(
				`STALE RULE — "${rule.module}" is not in the build at all.\n` +
					"    It was renamed, moved or deleted, so this guard has silently stopped\n" +
					"    protecting it. Update LAZY_ONLY_MODULES — do not delete the entry unless\n" +
					"    the payload itself is gone.",
			);
		}
	}

	for (const rule of FORBIDDEN_MODULES) {
		const hits = [...eagerInputs.keys(), ...lazyInputs.keys()].filter((input) =>
			rule.pattern.test(input),
		);
		if (hits.length > 0) {
			failures.push(
				`FORBIDDEN — "${rule.id}" appears in the build.\n` +
					`    modules: ${hits.join(", ")}\n` +
					`    ${rule.why}`,
			);
		}
	}

	for (const group of EAGER_GROUP_CEILINGS) {
		let bytes = 0;
		for (const [input, size] of eagerInputs) {
			if (group.pattern.test(input)) bytes += size;
		}
		if (bytes > group.maxBytes) {
			failures.push(
				`OVER CEILING — "${group.id}" holds ${bytes.toLocaleString()} eager bytes, ceiling ${group.maxBytes.toLocaleString()}.\n` +
					`    ${group.why}`,
			);
		}
	}

	if (eagerTotalGzip > EAGER_TOTAL_GZIP_CEILING) {
		failures.push(
			`OVER CEILING — total eager payload is ${eagerTotalGzip.toLocaleString()} B gz, ceiling ${EAGER_TOTAL_GZIP_CEILING.toLocaleString()} B.\n` +
				"    Move the new weight behind a dynamic import(), or raise this ceiling only\n" +
				"    with a written, reviewed justification recorded beside the constant.",
		);
	}

	return failures;
}

async function main() {
	const { pkg, budget, ignore } = await loadInputs();
	await ensureDistExists();
	await prepareEntry(pkg.name);

	const metafile = await bundle(pkg.name, pkg.peerDependencies ?? {}, ignore);
	const entryChunkKey = findEntryChunk(metafile, ENTRY_FILE);
	const raw = await readFile(resolve(PACKAGE_ROOT, entryChunkKey));
	const gzipped = gzipSync(raw, { level: 9 });
	const rawBytes = raw.length;
	const gzippedBytes = gzipped.length;
	const percentOfBudget = ((gzippedBytes / budget) * 100).toFixed(1);
	const entryChunkName = basename(entryChunkKey);

	const eagerChunks = collectEagerChunks(metafile, entryChunkKey);
	const allChunks = Object.keys(metafile.outputs).filter((outputPath) =>
		outputPath.endsWith(".js"),
	);
	const lazyChunks = allChunks.filter((outputPath) => !eagerChunks.has(outputPath));

	const eager = await measureChunks([...eagerChunks].sort());
	const lazy = await measureChunks(lazyChunks.sort());
	const eagerInputs = collectInputs(metafile, eagerChunks);
	const lazyInputs = collectInputs(metafile, lazyChunks);

	console.log(`check-bundle-budget: ${pkg.name}`);
	console.log(`  entry chunk:  ${entryChunkName}`);
	console.log(`  raw bytes:    ${rawBytes.toLocaleString()}`);
	console.log(`  gzipped:      ${gzippedBytes.toLocaleString()}`);
	console.log(`  budget:       ${budget.toLocaleString()}`);
	console.log(`  of budget:    ${percentOfBudget}%`);
	console.log("");
	console.log(
		`  eager closure (entry + static imports): ${eager.rows.length} chunks, ${eager.totalRaw.toLocaleString()} B raw, ${eager.totalGzip.toLocaleString()} B gz of ${EAGER_TOTAL_GZIP_CEILING.toLocaleString()} B ceiling`,
	);
	for (const row of eager.rows) {
		console.log(
			`      ${row.name.padEnd(36)} ${row.raw.toLocaleString().padStart(9)} raw  ${row.gzipped.toLocaleString().padStart(8)} gz`,
		);
	}
	console.log(
		`  lazy chunks (dynamic import() only):    ${lazy.rows.length} chunks, ${lazy.totalRaw.toLocaleString()} B raw, ${lazy.totalGzip.toLocaleString()} B gz`,
	);
	for (const row of lazy.rows) {
		console.log(
			`      ${row.name.padEnd(36)} ${row.raw.toLocaleString().padStart(9)} raw  ${row.gzipped.toLocaleString().padStart(8)} gz`,
		);
	}
	console.log("");
	console.log(
		"  NOTE: `pnpm size` (size-limit) bundles dist/index.js WITHOUT code splitting, so it",
	);
	console.log(
		`        inlines every lazy chunk above (${lazy.totalGzip.toLocaleString()} B gz of them) into one file. Its number is a`,
	);
	console.log(
		"        legitimate all-inclusive ceiling, NOT the eager payload — read the eager",
	);
	console.log("        closure above for that. See cp3-003 / cp6-002.");

	const failures = auditEagerClosure({
		eagerInputs,
		lazyInputs,
		eagerTotalGzip: eager.totalGzip,
	});

	if (gzippedBytes > budget) {
		failures.unshift(
			`OVER BUDGET — entry chunk is ${gzippedBytes.toLocaleString()} B gz, budget ${budget.toLocaleString()} B.`,
		);
	}

	if (failures.length > 0) {
		console.error("");
		for (const failure of failures) {
			console.error(`check-bundle-budget: FAIL — ${failure}`);
		}
		process.exit(1);
	}

	console.log("check-bundle-budget: OK");
}

main().catch((error) => {
	console.error("check-bundle-budget: crashed unexpectedly");
	console.error(error);
	process.exit(2);
});
