"use client";

import { cn } from "@anvilkit/ui/lib/utils";
import * as React from "react";

import type { CanvasT } from "../../context/canvas-studio-context.js";

/**
 * @file Version + deprecation badge for one catalog row (plan 0021 T-020).
 *
 * The version is rendered **verbatim**. Canvas treats `version` as opaque and
 * compares it only for equality (TD §5.1), so anything that parsed or
 * prettified it here — trimming a `v` prefix, formatting a SemVer, sorting —
 * would be inventing meaning the rest of the system explicitly refuses to
 * assume, and the string shown would stop matching the string stored.
 */
export function VersionBadge({
	version,
	deprecationNotice,
	t,
	className,
}: {
	version: string;
	deprecationNotice?: string | undefined;
	t: CanvasT;
	className?: string;
}): React.JSX.Element {
	const deprecated = deprecationNotice !== undefined;
	return (
		<span
			className={cn("inline-flex items-center gap-1", className)}
			data-testid="library-version-badge"
		>
			<span
				className={cn(
					"rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground",
					deprecated && "line-through",
				)}
				data-testid="library-version"
			>
				{version}
			</span>
			{deprecated ? (
				<span
					className="rounded bg-amber-100 px-1 py-0.5 text-[10px] text-amber-900 dark:bg-amber-950 dark:text-amber-200"
					data-testid="library-deprecated"
					// The notice is the host's own words; surface it as a tooltip rather
					// than inline so a long message cannot break the row layout.
					title={deprecationNotice}
				>
					{t("canvas.libraries.deprecated", "Deprecated")}
				</span>
			) : null}
		</span>
	);
}
