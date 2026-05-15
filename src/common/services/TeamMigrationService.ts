import * as CoreInterfaces from "azure-devops-node-api/interfaces/CoreInterfaces";
import * as WorkInterfaces from "azure-devops-node-api/interfaces/WorkInterfaces";
import * as WITInterfaces from "azure-devops-node-api/interfaces/WorkItemTrackingInterfaces";
import { IWorkApi } from "azure-devops-node-api/WorkApi";
import { ICoreApi } from "azure-devops-node-api/CoreApi";
import { IWorkItemTrackingApi } from "azure-devops-node-api/WorkItemTrackingApi";
import { logger } from "../Logger";

export interface ITeamMigrationClients {
    sourceWork: IWorkApi;
    sourceCore: ICoreApi;
    sourceWit: IWorkItemTrackingApi;
    targetWork: IWorkApi;
    targetCore: ICoreApi;
    targetWit: IWorkItemTrackingApi;
}

export interface ITeamMigrationResult {
    teamsCreated: number;
    teamsFailed: number;
    iterationNodesWithDates: number;
    boardsConfigured: number;
}

const TreeStructureGroup = WITInterfaces.TreeStructureGroup;

export class TeamMigrationService {
    constructor(private _clients: ITeamMigrationClients) {}

    public async migrate(
        sourceProjectName: string,
        targetProjectName: string,
    ): Promise<ITeamMigrationResult> {
        logger.logInfo(`Migrating teams from '${sourceProjectName}' → '${targetProjectName}'...`);
        const result: ITeamMigrationResult = {
            teamsCreated: 0,
            teamsFailed: 0,
            iterationNodesWithDates: 0,
            boardsConfigured: 0,
        };

        // -----------------------------------------------------------------------
        // 1. Copy iteration node sprint dates
        // -----------------------------------------------------------------------
        logger.logInfo("=== Copying sprint dates ===");
        await this._copyIterationDates(sourceProjectName, targetProjectName, result);

        // -----------------------------------------------------------------------
        // 2. Get source teams
        // -----------------------------------------------------------------------
        let sourceTeams: CoreInterfaces.WebApiTeam[] = [];
        try {
            sourceTeams = await this._clients.sourceCore.getTeams(sourceProjectName, false, 200);
        } catch (err: any) {
            logger.logWarning(`Could not list source teams: ${err?.message}`);
            return result;
        }
        logger.logInfo(`Found ${sourceTeams.length} source team(s).`);

        // -----------------------------------------------------------------------
        // 3. Get existing target teams so we don't duplicate the default team
        // -----------------------------------------------------------------------
        let targetTeams: CoreInterfaces.WebApiTeam[] = [];
        try {
            targetTeams = await this._clients.targetCore.getTeams(targetProjectName, false, 200);
        } catch (err: any) {
            logger.logWarning(`Could not list target teams: ${err?.message}`);
        }
        const targetTeamByName = new Map<string, CoreInterfaces.WebApiTeam>(
            targetTeams.map(t => [t.name!.toLowerCase(), t])
        );

        // -----------------------------------------------------------------------
        // 4. Build target iteration path → GUID map (needed for team subscriptions)
        // -----------------------------------------------------------------------
        const targetIterGuidMap = await this._buildIterGuidMap(targetProjectName);

        // -----------------------------------------------------------------------
        // 5. Process each source team
        // -----------------------------------------------------------------------
        for (const sourceTeam of sourceTeams) {
            if (!sourceTeam.name) { continue; }

            let targetTeam = targetTeamByName.get(sourceTeam.name.toLowerCase());

            if (!targetTeam) {
                // Create the team in target
                try {
                    targetTeam = await this._clients.targetCore.createTeam(
                        { name: sourceTeam.name, description: sourceTeam.description },
                        targetProjectName,
                    );
                    result.teamsCreated++;
                    logger.logVerbose(`Created team '${sourceTeam.name}'.`);
                } catch (err: any) {
                    logger.logWarning(`Failed to create team '${sourceTeam.name}': ${err?.message}`);
                    result.teamsFailed++;
                    continue;
                }
            } else {
                logger.logVerbose(`Team '${sourceTeam.name}' already exists in target.`);
            }

            // Configure the team (settings, areas, iterations, board)
            await this._configureTeam(
                sourceTeam, targetTeam,
                sourceProjectName, targetProjectName,
                targetIterGuidMap, result,
            );
        }

        logger.logInfo(
            `Team migration complete: ${result.teamsCreated} team(s) created, ` +
            `${result.teamsFailed} failed, ${result.boardsConfigured} board(s) configured.`
        );
        return result;
    }

    // -----------------------------------------------------------------------
    // Sprint dates
    // -----------------------------------------------------------------------

    private async _copyIterationDates(
        sourceProjectName: string,
        targetProjectName: string,
        result: ITeamMigrationResult,
    ): Promise<void> {
        let sourceTree: WITInterfaces.WorkItemClassificationNode | null = null;
        try {
            sourceTree = await this._clients.sourceWit.getClassificationNode(
                sourceProjectName, TreeStructureGroup.Iterations, undefined, 10
            );
        } catch (err: any) {
            logger.logWarning(`Could not read source iteration tree: ${err?.message}`);
            return;
        }

        await this._applyIterationDates(sourceTree, sourceProjectName, targetProjectName, "", result);
    }

    private async _applyIterationDates(
        node: WITInterfaces.WorkItemClassificationNode,
        sourceProjectName: string,
        targetProjectName: string,
        relativePath: string,
        result: ITeamMigrationResult,
    ): Promise<void> {
        if (!node || typeof node.name !== "string") { return; }

        const isRoot = node.name === sourceProjectName;
        const childRelative = isRoot ? "" : (relativePath ? `${relativePath}\\${node.name}` : node.name);

        // Apply dates if present and not the root
        if (!isRoot && childRelative && node.attributes?.startDate) {
            try {
                await this._clients.targetWit.createOrUpdateClassificationNode(
                    {
                        name: node.name,
                        attributes: {
                            startDate: node.attributes.startDate,
                            finishDate: node.attributes.finishDate,
                        },
                    },
                    targetProjectName,
                    TreeStructureGroup.Iterations,
                    childRelative.includes("\\") ? childRelative.slice(0, childRelative.lastIndexOf("\\")) : undefined,
                );
                result.iterationNodesWithDates++;
            } catch (err: any) {
                logger.logVerbose(`Could not set dates on iteration '${childRelative}': ${err?.message}`);
            }
        }

        for (const child of node.children ?? []) {
            await this._applyIterationDates(child, sourceProjectName, targetProjectName, childRelative, result);
        }
    }

    // -----------------------------------------------------------------------
    // Build path → GUID map for target iterations
    // -----------------------------------------------------------------------

    private async _buildIterGuidMap(targetProjectName: string): Promise<Map<string, string>> {
        const map = new Map<string, string>();
        try {
            const tree = await this._clients.targetWit.getClassificationNode(
                targetProjectName, TreeStructureGroup.Iterations, undefined, 10
            );
            this._walkNodeForGuids(tree, "", targetProjectName, map);
        } catch (err: any) {
            logger.logWarning(`Could not build iteration GUID map: ${err?.message}`);
        }
        return map;
    }

    private _walkNodeForGuids(
        node: WITInterfaces.WorkItemClassificationNode,
        prefix: string,
        projectName: string,
        map: Map<string, string>,
    ): void {
        if (!node || typeof node.name !== "string") { return; }
        const isRoot = node.name === projectName;
        const fullPath = isRoot ? "" : (prefix ? `${prefix}\\${node.name}` : node.name);
        if (!isRoot && node.identifier) {
            map.set(fullPath.toLowerCase(), node.identifier);
        }
        for (const child of node.children ?? []) {
            this._walkNodeForGuids(child, isRoot ? "" : fullPath, projectName, map);
        }
    }

    // -----------------------------------------------------------------------
    // Configure a team
    // -----------------------------------------------------------------------

    private async _configureTeam(
        sourceTeam: CoreInterfaces.WebApiTeam,
        targetTeam: CoreInterfaces.WebApiTeam,
        sourceProjectName: string,
        targetProjectName: string,
        targetIterGuidMap: Map<string, string>,
        result: ITeamMigrationResult,
    ): Promise<void> {
        const sourceCtx: CoreInterfaces.TeamContext = {
            project: sourceProjectName,
            team: sourceTeam.name,
        };
        const targetCtx: CoreInterfaces.TeamContext = {
            project: targetProjectName,
            team: targetTeam.name,
        };

        await Promise.allSettled([
            this._copyTeamSettings(sourceCtx, targetCtx),
            this._copyTeamAreaAssignments(sourceCtx, targetCtx, sourceProjectName, targetProjectName),
        ]);

        // Iterations must run after area assignments since it depends on same iteration tree
        await this._copyTeamIterations(sourceCtx, targetCtx, sourceProjectName, targetProjectName, targetIterGuidMap);

        // Board config (columns, rows) after team is fully configured
        await this._copyBoardConfig(sourceCtx, targetCtx, result);
    }

    // -----------------------------------------------------------------------
    // Team settings
    // -----------------------------------------------------------------------

    private async _copyTeamSettings(
        sourceCtx: CoreInterfaces.TeamContext,
        targetCtx: CoreInterfaces.TeamContext,
    ): Promise<void> {
        let settings: WorkInterfaces.TeamSetting;
        try {
            settings = await this._clients.sourceWork.getTeamSettings(sourceCtx);
        } catch (err: any) {
            logger.logVerbose(`Could not read settings for team '${sourceCtx.team}': ${err?.message}`);
            return;
        }

        try {
            const patch: WorkInterfaces.TeamSettingsPatch = {
                bugsBehavior: settings.bugsBehavior,
                workingDays: settings.workingDays,
                backlogVisibilities: settings.backlogVisibilities,
            };
            await this._clients.targetWork.updateTeamSettings(patch, targetCtx);
            logger.logVerbose(`Updated settings for team '${targetCtx.team}'.`);
        } catch (err: any) {
            logger.logVerbose(`Could not update settings for team '${targetCtx.team}': ${err?.message}`);
        }
    }

    // -----------------------------------------------------------------------
    // Team area assignments
    // -----------------------------------------------------------------------

    private async _copyTeamAreaAssignments(
        sourceCtx: CoreInterfaces.TeamContext,
        targetCtx: CoreInterfaces.TeamContext,
        sourceProjectName: string,
        targetProjectName: string,
    ): Promise<void> {
        let sourceFields: WorkInterfaces.TeamFieldValues;
        try {
            sourceFields = await this._clients.sourceWork.getTeamFieldValues(sourceCtx);
        } catch (err: any) {
            logger.logVerbose(`Could not read area assignments for team '${sourceCtx.team}': ${err?.message}`);
            return;
        }

        const remapPath = (p: string) => {
            if (!p) { return targetProjectName; }
            if (p.toLowerCase().startsWith(sourceProjectName.toLowerCase() + "\\")) {
                return targetProjectName + p.slice(sourceProjectName.length);
            }
            if (p.toLowerCase() === sourceProjectName.toLowerCase()) { return targetProjectName; }
            return p;
        };

        try {
            const patch: WorkInterfaces.TeamFieldValuesPatch = {
                defaultValue: remapPath(sourceFields.defaultValue ?? ""),
                values: (sourceFields.values ?? []).map(v => ({
                    value: remapPath(v.value ?? ""),
                    includeChildren: v.includeChildren,
                })),
            };
            await this._clients.targetWork.updateTeamFieldValues(patch, targetCtx);
            logger.logVerbose(`Updated area assignments for team '${targetCtx.team}'.`);
        } catch (err: any) {
            logger.logVerbose(`Could not update area assignments for team '${targetCtx.team}': ${err?.message}`);
        }
    }

    // -----------------------------------------------------------------------
    // Team iteration subscriptions
    // -----------------------------------------------------------------------

    private async _copyTeamIterations(
        sourceCtx: CoreInterfaces.TeamContext,
        targetCtx: CoreInterfaces.TeamContext,
        sourceProjectName: string,
        targetProjectName: string,
        targetIterGuidMap: Map<string, string>,
    ): Promise<void> {
        let sourceIters: WorkInterfaces.TeamSettingsIteration[];
        try {
            sourceIters = await this._clients.sourceWork.getTeamIterations(sourceCtx);
        } catch (err: any) {
            logger.logVerbose(`Could not read iterations for team '${sourceCtx.team}': ${err?.message}`);
            return;
        }

        for (const iter of sourceIters ?? []) {
            if (!iter.path) { continue; }

            // Convert source path to relative (strip source project prefix)
            let relPath = iter.path;
            if (relPath.startsWith("\\")) { relPath = relPath.slice(1); }
            if (relPath.toLowerCase().startsWith(sourceProjectName.toLowerCase() + "\\")) {
                relPath = relPath.slice(sourceProjectName.length + 1);
            } else if (relPath.toLowerCase() === sourceProjectName.toLowerCase()) {
                // Root project iteration — skip, it's the default backlog
                continue;
            }

            const targetGuid = targetIterGuidMap.get(relPath.toLowerCase());
            if (!targetGuid) {
                logger.logVerbose(`No matching target iteration found for '${relPath}', skipping.`);
                continue;
            }

            try {
                await this._clients.targetWork.postTeamIteration(
                    { id: targetGuid, name: iter.name, path: targetProjectName + "\\" + relPath },
                    targetCtx,
                );
                logger.logVerbose(`Subscribed team '${targetCtx.team}' to iteration '${relPath}'.`);
            } catch (err: any) {
                // Ignore "already subscribed" errors
                if (err?.message?.toLowerCase().includes("already")) { continue; }
                logger.logVerbose(`Could not subscribe team '${targetCtx.team}' to '${relPath}': ${err?.message}`);
            }
        }
    }

    // -----------------------------------------------------------------------
    // Board columns and swimlanes
    // -----------------------------------------------------------------------

    private async _copyBoardConfig(
        sourceCtx: CoreInterfaces.TeamContext,
        targetCtx: CoreInterfaces.TeamContext,
        result: ITeamMigrationResult,
    ): Promise<void> {
        let sourceBoards: WorkInterfaces.BoardReference[];
        let targetBoards: WorkInterfaces.BoardReference[];
        try {
            [sourceBoards, targetBoards] = await Promise.all([
                this._clients.sourceWork.getBoards(sourceCtx),
                this._clients.targetWork.getBoards(targetCtx),
            ]);
        } catch (err: any) {
            logger.logVerbose(`Could not list boards for team '${sourceCtx.team}': ${err?.message}`);
            return;
        }

        const targetBoardByName = new Map<string, WorkInterfaces.BoardReference>(
            (targetBoards ?? []).map(b => [b.name!.toLowerCase(), b])
        );

        for (const sourceBoard of sourceBoards ?? []) {
            if (!sourceBoard.name || !sourceBoard.id) { continue; }
            const targetBoard = targetBoardByName.get(sourceBoard.name.toLowerCase());
            if (!targetBoard?.id) {
                logger.logVerbose(`No matching target board for '${sourceBoard.name}', skipping.`);
                continue;
            }

            await Promise.allSettled([
                this._copyBoardColumns(sourceCtx, targetCtx, sourceBoard.id, targetBoard.id),
                this._copyBoardRows(sourceCtx, targetCtx, sourceBoard.id, targetBoard.id),
            ]);
            result.boardsConfigured++;
        }
    }

    private async _copyBoardColumns(
        sourceCtx: CoreInterfaces.TeamContext,
        targetCtx: CoreInterfaces.TeamContext,
        sourceBoardId: string,
        targetBoardId: string,
    ): Promise<void> {
        let sourceCols: WorkInterfaces.BoardColumn[];
        try {
            sourceCols = await this._clients.sourceWork.getBoardColumns(sourceCtx, sourceBoardId);
        } catch (err: any) {
            logger.logVerbose(`Could not read columns for board '${sourceBoardId}': ${err?.message}`);
            return;
        }

        if (!sourceCols?.length) { return; }

        // Strip IDs from the columns so ADO treats them as new definitions
        const targetCols: WorkInterfaces.BoardColumn[] = sourceCols.map(c => ({
            name: c.name,
            columnType: c.columnType,
            isSplit: c.isSplit,
            itemLimit: c.itemLimit,
            stateMappings: c.stateMappings,
        }));

        try {
            await this._clients.targetWork.updateBoardColumns(targetCols, targetCtx, targetBoardId);
            logger.logVerbose(`Updated columns for board '${targetBoardId}'.`);
        } catch (err: any) {
            logger.logVerbose(`Could not update columns for board '${targetBoardId}': ${err?.message}`);
        }
    }

    private async _copyBoardRows(
        sourceCtx: CoreInterfaces.TeamContext,
        targetCtx: CoreInterfaces.TeamContext,
        sourceBoardId: string,
        targetBoardId: string,
    ): Promise<void> {
        let sourceRows: WorkInterfaces.BoardRow[];
        try {
            sourceRows = await this._clients.sourceWork.getBoardRows(sourceCtx, sourceBoardId);
        } catch (err: any) {
            logger.logVerbose(`Could not read swimlanes for board '${sourceBoardId}': ${err?.message}`);
            return;
        }

        // ADO always has a default (unnamed) swimlane; only copy named ones
        const namedRows = (sourceRows ?? []).filter(r => r.name);
        if (!namedRows.length) { return; }

        // Get existing target rows first so we can merge
        let existingRows: WorkInterfaces.BoardRow[] = [];
        try {
            existingRows = await this._clients.targetWork.getBoardRows(targetCtx, targetBoardId);
        } catch { /* ignore */ }

        const targetRows: WorkInterfaces.BoardRow[] = [
            ...existingRows,
            ...namedRows.map(r => ({ name: r.name })),
        ];

        // Deduplicate by name (case-insensitive)
        const seen = new Set<string>();
        const deduped = targetRows.filter(r => {
            const key = (r.name ?? "").toLowerCase();
            if (seen.has(key)) { return false; }
            seen.add(key);
            return true;
        });

        try {
            await this._clients.targetWork.updateBoardRows(deduped, targetCtx, targetBoardId);
            logger.logVerbose(`Updated swimlanes for board '${targetBoardId}'.`);
        } catch (err: any) {
            logger.logVerbose(`Could not update swimlanes for board '${targetBoardId}': ${err?.message}`);
        }
    }
}
