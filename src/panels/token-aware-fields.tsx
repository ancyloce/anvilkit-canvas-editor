"use client";

import type {
	BrandTokenRef,
	CanvasFill,
	CanvasFontFamily,
} from "@anvilkit/canvas-core";
import { Button } from "@anvilkit/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@anvilkit/ui/select";
import type { BrandColor, BrandKit } from "../brand/brand-kit.js";
import { slug } from "../brand/resolve-brand-token.js";
import type { CanvasT } from "../context/canvas-studio-context.js";
import {
	ColorField,
	type FieldContractTarget,
	FieldRow,
	TextField,
} from "./fields.js";

/** The identity a `BrandTokenRef` resolves against — mirrors `resolveBrandToken`'s own `color.id ?? slug(color.name)` fallback. */
function colorIdentity(color: BrandColor): string {
	return color.id ?? slug(color.name);
}

function isColorTokenRef(
	value: CanvasFill | undefined,
): value is BrandTokenRef {
	return (
		typeof value === "object" &&
		value !== null &&
		"type" in value &&
		value.type === "brand-token" &&
		value.tokenType === "color"
	);
}

function isFontTokenRef(value: CanvasFontFamily): value is BrandTokenRef {
	return typeof value === "object" && value.type === "brand-token";
}

/** A small, always-visible (no hover needed) flag for an unresolved brand token. */
function UnresolvedBadge({ t }: { t: CanvasT }): React.JSX.Element {
	return (
		<span
			data-testid="prop-token-unresolved-badge"
			className="rounded bg-destructive/10 px-1 text-[10px] text-destructive"
			title={t(
				"canvas.inspector.unresolvedToken",
				"Unresolved brand token — showing fallback",
			)}
		>
			{t("canvas.inspector.unresolvedBadge", "Unresolved")}
		</span>
	);
}

export interface TokenAwareColorFieldProps {
	label: string;
	/** The raw field value — may be a literal color, a `BrandTokenRef`, or absent. */
	rawValue: CanvasFill | undefined;
	/** `resolveFillForDisplay(rawValue, brandKit).value`, when it resolves to a solid color (never a gradient — callers branch that out first). */
	resolvedValue: string | undefined;
	/** `resolveFillForDisplay(rawValue, brandKit).unresolved`. */
	unresolved: boolean;
	colors: readonly BrandColor[];
	dataTestId: string;
	onCommit: (next: CanvasFill) => void;
	/**
	 * §10 field-input contract for the LITERAL color path (B-12) — the token
	 * Select and detach/attach actions are discrete and stay on `onCommit`.
	 */
	contract?: FieldContractTarget<string>;
	t: CanvasT;
}

/**
 * A color field that can hold either a literal value or a brand-token
 * reference (FR-033, canvas-m2-007). With no brand colors configured, this
 * renders the plain literal `ColorField` — there is nothing to pick from.
 */
export function TokenAwareColorField({
	label,
	rawValue,
	resolvedValue,
	unresolved,
	colors,
	dataTestId,
	onCommit,
	contract,
	t,
}: TokenAwareColorFieldProps): React.JSX.Element {
	if (colors.length === 0) {
		return (
			<ColorField
				label={label}
				value={resolvedValue}
				dataTestId={dataTestId}
				onCommit={(v) => onCommit(v)}
				{...(contract ? { contract } : {})}
			/>
		);
	}

	const token = isColorTokenRef(rawValue) ? rawValue : undefined;

	if (token) {
		return (
			<FieldRow label={label}>
				<div className="flex items-center gap-1.5">
					<Select
						items={colors.map((c) => ({
							value: colorIdentity(c),
							label: c.name,
						}))}
						value={token.id}
						onValueChange={(next) =>
							next &&
							onCommit({ type: "brand-token", tokenType: "color", id: next })
						}
					>
						<SelectTrigger data-testid={dataTestId} className="h-7.5 flex-1">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{colors.map((c) => (
								<SelectItem key={colorIdentity(c)} value={colorIdentity(c)}>
									{c.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					{unresolved ? <UnresolvedBadge t={t} /> : null}
					<Button
						type="button"
						variant="ghost"
						size="sm"
						data-testid={`${dataTestId}-detach`}
						onClick={() => onCommit(resolvedValue ?? "#000000")}
					>
						{t("canvas.inspector.detachToken", "Detach")}
					</Button>
				</div>
			</FieldRow>
		);
	}

	return (
		<FieldRow label={label}>
			<div className="flex items-center gap-2">
				<div className="flex-1">
					<ColorField
						label=""
						value={resolvedValue}
						dataTestId={dataTestId}
						onCommit={(v) => onCommit(v)}
						{...(contract ? { contract } : {})}
					/>
				</div>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					data-testid={`${dataTestId}-use-token`}
					onClick={() => {
						const first = colors[0];
						if (!first) return;
						onCommit({
							type: "brand-token",
							tokenType: "color",
							id: colorIdentity(first),
						});
					}}
				>
					{t("canvas.inspector.useColorToken", "Use brand color")}
				</Button>
			</div>
		</FieldRow>
	);
}

export interface TokenAwareFontFieldProps {
	label: string;
	rawValue: CanvasFontFamily;
	resolvedValue: string | undefined;
	unresolved: boolean;
	fonts: readonly string[];
	dataTestId: string;
	onCommit: (next: CanvasFontFamily) => void;
	/** §10 contract for the LITERAL font path (B-12); see TokenAwareColorField. */
	contract?: FieldContractTarget<string>;
	t: CanvasT;
}

/** The font-family counterpart of {@link TokenAwareColorField}. */
export function TokenAwareFontField({
	label,
	rawValue,
	resolvedValue,
	unresolved,
	fonts,
	dataTestId,
	onCommit,
	contract,
	t,
}: TokenAwareFontFieldProps): React.JSX.Element {
	if (fonts.length === 0) {
		return (
			<TextField
				label={label}
				value={resolvedValue ?? ""}
				dataTestId={dataTestId}
				onCommit={(v) => onCommit(v)}
				{...(contract ? { contract } : {})}
			/>
		);
	}

	const token = isFontTokenRef(rawValue) ? rawValue : undefined;

	if (token) {
		return (
			<FieldRow label={label}>
				<div className="flex items-center gap-1.5">
					<Select
						items={fonts.map((family) => ({
							value: slug(family),
							label: family,
						}))}
						value={token.id}
						onValueChange={(next) =>
							next &&
							onCommit({ type: "brand-token", tokenType: "font", id: next })
						}
					>
						<SelectTrigger data-testid={dataTestId} className="h-7.5 flex-1">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{fonts.map((family) => (
								<SelectItem key={family} value={slug(family)}>
									{family}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					{unresolved ? <UnresolvedBadge t={t} /> : null}
					<Button
						type="button"
						variant="ghost"
						size="sm"
						data-testid={`${dataTestId}-detach`}
						onClick={() => onCommit(resolvedValue ?? "")}
					>
						{t("canvas.inspector.detachToken", "Detach")}
					</Button>
				</div>
			</FieldRow>
		);
	}

	return (
		<FieldRow label={label}>
			<div className="flex items-center gap-2">
				<div className="flex-1">
					<TextField
						label=""
						value={resolvedValue ?? ""}
						dataTestId={dataTestId}
						onCommit={(v) => onCommit(v)}
						{...(contract ? { contract } : {})}
					/>
				</div>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					data-testid={`${dataTestId}-use-token`}
					onClick={() => {
						const first = fonts[0];
						if (!first) return;
						onCommit({
							type: "brand-token",
							tokenType: "font",
							id: slug(first),
						});
					}}
				>
					{t("canvas.inspector.useFontToken", "Use brand font")}
				</Button>
			</div>
		</FieldRow>
	);
}
