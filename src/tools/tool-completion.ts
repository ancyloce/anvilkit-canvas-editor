import type { CanvasCommand } from "@anvilkit/canvas-core";
import type { AnyCanvasCommand } from "../stores/history-store.js";
import type { ToolId } from "../stores/tool-store.js";

/** Tools that never "complete" — they are modes, not creation gestures. */
const NON_CREATION_TOOLS: ReadonlySet<string> = new Set(["select", "hand"]);

function containsNodeCreate(cmds: readonly AnyCanvasCommand[]): boolean {
	return cmds.some((cmd) => {
		if (cmd.type === "node.create") return true;
		if (cmd.type === "batch") {
			return containsNodeCreate(
				(cmd as CanvasCommand & { commands: AnyCanvasCommand[] }).commands,
			);
		}
		return false;
	});
}

/**
 * FR-012 tool completion (A-10): after a creation tool commits its element,
 * the editor returns to Select — unless the host opts into continuous
 * creation. BEHAVIOR CHANGE (PRD 0012 v2): before this, every tool stayed
 * active; pass `continuousCreation` to restore the old behavior.
 */
export function shouldReturnToSelect(
	cmds: readonly AnyCanvasCommand[],
	activeTool: ToolId,
	continuousCreation: boolean,
): boolean {
	if (continuousCreation) return false;
	if (NON_CREATION_TOOLS.has(activeTool)) return false;
	return containsNodeCreate(cmds);
}
