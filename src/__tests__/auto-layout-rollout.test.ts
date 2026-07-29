import type { CanvasIR, CanvasNode } from "@anvilkit/canvas-core";
import {
	applyCommand,
	createCanvasIR,
	createFrame,
	createPage,
	createRect,
	flattenCanvasLayout,
	insertNode,
	resolveCanvasLayout,
} from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import { loadCanvasDocument } from "@/persistence/load-pipeline.js";
import { prepareDocumentForSave } from "@/persistence/save-pipeline.js";

/**
 * @file T-M5-05 (TS-59) — scripted rollout/rollback rehearsal against PRD
 * §19 and plan §9.4/§9.6. The flag-phase UI rehearsal (creation affordances
 * appear ONLY behind the opt-in flag; editing existing intent and export are
 * never gated) is pinned by `auto-layout-section.test.tsx` (TS-28 block);
 * this file rehearses the DOCUMENT-safety half: rollback never strips
 * fields, rolled-back editors keep editing, and emergency flatten produces a
 * NEW document while the original survives untouched.
 */

const FIXED_TS = "2026-07-28T00:00:00.000Z";

const LAYOUT = {
	version: 1,
	direction: "horizontal",
	padding: { top: 0, right: 0, bottom: 0, left: 0 },
	gap: 10,
	primaryAlign: "start",
	crossAlign: "start",
} as const;

function journeyIr(): CanvasIR {
	const frame: CanvasNode = {
		...createFrame({ id: "f1", bounds: { width: 200, height: 100 } }),
		autoLayout: LAYOUT,
		children: [
			{
				...createRect({ id: "r1", bounds: { width: 40, height: 20 } }),
				layoutItem: { widthSizing: "fill" as const },
				// Node-level unknown key — must survive every rollback path.
				vendorNodeMeta: { origin: "campaign-7" },
			} as CanvasNode,
			createRect({ id: "r2", bounds: { width: 40, height: 20 } }),
		],
	} as CanvasNode;
	const page = createPage({ id: "p1" });
	let ir = createCanvasIR({
		id: "rollout-doc",
		title: "rollout",
		pages: [page],
		now: () => FIXED_TS,
	});
	ir = insertNode(ir, { parentId: page.root.id, node: frame });
	return { ...ir, vendorExtension: { theme: "spring" } } as CanvasIR;
}

function frameOf(ir: CanvasIR): CanvasNode & {
	autoLayout?: unknown;
	children: CanvasNode[];
} {
	return ir.pages[0]?.root.children[0] as CanvasNode & {
		autoLayout?: unknown;
		children: CanvasNode[];
	};
}

describe("rollback never strips fields (PRD §19)", () => {
	it("save → load round trip preserves autoLayout, layoutItem, capability, and unknown keys", () => {
		const saved = prepareDocumentForSave(journeyIr(), 3);
		const loaded = loadCanvasDocument(JSON.stringify(saved));
		const frame = frameOf(loaded);
		expect(frame.autoLayout).toEqual(LAYOUT);
		expect(frame.children[0]?.layoutItem).toEqual({ widthSizing: "fill" });
		expect(
			(frame.children[0] as unknown as Record<string, unknown>).vendorNodeMeta,
		).toEqual({ origin: "campaign-7" });
		expect(loaded.compatibility?.requiredCapabilities).toEqual([
			"layout.auto.v1",
		]);
		expect(
			(loaded as unknown as Record<string, unknown>).vendorExtension,
		).toEqual({ theme: "spring" });
	});

	it("a rolled-back editor (creation disabled) still edits the document — the flag gates UI, never commands", () => {
		// Simulates Phase-3 → Phase-2 rollback: creation UI is gone, but the
		// command pipeline treats the layout document like any other. Only an
		// UNSUPPORTED capability gates commits (AC-010), never the flag.
		const saved = prepareDocumentForSave(journeyIr(), 3);
		const edited = applyCommand(saved, {
			type: "node.move",
			nodeId: "r2",
			from: { x: 0, y: 0 },
			to: { x: 9, y: 9 },
		}).ir;
		expect(frameOf(edited).autoLayout).toEqual(LAYOUT);
		expect(edited.compatibility?.requiredCapabilities).toEqual([
			"layout.auto.v1",
		]);
	});
});

describe("emergency flatten creates a NEW document (PRD §19, plan §9.6)", () => {
	it("the host recipe: flatten, assign a new identity, never overwrite the original", () => {
		const original = journeyIr();
		const before = JSON.parse(JSON.stringify(original));
		const resolved = resolveCanvasLayout(original, {});

		// The documented host recipe — flatten is deliberately lossy, so the
		// result MUST be written somewhere new; the original stays the source
		// of truth for un-flattening.
		const flattened: CanvasIR = {
			...flattenCanvasLayout(original, { resolved }),
			id: `${original.id}-flattened`,
		};

		// The original is untouched, byte for byte.
		expect(JSON.parse(JSON.stringify(original))).toEqual(before);
		// The copy carries materialized geometry with intent stripped…
		const flatFrame = frameOf(flattened);
		expect(flatFrame.autoLayout).toBeUndefined();
		expect(flatFrame.children[0]?.layoutItem).toBeUndefined();
		expect(flatFrame.children[1]?.transform.x).toBeGreaterThan(0);
		// …no stamp, no layout capability (older readers may open it)…
		expect(flattened.layoutMaterialization).toBeUndefined();
		expect(flattened.compatibility?.requiredCapabilities ?? []).not.toContain(
			"layout.auto.v1",
		);
		// …its own identity, and the unknown keys still intact.
		expect(flattened.id).not.toBe(original.id);
		expect(
			(flatFrame.children[0] as unknown as Record<string, unknown>)
				.vendorNodeMeta,
		).toEqual({ origin: "campaign-7" });
	});
});
