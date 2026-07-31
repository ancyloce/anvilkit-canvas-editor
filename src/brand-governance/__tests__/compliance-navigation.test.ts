import type {
	BrandComplianceIssue,
	CanvasComponentDefinition,
	CanvasIR,
} from "@anvilkit/canvas-core";
import {
	createCanvasIR,
	createComponentInstance,
	createGroup,
	createPage,
	createRect,
} from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";

import { resolveComplianceTarget } from "../use-compliance-navigation.js";

/** T-044 step 2/3 — the resolution table, and locale-independence. */

const DEFINITION = {
	id: "card",
	name: "Card",
	revision: 1,
	root: createGroup({
		id: "card-root",
		children: [
			createRect({
				id: "card-inner",
				bounds: { width: 4, height: 4 },
				fill: "#ff0000",
			}),
		],
	}),
	properties: [],
} as unknown as CanvasComponentDefinition;

function makeIR(): CanvasIR {
	const rect = createRect({
		id: "plain-rect",
		bounds: { width: 10, height: 10 },
		fill: "#ff0000",
	});
	const instance = createComponentInstance({
		id: "inst-1",
		componentId: "card",
		bounds: { width: 10, height: 10 },
	});
	const page2 = createPage({
		id: "p2",
		root: createGroup({ id: "p2-root", children: [instance] }),
	});
	const page1 = createPage({
		id: "p1",
		root: createGroup({ id: "p1-root", children: [rect] }),
	});
	return {
		...createCanvasIR({ id: "doc", pages: [page1, page2] }),
		components: { card: DEFINITION },
	};
}

function issue(over: Partial<BrandComplianceIssue>): BrandComplianceIssue {
	return {
		nodeId: "plain-rect",
		code: "off-brand-color",
		property: "fill",
		value: "#ff0000",
		...over,
	} as BrandComplianceIssue;
}

describe("resolveComplianceTarget", () => {
	const ir = makeIR();

	it("an ordinary page node resolves to its own page", () => {
		const target = resolveComplianceTarget(ir, issue({}));
		expect(target).toMatchObject({
			kind: "node",
			pageId: "p1",
			nodeId: "plain-rect",
		});
	});

	it("finds a node on a page other than the first", () => {
		const target = resolveComplianceTarget(ir, issue({ nodeId: "inst-1" }));
		expect(target).toMatchObject({ kind: "node", pageId: "p2" });
	});

	it("a virtual Source node selects the page-level INSTANCE, not the virtual id", () => {
		// A virtual id is derived from a resolution and changes when the Source or
		// variant changes; selecting one would lapse on the next edit (OD-08).
		const target = resolveComplianceTarget(
			ir,
			issue({ nodeId: "inst-1::card-inner", instanceId: "inst-1" }),
		);
		expect(target).toMatchObject({
			kind: "node",
			nodeId: "inst-1",
			instanceId: "inst-1",
			sourceNodeId: "inst-1::card-inner",
		});
	});

	it("carries property and variant through when present", () => {
		const target = resolveComplianceTarget(
			ir,
			issue({ propertyId: "label", variantId: "size=lg" }),
		);
		expect(target).toMatchObject({ propertyId: "label", variantId: "size=lg" });
	});

	it("omits property/variant entirely when absent (INV-10)", () => {
		const target = resolveComplianceTarget(ir, issue({}));
		expect(target).not.toHaveProperty("propertyId");
		expect(target).not.toHaveProperty("variantId");
	});

	it("a node that only exists inside a Source falls back to the Components panel", () => {
		const target = resolveComplianceTarget(ir, issue({ nodeId: "card-inner" }));
		expect(target).toEqual({ kind: "component", componentId: "card" });
	});

	it("reports an unresolvable issue rather than silently doing nothing", () => {
		expect(resolveComplianceTarget(ir, issue({ nodeId: "ghost" }))).toEqual({
			kind: "unavailable",
		});
	});

	it("resolves identically regardless of locale (T-044 step 3)", () => {
		// There is no localized text in the input at all — `BrandComplianceIssue`
		// has no `message` field — so this is really asserting that the resolver
		// reads only structural ids. A future `message` field plus a lookup keyed
		// on it would break here.
		const a = resolveComplianceTarget(ir, issue({ nodeId: "inst-1" }));
		const b = resolveComplianceTarget(ir, {
			...issue({ nodeId: "inst-1" }),
			// A hostile extra field that a message-based resolver might consult.
			...({ message: "完全に無関係" } as object),
		});
		expect(a).toEqual(b);
	});
});
