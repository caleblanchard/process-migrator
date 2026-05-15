import * as WITInterfaces from "azure-devops-node-api/interfaces/WorkItemTrackingInterfaces";
import { IRestClients } from "../Interfaces";
import { logger } from "../Logger";

const SHARED_QUERIES_PATH = "Shared Queries";
const FETCH_DEPTH = 10;

export interface IQueryMigrationResult {
    foldersCreated: number;
    queriesCreated: number;
    failed: number;
}

export class QueryMigrationService {
    constructor(
        private _sourceClients: IRestClients,
        private _targetClients: IRestClients,
    ) {}

    public async migrate(
        sourceProjectName: string,
        targetProjectName: string,
    ): Promise<IQueryMigrationResult> {
        logger.logInfo(`Migrating shared queries from '${sourceProjectName}' → '${targetProjectName}'...`);

        const result: IQueryMigrationResult = { foldersCreated: 0, queriesCreated: 0, failed: 0 };

        // Fetch the full Shared Queries tree from source (QueryExpand.All = 3 includes WIQL)
        let root: WITInterfaces.QueryHierarchyItem;
        try {
            root = await this._sourceClients.witApi.getQuery(
                sourceProjectName,
                SHARED_QUERIES_PATH,
                3 /* QueryExpand.All */,
                FETCH_DEPTH
            );
        } catch (err: any) {
            logger.logWarning(`Could not read shared queries from source project: ${err?.message}`);
            return result;
        }

        if (!root || !root.children?.length) {
            logger.logInfo("No shared queries found in source project.");
            return result;
        }

        // Ensure the Shared Queries root folder exists in the target (it always should)
        // Then recursively copy children
        await this._copyChildren(
            root.children,
            SHARED_QUERIES_PATH,
            sourceProjectName,
            targetProjectName,
            result,
        );

        logger.logInfo(
            `Query migration complete: ${result.foldersCreated} folder(s), ${result.queriesCreated} quer(ies) created, ${result.failed} failed.`
        );
        return result;
    }

    private async _copyChildren(
        items: WITInterfaces.QueryHierarchyItem[],
        parentPath: string,
        sourceProjectName: string,
        targetProjectName: string,
        result: IQueryMigrationResult,
    ): Promise<void> {
        for (const item of items) {
            if (item.isDeleted) { continue; }

            if (item.isFolder) {
                await this._createFolder(item, parentPath, sourceProjectName, targetProjectName, result);
            } else {
                await this._createQuery(item, parentPath, sourceProjectName, targetProjectName, result);
            }
        }
    }

    private async _createFolder(
        item: WITInterfaces.QueryHierarchyItem,
        parentPath: string,
        sourceProjectName: string,
        targetProjectName: string,
        result: IQueryMigrationResult,
    ): Promise<void> {
        if (!item.name) { return; }
        const folderPath = `${parentPath}/${item.name}`;

        try {
            await this._targetClients.witApi.createQuery(
                { name: item.name, isFolder: true, isPublic: true },
                targetProjectName,
                parentPath,
            );
            result.foldersCreated++;
            logger.logVerbose(`Created query folder '${folderPath}'`);
        } catch (err: any) {
            // Folder may already exist — log and continue so children can still be created
            if (err?.message?.toLowerCase().includes("already exists") ||
                err?.message?.includes("TF237093")) {
                logger.logVerbose(`Query folder '${folderPath}' already exists, continuing.`);
            } else {
                logger.logWarning(`Failed to create query folder '${folderPath}': ${err?.message}`);
                result.failed++;
                return; // Skip children if folder creation failed
            }
        }

        // Recurse into children
        if (item.children?.length) {
            await this._copyChildren(item.children, folderPath, sourceProjectName, targetProjectName, result);
        }
    }

    private async _createQuery(
        item: WITInterfaces.QueryHierarchyItem,
        parentPath: string,
        sourceProjectName: string,
        targetProjectName: string,
        result: IQueryMigrationResult,
    ): Promise<void> {
        if (!item.name || !item.wiql) {
            logger.logVerbose(`Skipping query '${item.name}' — no WIQL text available.`);
            return;
        }

        const remappedWiql = this._remapProjectInWiql(item.wiql, sourceProjectName, targetProjectName);

        try {
            await this._targetClients.witApi.createQuery(
                {
                    name: item.name,
                    wiql: remappedWiql,
                    isFolder: false,
                    isPublic: true,
                    queryType: item.queryType,
                    columns: item.columns,
                    sortColumns: item.sortColumns,
                },
                targetProjectName,
                parentPath,
            );
            result.queriesCreated++;
            logger.logVerbose(`Created query '${parentPath}/${item.name}'`);
        } catch (err: any) {
            if (err?.message?.toLowerCase().includes("already exists") ||
                err?.message?.includes("TF237093")) {
                logger.logVerbose(`Query '${item.name}' already exists in '${parentPath}', skipping.`);
            } else {
                logger.logWarning(`Failed to create query '${parentPath}/${item.name}': ${err?.message}`);
                result.failed++;
            }
        }
    }

    /**
     * Replace all occurrences of the source project name (inside single quotes) in a WIQL string
     * with the target project name. Handles both exact-match and Under/In/Not In operators.
     */
    private _remapProjectInWiql(wiql: string, source: string, target: string): string {
        // Match the project name in single quotes, case-insensitively
        const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const pattern = new RegExp(`'${escaped}'`, "gi");
        return wiql.replace(pattern, `'${target}'`);
    }
}
