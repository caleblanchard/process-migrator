import * as WITProcessDefinitionsInterfaces from "azure-devops-node-api/interfaces/WorkItemTrackingProcessDefinitionsInterfaces";
import * as WITProcessInterfaces from "azure-devops-node-api/interfaces/WorkItemTrackingProcessInterfaces";
import * as WITInterfaces from "azure-devops-node-api/interfaces/WorkItemTrackingInterfaces";
import { IWorkItemTrackingProcessDefinitionsApi as WITProcessDefinitionApi } from "azure-devops-node-api/WorkItemTrackingProcessDefinitionsApi";
import { IWorkItemTrackingProcessApi as WITProcessApi } from "azure-devops-node-api/WorkItemTrackingProcessApi";
import { IWorkItemTrackingApi as WITApi } from "azure-devops-node-api/WorkItemTrackingApi";
import { ICoreApi } from "azure-devops-node-api/CoreApi";
import { IWorkApi } from "azure-devops-node-api/WorkApi";
import { IDashboardApi } from "azure-devops-node-api/DashboardApi";

export enum LogLevel {
    error,
    warning,
    information,
    verbose
}

export enum Modes {
    import,
    export,
    migrate
}

export interface IExportOptions {
    processID: string;
}

export interface ICommandLineOptions {
    mode: Modes;
    overwriteProcessOnTarget: boolean;
    config: string;
    sourceToken?: string;
    targetToken?: string;
}

export interface IConfigurationFile {
    sourceProcessName?: string;
    targetProcessName?: string;
    sourceAccountUrl?: string;
    targetAccountUrl?: string;
    sourceAccountToken?: string;
    targetAccountToken?: string;
    options?: IConfigurationOptions;
    /** Required for any work item operation */
    sourceProjectName?: string;
    /** Required for work item import / project creation */
    targetProjectName?: string;
    /** When skipping process migration, the typeId of an existing target process to use for project creation */
    targetProcessTypeId?: string;
    /** Controls target project creation/selection */
    project?: IProjectOptions;
    /** Controls work item migration */
    workItems?: IWorkItemOptions;
}

export interface IConfigurationOptions {
    logLevel?: string;
    logFilename?: string;
    processFilename?: string;
    overwritePicklist?: boolean;
    continueOnRuleImportFailure?: boolean;
    continueOnIdentityDefaultValueFailure?: boolean;
    skipImportFormContributions?: boolean;
}

export interface IProcessPayload {
    process: WITProcessInterfaces.ProcessInfo;
    workItemTypes: WITProcessDefinitionsInterfaces.WorkItemTypeModel[];
    fields: WITProcessInterfaces.FieldModel[];
    workItemTypeFields: IWITypeFields[];
    witFieldPicklists: IWITFieldPicklist[];
    layouts: IWITLayout[];
    behaviors: WITProcessDefinitionsInterfaces.BehaviorModel[];
    workItemTypeBehaviors: IWITBehaviors[];
    states: IWITStates[];
    rules: IWITRules[];

    // Only populated during import
    targetAccountInformation?: ITargetInformation
}

/**
 * For information populated from target account during import
 */
export interface ITargetInformation {
    collectionFields?: WITInterfaces.WorkItemField[];
    fieldRefNameToPicklistId?: IDictionaryStringTo<string>;
}

export interface IWITypeFields {
    workItemTypeRefName: string;
    fields: WITProcessDefinitionsInterfaces.WorkItemTypeFieldModel[];
}

export interface IWITLayout {
    workItemTypeRefName: string;
    layout: WITProcessDefinitionsInterfaces.FormLayout;
}

export interface IWITStates {
    workItemTypeRefName: string;
    states: WITProcessDefinitionsInterfaces.WorkItemStateResultModel[];
}

export interface IWITRules {
    workItemTypeRefName: string;
    rules: WITProcessInterfaces.ProcessRule[];
}

export interface IWITBehaviors {
    workItemType: IWITBehaviorsInfo;
    behaviors: WITProcessDefinitionsInterfaces.WorkItemTypeBehavior[];
}

export interface IWITBehaviorsInfo {
    refName: string;
    workItemTypeClass: WITProcessDefinitionsInterfaces.WorkItemTypeClass;
}

export interface IValidationStatus {
    status: boolean;
    message: string;
}

export interface IWITFieldPicklist {
    workitemtypeRefName: string;
    fieldRefName: string;
    picklist: WITProcessDefinitionsInterfaces.PickListModel;
}

export interface IDictionaryStringTo<T> {
    [key: string]: T;
}

export interface ILogger {
    logVerbose(message: string);
    logInfo(message: string);
    logWarning(message: string);
    logError(message: string);
    logException(error: Error);
}

export interface IRestClients {
    witApi: WITApi;
    witProcessApi: WITProcessApi;
    witProcessDefinitionApi: WITProcessDefinitionApi;
    coreApi?: ICoreApi;
    workApi?: IWorkApi;
    dashboardApi?: IDashboardApi;
}

// ---------------------------------------------------------------------------
// Project management
// ---------------------------------------------------------------------------

export interface IProjectInfo {
    id: string;
    name: string;
    description?: string;
    url: string;
    state: string;
    processTemplateTypeId?: string;
}

/** Options controlling target project creation/selection */
export interface IProjectOptions {
    /** 'none' = skip project step, 'create' = create new project, 'useExisting' = select existing */
    action: 'none' | 'create' | 'useExisting';
    description?: string;
}

// ---------------------------------------------------------------------------
// Work item migration
// ---------------------------------------------------------------------------

/** Options controlling work item migration */
export interface IWorkItemOptions {
    /** 'disabled' = skip, 'online' = live copy, 'export' = write snapshot file, 'import' = read snapshot file */
    mode: 'disabled' | 'online' | 'export' | 'import';
    snapshotFilename?: string;         // default: "output/workitems.json"
    maxItems?: number;                 // no limit if omitted
    includeRelations?: boolean;        // default: true
    migrateQueries?: boolean;          // default: true — copy Shared Queries to target
    migrateTeams?: boolean;            // default: true — copy teams, settings, iterations, boards
    migrateDashboards?: boolean;       // default: true — copy dashboard structure per team
    includeWorkItemTypes?: string[];   // if set, only these WIT ref names
    excludeWorkItemTypes?: string[];   // if set, skip these WIT ref names
}

/** Versioned offline snapshot */
export interface WorkItemSnapshot {
    schemaVersion: '1.0';
    exportedAt: string;
    sourceOrgUrl: string;
    sourceProjectName: string;
    totalCount: number;
    workItems: WorkItemRecord[];
}

export interface WorkItemRecord {
    id: number;
    workItemType: string;
    fields: Record<string, any>;
    relations: WorkItemRelation[];
}

/** Relation stored as sourceId integer (not raw URL) for portable offline files */
export interface WorkItemRelation {
    rel: string;
    sourceId: number;
    comment?: string;
}

// ---------------------------------------------------------------------------
// Migration report / preflight
// ---------------------------------------------------------------------------

export interface IMigrationReport {
    sourceProject: string;
    targetProject: string;
    totalWorkItems: number;
    workItemsByType: Record<string, number>;
    skippedByTypeFilter: number;
    warnings: string[];
    blockers: string[];
    fieldSkipList: string[];
}

export interface IWorkItemImportResult {
    created: number;
    failed: number;
    idMap: Map<number, number>;
    fieldErrors: string[];
}

export interface ILinkReplayResult {
    created: number;
    skipped: number;
    failed: number;
}