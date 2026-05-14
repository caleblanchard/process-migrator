import { IRestClients, WorkItemSnapshot, ILinkReplayResult } from "../Interfaces";
import { Engine } from "../Engine";
import { logger } from "../Logger";

/** Only replay these relation types — others are skipped */
const SUPPORTED_RELS = new Set<string>([
    "System.LinkTypes.Hierarchy-Forward",
    "System.LinkTypes.Hierarchy-Reverse",
    "System.LinkTypes.Related",
    "System.LinkTypes.Dependency-Forward",
    "System.LinkTypes.Dependency-Reverse",
]);

export class LinkReplayService {
    constructor(private _clients: IRestClients) {}

    public async replayLinks(
        snapshot: WorkItemSnapshot,
        idMap: Map<number, number>,
        targetOrgUrl: string
    ): Promise<ILinkReplayResult> {
        let created = 0;
        let skipped = 0;
        let failed = 0;

        logger.logInfo("Replaying work item links...");

        for (const record of snapshot.workItems) {
            const targetId = idMap.get(record.id);
            if (!targetId) { continue; } // This WI was not successfully created

            for (const rel of record.relations) {
                if (!SUPPORTED_RELS.has(rel.rel)) {
                    skipped++;
                    continue;
                }

                const targetRelatedId = idMap.get(rel.sourceId);
                if (!targetRelatedId) {
                    // The related WI was not migrated (filtered or failed) — skip
                    skipped++;
                    continue;
                }

                const relatedUrl = `${targetOrgUrl.replace(/\/$/, "")}/_apis/wit/workItems/${targetRelatedId}`;
                const patch = [
                    {
                        op: "add",
                        path: "/relations/-",
                        value: {
                            rel: rel.rel,
                            url: relatedUrl,
                            attributes: rel.comment ? { comment: rel.comment } : {},
                        },
                    },
                ];

                try {
                    await Engine.Task(
                        () => this._clients.witApi.updateWorkItem(
                            null,
                            patch,
                            targetId
                        ),
                        `Add ${rel.rel} link: ${record.id}→${rel.sourceId} (target: ${targetId}→${targetRelatedId})`
                    );
                    created++;
                } catch (err: any) {
                    // Duplicate link errors are benign
                    if (err?.message?.includes("already exists") || err?.statusCode === 400) {
                        logger.logVerbose(`Link ${record.id}→${rel.sourceId} already exists, skipping.`);
                        skipped++;
                    } else {
                        logger.logWarning(`Failed to add link ${record.id}→${rel.sourceId}: ${err?.message}`);
                        failed++;
                    }
                }
            }
        }

        logger.logInfo(`Link replay complete: ${created} created, ${skipped} skipped, ${failed} failed.`);
        return { created, skipped, failed };
    }
}
