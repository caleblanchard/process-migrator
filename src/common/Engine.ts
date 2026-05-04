import { CancellationError } from "./Errors";
import { logger } from "./Logger";
import { Utility } from "./Utilities";

const MAX_RETRIES = 5;

function isRateLimitError(error: any): boolean {
    if (error?.statusCode === 429) { return true; }
    const msg: string = error?.message || '';
    return msg.includes('Request was blocked') || msg.includes('RequestBlockedException');
}

function getRateLimitDelayMs(error: any, attempt: number): number {
    const retryAfter = error?.responseHeaders?.['retry-after'] || error?.responseHeaders?.['Retry-After'];
    if (retryAfter) {
        const seconds = parseInt(retryAfter, 10);
        if (!isNaN(seconds) && seconds > 0) { return seconds * 1000; }
    }
    // Exponential backoff: 2s, 4s, 8s, 16s, 32s (capped at 60s)
    return Math.min(2000 * Math.pow(2, attempt), 60000);
}

export class Engine {
    public static async Task<T>(step: () => Promise<T>, stepName?: string): Promise<T> {
        if (Utility.didUserCancel()) {
            throw new CancellationError();
        }
        logger.logVerbose(`Begin step '${stepName}'.`);
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                const ret: T = await step();
                logger.logVerbose(`Finished step '${stepName}'.`);
                return ret;
            } catch (error: any) {
                if (attempt < MAX_RETRIES && isRateLimitError(error)) {
                    const delayMs = getRateLimitDelayMs(error, attempt);
                    logger.logWarning(`Rate limited on '${stepName}', retrying in ${delayMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`);
                    await new Promise(resolve => setTimeout(resolve, delayMs));
                } else {
                    throw error;
                }
            }
        }
        // Unreachable, but satisfies the TypeScript return type
        throw new Error(`Max retries exceeded for '${stepName}'`);
    }
}
