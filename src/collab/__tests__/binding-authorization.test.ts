import { createCanvasIR } from "@anvilkit/canvas-core";
import { describe, expect, it, vi } from "vitest";
import { Doc as YDoc } from "yjs";
import type { CanvasAuthorizationDecision } from "@/sharing/authorization.js";
import { createSceneStore } from "@/stores/scene-store.js";
import { createCanvasYjsBinding } from "../binding.js";

describe("Canvas Yjs provider authorization", () => {
	it("reverts a direct local store write before it reaches shared state", () => {
		const initial = createCanvasIR({ id: "document-1", title: "Before" });
		const sceneStore = createSceneStore({ initialIR: initial });
		const onDenied = vi.fn();
		let decision: CanvasAuthorizationDecision = {
			allowed: false,
			code: "denied-role",
			role: "commenter",
			matchedScope: { kind: "document", id: "document-1" },
		};
		const binding = createCanvasYjsBinding({
			doc: new YDoc(),
			sceneStore,
			peer: { id: "commenter-1" },
			authorizeLocalWrite: () => decision,
			onAuthorizationDenied: onDenied,
		});

		sceneStore.getState().setIR(
			createCanvasIR({ id: "document-1", title: "Unauthorized" }),
		);
		expect(sceneStore.getState().ir.title).toBe("Before");
		expect(binding.current()?.title).toBe("Before");
		expect(onDenied).toHaveBeenCalledOnce();

		decision = {
			allowed: true,
			code: "allowed",
			role: "editor",
			matchedScope: { kind: "document", id: "document-1" },
		};
		sceneStore
			.getState()
			.setIR(createCanvasIR({ id: "document-1", title: "Authorized" }));
		expect(binding.current()?.title).toBe("Authorized");
		binding.destroy();
	});
});
