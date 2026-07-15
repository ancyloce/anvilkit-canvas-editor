import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import en from "../../i18n/messages/en.json";
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

describe("i18n catalogs (A-11)", () => {
	it("en and zh cover the exact same key set", () => {
		const enKeys = Object.keys(en).sort();
		const zhKeys = Object.keys(zh).sort();
		expect(zhKeys).toEqual(enKeys);
	});

	it("every canvas.* key referenced in src has a catalog entry", () => {
		const used = new Set<string>();
		collectSourceKeys(join(__dirname, ".."), used);
		const missing = [...used].filter((key) => !(key in en)).sort();
		expect(missing).toEqual([]);
	});

	it("no catalog entry is empty", () => {
		for (const [key, value] of Object.entries(en)) {
			expect(value, `en ${key}`).not.toBe("");
		}
		for (const [key, value] of Object.entries(zh)) {
			expect(value, `zh ${key}`).not.toBe("");
		}
	});
});
