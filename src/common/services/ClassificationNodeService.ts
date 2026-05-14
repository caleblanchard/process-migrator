import { IRestClients, WorkItemSnapshot } from "../Interfaces";
import { Engine } from "../Engine";
import { logger } from "../Logger";
import * as WITInterfaces from "azure-devops-node-api/interfaces/WorkItemTrackingInterfaces";
// CoreInterfaces doesn't export TreeStructureGroup — it lives in WorkItemTrackingInterfaces
const TreeStructureGroup = WITInterfaces.TreeStructureGroup;

export class ClassificationNodeService {
    constructor(private _clients: IRestClients) {}

    /** Collects every unique area and iteration path suffix used in the snapshot */
    public collectUsedPaths(snapshot: WorkItemSnapshot, sourceProjectName: string): { areas: string[]; iterations: string[] } {
        const areas = new Set<string>();
        const iterations = new Set<string>();

        for (const wi of snapshot.workItems) {
            const area: string = wi.fields["System.AreaPath"] ?? "";
            const iteration: string = wi.fields["System.IterationPath"] ?? "";

            const areaSuffix = this._stripProjectPrefix(area, sourceProjectName);
            if (areaSuffix) { this._addWithAncestors(areaSuffix, areas); }

            const iterSuffix = this._stripProjectPrefix(iteration, sourceProjectName);
            if (iterSuffix) { this._addWithAncestors(iterSuffix, iterations); }
        }

        return {
            areas: this._sortByDepth(Array.from(areas)),
            iterations: this._sortByDepth(Array.from(iterations)),
        };
    }

    /** Creates any area/iteration path nodes that don't already exist in target project */
    public async ensurePathsExist(
        targetProjectName: string,
        areas: string[],
        iterations: string[]
    ): Promise<void> {
        const witApi = this._clients.witApi;

        // Fetch existing trees once
        const [existingAreas, existingIterations] = await Promise.all([
            Engine.Task(
                () => witApi.getClassificationNode(targetProjectName, TreeStructureGroup.Areas, undefined, 10),
                "Get existing area nodes"
            ).catch(() => null),
            Engine.Task(
                () => witApi.getClassificationNode(targetProjectName, TreeStructureGroup.Iterations, undefined, 10),
                "Get existing iteration nodes"
            ).catch(() => null),
        ]);

        const existingAreaPaths = this._flattenPaths(existingAreas, targetProjectName);
        const existingIterPaths = this._flattenPaths(existingIterations, targetProjectName);

        // Create missing area paths (shallowest first — already sorted by collectUsedPaths)
        for (const path of areas) {
            if (!existingAreaPaths.has(path.toLowerCase())) {
                await this._createNode(targetProjectName, TreeStructureGroup.Areas, path);
            }
        }

        // Create missing iteration paths
        for (const path of iterations) {
            if (!existingIterPaths.has(path.toLowerCase())) {
                await this._createNode(targetProjectName, TreeStructureGroup.Iterations, path);
            }
        }
    }

    private async _createNode(
        projectName: string,
        structure: WITInterfaces.TreeStructureGroup,
        relativePath: string
    ): Promise<void> {
        const segments = relativePath.split("\\");
        const name = segments[segments.length - 1];
        // Parent path is everything before the last segment; omit for root-level nodes
        const parentRelative = segments.length > 1 ? segments.slice(0, -1).join("\\") : undefined;

        try {
            await Engine.Task(
                () => this._clients.witApi.createOrUpdateClassificationNode(
                    { name },
                    projectName,
                    structure,
                    parentRelative
                ),
                `Create ${TreeStructureGroup[structure]} node '${relativePath}'`
            );
            logger.logVerbose(`Created ${TreeStructureGroup[structure]} node '${relativePath}'.`);
        } catch (err: any) {
            // If it already exists (concurrent creation, race), treat as success
            if (err?.message?.includes("already exists") || err?.statusCode === 400) {
                logger.logVerbose(`${TreeStructureGroup[structure]} node '${relativePath}' already exists, skipping.`);
            } else {
                logger.logWarning(`Failed to create ${TreeStructureGroup[structure]} node '${relativePath}': ${err?.message}`);
            }
        }
    }

    private _stripProjectPrefix(path: string, projectName: string): string {
        if (!path) { return ""; }
        if (path.toLowerCase().startsWith(projectName.toLowerCase() + "\\")) {
            return path.slice(projectName.length + 1);
        }
        return path === projectName ? "" : path;
    }

    /** Adds the path and all its ancestor segments so parents are created first */
    private _addWithAncestors(path: string, set: Set<string>): void {
        const segments = path.split("\\");
        let current = "";
        for (const seg of segments) {
            current = current ? `${current}\\${seg}` : seg;
            set.add(current);
        }
    }

    /** Sort so that shallower paths (fewer \) are first */
    private _sortByDepth(paths: string[]): string[] {
        return paths.sort((a, b) => {
            const depthA = (a.match(/\\/g) || []).length;
            const depthB = (b.match(/\\/g) || []).length;
            return depthA - depthB;
        });
    }

    /** Recursively flatten a classification node tree into a set of lowercase relative paths */
    private _flattenPaths(node: any, projectName: string): Set<string> {
        const paths = new Set<string>();
        if (!node) { return paths; }

        const visit = (n: any, prefix: string) => {
            const fullPath = prefix ? `${prefix}\\${n.name}` : n.name;
            // Strip project root node itself
            if (n.name !== projectName) {
                const relative = fullPath.toLowerCase().startsWith(projectName.toLowerCase() + "\\")
                    ? fullPath.slice(projectName.length + 1).toLowerCase()
                    : fullPath.toLowerCase();
                paths.add(relative);
            }
            for (const child of n.children || []) {
                visit(child, fullPath);
            }
        };

        visit(node, "");
        return paths;
    }
}
