import { fireEvent, screen, waitFor } from "@testing-library/react";

/**
 * Interaction helpers for the inspector's `FontPickerField` (`cp2-003`), which
 * replaced the Font row's free-text `TextField` in `cp2-004`.
 *
 * It is an `@anvilkit/ui/combobox` (Base UI), so it shares every gotcha
 * `_select-test-helpers.ts` documents for the selects — options exist only
 * while open, the popup is PORTALLED to `document.body`, and a bare
 * `fireEvent.click` on the trigger does not open it — plus two of its own:
 *
 * 1. The search input lives INSIDE the popup, so it is portalled too and can
 *    never be found through the `render()` container.
 * 2. An option is picked by keyboard here, not by a pointer sequence. That is
 *    not a preference: cp2-003's own suite proves keyboard selection works in
 *    jsdom, and it also proves the acceptance criterion that every option is
 *    reachable without a pointer. Filtering to the wanted family first keeps
 *    the arrow count to one, whatever the catalog's size.
 *
 * `scope` behaves exactly as in `_select-test-helpers.ts`: pass the `render()`
 * container in files that do NOT `afterEach(cleanup)`, where earlier renders
 * stay mounted and a bare `getByTestId` matches several triggers at once.
 */

function findTrigger(triggerTestId: string, scope?: HTMLElement): HTMLElement {
	if (!scope) return screen.getByTestId(triggerTestId);
	const el = scope.querySelector<HTMLElement>(
		`[data-testid="${triggerTestId}"]`,
	);
	if (!el)
		throw new Error(`no font picker trigger "${triggerTestId}" in scope`);
	return el;
}

/**
 * This trigger's own popup. Resolved through `aria-controls` where Base UI
 * publishes it, so a stale popup belonging to an earlier still-mounted render
 * can never be mistaken for this one; the ambiguity is reported rather than
 * guessed at.
 */
function popupFor(trigger: HTMLElement): HTMLElement | null {
	const listId = trigger.getAttribute("aria-controls");
	const list = listId ? document.getElementById(listId) : null;
	if (list) {
		return list.closest<HTMLElement>('[data-slot="combobox-content"]') ?? list;
	}
	const open = document.querySelectorAll<HTMLElement>(
		'[data-slot="combobox-content"]',
	);
	if (open.length > 1) {
		throw new Error(
			`ambiguous font picker popup: ${open.length} are open at once`,
		);
	}
	return open[0] ?? null;
}

/**
 * Opens the picker and returns its popup. Base UI's `Combobox.Trigger` needs a
 * real pointer down+up before the click, exactly like the selects.
 */
export async function openFontPicker(
	triggerTestId: string,
	scope?: HTMLElement,
): Promise<HTMLElement> {
	const trigger = findTrigger(triggerTestId, scope);
	if (trigger.getAttribute("aria-expanded") !== "true") {
		trigger.focus();
		fireEvent.pointerDown(trigger, {
			pointerId: 1,
			button: 0,
			pointerType: "mouse",
		});
		fireEvent.mouseDown(trigger, { button: 0 });
		fireEvent.pointerUp(trigger, {
			pointerId: 1,
			button: 0,
			pointerType: "mouse",
		});
		fireEvent.mouseUp(trigger, { button: 0 });
		fireEvent.click(trigger);
	}
	return waitFor(() => {
		const popup = popupFor(trigger);
		if (!popup) throw new Error(`font picker "${triggerTestId}" did not open`);
		return popup;
	});
}

/** Option rows currently rendered in this picker, in document order. */
export function fontOptionLabels(popup: HTMLElement): string[] {
	return Array.from(popup.querySelectorAll<HTMLElement>('[role="option"]')).map(
		(option) => option.textContent ?? "",
	);
}

/** Group headings currently rendered, in order (Brand → Recent → All fonts). */
export function fontGroupLabels(popup: HTMLElement): string[] {
	return Array.from(
		popup.querySelectorAll<HTMLElement>('[data-slot="combobox-label"]'),
	).map((label) => label.textContent ?? "");
}

/**
 * Picks a family: open, type it into the search box, then take the single
 * remaining row with ArrowDown + Enter.
 *
 * Works for a catalog family and for a family the catalog has never heard of
 * alike — the latter lands on the trailing "Custom" group's `Use "<query>"`
 * row, which is the free-text escape hatch `cp2-004` depends on.
 */
export async function pickFont(
	triggerTestId: string,
	family: string,
	scope?: HTMLElement,
): Promise<void> {
	const popup = await openFontPicker(triggerTestId, scope);
	const search = popup.querySelector<HTMLElement>(
		`[data-testid="${triggerTestId}-search"]`,
	);
	if (!search) throw new Error(`font picker "${triggerTestId}" has no search`);
	fireEvent.change(search, { target: { value: family } });
	await waitFor(() => {
		const options = fontOptionLabels(popup);
		if (options.length !== 1) {
			throw new Error(
				`expected "${family}" to narrow to one row, got: ${options.join(", ")}`,
			);
		}
	});
	fireEvent.keyDown(search, { key: "ArrowDown" });
	fireEvent.keyDown(search, { key: "Enter" });
}

/** The family currently shown on the trigger (or the "Mixed"/unset placeholder). */
export function fontTriggerText(
	triggerTestId: string,
	scope?: HTMLElement,
): string {
	const trigger = findTrigger(triggerTestId, scope);
	const value = trigger.querySelector(`[data-testid="${triggerTestId}-value"]`);
	return (value ?? trigger).textContent ?? "";
}
