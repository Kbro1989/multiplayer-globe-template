import { createLogger } from '../../utils/logger.js';
import { Result, ok, err } from '../../core/models.js';
import { CacheForensicsLimb } from './CacheForensicsLimb.js';
import { CacheLearningLimb } from './CacheLearningLimb.js';
import { WikiEnricher } from '../../utils/WikiEnricher.js';
import * as fs from 'fs';
import * as path from 'path';

const logger = createLogger('MinigameForensicsLimb');

export interface MinigameManifest {
    name: string;
    description: string;
    interfaces: number[];
    npcs: { id: number; name: string; spatial?: any }[];
    objects: { id: number; name: string; spatial?: any }[];
    rewards: { id: number; name: string; spatial?: any }[];
    timestamp: string;
}

/**
 * MinigameForensicsLimb - Systemic Learning Substrate
 */
export class MinigameForensicsLimb {
    constructor(
        private forensics: CacheForensicsLimb,
        private learning: CacheLearningLimb
    ) {}

    /**
     * learnMinigame(name) - Deconstructs a minigame system.
     */
    public async learnMinigame(name: string): Promise<Result<MinigameManifest>> {
        logger.info({ name }, 'Learning minigame system...');

        try {
            const manifest: MinigameManifest = {
                name,
                description: '',
                interfaces: [],
                npcs: [],
                objects: [],
                rewards: [],
                timestamp: new Date().toISOString()
            };

            // 1. Fetch Wiki Enrichment
            const wikiRes = await WikiEnricher.enrich(name);
            if (wikiRes.ok) {
                manifest.description = wikiRes.value.intent;
            }

            // 2. Extract Associated Links
            const links = await WikiEnricher.fetchPageLinks(name);
            logger.debug({ count: links.length }, 'Extracted systemic links from Wiki.');

            // 3. Filter & Resolve Assets
            for (const link of links) {
                // Heuristic: Check if NPC
                const npcRes = await this.forensics.crossReferenceNpc(link);
                if (npcRes.ok) {
                    const spatial = await this.learning.learnSpatialModel('npc', npcRes.value.id);
                    manifest.npcs.push({ id: npcRes.value.id, name: link, spatial: spatial.ok ? spatial.value.metrics : undefined });
                    continue;
                }

                // Heuristic: Check if Item (Rewards)
                // Filter for common reward keywords
                if (link.match(/halo|decorative|cape|hood|sword|plate|legs|helm/i)) {
                    const itemRes = await this.forensics.crossReferenceItem(link);
                    if (itemRes.ok) {
                        const spatial = await this.learning.learnSpatialModel('item', itemRes.value.id);
                        manifest.rewards.push({ id: itemRes.value.id, name: link, spatial: spatial.ok ? spatial.value.metrics : undefined });
                        continue;
                    }
                }

                // Optimization: Interface IDs are often mentioned in technical sections
                const interfaceIdMatch = link.match(/Interface (\d+)/i);
                if (interfaceIdMatch) {
                    manifest.interfaces.push(parseInt(interfaceIdMatch[1]));
                    continue;
                }
            }

            // 4. Persistence
            const atlasDir = 'D:\\sovereign\\atlas\\minigames';
            const atlasPath = path.join(atlasDir, `${name.replace(/\s+/g, '_').toLowerCase()}.json`);
            if (!fs.existsSync(atlasDir)) fs.mkdirSync(atlasDir, { recursive: true });
            fs.writeFileSync(atlasPath, JSON.stringify(manifest, null, 2));

            return ok(manifest);
        } catch (e) {
            logger.error({ name, error: (e as Error).message }, 'Minigame learning failed.');
            return err(e as Error);
        }
    }
}
