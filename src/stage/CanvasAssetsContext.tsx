"use client";

import type { CanvasAssetRef } from "@anvilkit/canvas-core";
import { createContext, use } from "react";

export const CanvasAssetsContext = createContext<
	Record<string, CanvasAssetRef>
>({});

export function useCanvasAsset(id: string): CanvasAssetRef | undefined {
	return use(CanvasAssetsContext)[id];
}
