import { fireEvent, screen } from "@testing-library/react";

/**
 * Interaction helpers for `@anvilkit/ui`'s `ColorRow`, which replaced the
 * native `<input type="color">` behind every colour selector.
 *
 * The control is a popover, not an input, so `fireEvent.change` on the trigger
 * does nothing. The shape is:
 *
 * - the trigger carries the caller's `data-testid` and is a BUTTON — its
 *   swatch colour lives in `style.background`, there is no `.value`;
 * - opening it portals a dialog to `document.body` containing a hex field at
 *   `<testId>-hex`, an eyedropper at `<testId>-eyedropper`, and (with `rgb`)
 *   channel inputs at `<testId>-r|-g|-b`;
 * - the hex field applies on blur, and DISMISSAL is what commits: an outside
 *   pointerdown commits, Escape cancels.
 *
 * Pass `scope` (a `render()` container) in test files that do NOT
 * `afterEach(cleanup)` — earlier renders stay mounted and a bare
 * `screen.getByTestId` then matches several triggers at once. The popover is
 * always queried globally, since it portals out of the container.
 */

function findTrigger(testId: string, scope?: HTMLElement): HTMLElement {
	if (!scope) return screen.getByTestId(testId);
	const el = scope.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
	if (!el) throw new Error(`no colour trigger "${testId}" in scope`);
	return el;
}

/** Opens the picker popover (idempotent) and returns its hex input. */
export async function openColor(
	testId: string,
	scope?: HTMLElement,
): Promise<HTMLInputElement> {
	const trigger = findTrigger(testId, scope);
	if (trigger.getAttribute("aria-expanded") !== "true") {
		fireEvent.click(trigger);
	}
	return (await screen.findByTestId(`${testId}-hex`)) as HTMLInputElement;
}

/** Closes the popover the way a user commits: a pointerdown outside it. */
export function commitColor(): void {
	fireEvent.pointerDown(document.body);
}

/**
 * Full "user picked a colour" gesture: open, type the hex, blur to apply, then
 * dismiss so the host sees the commit.
 */
export async function setColor(
	testId: string,
	hex: string,
	scope?: HTMLElement,
): Promise<void> {
	const input = await openColor(testId, scope);
	fireEvent.change(input, { target: { value: hex } });
	fireEvent.blur(input);
	commitColor();
}

/** Opens, edits, then dismisses with Escape — the host should revert. */
export async function cancelColor(
	testId: string,
	hex: string,
	scope?: HTMLElement,
): Promise<void> {
	const input = await openColor(testId, scope);
	fireEvent.change(input, { target: { value: hex } });
	fireEvent.blur(input);
	fireEvent.keyDown(await screen.findByRole("dialog"), { key: "Escape" });
}

/** Sets one R/G/B channel (requires the row to be rendered with `rgb`). */
export async function setColorChannel(
	testId: string,
	channel: "r" | "g" | "b",
	value: number,
	scope?: HTMLElement,
): Promise<void> {
	await openColor(testId, scope);
	const input = await screen.findByTestId(`${testId}-${channel}`);
	fireEvent.change(input, { target: { value: String(value) } });
	commitColor();
}

/** Clicks the eyedropper button, then dismisses so the pick commits. */
export async function pickColorWithEyedropper(
	testId: string,
	scope?: HTMLElement,
): Promise<void> {
	await openColor(testId, scope);
	fireEvent.click(await screen.findByTestId(`${testId}-eyedropper`));
	// The adapter resolves asynchronously; let it apply before dismissing.
	await new Promise((resolve) => setTimeout(resolve, 0));
	commitColor();
}

/** The trigger swatch's current CSS background (there is no `.value`). */
export function colorSwatchBackground(
	testId: string,
	scope?: HTMLElement,
): string {
	const swatch = findTrigger(testId, scope).querySelector("span:last-of-type");
	return (swatch as HTMLElement | null)?.style.background ?? "";
}

/**
 * The hex text a non-compact row displays. The trigger is a button, so there
 * is no `.value` to read.
 */
export function colorRowText(testId: string, scope?: HTMLElement): string {
	return findTrigger(testId, scope).textContent?.trim() ?? "";
}
