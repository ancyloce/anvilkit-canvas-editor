import {
	type CanvasIR,
	createCanvasIR,
	createGroup,
	createPage,
	createText,
} from "@anvilkit/canvas-core";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { type ReactNode, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasStudioContextValue } from "../context/canvas-studio-context.js";

/**
 * cp2-007 — `CanvasStudioProps.fontCatalog`, proved at BOTH ends.
 *
 * The deliverable is a seam, and a seam is only worth what its two ends are
 * worth. So nothing here asserts that the prop "exists": every test follows a
 * host catalog all the way to a user-visible consequence — a family offered by
 * the real `FontPickerField`, and an `@font-face` rule in the bytes the real
 * `svgExporter` produces through the real headless export action.
 *
 * The negative case is asserted just as hard: with no host catalog, the SVG the
 * exporter emits must be byte-for-byte what it emitted before this task. The
 * studio now always puts a catalog on the export context (the default one), and
 * that must remain invisible — every default entry carries a stylesheet URL and
 * no `source.files`, so the derived manifest is empty and core's `fonts` option
 * normalizes `[]` and `undefined` identically (`core/src/serialize/svg.ts:474`).
 */

function makeMock(type: string) {
	return (props: Record<string, unknown>) => {
		const { children } = props as { children?: ReactNode };
		return <div data-testid={type.toLowerCase()}>{children}</div>;
	};
}

vi.mock("react-konva", () => {
	type StageProps = { children?: ReactNode; ref?: { current: object | null } };
	const Stage = (props: StageProps) => {
		if (props.ref && "current" in props.ref) {
			const container = document.createElement("div");
			props.ref.current = {
				destroy: vi.fn(),
				on: vi.fn(),
				off: vi.fn(),
				container: () => container,
				getPointerPosition: () => null,
			};
		}
		return <div data-testid="stage">{props.children}</div>;
	};
	return {
		Stage,
		Layer: makeMock("Layer"),
		Group: makeMock("Group"),
		Rect: makeMock("Rect"),
		Ellipse: makeMock("Ellipse"),
		Line: makeMock("Line"),
		Shape: makeMock("Shape"),
		Path: makeMock("Path"),
		Text: makeMock("Text"),
		Image: makeMock("Image"),
		Label: makeMock("Label"),
		Tag: makeMock("Tag"),
		Transformer: makeMock("Transformer"),
	};
});

vi.mock("use-image", () => ({ default: () => [null, "loading"] }));

vi.mock("../render/rasterize-page.js", () => ({
	rasterizePage: vi.fn(async ({ page }: { page: { id: string } }) => ({
		url: `data:thumb/${page.id}`,
		mimeType: "image/png",
	})),
}));

import { useCanvasFontCatalog } from "../context/use-font-catalog.js";
import { createCanvasStudioActions } from "../header/export-action.js";
import { createSvgExporter } from "../header/exporters.js";
import type {
	CanvasExportContext,
	CanvasExportRequest,
} from "../header/types.js";
import { CanvasStudio, useCanvasStudio } from "../index.js";
import { FontPickerField } from "../panels/font-picker-field.js";
import {
	FONT_PREVIEW_LINK_ATTRIBUTE,
	resetFontStylesheetsForTests,
} from "../panels/font-preview.js";
import { DEFAULT_FONT_CATALOG } from "../text/default-font-catalog.js";
import type {
	CanvasFontCatalog,
	CanvasFontCatalogEntry,
} from "../text/font-catalog.js";
import { createFontCatalog } from "../text/font-catalog.js";
import { resetFontStatusesForTests } from "../text/font-status.js";

const REQUEST: CanvasExportRequest = {
	quality: 1,
	resolution: 1,
	stripMetadata: false,
};

/** A host family the default catalog has never heard of, WITH real bytes. */
const HOST_ONLY: CanvasFontCatalogEntry = {
	family: "Acme Grotesk",
	category: "sans",
	weights: [{ min: 100, max: 900 }],
	license: "LicenseRef-Acme-Corporate",
	source: {
		kind: "files",
		files: [
			{
				url: "https://cdn.acme.example/acme-grotesk-var.woff2",
				format: "woff2",
				weight: { min: 100, max: 900 },
			},
		],
	},
};

/**
 * A host cut of a family the DEFAULT catalog also ships (`Inter`, metadata
 * only). This is the "replace" half of the acceptance criterion: the host entry
 * must win whole-entry, licence included, and must be the one that exports.
 */
const HOST_OVERRIDE: CanvasFontCatalogEntry = {
	family: "Inter",
	category: "sans",
	weights: [400],
	license: "LicenseRef-Acme-Corporate",
	source: {
		kind: "files",
		files: [
			{
				url: "https://cdn.acme.example/inter-acme.woff2",
				format: "woff2",
				weight: 400,
			},
		],
	},
};

const hostCatalog: CanvasFontCatalog = createFontCatalog([
	HOST_ONLY,
	HOST_OVERRIDE,
]);

function fixtureIR(families: readonly string[]): CanvasIR {
	return createCanvasIR({
		id: "doc-1",
		title: "Fonts",
		pages: [
			createPage({
				id: "p1",
				size: { width: 400, height: 200 },
				root: createGroup({
					id: "root",
					bounds: { width: 400, height: 200 },
					children: families.map((family, index) =>
						createText({
							id: `t${index}`,
							bounds: { x: 0, y: 0, width: 200, height: 24 },
							text: "Hello",
							fontFamily: family,
						}),
					),
				}),
			}),
		],
		now: () => "2026-01-01T00:00:00.000Z",
	});
}

let ctx: CanvasStudioContextValue | undefined;
let hookCatalog: CanvasFontCatalog | undefined;

function CaptureCtx(): null {
	const value = useCanvasStudio();
	const catalog = useCanvasFontCatalog();
	useEffect(() => {
		ctx = value;
		hookCatalog = catalog;
	});
	ctx = value;
	hookCatalog = catalog;
	return null;
}

/**
 * The picker as `cp2-004` will mount it: the catalog comes from the studio, not
 * from a literal at the call site. If the prop stops reaching the context this
 * component renders the default catalog and the host family disappears.
 */
function PickerUnderStudio(): React.JSX.Element {
	return (
		<FontPickerField
			label="Font"
			value=""
			catalog={useCanvasFontCatalog()}
			dataTestId="font-picker"
			t={(_key, fallback) => fallback ?? _key}
		/>
	);
}

function mount(props: Record<string, unknown> = {}, children?: ReactNode) {
	return render(
		<CanvasStudio
			initialIR={fixtureIR(["Acme Grotesk", "Inter"])}
			initialActivePageId="p1"
			{...props}
		>
			<CaptureCtx />
			{children}
		</CanvasStudio>,
	);
}

/** Base UI opens a `Combobox.Trigger` on a real pointer sequence, not a click. */
async function openPicker(): Promise<HTMLElement[]> {
	const trigger = screen.getByTestId("font-picker");
	trigger.focus();
	for (const [type, init] of [
		["pointerDown", { pointerId: 1, button: 0, pointerType: "mouse" }],
		["mouseDown", { button: 0 }],
		["pointerUp", { pointerId: 1, button: 0, pointerType: "mouse" }],
		["mouseUp", { button: 0 }],
		["click", {}],
	] as const) {
		fireEvent[type as "click"](trigger, init as Record<string, unknown>);
	}
	return waitFor(() => {
		const content = document.querySelector<HTMLElement>(
			'[data-slot="combobox-content"]',
		);
		const options = content
			? Array.from(content.querySelectorAll<HTMLElement>('[role="option"]'))
			: [];
		if (options.length === 0) throw new Error("picker did not open");
		return options;
	});
}

function offeredFamilies(): string[] {
	const content = document.querySelector<HTMLElement>(
		'[data-slot="combobox-content"]',
	);
	return content
		? Array.from(
				content.querySelectorAll<HTMLElement>("[data-font-family]"),
			).map((element) => element.dataset.fontFamily ?? "")
		: [];
}

beforeEach(() => {
	ctx = undefined;
	hookCatalog = undefined;
	resetFontStatusesForTests();
	resetFontStylesheetsForTests();
	for (const link of document.head.querySelectorAll(
		`link[${FONT_PREVIEW_LINK_ATTRIBUTE}]`,
	)) {
		link.remove();
	}
});

// The react-library preset runs `globals: false`, so RTL auto-cleanup is OFF.
afterEach(cleanup);

describe("the prop resolves to ONE catalog on the studio context", () => {
	it("is the default catalog itself when the host passes nothing", () => {
		mount();
		expect(ctx?.fontCatalog).toBe(DEFAULT_FONT_CATALOG);
		expect(hookCatalog).toBe(DEFAULT_FONT_CATALOG);
	});

	it("merges a host catalog over the default, keeping every default family", () => {
		mount({ fontCatalog: hostCatalog });
		const resolved = ctx?.fontCatalog;
		expect(resolved).toBeDefined();
		expect(resolved?.get("Acme Grotesk")?.origin).toBe("host");
		// +1 family: `Inter` is REPLACED, not appended.
		expect(resolved?.entries.length).toBe(
			DEFAULT_FONT_CATALOG.entries.length + 1,
		);
		for (const entry of DEFAULT_FONT_CATALOG.entries) {
			expect(resolved?.get(entry.family)).toBeDefined();
		}
	});

	it("replaces a same-named default family WHOLE-ENTRY, licence included", () => {
		mount({ fontCatalog: hostCatalog });
		const inter = ctx?.fontCatalog?.get("Inter");
		expect(inter?.origin).toBe("host");
		expect(inter?.license).toBe("LicenseRef-Acme-Corporate");
		expect(inter?.source.kind).toBe("files");
		// The default `Inter` is OFL-1.1 with a css source; no field survived.
		expect(DEFAULT_FONT_CATALOG.get("Inter")?.license).toBe("OFL-1.1");
	});

	it("hands `useCanvasFontCatalog` the same object the context carries", () => {
		mount({ fontCatalog: hostCatalog });
		expect(hookCatalog).toBe(ctx?.fontCatalog);
	});
});

describe("consumer 1 — the picker", () => {
	/**
	 * Asserted by COUNT as well as by membership, in both directions. A bare
	 * `not.toContain` would also pass against an empty popup, which is exactly
	 * the failure mode a broken seam produces.
	 */
	it("offers a host-only family the default catalog does not contain", async () => {
		expect(DEFAULT_FONT_CATALOG.get("Acme Grotesk")).toBeUndefined();
		mount({ fontCatalog: hostCatalog }, <PickerUnderStudio />);
		await openPicker();
		const offered = offeredFamilies();
		expect(offered).toContain("Acme Grotesk");
		expect(offered.length).toBe(DEFAULT_FONT_CATALOG.entries.length + 1);
	});

	it("offers exactly the default families when the host wired no catalog", async () => {
		mount({}, <PickerUnderStudio />);
		await openPicker();
		const offered = offeredFamilies();
		expect(offered.length).toBe(DEFAULT_FONT_CATALOG.entries.length);
		expect(offered).not.toContain("Acme Grotesk");
	});
});

describe("consumer 2 — the export @font-face manifest", () => {
	it("embeds a host family through the built-in svgExporter and the real action", async () => {
		mount({ fontCatalog: hostCatalog });
		if (!ctx) throw new Error("the studio context was never captured");
		const result = await createCanvasStudioActions(ctx).export({
			format: "svg",
		});
		const svg = await result.artifacts[0]?.blob.text();
		expect(svg).toContain(
			'@font-face{font-family:"Acme Grotesk";src:url("https://cdn.acme.example/acme-grotesk-var.woff2") format("woff2");font-weight:100 900;font-style:normal;}',
		);
		// The host's cut of `Inter` exports; the default's metadata-only one could not.
		expect(svg).toContain(
			'src:url("https://cdn.acme.example/inter-acme.woff2")',
		);
	});

	it("emits NO @font-face when the host wired no catalog — the default ships no bytes", async () => {
		mount();
		if (!ctx) throw new Error("the studio context was never captured");
		// The default catalog IS on the context here, so this is the assertion that
		// the metadata-only default is genuinely inert at export.
		expect(ctx.fontCatalog).toBe(DEFAULT_FONT_CATALOG);
		const result = await createCanvasStudioActions(ctx).export({
			format: "svg",
		});
		const svg = await result.artifacts[0]?.blob.text();
		expect(svg).not.toContain("@font-face");
		expect(
			result.warnings.some(
				(warning) => warning.code === "FONT_NOT_IN_MANIFEST",
			),
		).toBe(true);
	});
});

describe("nothing changes for a host that wired nothing", () => {
	const bare = (ir: CanvasIR): CanvasExportContext => ({
		ir,
		activePageId: "p1",
		stage: null,
	});

	it("produces byte-identical SVG with and without the default catalog on the context", async () => {
		const ir = fixtureIR(["Inter"]);
		const before = await createSvgExporter()(bare(ir), REQUEST);
		const after = await createSvgExporter()(
			{ ...bare(ir), fontCatalog: DEFAULT_FONT_CATALOG },
			REQUEST,
		);
		expect(String(after.data)).toBe(String(before.data));
	});

	it("still lets an exporter's own `fontCatalog` option override the context", async () => {
		const ir = fixtureIR(["Acme Grotesk"]);
		const artifact = await createSvgExporter({ fontCatalog: hostCatalog })(
			// The context deliberately carries the INERT default; the option wins.
			{ ...bare(ir), fontCatalog: DEFAULT_FONT_CATALOG },
			REQUEST,
		);
		expect(String(artifact.data)).toContain(
			'src:url("https://cdn.acme.example/acme-grotesk-var.woff2")',
		);
	});
});
