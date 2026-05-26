import { type Result, ok } from '../../core/models.js';
import { createLogger } from "../../utils/logger.js";
import { type Todo } from '../../core/models.js';

const logger = createLogger('TodoCloudLimb');

/**
 * TodoCloudLimb - Specialized substrate for the pog2-todo-list Cloudflare Worker.
 * Decoupled from the core GlobeStateLimb to allow for modular task pipelining.
 */
export class TodoCloudLimb {
    private endpoint: string = 'https://pog2-todo-list.kristain33rs.workers.dev/api/todos';
    private apiToken: string | null = null;

    constructor(options?: { endpoint?: string; token?: string }) {
        if (options?.endpoint) this.endpoint = options.endpoint;
        if (options?.token) this.apiToken = options.token;
    }

    /**
     * Push the current task state to the specialized Cloudflare Worker.
     */
    public async pushTasks(todos: Todo[]): Promise<Result<boolean>> {
        if (!this.endpoint) {
            return { ok: false, error: new Error('Todo endpoint not configured') };
        }

        try {
            logger.debug({ count: todos.length }, 'Pipelining tasks to Cloud Todo substrate');
            
            const response = await fetch(this.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiToken || ''}`
                },
                body: JSON.stringify({
                    todos,
                    timestamp: Date.now(),
                    source: 'pog2-sovereign-cli'
                })
            });

            if (!response.ok) {
                const errorBody = await response.text();
                logger.warn({ status: response.status, error: errorBody }, 'Cloud Todo pipeline rejection');
                return { ok: false, error: new Error(`Cloud Todo push failed: ${response.statusText}`) };
            }

            logger.info('Cloud Todo synchronization NOMINAL.');
            return ok(true);
        } catch (err) {
            logger.error({ err }, 'Critical failure in Cloud Todo pipeline');
            return { ok: false, error: err as Error };
        }
    }

    public healthCheck(): { online: boolean; details: string } {
        return {
            online: !!this.endpoint,
            details: `TodoCloudLimb active pointing to ${this.endpoint}`
        };
    }
}
