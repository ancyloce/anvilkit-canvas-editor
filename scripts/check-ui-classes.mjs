#!/usr/bin/env node

/**
 * @file Guards the `@anvilkit/ui` `@source` glob in `src/styles.src.css`.
 *
 * `@anvilkit/ui` is EXTERNALIZED from this package's bundle, so its class
 * strings never appear in our `dist/`. Scanning `dist/` alone therefore emits
 * none of the utilities used only inside ui components. That is invisible for
 * inline chrome — a host's own Tailwind build usually covers it — but fatal for
 * PORTALLED popups: a Select popup or the ColorRow picker rendered into
 * `document.body` without `z-50` / `bg-popover` / `min-w-36` is transparent,
 * unsized, and painted UNDER the editor, which reads to a user as "the dropdown
 * won't open".
 *
 * jsdom applies no CSS, so the entire unit suite passes against a completely
 * unstyled popup — nothing else in this repo can catch a regression here.
 *
 * The invariant: for every `@anvilkit/ui` module this package imports, at least
 * one utility that ONLY that module uses must appear in the compiled
 * `dist/styles.css`. Self-maintaining — importing a new ui primitive extends
 * the check automatically, with no list to update.
 *
 * Runs after a build (like check-bundle-budget / check-api-snapshot): it reads
 * `dist/styles.css`, which `pnpm build` produces via `build:css`.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, "..");
const SRC_DIR = resolve(PACKAGE_ROOT, "src");
const DIST_DIR = resolve(PACKAGE_ROOT, "dist");
const STYLESHEET = resolve(DIST_DIR, "styles.css");
const UI_SRC = resolve(PACKAGE_ROOT, "node_modules/@anvilkit/ui/src");

/** `@anvilkit/ui/<subpath>` — the specifier form used across this package. */
const UI_IMPORT = /["']@anvilkit\/ui\/([a-zA-Z0-9._/-]+)["']/g;

/** Minimum module-exclusive tokens before a zero-hit result counts as broken. */
const MIN_EXCLUSIVE_TOKENS = 8;

async function walk(dir, test, out = []) {
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const entry of entries) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === "__tests__" || entry.name === "node_modules") continue;
			await walk(full, test, out);
		} else if (test(entry.name)) {
			out.push(full);
		}
	}
	return out;
}

/**
 * Class-ish tokens from a source file. Deliberately over-collects: a token that
 * is not a real utility simply never matches the stylesheet, and the assertion
 * below only needs ONE genuine hit per module — so extraction noise cannot
 * produce a false failure.
 */
function extractClassTokens(source) {
	const tokens = new Set();
	for (const [, literal] of source.matchAll(/["'`]([^"'`\n]{2,600})["'`]/g)) {
		if (literal.includes("${")) continue;
		for (const raw of literal.split(/\s+/)) {
			const token = raw.trim();
			if (token.length < 2 || token.length > 120) continue;
			// Utilities are lowercase and contain a dash, colon, or bracket.
			if (!/^[a-z[]/.test(token)) continue;
			if (/[A-Z${}`;]/.test(token)) continue;
			if (!/[-:[]/.test(token)) continue;
			// A trailing colon is a JSX/obj key ("align:"), not a variant.
			if (token.endsWith(":")) continue;
			// ARIA/DOM attribute names read as utilities but never emit CSS.
			if (/^aria-/.test(token)) continue;
			tokens.add(token);
		}
	}
	return tokens;
}

/**
 * Tailwind escapes selector-special characters (`.bg-popover\/95`,
 * `.rounded-t-\[94px\]`). Dropping every backslash once lets a raw token be
 * substring-matched directly.
 */
function makeStylesheetProbe(css) {
	const plain = css.replaceAll("\\", "");
	return (token) => {
		let from = 0;
		for (;;) {
			const at = plain.indexOf(`.${token}`, from);
			if (at === -1) return false;
			// Reject `.z-50` matching inside `.z-500`.
			const next = plain[at + token.length + 1] ?? "";
			if (!/[a-zA-Z0-9_-]/.test(next)) return true;
			from = at + 1;
		}
	};
}

/** Resolve `@anvilkit/ui/<subpath>` to its source file, if it has one. */
async function resolveUiModule(subpath) {
	for (const candidate of [
		`${subpath}.tsx`,
		`${subpath}.ts`,
		join(subpath, "index.tsx"),
		join(subpath, "index.ts"),
	]) {
		const full = resolve(UI_SRC, candidate);
		try {
			if ((await stat(full)).isFile()) return full;
		} catch {
			/* keep looking */
		}
	}
	return null;
}

async function main() {
	let css;
	try {
		css = await readFile(STYLESHEET, "utf8");
	} catch {
		console.error("check-ui-classes: dist/styles.css is missing");
		console.error("  Run `pnpm build` (its build:css step emits it) first.");
		process.exit(1);
	}

	try {
		await stat(UI_SRC);
	} catch {
		console.error(`check-ui-classes: cannot resolve ${UI_SRC}`);
		console.error(
			"  `@anvilkit/ui` must be installed for its classes to be compiled.",
		);
		process.exit(1);
	}

	// Which ui modules does the chrome actually render?
	const sourceFiles = await walk(SRC_DIR, (n) => /\.(ts|tsx)$/.test(n));
	const subpaths = new Set();
	for (const file of sourceFiles) {
		const text = await readFile(file, "utf8");
		for (const [, subpath] of text.matchAll(UI_IMPORT)) subpaths.add(subpath);
	}
	if (subpaths.size === 0) {
		console.log("check-ui-classes: OK — no @anvilkit/ui imports to verify.");
		return;
	}

	// Classes this package emits on its own; anything here could reach the
	// stylesheet via the `dist/` glob, so it proves nothing about the ui glob.
	const ownTokens = new Set();
	for (const file of await walk(DIST_DIR, (n) => n.endsWith(".js"))) {
		for (const token of extractClassTokens(await readFile(file, "utf8"))) {
			ownTokens.add(token);
		}
	}

	const inStylesheet = makeStylesheetProbe(css);
	const failures = [];
	const skipped = [];
	let verified = 0;

	for (const subpath of [...subpaths].sort()) {
		const file = await resolveUiModule(subpath);
		if (!file) {
			skipped.push(`${subpath} (no source file — type-only or generated)`);
			continue;
		}
		const exclusive = [
			...extractClassTokens(await readFile(file, "utf8")),
		].filter((token) => !ownTokens.has(token));
		// Extraction deliberately over-collects, so a module with only a handful
		// of exclusive tokens may be carrying pure noise (an import specifier, a
		// DOM attribute) rather than real utilities — too weak a signal to fail
		// on. Modules that actually style something carry dozens; those are the
		// ones whose absence from the stylesheet proves the glob is broken.
		if (exclusive.length < MIN_EXCLUSIVE_TOKENS) {
			skipped.push(
				`${subpath} (${exclusive.length} unique token(s) — too few to assert)`,
			);
			continue;
		}
		const present = exclusive.filter(inStylesheet);
		if (present.length === 0) {
			failures.push({ subpath, sample: exclusive.slice(0, 6) });
		} else {
			verified += 1;
		}
	}

	if (failures.length === 0 && verified > 0) {
		console.log(
			`check-ui-classes: OK — ${verified} @anvilkit/ui module(s) contribute compiled classes.`,
		);
		for (const note of skipped) console.log(`  skipped: ${note}`);
		return;
	}

	// An empty `failures` list is not the same as a pass. Every imported module
	// can be SKIPPED — `resolveUiModule` only guesses `src/<subpath>.{ts,tsx}`
	// and `src/<subpath>/index.{ts,tsx}`, so an exports-map indirection or a
	// nested layout misses, and a module under MIN_EXCLUSIVE_TOKENS is skipped by
	// design. With nothing verified this gate reports OK while asserting nothing,
	// and the invisible-portalled-popup regression it exists to catch sails
	// through. Nothing else in the repo can catch that, so a vacuous run FAILS.
	if (failures.length === 0) {
		console.error("check-ui-classes: FAIL");
		console.error("");
		console.error(
			`All ${subpaths.size} imported @anvilkit/ui module(s) were skipped, so this run`,
		);
		console.error("verified nothing:");
		console.error("");
		for (const note of skipped) console.error(`  skipped: ${note}`);
		console.error("");
		console.error(
			"Fix: confirm resolveUiModule's path guesses still match @anvilkit/ui's",
		);
		console.error(
			`source layout, and that MIN_EXCLUSIVE_TOKENS (${MIN_EXCLUSIVE_TOKENS}) is not`,
		);
		console.error("filtering out every module.");
		process.exit(1);
	}

	console.error("check-ui-classes: FAIL");
	console.error("");
	console.error(
		"These @anvilkit/ui modules are imported but contributed NO utilities to",
	);
	console.error("dist/styles.css, so anything they render will be unstyled:");
	console.error("");
	for (const { subpath, sample } of failures) {
		console.error(`  @anvilkit/ui/${subpath}`);
		console.error(`    missing e.g. ${sample.join(", ")}`);
	}
	console.error("");
	console.error(
		'Fix: ensure src/styles.src.css keeps its `@source "../node_modules/@anvilkit/ui/src/**/*.{ts,tsx}"`',
	);
	console.error("directive, then re-run `pnpm build:css`.");
	process.exit(1);
}

main().catch((error) => {
	console.error("check-ui-classes: crashed unexpectedly");
	console.error(error);
	process.exit(2);
});
