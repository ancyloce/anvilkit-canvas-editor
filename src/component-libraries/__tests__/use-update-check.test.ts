import type {
	CanvasExternalComponentRef,
	CanvasIR,
} from "@anvilkit/canvas-core";
import {
	createCanvasIR,
	createComponentInstance,
	insertNode,
} from "@anvilkit/canvas-core";
import { describe, expect, it, vi } from "vitest";

import type {
	CanvasComponentCatalogEntry,
	CanvasComponentProvider,
} from "../component-provider.js";
import {
	checkForComponentUpdates,
	collectExternalRefUsage,
} from "../use-update-check.js";

/**
 * T-028 (discovery half) — read-only update check.
 *
 * AC-002 is "no visual change on discovery", so the assertions that matter are
 * that the document is byte-identical afterwards and that a provider failure
 * does not invalidate what is already stored.
 */

function ref(version: string, integrity = version): CanvasExternalComponentRef {
	return {
		kind: "library",
		libraryId: "acme",
		componentId: "button",
		version,
		integrity: `sha256-${integrity.padEnd(43, "x").slice(0, 43)}`,
	};
}

function entry(
	version: string,
	extra: Partial<CanvasComponentCatalogEntry> = {},
): CanvasComponentCatalogEntry {
	return { ref: ref(version), name: "button", ...extra };
}

function doc(instances = 1, source = ref("1.0.0")): CanvasIR {
	let ir = createCanvasIR({ id: "doc", now: () => "t0" });
	for (let i = 0; i < instances; i += 1) {
		ir = insertNode(ir, {
			parentId: ir.pages[0]?.root.id as string,
			node: createComponentInstance({
				id: `inst-${i + 1}`,
				source,
				bounds: { width: 10, height: 10 },
			}),
			now: () => "t0",
		});
	}
	return ir;
}

function providerWith(
	entries: CanvasComponentCatalogEntry[],
): CanvasComponentProvider {
	return {
		search: () => Promise.resolve({ entries: [] }),
		getEnvelope: () => Promise.resolve(null),
		listVersions: () => Promise.resolve({ entries }),
	};
}

describe("collectExternalRefUsage", () => {
	it("counts instances per distinct ref", async () => {
		const usage = collectExternalRefUsage(doc(3));
		expect([...usage.values()][0]?.count).toBe(3);
	});

	it("finds refs nested inside local Source trees", () => {
		const base = doc(0);
		const ir: CanvasIR = {
			...base,
			components: {
				"cmp-local": {
					id: "cmp-local",
					name: "L",
					revision: 1,
					root: {
						id: "r",
						type: "frame",
						transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
						bounds: { width: 1, height: 1 },
						zIndex: 0,
						children: [
							{
								id: "n",
								type: "component-instance",
								transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
								bounds: { width: 1, height: 1 },
								zIndex: 0,
								source: ref("1.0.0"),
							},
						],
					},
					properties: [],
				},
			},
		} as CanvasIR;
		expect(collectExternalRefUsage(ir).size).toBe(1);
	});
});

describe("checkForComponentUpdates (T-028, AC-002)", () => {
	it("reports a newer version with the affected instance count", async () => {
		const result = await checkForComponentUpdates(
			doc(2),
			providerWith([entry("2.0.0"), entry("1.0.0")]),
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.updates).toHaveLength(1);
		expect(result.updates[0]?.latest.ref.version).toBe("2.0.0");
		expect(result.updates[0]?.affectedInstanceCount).toBe(2);
	});

	it("reports nothing when the newest IS the installed version", async () => {
		const result = await checkForComponentUpdates(
			doc(),
			providerWith([entry("1.0.0")]),
		);
		expect(result.ok && result.updates).toEqual([]);
	});

	it("treats the Provider's FIRST entry as newest, never ordering versions itself", async () => {
		// Version strings are opaque; ordering is information only the host has.
		const result = await checkForComponentUpdates(
			doc(),
			providerWith([entry("0.9.0"), entry("2.0.0")]),
		);
		expect(result.ok && result.updates[0]?.latest.ref.version).toBe("0.9.0");
	});

	it("leaves the document BYTE-IDENTICAL (AC-002)", async () => {
		const ir = doc(2);
		const before = structuredClone(ir);
		await checkForComponentUpdates(ir, providerWith([entry("2.0.0")]));
		expect(ir).toEqual(before);
	});

	it("a provider failure does NOT invalidate the stored snapshot", async () => {
		// Being unable to ask about updates is not evidence the installed
		// version is bad.
		const ir = doc();
		const before = structuredClone(ir);
		const result = await checkForComponentUpdates(ir, {
			search: () => Promise.resolve({ entries: [] }),
			getEnvelope: () => Promise.resolve(null),
			listVersions: () => Promise.reject({ status: 503 }),
		});
		expect(result.ok).toBe(false);
		expect(result.ok === false && result.reason).toBe("provider");
		expect(ir).toEqual(before);
	});

	it("reports an abort as its own outcome", async () => {
		const abort = new Error("x");
		abort.name = "AbortError";
		const result = await checkForComponentUpdates(doc(), {
			search: () => Promise.resolve({ entries: [] }),
			getEnvelope: () => Promise.resolve(null),
			listVersions: () => Promise.reject(abort),
		});
		expect(result.ok === false && result.reason).toBe("aborted");
	});

	it("SANITIZES the release-notes URL", async () => {
		const result = await checkForComponentUpdates(
			doc(),
			providerWith([
				entry("2.0.0", { releaseNotesUrl: "javascript:alert(1)" }),
			]),
		);
		expect(result.ok && result.updates[0]?.releaseNotesUrl).toBeUndefined();
	});

	it("keeps a safe release-notes URL", async () => {
		const result = await checkForComponentUpdates(
			doc(),
			providerWith([
				entry("2.0.0", { releaseNotesUrl: "https://example.com/n" }),
			]),
		);
		expect(result.ok && result.updates[0]?.releaseNotesUrl).toBe(
			"https://example.com/n",
		);
	});

	it("carries a deprecation notice through", async () => {
		const result = await checkForComponentUpdates(
			doc(),
			providerWith([entry("2.0.0", { deprecationNotice: "Use v3" })]),
		);
		expect(result.ok && result.updates[0]?.deprecationNotice).toBe("Use v3");
	});

	it("reports nothing when the Provider cannot enumerate versions", async () => {
		// `listVersions` is optional in the contract, so its absence is not an
		// error.
		const spy = vi.fn();
		const result = await checkForComponentUpdates(doc(), {
			search: () => Promise.resolve({ entries: [] }),
			getEnvelope: spy,
		});
		expect(result.ok && result.updates).toEqual([]);
		expect(spy).not.toHaveBeenCalled();
	});

	it("asks nothing for a document with no external components", async () => {
		const listVersions = vi.fn();
		await checkForComponentUpdates(
			createCanvasIR({ id: "d", now: () => "t0" }),
			{
				search: () => Promise.resolve({ entries: [] }),
				getEnvelope: () => Promise.resolve(null),
				listVersions,
			},
		);
		expect(listVersions).not.toHaveBeenCalled();
	});
});
