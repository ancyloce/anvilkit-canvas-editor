import {
	type CanvasCommandHandler,
	type CanvasIR,
	createCanvasIR,
	createCanvasRuntime,
	createGroup,
	createPage,
	createRect,
} from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import { createHistoryStore } from "../history-store.js";

const FIXED_TS = "2026-05-20T00:00:00.000Z";
const now = () => FIXED_TS;

function fixtureIR(): CanvasIR {
	const rect = createRect({
		id: "rectA",
		bounds: { width: 100, height: 50 },
		fill: "#f00",
	});
	const page = createPage({ id: "page-1" });
	page.root = createGroup({
		id: "page-1-root",
		bounds: page.root.bounds,
		children: [rect],
	});
	return createCanvasIR({ id: "ir-1", title: "t", pages: [page], now });
}

interface CustomTagCommand {
	type: "custom.tag";
}
interface CustomUntagCommand {
	type: "custom.untag";
}

function tagExtension() {
	const tagHandler: CanvasCommandHandler<CustomTagCommand, CustomUntagCommand> =
		{
			type: "custom.tag",
			apply: (cur) => ({
				ir: { ...cur, title: "tagged" },
				inverse: { type: "custom.untag" },
			}),
		};
	const untagHandler: CanvasCommandHandler<
		CustomUntagCommand,
		CustomTagCommand
	> = {
		type: "custom.untag",
		apply: (cur) => ({
			ir: { ...cur, title: "t" },
			inverse: { type: "custom.tag" },
		}),
	};
	return { id: "tag-ext", commands: [tagHandler, untagHandler] };
}

describe("createHistoryStore — injected runtime (P0-7)", () => {
	it("without a runtime, commit still works for built-in commands (default unchanged)", () => {
		const store = createHistoryStore({ now });
		const ir = fixtureIR();
		const next = store.getState().commit(ir, {
			type: "node.move",
			nodeId: "rectA",
			from: { x: 0, y: 0 },
			to: { x: 10, y: 0 },
		});
		expect(next.pages[0]?.root.children[0]?.transform.x).toBe(10);
	});

	it("commits a custom command through an injected runtime", () => {
		const runtime = createCanvasRuntime([tagExtension()]);
		const store = createHistoryStore({ now, apply: runtime.apply });
		const ir = fixtureIR();
		const next = store.getState().commit(ir, { type: "custom.tag" });
		expect(next.title).toBe("tagged");
		expect(store.getState().past).toHaveLength(1);
	});

	it("undoes and redoes a custom command through an injected runtime", () => {
		const runtime = createCanvasRuntime([tagExtension()]);
		const store = createHistoryStore({ now, apply: runtime.apply });
		let ir = fixtureIR();
		ir = store.getState().commit(ir, { type: "custom.tag" });
		expect(ir.title).toBe("tagged");

		ir = store.getState().undo(ir);
		expect(ir.title).toBe("t");
		expect(store.getState().canRedo()).toBe(true);

		ir = store.getState().redo(ir);
		expect(ir.title).toBe("tagged");
	});

	it("commits a batch mixing a built-in and a custom command, and undoes it atomically", () => {
		const runtime = createCanvasRuntime([tagExtension()]);
		const store = createHistoryStore({ now, apply: runtime.apply });
		let ir = fixtureIR();
		ir = store.getState().commitBatch(
			ir,
			[
				{
					type: "node.move",
					nodeId: "rectA",
					from: { x: 0, y: 0 },
					to: { x: 20, y: 0 },
				},
				{ type: "custom.tag" },
			],
			"move+tag",
		);
		expect(ir.pages[0]?.root.children[0]?.transform.x).toBe(20);
		expect(ir.title).toBe("tagged");
		expect(store.getState().past).toHaveLength(1);

		ir = store.getState().undo(ir);
		expect(ir.pages[0]?.root.children[0]?.transform.x).toBe(0);
		expect(ir.title).toBe("t");
	});

	it("a custom command with no runtime injected fails loudly rather than silently no-opping", () => {
		// The default `apply` is core's built-in-only `applyCommand`: its switch
		// has no case (and no default) for "custom.tag", so it returns `undefined`
		// — and `commit` destructures `.inverse`/`.ir` off that, throwing. This
		// documents the failure mode a host sees if it commits a custom command
		// without passing the matching `runtime` (a misconfiguration, not a
		// supported "custom commands are optional" path).
		const store = createHistoryStore({ now });
		const ir = fixtureIR();
		expect(() => store.getState().commit(ir, { type: "custom.tag" })).toThrow();
	});
});

describe("createHistoryStore — enforceLocked (FR-024 / §20.13)", () => {
	function lockedFixture(): CanvasIR {
		const rect = createRect({
			id: "rectA",
			bounds: { width: 100, height: 50 },
			fill: "#f00",
		});
		(rect as { locked?: boolean }).locked = true;
		const page = createPage({ id: "page-1" });
		page.root = createGroup({
			id: "page-1-root",
			bounds: page.root.bounds,
			children: [rect],
		});
		return createCanvasIR({ id: "ir-l", title: "t", pages: [page], now });
	}

	it("throws node-locked for a mutation of a locked node when enabled", () => {
		const store = createHistoryStore({ now, enforceLocked: true });
		expect(() =>
			store.getState().commit(lockedFixture(), {
				type: "node.update",
				nodeId: "rectA",
				kind: "rect",
				patch: { fill: "#0f0" },
			}),
		).toThrow(/locked/i);
	});

	it("allows unlocking a locked node (exemption)", () => {
		const store = createHistoryStore({ now, enforceLocked: true });
		const next = store.getState().commit(lockedFixture(), {
			type: "node.update",
			nodeId: "rectA",
			kind: "rect",
			patch: { locked: false },
		});
		expect(next.pages[0]?.root.children[0]).toMatchObject({ locked: false });
	});

	it("does not enforce on a store without the option (default off)", () => {
		const store = createHistoryStore({ now });
		const next = store.getState().commit(lockedFixture(), {
			type: "node.update",
			nodeId: "rectA",
			kind: "rect",
			patch: { fill: "#0f0" },
		});
		expect(next.pages[0]?.root.children[0]).toMatchObject({ fill: "#0f0" });
	});
});
