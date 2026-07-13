"use client";

import { type CanvasPathNode, findNode } from "@anvilkit/canvas-core";
import type Konva from "konva";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Circle, Line, Path, Rect } from "react-konva";
import { useCanvasStudio } from "../context/canvas-studio-context.js";
import type { PathEditStoreApi } from "../stores/path-edit-store.js";
import {
	movePathControl,
	type ParsedPath,
	type Pt,
	parsePathD,
	pathControlPoints,
	serializeParsedPath,
} from "../tools/path-edit-geometry.js";
import { commitPathD, endPathEdit } from "./path-edit-actions.js";

const ANCHOR = 8;
const CONTROL_R = 4;

/**
 * On-stage path point editor (I3-2). When a path node is in edit mode it parses
 * the node's `d`, renders draggable anchor squares + bezier-control dots (with
 * connector lines) plus a live preview, and commits one `node.update` per drag
 * (MVP-7: the draft mutates during drag, the commit fires on `dragend`). Escape
 * exits. Paths whose `d` uses unsupported commands simply render no handles.
 */
export function PathEditOverlay(): React.JSX.Element | null {
	const { pathEditStore } = useCanvasStudio();
	if (!pathEditStore) return null;
	return <PathEditOverlayInner pathEditStore={pathEditStore} />;
}

function PathEditOverlayInner({
	pathEditStore,
}: {
	pathEditStore: PathEditStoreApi;
}): React.JSX.Element | null {
	const ctx = useCanvasStudio();
	const { stage, ir } = ctx;
	const editNodeId = useSyncExternalStore(
		pathEditStore.subscribe,
		() => pathEditStore.getState().editNodeId,
		() => pathEditStore.getState().editNodeId,
	);

	const found = editNodeId ? findNode(ir, editNodeId) : null;
	const node =
		found && found.node.type === "path" ? (found.node as CanvasPathNode) : null;
	const sourceD = node?.d ?? "";

	const [draft, setDraft] = useState<ParsedPath | null>(null);
	const draftRef = useRef<ParsedPath | null>(null);
	const applyDraft = (next: ParsedPath) => {
		draftRef.current = next;
		setDraft(next);
	};

	// (Re)seed the draft whenever the edited node or its `d` changes.
	useEffect(() => {
		if (!editNodeId) {
			draftRef.current = null;
			setDraft(null);
			return;
		}
		const parsed = parsePathD(sourceD);
		draftRef.current = parsed;
		setDraft(parsed);
	}, [editNodeId, sourceD]);

	useEffect(() => {
		if (!editNodeId) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				endPathEdit(ctx);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [editNodeId, ctx]);

	if (!editNodeId || !node || !draft || !stage) return null;

	const tx = node.transform.x;
	const ty = node.transform.y;
	const world = (pt: Pt) => ({ x: tx + pt.x, y: ty + pt.y });
	const controls = pathControlPoints(draft);

	// Connector lines: each segment's c1 ties to its start anchor, c2 to its end.
	// Keyed by segment index (not array position) so edits elsewhere in the
	// path don't reshuffle unrelated connectors' identity.
	const connectors: Array<{ key: string; a: Pt; b: Pt }> = [];
	draft.segs.forEach((seg, idx) => {
		if (seg.kind !== "C") return;
		const from =
			idx === 0 ? draft.start : (draft.segs[idx - 1]?.to ?? draft.start);
		connectors.push({ key: `seg-${idx}-c1`, a: from, b: seg.c1 });
		connectors.push({ key: `seg-${idx}-c2`, a: seg.to, b: seg.c2 });
	});

	return (
		<>
			<Path
				data={serializeParsedPath(draft)}
				x={tx}
				y={ty}
				stroke="#3b82f6"
				strokeWidth={1}
				listening={false}
			/>
			{connectors.map(({ key, a, b }) => {
				const wa = world(a);
				const wb = world(b);
				return (
					<Line
						key={key}
						points={[wa.x, wa.y, wb.x, wb.y]}
						stroke="#93c5fd"
						strokeWidth={1}
						listening={false}
					/>
				);
			})}
			{controls.map((c) => {
				const w = world(c);
				const onDragMove = (e: Konva.KonvaEventObject<DragEvent>) => {
					const lx = e.target.x() - tx;
					const ly = e.target.y() - ty;
					const base = draftRef.current ?? draft;
					applyDraft(movePathControl(base, c.ref, lx, ly));
				};
				const onDragEnd = () => {
					const current = draftRef.current;
					if (current)
						commitPathD(ctx, editNodeId, serializeParsedPath(current));
				};
				const key = `${c.ref.type}-${"seg" in c.ref ? c.ref.seg : "s"}`;
				if (c.role === "anchor") {
					return (
						<Rect
							key={key}
							x={w.x}
							y={w.y}
							width={ANCHOR}
							height={ANCHOR}
							offsetX={ANCHOR / 2}
							offsetY={ANCHOR / 2}
							fill="#ffffff"
							stroke="#2563eb"
							strokeWidth={1}
							draggable
							onDragMove={onDragMove}
							onDragEnd={onDragEnd}
						/>
					);
				}
				return (
					<Circle
						key={key}
						x={w.x}
						y={w.y}
						radius={CONTROL_R}
						fill="#bfdbfe"
						stroke="#2563eb"
						strokeWidth={1}
						draggable
						onDragMove={onDragMove}
						onDragEnd={onDragEnd}
					/>
				);
			})}
		</>
	);
}
