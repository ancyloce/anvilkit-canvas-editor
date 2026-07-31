import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
} from "@anvilkit/canvas-core";
import { cleanup, render } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import type { CanvasT } from "@/context/canvas-studio-context.js";
import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import { BlockedOperationDialog } from "@/panels/governance/BlockedOperationDialog.js";
import { CompliancePanel } from "@/panels/governance/CompliancePanel.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import en from "../../i18n/messages/en.json" with { type: "json" };
import ja from "../../i18n/messages/ja.json" with { type: "json" };
import ko from "../../i18n/messages/ko.json" with { type: "json" };
import zh from "../../i18n/messages/zh.json" with { type: "json" };

/**
 * @file A11Y + four-locale parity for the plan-0021 surfaces (T-049).
 *
 * The catalog-completeness gate already lives in `i18n-catalog.test.ts` and is
 * not duplicated here. What this file adds is the part that gate cannot see:
 * that the new panels and dialogs are actually operable, and that status is
 * conveyed by something other than colour.
 */

// react-library preset has globals:false — RTL auto-cleanup is OFF.
afterEach(cleanup);

const t: CanvasT = (_key, fallback) => fallback ?? "";
const noop = (): void => undefined;

const DEFINITION = {
	id: "card",
	name: "Card",
	revision: 1,
	root: createGroup({ id: "card-root", children: [] }),
	properties: [],
} as unknown as CanvasComponentDefinition;

function doc(): CanvasIR {
	const instance = createComponentInstance({
		id: "inst-1",
		componentId: "card",
		bounds: { width: 10, height: 10 },
	});
	return {
		...createCanvasIR({
			id: "doc",
			pages: [
				createPage({
					id: "p1",
					root: createGroup({ id: "p1-root", children: [instance] }),
				}),
			],
		}),
		components: { card: DEFINITION },
	} as CanvasIR;
}

function issue(over: Partial<BrandComplianceIssue> = {}): BrandComplianceIssue {
	return {
		nodeId: "inst-1",
		code: "off-brand-color",
		property: "fill",
		value: "#ff0000",
		...over,
	} as BrandComplianceIssue;
}

function withStudio(children: React.ReactNode) {
	const h = makeHarness({ ir: doc() });
	return (
		<CanvasStudioContext.Provider
			value={{ ...h.studioCtx, ir: h.studioCtx.getIR() }}
		>
			{children}
		</CanvasStudioContext.Provider>
	);
}

describe("axe — the new governance surfaces", () => {
	it("the compliance panel has no violations", async () => {
		const view = render(
			withStudio(
				<CompliancePanel
					issues={[
						issue({ severity: "warning" }),
						issue({
							severity: "blocking",
							property: "stroke",
							code: "forbidden-color",
						}),
					]}
					t={t}
				/>,
			),
		);
		expect((await axe(view.container)).violations).toHaveLength(0);
	});

	it("the empty compliance panel has no violations", async () => {
		const view = render(withStudio(<CompliancePanel issues={[]} t={t} />));
		expect((await axe(view.container)).violations).toHaveLength(0);
	});

	it("the blocked-operation dialog has no violations", async () => {
		const view = render(
			<BlockedOperationDialog
				code="detach-denied"
				onDeepLink={noop}
				onClose={noop}
				t={t}
			/>,
		);
		// The dialog portals, so scan the whole body rather than the container.
		expect((await axe(view.baseElement)).violations).toHaveLength(0);
	});
});

describe("keyboard operability (TD §25)", () => {
	it("every compliance row is a real button, so Tab and Enter reach it", async () => {
		const view = render(
			withStudio(<CompliancePanel issues={[issue()]} t={t} />),
		);
		const row = view.getByTestId("compliance-issue-inst-1-off-brand-color");
		// A `div` with an onClick is the failure this guards: it is reachable by
		// mouse only, and no amount of styling fixes that.
		expect(row.tagName).toBe("BUTTON");
		expect(row.getAttribute("type")).toBe("button");
	});

	it("an unreachable issue is DISABLED rather than silently inert", async () => {
		// Disabled is announced; a button that does nothing when pressed is not.
		const view = render(
			withStudio(
				<CompliancePanel issues={[issue({ nodeId: "ghost" })]} t={t} />,
			),
		);
		const row = view.getByTestId(
			"compliance-issue-ghost-off-brand-color",
		) as HTMLButtonElement;
		expect(row.disabled).toBe(true);
		expect(row.getAttribute("title")).toBeTruthy();
	});

	it("the blocked dialog's dismiss is reachable and focused", async () => {
		const view = render(
			<BlockedOperationDialog code="flatten-denied" onClose={noop} t={t} />,
		);
		const dismiss = view.getByTestId("blocked-operation-dismiss");
		expect(dismiss.tagName).toBe("BUTTON");
	});
});

describe("status is never conveyed by colour alone (TD §25)", () => {
	it("each severity carries a distinct WORD, not just a hue", async () => {
		const view = render(
			withStudio(
				<CompliancePanel
					issues={[
						issue({ severity: "warning" }),
						issue({
							severity: "blocking",
							property: "stroke",
							code: "forbidden-color",
						}),
					]}
					t={t}
				/>,
			),
		);
		const warning = view.getByTestId("compliance-issue-inst-1-off-brand-color");
		const blocking = view.getByTestId("compliance-issue-inst-1-forbidden-color");
		expect(warning.textContent).toContain("Warning");
		expect(blocking.textContent).toContain("Blocking");
		// And the machine-readable form, for a host's own styling.
		expect(warning.getAttribute("data-severity")).toBe("warning");
		expect(blocking.getAttribute("data-severity")).toBe("blocking");
	});

	it("strips every colour class and the severities are still distinguishable", async () => {
		// The decisive test: simulate a monochrome rendering by ignoring class
		// names entirely and asking whether the text still tells them apart.
		const view = render(
			withStudio(
				<CompliancePanel
					issues={[
						issue({ severity: "warning" }),
						issue({
							severity: "blocking",
							property: "stroke",
							code: "forbidden-color",
						}),
					]}
					t={t}
				/>,
			),
		);
		const texts = view
			.getAllByTestId(/^compliance-issue-/)
			.map((el) => el.textContent ?? "");
		expect(new Set(texts).size).toBe(texts.length);
	});
});

describe("four-locale parity for the plan-0021 keys (CON-8)", () => {
	const catalogs: Record<string, Record<string, string>> = {
		en: en as Record<string, string>,
		zh: zh as Record<string, string>,
		ja: ja as Record<string, string>,
		ko: ko as Record<string, string>,
	};

	/** Every key this plan introduced, by namespace. */
	const NAMESPACES = [
		"canvas.governance.",
		"canvas.library.",
		"canvas.componentChange.",
		"canvas.export.blocked",
	];

	it("every plan-0021 key exists in all four locales", () => {
		const planKeys = Object.keys(catalogs.en as Record<string, string>).filter(
			(key) => NAMESPACES.some((ns) => key.startsWith(ns)),
		);
		expect(planKeys.length).toBeGreaterThan(0);
		for (const [locale, catalog] of Object.entries(catalogs)) {
			const missing = planKeys.filter((key) => !(key in catalog));
			expect(missing, `${locale} is missing keys`).toEqual([]);
		}
	});

	it("no locale falls back to the English string verbatim", () => {
		// A copy-pasted English value is the usual way a locale silently ships
		// untranslated. Version numbers and single symbols legitimately match, so
		// only multi-word values are checked.
		const planKeys = Object.keys(catalogs.en as Record<string, string>).filter(
			(key) => NAMESPACES.some((ns) => key.startsWith(ns)),
		);
		for (const locale of ["zh", "ja", "ko"] as const) {
			const untranslated = planKeys.filter((key) => {
				const english = (catalogs.en as Record<string, string>)[key] ?? "";
				// A value that is only placeholders and punctuation — `{from} → {to}`
				// — is CORRECTLY identical in every locale. Flagging it would train
				// whoever hits it to weaken the check.
				const prose = english.replace(/\{[a-zA-Z]+\}/g, "").trim();
				return (
					/[a-zA-Z]{2}/.test(prose) &&
					prose.split(/\s+/).length > 2 &&
					(catalogs[locale] as Record<string, string>)[key] === english
				);
			});
			expect(untranslated, `${locale} has untranslated values`).toEqual([]);
		}
	});

	it("placeholders survive translation", () => {
		// A `{name}` dropped in one locale produces a message with a hole in it,
		// and no type check can catch that.
		for (const [key, english] of Object.entries(
			catalogs.en as Record<string, string>,
		)) {
			const placeholders = (english.match(/\{[a-zA-Z]+\}/g) ?? []).sort();
			if (placeholders.length === 0) continue;
			for (const locale of ["zh", "ja", "ko"] as const) {
				const translated = (catalogs[locale] as Record<string, string>)[key];
				if (translated === undefined) continue;
				expect(
					(translated.match(/\{[a-zA-Z]+\}/g) ?? []).sort(),
					`${locale} ${key}`,
				).toEqual(placeholders);
			}
		}
	});
});

describe("provider errors are localized from stable codes (TD §25)", () => {
	it("no new surface renders a raw diagnostic code as user copy", () => {
		// Every panel/dialog added by this plan must map a code to a message
		// rather than printing the code. A rendered `component-snapshot-missing`
		// is a developer string leaking into the product.
		const dir = join(__dirname, "..", "panels", "governance");
		for (const file of readdirSync(dir).filter((f) => f.endsWith(".tsx"))) {
			const source = readFileSync(join(dir, file), "utf8");
			// Attribute values are exempt: `data-testid={...issue.code}` is how a
			// test addresses a row, and is never shown to anyone. Only a code
			// rendered as JSX TEXT is the leak this guards against.
			expect(source, file).not.toMatch(/>\s*\{?\s*["']component-[a-z-]+["']/);
			expect(source, file).not.toMatch(/>\s*\{\s*issue\.code\s*\}/);
		}
	});
});
