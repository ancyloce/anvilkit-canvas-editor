"use client";

import {
	lazy,
	type ReactNode,
	Suspense,
	useCallback,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	type CanvasConfirmOptions,
	CanvasDialogContext,
	type CanvasDialogs,
} from "../../context/dialog-context.js";

// Dialog-class UI is CODE-SPLIT (PRD 0012 constraint 20.15): the modal chunk
// loads on the FIRST confirm request, not with the editor bundle.
const ConfirmDialog = lazy(() => import("./ConfirmDialog.js"));

interface ActiveConfirm {
	options: CanvasConfirmOptions;
	resolve: (confirmed: boolean) => void;
}

/**
 * Workspace dialog host (B-05, FR-171): provides the {@link CanvasDialogs}
 * seam and renders the active confirm dialog. One request at a time; a
 * second `confirm` while one is open settles the first as cancelled and
 * replaces it (last-writer-wins keeps flows deadlock-free).
 */
export function CanvasDialogHost({
	children,
}: {
	children: ReactNode;
}): React.JSX.Element {
	const [active, setActive] = useState<ActiveConfirm | null>(null);
	const activeRef = useRef<ActiveConfirm | null>(null);

	const confirm = useCallback((options: CanvasConfirmOptions) => {
		return new Promise<boolean>((resolve) => {
			activeRef.current?.resolve(false);
			const next = { options, resolve };
			activeRef.current = next;
			setActive(next);
		});
	}, []);

	const dialogs = useMemo<CanvasDialogs>(() => ({ confirm }), [confirm]);

	const close = useCallback((confirmed: boolean) => {
		activeRef.current?.resolve(confirmed);
		activeRef.current = null;
		setActive(null);
	}, []);

	return (
		<CanvasDialogContext.Provider value={dialogs}>
			{children}
			{active ? (
				<Suspense fallback={null}>
					<ConfirmDialog request={active.options} onClose={close} />
				</Suspense>
			) : null}
		</CanvasDialogContext.Provider>
	);
}
