import { readFileSync, writeFileSync } from "fs";
import { normalize } from "path";
import {
    IRestClients, IConfigurationFile, IMigrationReport, WorkItemSnapshot, IWorkItemOptions,
} from "./Interfaces";
import { Engine } from "./Engine";
import { logger } from "./Logger";
import { ProjectService } from "./services/ProjectService";
import { WorkItemExportService } from "./services/WorkItemExportService";
import { ClassificationNodeService } from "./services/ClassificationNodeService";
import { WorkItemImportService } from "./services/WorkItemImportService";
import { LinkReplayService } from "./services/LinkReplayService";
import { QueryMigrationService } from "./services/QueryMigrationService";
import { defaultEncoding } from "./Constants";

const DEFAULT_SNAPSHOT_FILENAME = "output/workitems.json";

export class WorkItemOrchestrator {
    private _projectService: ProjectService;
    private _exportService: WorkItemExportService;
    private _classifyService: ClassificationNodeService;
    private _importService: WorkItemImportService;
    private _linkService: LinkReplayService;
    private _queryService: QueryMigrationService;

    constructor(
        private _sourceClients: IRestClients,
        private _targetClients: IRestClients,
        private _config: IConfigurationFile
    ) {
        this._projectService = new ProjectService(_targetClients);
        this._exportService = new WorkItemExportService(_sourceClients);
        this._classifyService = new ClassificationNodeService(_targetClients);
        this._importService = new WorkItemImportService(_targetClients);
        this._linkService = new LinkReplayService(_targetClients);
        this._queryService = new QueryMigrationService(_sourceClients, _targetClients);
    }

    public async run(importedProcessTypeId?: string): Promise<void> {
        const wiOptions = this._config.workItems;
        const projOptions = this._config.project;

        // -----------------------------------------------------------------------
        // 1. Resolve / create target project
        // -----------------------------------------------------------------------
        let targetProjectName = this._config.targetProjectName;

        if (projOptions && projOptions.action !== "none") {
            targetProjectName = await Engine.Task(
                () => this._resolveTargetProject(projOptions.action, targetProjectName, projOptions.description, importedProcessTypeId),
                "Resolve target project"
            );
            logger.logInfo(`Target project resolved: '${targetProjectName}'`);
        }

        if (!wiOptions || wiOptions.mode === "disabled") {
            logger.logInfo("Work item migration is disabled — skipping.");
            return;
        }

        if (!this._config.sourceProjectName && wiOptions.mode !== "import") {
            throw new Error("configuration.sourceProjectName is required for work item export/online migration.");
        }
        if (!targetProjectName && wiOptions.mode !== "export") {
            throw new Error("configuration.targetProjectName (or project.action) is required for work item import/online migration.");
        }

        const snapshotFile = normalize(wiOptions.snapshotFilename || DEFAULT_SNAPSHOT_FILENAME);

        // -----------------------------------------------------------------------
        // 2. Export phase (or load from file)
        // -----------------------------------------------------------------------
        let snapshot: WorkItemSnapshot;

        if (wiOptions.mode === "export" || wiOptions.mode === "online") {
            logger.logInfo("=== Work Item Export ===");
            snapshot = await Engine.Task(
                () => this._exportService.exportFromProject(
                    this._config.sourceProjectName!,
                    this._config.sourceAccountUrl!,
                    wiOptions
                ),
                "Export work items from source project"
            );

            if (wiOptions.mode === "export") {
                logger.logInfo(`Writing work item snapshot to '${snapshotFile}'...`);
                writeFileSync(snapshotFile, JSON.stringify(snapshot, null, 2), defaultEncoding);
                logger.logInfo(`Work item export complete: ${snapshot.totalCount} items written to '${snapshotFile}'.`);
                return;
            }
        } else {
            // mode === "import" — load from file
            logger.logInfo(`Loading work item snapshot from '${snapshotFile}'...`);
            const raw = readFileSync(snapshotFile, defaultEncoding);
            snapshot = JSON.parse(raw) as WorkItemSnapshot;
            if (snapshot.schemaVersion !== "1.0") {
                throw new Error(`Unsupported snapshot schema version: '${snapshot.schemaVersion}'. Expected '1.0'.`);
            }
            logger.logInfo(`Loaded ${snapshot.totalCount} work items from snapshot.`);
        }

        // -----------------------------------------------------------------------
        // 3. Preflight validation
        // -----------------------------------------------------------------------
        logger.logInfo("=== Preflight Validation ===");
        const report = await this._runPreflight(snapshot, targetProjectName!, wiOptions);

        this._logReport(report);

        if (report.blockers.length > 0) {
            throw new Error(
                `Work item migration aborted due to ${report.blockers.length} blocker(s). See log for details.`
            );
        }

        // -----------------------------------------------------------------------
        // 4. Ensure area/iteration paths exist in target
        // -----------------------------------------------------------------------
        logger.logInfo("=== Classification Nodes ===");
        const { areas, iterations } = this._classifyService.collectUsedPaths(snapshot, snapshot.sourceProjectName);
        logger.logInfo(`Ensuring ${areas.length} area path(s) and ${iterations.length} iteration path(s) in target...`);
        await this._classifyService.ensurePathsExist(targetProjectName!, areas, iterations);

        // -----------------------------------------------------------------------
        // 5. Import work items
        // -----------------------------------------------------------------------
        logger.logInfo("=== Work Item Import ===");
        const importResult = await this._importService.importSnapshot(snapshot, targetProjectName!, wiOptions);

        // -----------------------------------------------------------------------
        // 6. Replay links
        // -----------------------------------------------------------------------
        if (wiOptions.includeRelations !== false) {
            logger.logInfo("=== Link Replay ===");
            await this._linkService.replayLinks(snapshot, importResult.idMap, this._config.targetAccountUrl!);
        }

        // -----------------------------------------------------------------------
        // 7. Migrate shared queries
        // -----------------------------------------------------------------------
        const shouldMigrateQueries = wiOptions.migrateQueries !== false; // default true
        if (shouldMigrateQueries && this._config.sourceProjectName && targetProjectName) {
            logger.logInfo("=== Query Migration ===");
            await this._queryService.migrate(this._config.sourceProjectName, targetProjectName);
        }

        // -----------------------------------------------------------------------
        // 8. Summary
        // -----------------------------------------------------------------------
        logger.logInfo("=== Work Item Migration Summary ===");
        logger.logInfo(`  Created: ${importResult.created}`);
        logger.logInfo(`  Failed:  ${importResult.failed}`);
        if (importResult.fieldErrors.length > 0) {
            logger.logWarning(`  Field errors: ${importResult.fieldErrors.length} (see log for details)`);
        }
    }

    // ---------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------

    private async _resolveTargetProject(
        action: "none" | "create" | "useExisting",
        targetProjectName: string | undefined,
        description: string | undefined,
        processTypeId: string | undefined
    ): Promise<string> {
        // Fall back to the config-supplied targetProcessTypeId when process migration was skipped
        const effectiveProcessTypeId = processTypeId || this._config.targetProcessTypeId;

        if (action === "create") {
            if (!targetProjectName) {
                throw new Error("configuration.targetProjectName is required when project.action = 'create'.");
            }
            if (!effectiveProcessTypeId) {
                throw new Error(
                    "A process type ID is required to create a project. Either run a process migration first " +
                    "or set configuration.targetProcessTypeId to an existing process on the target org."
                );
            }
            const info = await this._projectService.createProject(
                targetProjectName,
                description || "",
                effectiveProcessTypeId
            );
            return info.name;
        }

        if (action === "useExisting") {
            if (!targetProjectName) {
                throw new Error("configuration.targetProjectName is required when project.action = 'useExisting'.");
            }
            if (effectiveProcessTypeId) {
                const matching = await this._projectService.getProjectsUsingProcess(effectiveProcessTypeId);
                const found = matching.find(p => p.name.toLowerCase() === targetProjectName.toLowerCase());
                if (!found) {
                    logger.logWarning(
                        `Project '${targetProjectName}' may not use the expected process '${effectiveProcessTypeId}'. Proceeding anyway.`
                    );
                }
            }
            return targetProjectName;
        }

        return targetProjectName || "";
    }

    private async _runPreflight(
        snapshot: WorkItemSnapshot,
        targetProjectName: string,
        options: IWorkItemOptions
    ): Promise<IMigrationReport> {
        const warnings: string[] = [];
        const blockers: string[] = [];
        const fieldSkipList: string[] = [];

        const byType: Record<string, number> = {};
        let skippedByTypeFilter = 0;

        const IDENTITY_FIELDS = ["System.AssignedTo", "Microsoft.VSTS.Common.ActivatedBy",
            "Microsoft.VSTS.Common.ClosedBy", "Microsoft.VSTS.Common.ResolvedBy"];

        for (const wi of snapshot.workItems) {
            // Type filter check
            if (options.excludeWorkItemTypes?.includes(wi.workItemType)) {
                skippedByTypeFilter++;
                continue;
            }
            byType[wi.workItemType] = (byType[wi.workItemType] || 0) + 1;

            // Warn on identity fields
            for (const field of IDENTITY_FIELDS) {
                if (wi.fields[field]) {
                    if (!warnings.some(w => w.includes(field))) {
                        warnings.push(
                            `Identity field '${field}' is present. Users must exist in the target org or the value will be cleared.`
                        );
                    }
                }
            }
        }

        // Check target project is reachable
        try {
            await Engine.Task(
                () => this._targetClients.witApi.queryByWiql(
                    { query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${targetProjectName}'` },
                    { project: targetProjectName }
                ),
                "Preflight: verify target project access"
            );
        } catch (err: any) {
            blockers.push(`Cannot access target project '${targetProjectName}': ${err?.message}`);
        }

        if (snapshot.totalCount === 0) {
            warnings.push("Source project has no work items — nothing to migrate.");
        }

        return {
            sourceProject: snapshot.sourceProjectName,
            targetProject: targetProjectName,
            totalWorkItems: snapshot.workItems.length,
            workItemsByType: byType,
            skippedByTypeFilter,
            warnings,
            blockers,
            fieldSkipList,
        };
    }

    private _logReport(report: IMigrationReport): void {
        logger.logInfo(`Preflight: ${report.totalWorkItems} work items across ${Object.keys(report.workItemsByType).length} type(s).`);
        for (const [type, count] of Object.entries(report.workItemsByType)) {
            logger.logVerbose(`  ${type}: ${count}`);
        }
        if (report.skippedByTypeFilter > 0) {
            logger.logInfo(`  Skipped by type filter: ${report.skippedByTypeFilter}`);
        }
        for (const w of report.warnings) {
            logger.logWarning(`[Preflight] ${w}`);
        }
        for (const b of report.blockers) {
            logger.logError(`[Preflight BLOCKER] ${b}`);
        }
    }
}
