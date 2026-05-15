import { IRestClients, IWorkItemOptions, WorkItemSnapshot, IWorkItemImportResult } from "../Interfaces";
import { Engine } from "../Engine";
import { logger } from "../Logger";

const IMPORT_CHUNK_SIZE = 200;

/** Identity-like fields that may fail if the user doesn't exist in target — warn only */
const IDENTITY_FIELDS = new Set<string>([
    "System.AssignedTo",
    "Microsoft.VSTS.Common.ActivatedBy",
    "Microsoft.VSTS.Common.ClosedBy",
    "Microsoft.VSTS.Common.ResolvedBy",
]);

/** Fields whose values are project-scoped paths */
const PATH_FIELDS = new Set<string>(["System.AreaPath", "System.IterationPath"]);

export class WorkItemImportService {
    constructor(private _clients: IRestClients) {}

    public async importSnapshot(
        snapshot: WorkItemSnapshot,
        targetProjectName: string,
        options: IWorkItemOptions
    ): Promise<IWorkItemImportResult> {
        const idMap = new Map<number, number>();
        const fieldErrors: string[] = [];
        let created = 0;
        let failed = 0;

        // Apply WIT type exclusion filter (inclusion is handled at export time)
        const workItems = options.excludeWorkItemTypes?.length
            ? snapshot.workItems.filter(wi => !options.excludeWorkItemTypes!.includes(wi.workItemType))
            : snapshot.workItems;

        logger.logInfo(`Importing ${workItems.length} work item(s) into project '${targetProjectName}'...`);

        const totalChunks = Math.ceil(workItems.length / IMPORT_CHUNK_SIZE);

        for (let i = 0; i < workItems.length; i += IMPORT_CHUNK_SIZE) {
            const chunk = workItems.slice(i, i + IMPORT_CHUNK_SIZE);
            const chunkNum = Math.floor(i / IMPORT_CHUNK_SIZE) + 1;
            logger.logVerbose(`Importing chunk ${chunkNum}/${totalChunks} (${chunk.length} items)...`);

            for (const record of chunk) {
                try {
                    const patch = this._buildPatchDocument(record.fields, record.workItemType, targetProjectName, snapshot.sourceProjectName, fieldErrors);
                    const created_wi = await Engine.Task(
                        () => this._clients.witApi.createWorkItem(
                            null,
                            patch,
                            targetProjectName,
                            record.workItemType
                        ),
                        `Create work item '${record.fields["System.Title"] || record.id}' (type: ${record.workItemType})`
                    );

                    if (created_wi?.id) {
                        idMap.set(record.id, created_wi.id);
                        created++;
                    } else {
                        logger.logWarning(`Work item ${record.id} created but no ID returned.`);
                        failed++;
                    }
                } catch (err: any) {
                    // If the error is an area/iteration path problem, retry with root paths
                    if (this._isPathError(err?.message)) {
                        const retryResult = await this._retryWithRootPaths(
                            record, targetProjectName, snapshot.sourceProjectName, fieldErrors
                        );
                        if (retryResult !== null) {
                            idMap.set(record.id, retryResult);
                            created++;
                            logger.logWarning(
                                `Work item ${record.id} created with root area/iteration path (original path was invalid): ${err?.message}`
                            );
                            continue;
                        }
                    }
                    const msg = `Failed to create work item ${record.id} (${record.workItemType}): ${err?.message}`;
                    logger.logWarning(msg);
                    fieldErrors.push(msg);
                    failed++;
                }
            }
        }

        logger.logInfo(`Import complete: ${created} created, ${failed} failed.`);
        return { created, failed, idMap, fieldErrors };
    }

    /** Returns the new work item ID on success, null on failure */
    private async _retryWithRootPaths(
        record: { id: number; workItemType: string; fields: Record<string, any>; relations: any[] },
        targetProjectName: string,
        sourceProjectName: string,
        fieldErrors: string[]
    ): Promise<number | null> {
        try {
            const fieldsWithRootPaths = {
                ...record.fields,
                "System.AreaPath": targetProjectName,
                "System.IterationPath": targetProjectName,
            };
            const patch = this._buildPatchDocument(fieldsWithRootPaths, record.workItemType, targetProjectName, sourceProjectName, fieldErrors);
            const wi = await this._clients.witApi.createWorkItem(
                null,
                patch,
                targetProjectName,
                record.workItemType
            );
            return wi?.id ?? null;
        } catch {
            return null;
        }
    }

    private _isPathError(message?: string): boolean {
        if (!message) { return false; }
        return message.includes("TF401347") ||
            message.toLowerCase().includes("invalid tree name") ||
            message.toLowerCase().includes("areapath") ||
            message.toLowerCase().includes("iterationpath");
    }

    private _buildPatchDocument(
        fields: Record<string, any>,
        workItemType: string,
        targetProjectName: string,
        sourceProjectName: string,
        fieldErrors: string[]
    ): any[] {
        const patch: any[] = [];

        const addField = (refName: string, value: any) => {
            patch.push({ op: "add", path: `/fields/${refName}`, value });
        };

        for (const [key, value] of Object.entries(fields)) {
            if (value === undefined || value === null) { continue; }

            // Remap project-scoped path fields
            if (PATH_FIELDS.has(key)) {
                const remapped = this._remapProjectPath(String(value), sourceProjectName, targetProjectName);
                addField(key, remapped);
                continue;
            }

            // Skip System.TeamProject — ADO sets it automatically from the project context
            if (key === "System.TeamProject") { continue; }

            // Warn on identity fields but still attempt to copy
            if (IDENTITY_FIELDS.has(key)) {
                logger.logVerbose(`Identity field '${key}' on work item — may fail if user doesn't exist in target org.`);
            }

            addField(key, value);
        }

        // Ensure TeamProject is set correctly (ADO normally handles this, but be explicit)
        addField("System.TeamProject", targetProjectName);

        return patch;
    }

    private _remapProjectPath(path: string, sourceProject: string, targetProject: string): string {
        if (!path) { return targetProject; }
        if (path.toLowerCase().startsWith(sourceProject.toLowerCase() + "\\")) {
            return targetProject + path.slice(sourceProject.length);
        }
        if (path.toLowerCase() === sourceProject.toLowerCase()) {
            return targetProject;
        }
        // Path doesn't start with source project — return with target project prepended
        // (handles edge cases where the stored path doesn't match the expected project prefix)
        logger.logVerbose(`AreaPath/IterationPath '${path}' does not start with source project '${sourceProject}'; using target project root.`);
        return targetProject;
    }
}
