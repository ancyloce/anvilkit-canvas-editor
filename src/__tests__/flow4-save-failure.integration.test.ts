import {
	type CanvasIR,
	createCanvasIR,
	createGroup,
	createPage,
	createRect,
} from "@anvilkit/canvas-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasStudioContextValue } from "@/context/canvas-studio-context.js";
import { createSaveController } from "@/persistence/save-controller.js";
import type {
	CanvasPersistenceAdapter,
	CanvasSaveInput,
} from "@/persistence/types.js";
import {
	type DocumentStores,
	replaceDocumentSnapshot,
} from "@/stores/replace-document.js";
import { createSaveStatusStore } from "@/stores/save-status-store.js";
import { createUploadStore } from "@/stores/upload-store.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";

const FIXED_TS = "2026-05-20T00:00:00.000Z";

/**
 * PRD 0012 §17.4 Flow 4 — Save Failure, over the REAL history store and save
 * controller: edit → auto-save fails → error feedback → retry succeeds →
 * reload the document from the adapter → persisted state restored → dirty
 * and clean checkpoint transitions verified at every step.
 */
function fixtureIR(): CanvasIR {
	const page = createPage({ id: "p1" });
	page.root = createGroup({
		id: "root",
		bounds: page.root.bounds,
		children: [
			createRect({
				id: "a",
				transform: { x: 0 },
				bounds: { width: 10, height: 10 },
			}),
		],
	});
	return createCanvasIR({ id: "doc-1", pages: [page], now: () => FIXED_TS });
}

/** A flaky storage backend: fails until told otherwise, then persists. */
function flakyAdapter() {
	let failing = true;
	let stored: CanvasIR | null = null;
	const saves: CanvasSaveInput[] = [];
	const adapter: CanvasPersistenceAdapter = {
		save: async (input) => {
			saves.push(input);
			if (failing) throw new Error("storage unavailable");
			stored = input.ir;
			return { savedAt: FIXED_TS };
		},
		load: async (documentId) => {
			if (!stored || stored.id !== documentId) {
				throw new Error("not found");
			}
			return stored;
		},
	};
	return {
		adapter,
		saves,
		heal: () => {
			failing = false;
		},
		stored: () => stored,
	};
}

function liveSetup() {
	const h = makeHarness({ ir: fixtureIR() });
	const history = h.studioCtx.historyStore;
	const applyCommit: CanvasStudioContextValue["commit"] = (cmd) => {
		const next = history.getState().commit(h.studioCtx.getIR(), cmd);
		h.setIR(next);
		return next;
	};
	h.studioCtx.commit = applyCommit;
	return h;
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("Flow 4 — Save Failure (PRD 0012 §17.4)", () => {
	it("edit → auto-save failure → error → retry → reload → restored, with exact dirty/clean transitions", async () => {
		const h = liveSetup();
		const s = h.studioCtx;
		const backend = flakyAdapter();
		const saveStatusStore = createSaveStatusStore();
		const states: string[] = [];
		const controller = createSaveController({
			adapter: backend.adapter,
			getIR: s.getIR,
			historyStore: s.historyStore,
			saveStatusStore,
			autoSave: { debounceMs: 100, maxWaitMs: 500, maxRetries: 1, retryBaseMs: 50 },
			onSaveStateChange: (state) => states.push(state),
			now: () => FIXED_TS,
		});

		// Clean at rest.
		expect(s.historyStore.getState().isAtSaveCheckpoint()).toBe(true);

		// 1. Edit the document → dirty.
		s.commit({
			type: "node.move",
			nodeId: "a",
			from: { x: 0, y: 0 },
			to: { x: 25, y: 0 },
		});
		expect(saveStatusStore.getState().status).toBe("dirty");
		expect(s.historyStore.getState().isAtSaveCheckpoint()).toBe(false);

		// 2. Auto-save fires and fails; one scheduled retry also fails.
		await vi.advanceTimersByTimeAsync(100);
		expect(backend.saves).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(50);
		expect(backend.saves).toHaveLength(2);

		// 3. Error feedback: status + message for the header pill; retries
		// exhausted, nothing further scheduled.
		expect(saveStatusStore.getState().status).toBe("error");
		expect(saveStatusStore.getState().lastError).toBe("storage unavailable");
		expect(states).toContain("error");
		await vi.advanceTimersByTimeAsync(5_000);
		expect(backend.saves).toHaveLength(2);

		// 4. Backend heals; manual retry succeeds → saved + clean checkpoint.
		backend.heal();
		const ok = await controller.save();
		expect(ok).toBe(true);
		expect(saveStatusStore.getState().status).toBe("saved");
		expect(s.historyStore.getState().isAtSaveCheckpoint()).toBe(true);
		expect(backend.stored()?.id).toBe("doc-1");

		// 5. A further edit re-dirties…
		s.commit({
			type: "node.move",
			nodeId: "a",
			from: { x: 25, y: 0 },
			to: { x: 50, y: 0 },
		});
		expect(saveStatusStore.getState().status).toBe("dirty");

		// …then the user discards it by reloading the persisted document.
		const persisted = await backend.adapter.load?.("doc-1");
		if (!persisted) throw new Error("no persisted document");
		// The lightweight harness wires getIR/setIR without a scene store;
		// stand one in for the replacement, seeded with the live IR.
		const { createSceneStore } = await import("@/stores/scene-store.js");
		const sceneStore = createSceneStore({ initialIR: s.getIR() });
		const stores: DocumentStores = {
			sceneStore,
			historyStore: s.historyStore,
			pagesStore: s.pagesStore,
			selectionStore: s.selectionStore,
			focusStore: s.focusStore,
			draftStore: s.draftStore,
			editingStore: s.editingStore,
			cropStore: s.cropStore,
			penStore: s.penStore,
			pathEditStore: s.pathEditStore,
			guidesStore: s.guidesStore,
			aiJobStore: s.aiJobStore,
			uploadStore: createUploadStore(),
		};
		replaceDocumentSnapshot(stores, persisted, { source: "document-switch" });

		// 6. Persisted state restored: the saved x=25 move, not the discarded 50.
		const rect = sceneStore
			.getState()
			.ir.pages[0]?.root.children.find((n) => n.id === "a");
		expect(rect?.transform.x).toBe(25);

		// 7. Replacement is a fresh, clean checkpoint; undo history is gone and
		// the next edit dirties again from the new baseline.
		expect(s.historyStore.getState().isAtSaveCheckpoint()).toBe(true);
		expect(s.historyStore.getState().past).toHaveLength(0);

		controller.dispose();
	});
});
