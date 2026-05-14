import { IRestClients, IProjectInfo } from "../Interfaces";
import { Engine } from "../Engine";
import { logger } from "../Logger";

const PROJECT_POLL_INTERVAL_MS = 3000;
const PROJECT_POLL_TIMEOUT_MS = 120000;

export class ProjectService {
    constructor(private _clients: IRestClients) {}

    public async listProjects(): Promise<IProjectInfo[]> {
        const coreApi = await this._getCoreApi();
        const projects = await Engine.Task(
            () => coreApi.getProjects(),
            "List projects"
        );
        return (projects || []).map(p => ({
            id: p.id || "",
            name: p.name || "",
            description: p.description,
            url: p.url || "",
            state: String(p.state ?? ""),
        }));
    }

    /** Returns projects whose process template matches the given typeId */
    public async getProjectsUsingProcess(processTypeId: string): Promise<IProjectInfo[]> {
        const coreApi = await this._getCoreApi();
        // getProjects does not return capabilities; fetch individually in batches
        const all = await this.listProjects();
        const results: IProjectInfo[] = [];
        // Fetch in chunks of 5 to avoid overwhelming the API
        for (let i = 0; i < all.length; i += 5) {
            const chunk = all.slice(i, i + 5);
            const detailed = await Promise.all(
                chunk.map(p =>
                    Engine.Task(
                        () => coreApi.getProject(p.id, true),
                        `Get project capabilities '${p.name}'`
                    ).catch(() => null)
                )
            );
            for (const proj of detailed) {
                if (!proj) { continue; }
                const templateId: string =
                    (proj as any).capabilities?.processTemplate?.templateTypeId ?? "";
                if (templateId.toLowerCase() === processTypeId.toLowerCase()) {
                    results.push({
                        id: proj.id || "",
                        name: proj.name || "",
                        description: proj.description,
                        url: proj.url || "",
                        state: String(proj.state ?? ""),
                        processTemplateTypeId: templateId,
                    });
                }
            }
        }
        return results;
    }

    /**
     * Creates a new ADO project with the specified process template, then polls
     * until the project reaches `wellFormed` state.
     */
    public async createProject(
        name: string,
        description: string,
        processTypeId: string
    ): Promise<IProjectInfo> {
        const coreApi = await this._getCoreApi();

        logger.logInfo(`Creating project '${name}' with process template '${processTypeId}'...`);

        const operationRef = await Engine.Task(
            () => coreApi.queueCreateProject({
                name,
                description,
                visibility: 1, // private
                capabilities: {
                    versioncontrol: { sourceControlType: "Git" },
                    processTemplate: { templateTypeId: processTypeId },
                },
            }),
            `Queue create project '${name}'`
        );

        if (!operationRef) {
            throw new Error(`Failed to queue project creation for '${name}'`);
        }

        logger.logVerbose(`Project creation queued (operation id: ${operationRef.id}), polling for readiness...`);
        return this._pollUntilReady(name, PROJECT_POLL_TIMEOUT_MS);
    }

    private async _pollUntilReady(projectName: string, timeoutMs: number): Promise<IProjectInfo> {
        const coreApi = await this._getCoreApi();
        const deadline = Date.now() + timeoutMs;

        while (Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, PROJECT_POLL_INTERVAL_MS));
            try {
                const proj = await coreApi.getProject(projectName);
                if (proj && String(proj.state) === "wellFormed") {
                    logger.logInfo(`Project '${projectName}' is ready.`);
                    return {
                        id: proj.id || "",
                        name: proj.name || "",
                        description: proj.description,
                        url: proj.url || "",
                        state: String(proj.state ?? ""),
                    };
                }
                logger.logVerbose(`Project '${projectName}' state: ${proj?.state}, waiting...`);
            } catch {
                // project may not be visible yet — keep polling
            }
        }
        throw new Error(`Timed out waiting for project '${projectName}' to become ready after ${timeoutMs / 1000}s`);
    }

    private async _getCoreApi() {
        if (this._clients.coreApi) { return this._clients.coreApi; }
        throw new Error("coreApi not available in IRestClients — ensure it is included when constructing clients");
    }
}
