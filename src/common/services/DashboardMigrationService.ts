import * as DashboardInterfaces from "azure-devops-node-api/interfaces/DashboardInterfaces";
import * as CoreInterfaces from "azure-devops-node-api/interfaces/CoreInterfaces";
import { IDashboardApi } from "azure-devops-node-api/DashboardApi";
import { logger } from "../Logger";

export interface IDashboardMigrationResult {
    dashboardsCreated: number;
    failed: number;
}

export class DashboardMigrationService {
    constructor(
        private _sourceDash: IDashboardApi,
        private _targetDash: IDashboardApi,
    ) {}

    public async migrate(
        sourceProjectName: string,
        targetProjectName: string,
        sourceTeamName: string,
        targetTeamName: string,
    ): Promise<IDashboardMigrationResult> {
        const result: IDashboardMigrationResult = { dashboardsCreated: 0, failed: 0 };

        const sourceCtx: CoreInterfaces.TeamContext = {
            project: sourceProjectName,
            team: sourceTeamName,
        };
        const targetCtx: CoreInterfaces.TeamContext = {
            project: targetProjectName,
            team: targetTeamName,
        };

        let sourceDashboards: DashboardInterfaces.Dashboard[];
        try {
            sourceDashboards = await this._sourceDash.getDashboardsByProject(sourceCtx);
        } catch (err: any) {
            logger.logVerbose(`Could not read dashboards for team '${sourceTeamName}': ${err?.message}`);
            return result;
        }

        for (const dash of sourceDashboards ?? []) {
            await this._copyDashboard(dash, sourceProjectName, targetProjectName, targetCtx, result);
        }

        return result;
    }

    private async _copyDashboard(
        source: DashboardInterfaces.Dashboard,
        sourceProjectName: string,
        targetProjectName: string,
        targetCtx: CoreInterfaces.TeamContext,
        result: IDashboardMigrationResult,
    ): Promise<void> {
        if (!source.name) { return; }

        // Strip IDs and remap project name in widget settings
        const widgets = (source.widgets ?? []).map(w => this._remapWidget(w, sourceProjectName, targetProjectName));

        const newDash: DashboardInterfaces.Dashboard = {
            name: source.name,
            description: source.description,
            refreshInterval: source.refreshInterval,
            widgets,
        };

        try {
            await this._targetDash.createDashboard(newDash, targetCtx);
            result.dashboardsCreated++;
            logger.logVerbose(`Created dashboard '${source.name}' for team '${targetCtx.team}'.`);
        } catch (err: any) {
            logger.logWarning(`Failed to create dashboard '${source.name}': ${err?.message}`);
            result.failed++;
        }
    }

    private _remapWidget(
        widget: DashboardInterfaces.Widget,
        sourceProject: string,
        targetProject: string,
    ): DashboardInterfaces.Widget {
        // Copy widget structure but strip IDs so ADO assigns new ones
        const w: DashboardInterfaces.Widget = {
            name: widget.name,
            contributionId: widget.contributionId,
            size: widget.size,
            position: widget.position,
        };

        // Remap project name in widget settings JSON if present
        if (widget.settings) {
            try {
                const settingsStr = typeof widget.settings === "string"
                    ? widget.settings
                    : JSON.stringify(widget.settings);
                // Replace source project name with target project name (case-insensitive)
                const escaped = sourceProject.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                const remapped = settingsStr.replace(new RegExp(escaped, "gi"), targetProject);
                w.settings = remapped;
            } catch {
                w.settings = widget.settings;
            }
        }

        return w;
    }
}
