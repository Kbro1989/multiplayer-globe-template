import { createLogger } from '../../utils/logger.js';
import { Result, ok, err } from '../../core/models.js';

const logger = createLogger('OfficialApiLimb');

export interface GEDetail {
    id: number;
    name: string;
    description: string;
    type: string;
    members: boolean;
    price: string | number;
    icon: string;
}

/**
 * OfficialApiLimb - Bridge to Jagex REST Infrastructure
 */
export class OfficialApiLimb {
    private readonly GE_BASE = 'https://secure.runescape.com/m=itemdb_rs/api';
    private readonly METRICS_BASE = 'https://apps.runescape.com/runemetrics';
    private readonly USER_AGENT = 'POG2-Sovereign-Forensics/1.0';

    /**
     * getItemDetail(id) - Fetches GE metadata for a specific Item ID.
     */
    public async getItemDetail(id: number): Promise<Result<GEDetail>> {
        const url = `${this.GE_BASE}/catalogue/detail.json?item=${id}`;
        try {
            const response = await fetch(url, {
                headers: { 'User-Agent': this.USER_AGENT }
            });

            if (!response.ok) {
                return err(new Error(`GE API returned ${response.status} for item ${id}`));
            }

            const data = await response.json() as any;
            if (!data.item) return err(new Error('Item not found in GE database.'));

            const item = data.item;
            return ok({
                id: item.id,
                name: item.name,
                description: item.description,
                type: item.type,
                members: item.members === 'true',
                price: item.current.price,
                icon: item.icon_large
            });
        } catch (e) {
            logger.error({ id, error: (e as Error).message }, 'GE Item lookup failed.');
            return err(e as Error);
        }
    }

    /**
     * getPlayerQuests(name) - Fetches quest completion status for a player.
     */
    public async getPlayerQuests(name: string): Promise<Result<any[]>> {
        const url = `${this.METRICS_BASE}/quests?user=${encodeURIComponent(name)}`;
        try {
            const response = await fetch(url, {
                headers: { 'User-Agent': this.USER_AGENT }
            });

            if (!response.ok) {
                return err(new Error(`Runemetrics returned ${response.status} for user ${name}`));
            }

            const data = await response.json() as any;
            return ok(data);
        } catch (e) {
            logger.error({ name, error: (e as Error).message }, 'Quest lookup failed.');
            return err(e as Error);
        }
    }

    /**
     * healthCheck() - Verifies connectivity to Jagex APIs.
     */
    public async healthCheck(): Promise<{ online: boolean; details: string }> {
        try {
            const res = await fetch(`${this.GE_BASE}/info.json`, { signal: AbortSignal.timeout(3000) });
            return {
                online: res.ok,
                details: res.ok ? 'Official Jagex API Bridge: ONLINE' : 'Official Jagex API Bridge: OFFLINE (CORS or Connectivity Issue)'
            };
        } catch (e) {
            return { online: false, details: `Official Jagex API Bridge: OFFLINE (${(e as Error).message})` };
        }
    }
}
