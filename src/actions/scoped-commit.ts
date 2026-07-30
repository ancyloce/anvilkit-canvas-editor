import type {
	CanvasCommand,
	CanvasDocumentLocation,
} from "@anvilkit/canvas-core";
import type { AnyCanvasCommand } from "../stores/history-store.js";

/**
 * @file Stamping the active Source scope onto outgoing commands
 * (plan 0023 M5-03, LC-CREATE-002).
 *
 * While a Component Source is open, the editor's surfaces address nodes in the
 * DEFINITION tree — but every tool, inspector field and action builds commands
 * the same way it always has, by node id alone. A command with no `location`
 * resolves against `ir.pages`, so a Source node id would simply not be found and
 * the edit would throw out of the commit pipeline.
 *
 * Rather than teach every producer about scopes, the scope is stamped at the ONE
 * choke point every mutation already passes through (the commit pipeline). That
 * keeps Source editing "the same renderers, Inspector, tools and commands" the
 * plan asks for, with one place to reason about instead of dozens.
 */

/**
 * The command members that ACCEPT a `location`, derived from core's own union
 * rather than listed by hand.
 *
 * `keyof` includes optional keys, so the distributive conditional below selects
 * exactly the members extending `CanvasCommandLocationOptions`.
 */
type WithLocation<T> = T extends unknown
	? "location" extends keyof T
		? T
		: never
	: never;

export type CanvasScopedCommandType = WithLocation<CanvasCommand>["type"];

/**
 * The same set as a runtime lookup.
 *
 * Typed as a TOTAL record over {@link CanvasScopedCommandType}, so if core ever
 * adds (or removes) a location-aware command this file stops compiling instead
 * of silently dropping the scope from the new one — the drift that would corrupt
 * an edit by applying it to a page tree.
 */
const SCOPED_COMMAND_TYPES: Record<CanvasScopedCommandType, true> = {
	"node.create": true,
	"node.move": true,
	"node.resize": true,
	"node.rotate": true,
	"node.delete": true,
	"node.reorder": true,
	"node.reparent": true,
	"node.update": true,
	// `node.applyStyle`, NOT `node.apply-style` — the one command in the union
	// that is camelCase. The total-record check above is what caught the guess.
	"node.applyStyle": true,
	"node.group": true,
	"node.ungroup": true,
	"image.replace": true,
	"frame.set-layout": true,
	"frame.remove-layout": true,
	"component-instance.insert": true,
	"component-instance.set-override": true,
	"component-instance.reset-override": true,
	"component-instance.reset-all-overrides": true,
	"component-instance.detach": true,
	// `component.create` in `from-selection` mode carries a location too: it says
	// which tree the SELECTION lives in, so creating a component from nodes inside
	// an open Source works. Registry-only modes ignore it.
	"component.create": true,
};

function acceptsLocation(type: string): type is CanvasScopedCommandType {
	return Object.hasOwn(SCOPED_COMMAND_TYPES, type);
}

/**
 * Stamp `location` onto a command (and, recursively, a batch's sub-commands) so
 * it applies inside the open Source instead of the page tree.
 *
 * Deliberately conservative:
 * - a command that does not accept `location` is returned UNTOUCHED — page,
 *   asset and Registry commands are document-level by design and must not be
 *   redirected into a definition tree;
 * - an EXPLICIT location already on the command wins, so a caller that knows its
 *   own scope (the M3 detach-all planner, a cross-scope undo inverse) is never
 *   overridden;
 * - nothing is cloned unless something actually changes, so the common
 *   page-scoped path allocates nothing.
 */
export function withComponentLocation(
	command: AnyCanvasCommand,
	componentId: string,
): AnyCanvasCommand {
	const location: CanvasDocumentLocation = {
		kind: "component",
		id: componentId,
	};
	const type = (command as { type?: unknown }).type;
	if (typeof type !== "string") return command;

	if (type === "batch") {
		const nested = (command as { commands?: readonly AnyCanvasCommand[] })
			.commands;
		if (!Array.isArray(nested)) return command;
		let changed = false;
		const stamped = nested.map((sub) => {
			const next = withComponentLocation(sub, componentId);
			if (next !== sub) changed = true;
			return next;
		});
		// ONE contained cast, the same pattern `history-store`'s dispatch boundary
		// uses: `AnyCanvasCommand` widens to `{type: string}` for host runtime
		// commands, which no structural spread can narrow back on its own.
		return changed
			? ({ ...command, commands: stamped } as AnyCanvasCommand)
			: command;
	}

	if (!acceptsLocation(type)) return command;
	if (
		(command as { location?: CanvasDocumentLocation }).location !== undefined
	) {
		return command;
	}
	return { ...command, location } as AnyCanvasCommand;
}
