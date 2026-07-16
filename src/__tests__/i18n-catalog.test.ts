import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import en from "../../i18n/messages/en.json";
import ja from "../../i18n/messages/ja.json";
import ko from "../../i18n/messages/ko.json";
import zh from "../../i18n/messages/zh.json";

/**
 * A-11 catalog-completeness gate (PRD 0012 §8.7): the bundled locales must
 * never drift from each other, and every `canvas.*` key referenced in source
 * must have catalog entries. New user-visible strings land with their en+zh
 * entries IN THE SAME CHANGE — this test is what enforces it.
 */

function collectSourceKeys(dir: string, out: Set<string>): void {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			if (entry.name === "__tests__" || entry.name === "node_modules") continue;
			collectSourceKeys(join(dir, entry.name), out);
			continue;
		}
		if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\./.test(entry.name)) {
			continue;
		}
		const text = readFileSync(join(dir, entry.name), "utf8");
		for (const match of text.matchAll(/["'](canvas\.[a-zA-Z0-9.]+)["']/g)) {
			const key = match[1];
			if (key) out.add(key);
		}
	}
}

describe("i18n catalogs (A-11, OD-3: four bundled locales)", () => {
	it("every bundled locale covers the exact same key set", () => {
		const enKeys = Object.keys(en).sort();
		expect(Object.keys(zh).sort()).toEqual(enKeys);
		expect(Object.keys(ja).sort()).toEqual(enKeys);
		expect(Object.keys(ko).sort()).toEqual(enKeys);
	});

	it("every canvas.* key referenced in src has a catalog entry", () => {
		const used = new Set<string>();
		collectSourceKeys(join(__dirname, ".."), used);
		const missing = [...used].filter((key) => !(key in en)).sort();
		expect(missing).toEqual([]);
	});

	it("no catalog entry is empty", () => {
		const catalogs: Array<[string, Record<string, string>]> = [
			["en", en],
			["zh", zh],
			["ja", ja],
			["ko", ko],
		];
		for (const [locale, catalog] of catalogs) {
			for (const [key, value] of Object.entries(catalog)) {
				expect(value, `${locale} ${key}`).not.toBe("");
			}
		}
	});

	it("placeholders survive translation in every locale", () => {
		const placeholderPattern = /\{[a-zA-Z]+\}/g;
		for (const [key, value] of Object.entries(en)) {
			const expected = [...value.matchAll(placeholderPattern)]
				.map((m) => m[0])
				.sort();
			if (expected.length === 0) continue;
			for (const [locale, catalog] of [
				["zh", zh],
				["ja", ja],
				["ko", ko],
			] as Array<[string, Record<string, string>]>) {
				const actual = [...(catalog[key] ?? "").matchAll(placeholderPattern)]
					.map((m) => m[0])
					.sort();
				expect(actual, `${locale} ${key}`).toEqual(expected);
			}
		}
	});
});
