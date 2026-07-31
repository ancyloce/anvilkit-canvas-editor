import { fireEvent, screen, waitFor } from "@testing-library/react";

/**
 * Interaction helpers for the inspector's `@anvilkit/ui/select` (Base UI)
 * pickers, which replaced the hand-rolled native `<select>` markup.
 *
 * Three things differ from a native select and bite every test that touches
 * one:
 *
 * 1. Options only exist in the DOM while the popup is OPEN — there is no
 *    `select.options` to read, and no `fireEvent.change` to fire.
 * 2. A plain `fireEvent.click` on an option does NOT reach Base UI's selection
 *    handler in jsdom; it needs a real pointer down+up sequence first.
 * 3. The popup renders through a PORTAL, so its options land at
 *    `document.body` — outside the `container` that `render()` returns. Only
 *    the trigger is scopable; options are always queried globally.
 *
 * The trigger keeps its `data-testid`, but it is a button, and its rendered
 * `textContent` is the selected option's LABEL (localized), not its value.
 *
 * Pass `scope` (a `render()` container) in test files that do NOT
 * `afterEach(cleanup)` — there, earlier renders stay mounted and a bare
 * `screen.getByTestId` matches several triggers at once.
 */

function findTrigger(triggerTestId: string, scope?: HTMLElement): HTMLElement {
	if (!scope) return screen.getByTestId(triggerTestId);
	const el = scope.querySelector<HTMLElement>(
		`[data-testid="${triggerTestId}"]`,
	);
	if (!el) throw new Error(`no select trigger "${triggerTestId}" in scope`);
	return el;
}

/**
 * Opens the popup and returns its options in document order. Idempotent:
 * clicking an already-open trigger would TOGGLE it shut, so the open state is
 * checked first — a test may inspect the options and then pick one.
 */
export async function openSelect(
	triggerTestId: string,
	scope?: HTMLElement,
): Promise<HTMLElement[]> {
	const trigger = findTrigger(triggerTestId, scope);
	if (trigger.getAttribute("aria-expanded") !== "true") {
		fireEvent.click(trigger);
	}
	// Resolve the options through THIS trigger's own `aria-controls` link
	// rather than a global `findAllByRole("option")`: the popup is portalled to
	// document.body, so in a test file without `afterEach(cleanup)` a global
	// query also sees popups belonging to earlier, still-mounted renders — and
	// picking one of those commits against a stale harness.
	return waitFor(() => {
		const listId = trigger.getAttribute("aria-controls");
		const list = listId ? document.getElementById(listId) : null;
		if (!list) throw new Error(`select "${triggerTestId}" did not open`);
		const options = Array.from(
			list.querySelectorAll<HTMLElement>('[role="option"]'),
		);
		if (options.length === 0) {
			throw new Error(`select "${triggerTestId}" rendered no options`);
		}
		return options;
	});
}

/** Visible option labels, in order, for the given trigger. */
export async function optionLabels(
	triggerTestId: string,
	scope?: HTMLElement,
): Promise<string[]> {
	const options = await openSelect(triggerTestId, scope);
	return options.map((o) => o.textContent ?? "");
}

/** Picks the option with the given visible label. */
export async function selectOption(
	triggerTestId: string,
	optionName: string,
	scope?: HTMLElement,
): Promise<void> {
	const options = await openSelect(triggerTestId, scope);
	const option = options.find((o) => o.textContent === optionName);
	if (!option) {
		throw new Error(
			`no option "${optionName}" in ${triggerTestId} (got: ${options
				.map((o) => o.textContent)
				.join(", ")})`,
		);
	}
	fireEvent.pointerDown(option, { pointerId: 1, button: 0 });
	fireEvent.pointerUp(option, { pointerId: 1, button: 0 });
	fireEvent.click(option);
}

/**
 * The label currently shown on a select trigger (its "value", displayed).
 * Reads the `select-value` slot, not the trigger itself — the trigger also
 * contains the chevron icon.
 */
export function selectedLabel(
	triggerTestId: string,
	scope?: HTMLElement,
): string {
	const trigger = findTrigger(triggerTestId, scope);
	const value = trigger.querySelector('[data-slot="select-value"]');
	return (value ?? trigger).textContent ?? "";
}
