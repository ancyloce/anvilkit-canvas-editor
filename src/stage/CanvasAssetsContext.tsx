"use client";

import type { CanvasAssetRef } from "@anvilkit/canvas-core";
import { createContext, useContext } from "react";

export const CanvasAssetsContext = createContext<
	Record<string, CanvasAssetRef>
>({});

export function useCanvasAsset(id: string): CanvasAssetRef | undefined {
	return useContext(CanvasAssetsContext)[id];
}
