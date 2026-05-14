import { IRestClients, IWorkItemOptions, WorkItemSnapshot, WorkItemRecord, WorkItemRelation } from "../Interfaces";
import { Engine } from "../Engine";
import { logger } from "../Logger";

/** Fields we never include in a snapshot — read-only or system-managed */
const SKIP_FIELDS = new Set<string>([
    "System.Id", "System.Rev", "System.AreaId", "System.IterationId",
    "System.NodeName", "System.AuthorizedDate", "System.AuthorizedAs",
    "System.Watermark", "System.IsDeleted", "System.ChangedDate", "System.ChangedBy",
    "System.CreatedDate", "System.CreatedBy", "System.BoardColumn",
    "System.BoardColumnDone", "System.BoardLane",
]);

const SKIP_PREFIX = "WEF_";

/** ADO batch limit for getWorkItemsBatch */
const FETCH_CHUNK_SIZE = 200;

/** Supported relation types to preserve in the snapshot */
const SUPPORTED_RELS = new Set<string>([
    "System.LinkTypes.Hierarchy-Forward",
    "System.LinkTypes.Hierarchy-Reverse",
    "System.LinkTypes.Related",
    "System.LinkTypes.Dependency-Forward",
    "System.LinkTypes.Dependency-Reverse",
]);

const WI_ID_REGEX = /\/(\d+)$/;

export class WorkItemExportService {
    constructor(private _clients: IRestClients) {}

    public async exportFromProject(
        projectName: string,
        orgUrl: string,
        options: IWorkItemOptions
    ): Promise<WorkItemSnapshot> {
        logger.logInfo(`Exporting work items from project '${projectName}'...`);

        const ids = await this._fetchWorkItemIds(projectName, options);
        logger.logInfo(`Found ${ids.length} work item(s) to export.`);

        const limit = options.maxItems && options.maxItems > 0 ? options.maxItems : ids.length;
        const limitedIds = ids.slice(0, limit);
        if (limitedIds.length < ids.length) {
            logger.logInfo(`Limiting export to ${limitedIds.length} work items (maxItems=${options.maxItems}).`);
        }

        const records = await this._fetchWorkItemDetails(limitedIds, options.includeRelations !== false);

        const snapshot: WorkItemSnapshot = {
            schemaVersion: "1.0",
            exportedAt: new Date().toISOString(),
            sourceOrgUrl: orgUrl,
            sourceProjectName: projectName,
            totalCount: records.length,
            workItems: records,
        };

        logger.logInfo(`Export complete: ${records.length} work items.`);
        return snapshot;
    }

    private async _fetchWorkItemIds(projectName: string, options: IWorkItemOptions): Promise<number[]> {
        const witTypeFilter = this._buildWitFilter(options);
        const wiqlFilter = witTypeFilter
            ? ` AND [System.WorkItemType] IN (${witTypeFilter})`
            : "";

        const wiql = {
            query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${projectName}'${wiqlFilter} ORDER BY [System.Id]`,
        };

        const result = await Engine.Task(
            () => this._clients.witApi.queryByWiql(wiql, { project: projectName }),
            `WIQL query for project '${projectName}'`
        );

        return (result?.workItems || []).map(wi => wi.id!).filter(id => id != null);
    }

    private async _fetchWorkItemDetails(ids: number[], includeRelations: boolean): Promise<WorkItemRecord[]> {
        const records: WorkItemRecord[] = [];

        for (let i = 0; i < ids.length; i += FETCH_CHUNK_SIZE) {
            const chunk = ids.slice(i, i + FETCH_CHUNK_SIZE);
            const chunkNum = Math.floor(i / FETCH_CHUNK_SIZE) + 1;
            const totalChunks = Math.ceil(ids.length / FETCH_CHUNK_SIZE);

            logger.logVerbose(`Fetching work item details chunk ${chunkNum}/${totalChunks} (${chunk.length} items)...`);

            const items = await Engine.Task(
                () => this._clients.witApi.getWorkItemsBatch({
                    ids: chunk,
                    $expand: includeRelations ? 1 /* Relations */ : 0,
                }),
                `Fetch work items chunk ${chunkNum}/${totalChunks}`
            );

            for (const item of items || []) {
                if (!item?.id) { continue; }

                const fields: Record<string, any> = {};
                for (const [key, value] of Object.entries(item.fields || {})) {
                    if (SKIP_FIELDS.has(key)) { continue; }
                    if (key.startsWith(SKIP_PREFIX)) { continue; }
                    if (value === undefined || value === null) { continue; }
                    fields[key] = value;
                }

                const relations: WorkItemRelation[] = [];
                if (includeRelations && item.relations) {
                    for (const rel of item.relations) {
                        if (!rel.rel || !SUPPORTED_RELS.has(rel.rel)) { continue; }
                        const match = rel.url?.match(WI_ID_REGEX);
                        if (!match) { continue; }
                        const sourceId = parseInt(match[1], 10);
                        if (isNaN(sourceId)) { continue; }
                        relations.push({ rel: rel.rel, sourceId, comment: rel.attributes?.comment });
                    }
                }

                records.push({
                    id: item.id,
                    workItemType: item.fields?.["System.WorkItemType"] || "",
                    fields,
                    relations,
                });
            }
        }

        return records;
    }

    private _buildWitFilter(options: IWorkItemOptions): string {
        if (options.includeWorkItemTypes?.length) {
            return options.includeWorkItemTypes.map(t => `'${t}'`).join(", ");
        }
        if (options.excludeWorkItemTypes?.length) {
            // Handled post-fetch via record filter; return empty to fetch all then filter
        }
        return "";
    }
}
