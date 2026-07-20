import type { CanvasCommand, CanvasIR } from "@anvilkit/canvas-core";
import type Konva from "konva";
import type { LucideProps } from "lucide-react";
import type { ComponentType } from "react";
import type { CanvasPickedAsset } from "../assets/adapter-types.js";
import type { DraftStoreApi } from "../stores/draft-store.js";
import type { EditingStoreApi } from "../stores/editing-store.js";
import type { CanvasFocusStoreApi } from "../stores/focus-store.js";
import type { GuidesStoreApi } from "../stores/guides-store.js";
import type { IsolationStoreApi } from "../stores/isolation-store.js";
import type { PenStoreApi } from "../stores/pen-store.js";
import type { SelectionStoreApi } from "../stores/selection-store.js";
import type { ToolId, ToolStoreApi } from "../stores/tool-store.js";
import type { ViewportStoreApi } from "../stores/viewport-store.js";
import type { AiToolIntent } from "./ai-intent.js";

/**
 * Per-event context handed to every tool handler. Stable across an interaction —
 * the same ctx that arrives in `onPointerDown` is reused for `onPointerMove` and
 * `onPointerUp` so tools can stash interaction state on it via a closure ref.
 */
export interface ToolContext {
	stage: Konva.Stage;
	getIR: () => CanvasIR;
	commit: (cmd: CanvasCommand) => CanvasIR;
	/**
	 * Apply many commands as one undoable transaction (a single undo step).
	 * Supplied by `<CanvasStudio>` via `ToolInteractionLayer`; optional so
	 * lightweight tool-test contexts may omit it — callers must fall back to
	 * per-command {@link commit} when it is absent.
	 */
	commitBatch?: (
		commands: readonly CanvasCommand[],
		label?: string,
	) => CanvasIR;
	selectionStore: SelectionStoreApi;
	/** Roving keyboard focus (a11y). Optional — lightweight tool tests may omit it. */
	focusStore?: CanvasFocusStoreApi;
	viewportStore: ViewportStoreApi;
	toolStore: ToolStoreApi;
	guidesStore: GuidesStoreApi;
	draftStore: DraftStoreApi;
	editingStore: EditingStoreApi;
	/** Multi-click pen-path state (I3-2). Always supplied by `<CanvasStudio>`. */
	penStore: PenStoreApi;
	pickAsset: () => Promise<string>;
	/**
	 * FR-090 (B-10) multi-select pick: present only when a full `assetPicker`
	 * adapter is wired. Optional — lightweight tool-test contexts, and hosts
	 * without an `assetPicker`, omit it; tools fall back to {@link pickAsset}.
	 */
	pickAssets?: () => Promise<readonly CanvasPickedAsset[]>;
	activePageId: string;
	/**
	 * Hand an AI gesture (marquee region / image selection) to the host. Optional
	 * because the AI host is opt-in — `<CanvasStudio>` always supplies a function
	 * (a no-op when no `onAiIntent` prop is wired), but tool tests may omit it.
	 */
	requestAiIntent?: (intent: AiToolIntent) => void;
	/**
	 * Container isolation stack (C-09, FR-055). Always supplied by
	 * `<CanvasStudio>`; optional so lightweight tool tests may omit it — the
	 * select tool then scopes to the page's top level.
	 */
	isolationStore?: IsolationStoreApi;
}

export interface ToolPointerEvent {
	/** The underlying DOM PointerEvent / MouseEvent / TouchEvent. */
	evt: PointerEvent | MouseEvent | TouchEvent;
	/** Pointer position in world (canvas IR) coordinates. */
	point: { x: number; y: number };
	/** Pointer position in stage screen coordinates (pre-transform). */
	screenPoint: { x: number; y: number };
	stage: Konva.Stage;
	/** Konva.Node directly under the pointer (i.e. e.target). */
	target: Konva.Node;
	shiftKey: boolean;
}

/**
 * Icon component for a tool's chrome presentation (FR-010). Structurally
 * identical to `chrome/icons.ts`'s `ChromeIcon` — re-declared here because
 * `tools/` sits BELOW `chrome/` in `check-layering.mjs` and may not import
 * from it. Any lucide icon (or props-compatible `<svg>` component) fits.
 */
export type ToolIcon = ComponentType<LucideProps>;

export interface Tool {
	id: ToolId;
	/** CSS cursor value applied to the stage container while active. */
	cursor: string;
	/**
	 * FR-010 presentation metadata (all optional — behavior-only tools stay
	 * valid): how this tool appears in the workspace chrome (tool strip
	 * overflow, Elements panel). English display name; falls back to `id`.
	 */
	label?: string;
	/** `canvas.*` i18n key resolved before {@link label} via `t(labelKey, label)`. */
	labelKey?: string;
	/** Chrome icon. Extension tools without one get a generic fallback icon. */
	icon?: ToolIcon;
	/**
	 * DISPLAY-ONLY shortcut hint (e.g. `"K"`), shown when no real key binding
	 * exists for this tool. It does NOT register a binding — pair it with
	 * `CanvasShortcutOptions.extraBindings` (id `tool-<id>`) to actually bind
	 * the key; a real binding's derived label wins over this hint.
	 */
	shortcut?: string;
	/** Consulted per render by chrome surfaces: `true` disables the button. */
	disabled?: () => boolean;
	onActivate?(ctx: ToolContext): void;
	onDeactivate?(ctx: ToolContext): void;
	onPointerDown?(e: ToolPointerEvent, ctx: ToolContext): void;
	onPointerMove?(e: ToolPointerEvent, ctx: ToolContext): void;
	onPointerUp?(e: ToolPointerEvent, ctx: ToolContext): void;
}

export type ToolRegistry = Partial<Record<ToolId, Tool>>;
