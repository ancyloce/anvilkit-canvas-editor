import type {
	CanvasAssetMigrationResult,
	MigrateCanvasAssetsForSharingOptions,
} from "./host-asset-migration.js";

export { ASSET_MIGRATION_HISTORY_LABEL } from "./asset-migration-contract.js";

export type {
	CanvasAssetMigrationDocumentPort,
	CanvasAssetMigrationIssue,
	CanvasAssetMigrationIssueReason,
	CanvasAssetMigrationProgress,
	CanvasAssetMigrationResult,
	CanvasAssetMigrationRetryState,
	CanvasAssetMigrationRunOptions,
	MigrateCanvasAssetsForSharingOptions,
} from "./host-asset-migration.js";

/**
 * Upload every healthy browser-local asset, then commit all reference moves in
 * one batch. The implementation loads only when a host requests migration.
 */
export async function migrateCanvasAssetsForSharing(
	options: MigrateCanvasAssetsForSharingOptions,
): Promise<CanvasAssetMigrationResult> {
	const module = await import("./host-asset-migration.js");
	return module.migrateCanvasAssetsForSharing(options);
}
