import * as path from 'path';
import { Result, ok, err } from '../../core/models.js';
import { createLogger } from "../../utils/logger.js";
import { getSovereignRoot, getrsmvCachePath, getCachePedagogyPath, getrsmvSubstratePath, getrsmvLiveCachePath, getrsmvBetaCachePath } from '../../utils/SovereignPathResolver.js';
import { rsmvBridge } from '../../utils/RSMVBridge.js'; // Assuming rsmvBridge has a .getEnum(id: number) method
import { WorldGroundingLimb } from '../world_grounding/WorldGroundingLimb.js';
import * as fs from 'fs';
import * as fsPromise from 'fs/promises';

const logger = createLogger('CacheForensicsLimb');

/**
 * Represents the volatility status of a cache file.
 */
export interface VolatilityStatus {
    readonly lastModified: Date;
    readonly hasChanged: boolean;
}

/**
 * Interface for an item entry in the JSON catalog.
 */
interface ItemEntry {
    readonly id: number;
    readonly name: string;
    readonly isEquippable?: boolean;
    readonly equipSlotId?: number;
    readonly isMember?: boolean;
    readonly members?: boolean;
    readonly maleModels?: number[];
    readonly femaleModels?: number[];
    readonly actions?: string[];
    readonly widget_actions_0?: string;
    readonly widget_actions_1?: string;
    readonly widget_actions_2?: string;
    readonly widget_actions_3?: string;
    readonly widget_actions_4?: string;
}

/**
 * Interface for an NPC entry in the JSON catalog.
 */
interface NpcEntry {
    readonly id: number;
    readonly name: string;
    readonly combatLevel?: number;
    readonly combat?: number;
    readonly models?: number[];
    readonly headModels?: number[];
    readonly actions?: string[];
    readonly actions_0?: string;
    readonly actions_1?: string;
    readonly actions_2?: string;
    readonly actions_3?: string;
    readonly actions_4?: string;
    readonly boundSize?: number;
    readonly raw?: { boundSize?: number; animation_group?: number };
    readonly animationGroup?: number;
}

/**
 * Interface for an object entry in the JSON catalog.
 */
interface ObjectEntry {
    readonly id: number;
    readonly name: string;
    readonly actions?: string[];
    readonly actions_0?: string;
    readonly actions_1?: string;
    readonly actions_2?: string;
    readonly actions_3?: string;
    readonly actions_4?: string;
    readonly models?: number[];
    readonly sizeX?: number;
    readonly width?: number;
    readonly sizeZ?: number;
    readonly length?: number;
    readonly maybe_blocks_movement?: boolean;
    readonly probably_nocollision?: boolean;
    readonly params?: Record<string, unknown>;
}

/**
 * Interface for a quest entry in the JSON catalog.
 */
interface QuestEntry {
    readonly id: number;
    readonly name: string;
    readonly prerequisiteQuests: number[];
    // Add other relevant quest properties as needed
}

/**
 * Interface for the structure of equipment_by_slot.json.
 */
interface EquipmentBySlotData {
    readonly equipment: Record<string, { items: Array<{ id: number; maleModelId?: number }> }>;
}

/**
 * CacheForensicsLimb - Sovereign Epistemology Substrate
 *
 * Responsibilities:
 * 1. Cache Volatility Monitoring (detecting if the physical JS5 cache updated).
 * 2. High-fidelity forensic decompilation of Items, NPCs, Objects, and Enums.
 * 3. Unified search across exported JSON catalogs.
 */
export class CacheForensicsLimb {
    private static instance: CacheForensicsLimb | undefined;
    private readonly rootDir: string = getCachePedagogyPath(); // D:\sovereign\cache_pedagogy\json_dumps
    private readonly liveCachePath: string = getrsmvLiveCachePath();
    private readonly betaCachePath: string | null = getrsmvBetaCachePath();

    // Volatility tracking
    private lastLiveCacheStat: number = 0;
    private lastBetaCacheStat: number = 0;
    private readonly liveMainFile: string;
    private readonly betaMainFile: string | null = null;

    // Cached JSON files
    private equipmentBySlot: EquipmentBySlotData | null = null;
    private quests: { quests: QuestEntry[] } | null = null;
    private npcs: NpcEntry[] | null = null;
    private items: ItemEntry[] | null = null;
    private objects: ObjectEntry[] | null = null;

    // Grounding & Pedagogy
    private readonly grounding: WorldGroundingLimb;
    private readonly pedagogyDir: string = path.join('D:/sovereign', 'memory', 'pedagogy'); // This path is intentionally hardcoded as D:/sovereign, not relative to getSovereignRoot()

    private readonly SLOT_NAMES: readonly string[] = [
        'helm', 'cape', 'necklace', 'weapon', 'body', 'offhand',
        'arms', 'legs', 'face', 'gloves', 'boots', 'beard',
        'ring', 'ammo', 'aura', 'slot15'
    ];

    /**
     * Returns the singleton instance of CacheForensicsLimb.
     * @returns The singleton instance.
     */
    public static getInstance(): CacheForensicsLimb {
        if (!this.instance) {
            this.instance = new CacheForensicsLimb();
        }
        return this.instance;
    }

    /**
     * Resets the singleton instance (for testing purposes only).
     * @throws {Error} If called in production environment.
     */
    public static resetInstance(): void {
        if (process.env.NODE_ENV === 'production') {
            throw new Error('resetInstance is forbidden in production');
        }
        this.instance = undefined;
    }

    /**
     * Private constructor to enforce singleton pattern.
     * Initializes cache paths and loads catalog data.
     * @throws {Error} If an attempt is made to create a second instance.
     */
    protected constructor() {
        if (CacheForensicsLimb.instance) {
            throw new Error('Singleton violation: use CacheForensicsLimb.getInstance()');
        }

        // 1. Resolve Live Main File
        this.liveMainFile = this.resolveMainCacheFile(this.liveCachePath);

        // 2. Resolve Beta Main File
        if (this.betaCachePath) {
            this.betaMainFile = this.resolveMainCacheFile(this.betaCachePath);
        }

        // Initialize grounding resolver
        this.grounding = WorldGroundingLimb.getInstance();

        // Lazy load basic catalogs
        this.loadCatalogData();
    }

    private resolveMainCacheFile(cachePath: string): string {
        const legacyPath = path.join(cachePath, 'main_file_cache.dat2');
        const rootIndexPath = path.join(cachePath, 'js5-index.jcache');

        if (fs.existsSync(rootIndexPath)) return rootIndexPath;
        if (fs.existsSync(legacyPath)) return legacyPath;

        const files = fs.readdirSync(cachePath).filter(f => f.endsWith('.jcache'));
        const bundles = files.map(f => ({ name: f, major: parseInt(f.match(/\d+/)?.[0] || '0', 10) }))
            .sort((a, b) => b.major - a.major);
        return bundles.length > 0 ? path.join(cachePath, bundles[0].name) : 'OFFLINE';
    }

    /**
     * initialize - Boot sequence for the forensic substrate.
     * @returns A Promise resolving to a Result indicating success or failure.
     */
    public async initialize(): Promise<Result<boolean, Error>> {
        try {
            const manifestsDir = path.join(this.pedagogyDir, 'manifests');
            // Ensure pedagogy directories exist, if not, create them.
            if (!fs.existsSync(this.pedagogyDir)) {
                await fsPromise.mkdir(this.pedagogyDir, { recursive: true });
            }
            if (!fs.existsSync(manifestsDir)) {
                await fsPromise.mkdir(manifestsDir, { recursive: true });
            }

            logger.info('Booting CacheForensicsLimb (Epistemology substrate)...');

            // Initial volatility check
            const volatility = await this.checkCacheVolatility();
            if (volatility.ok && volatility.value.hasChanged) {
                logger.warn('Initial cache state indicates recent modifications. Substrate may be out of sync.');
            }

            logger.info('CacheForensicsLimb sequence ACTIVE.');
            return ok(true);
        } catch (error) {
            return err(error instanceof Error ? error : new Error(String(error)));
        }
    }

    /**
     * isAuthoritative - Confirms if the substrate is grounded in the 11GB Live Cache.
     * @returns A Promise resolving to a boolean indicating if the substrate is authoritative.
     */
    public async isAuthoritative(): Promise<boolean> {
        try {
            const health = await rsmvBridge.healthCheck();
            // Statuses like 'ONLINE (Authoritative)' or 'ONLINE' against the live path confirm authority.
            return health.ok && health.value.online;
        } catch (error) {
            logger.error({ error }, 'Failed to check rsmvBridge authority.');
            return false;
        }
    }

    /**
     * Synchronously loads basic JSON catalog data from disk.
     */
    private loadCatalogData(): void {
        try {
            const eqPath = path.join(this.rootDir, 'equipment_by_slot.json');
            if (fs.existsSync(eqPath)) {
                this.equipmentBySlot = JSON.parse(fs.readFileSync(eqPath, 'utf8')) as EquipmentBySlotData;
                logger.debug('Loaded equipment_by_slot.json');
            }

            const questPath = path.join(this.rootDir, 'quests.json');
            if (fs.existsSync(questPath)) {
                this.quests = JSON.parse(fs.readFileSync(questPath, 'utf8')) as { quests: QuestEntry[] };
                logger.debug('Loaded quests.json');
            }
        } catch (e) {
            const err = `Critical failure: Failed to load forensic JSON catalogs from ${this.rootDir}. Error: ${(e as Error).message}`;
            logger.error({ error: (e as Error).message }, err);
            throw new Error(err);
        }
    }

    /**
     * Checks the physical mtime of both live and beta caches.
     * @returns A Promise resolving to a Result containing the VolatilityStatus or an Error.
     */
    public async checkCacheVolatility(): Promise<Result<VolatilityStatus, Error>> {
        try {
            const liveStat = await this.getStat(this.liveMainFile);
            const liveChanged = this.lastLiveCacheStat > 0 && liveStat.mtimeMs > this.lastLiveCacheStat;
            this.lastLiveCacheStat = liveStat.mtimeMs;

            let betaChanged = false;
            let lastBetaMod = new Date(0);
            if (this.betaMainFile && this.betaMainFile !== 'OFFLINE') {
                const betaStat = await this.getStat(this.betaMainFile);
                betaChanged = this.lastBetaCacheStat > 0 && betaStat.mtimeMs > this.lastBetaCacheStat;
                this.lastBetaCacheStat = betaStat.mtimeMs;
                lastBetaMod = betaStat.mtime;
            }

            if (liveChanged || betaChanged) {
                logger.info({ liveChanged, betaChanged }, 'Cache update detected.');
                if (betaChanged) {
                    await this.monitorSkillRegistry();
                }
            }

            return ok({
                lastModified: liveStat.mtime,
                hasChanged: liveChanged || betaChanged
            });
        } catch (error) {
            logger.error({ error }, `Cache volatility probe failed`);
            return err(error as Error);
        }
    }

    private async getStat(filePath: string): Promise<fs.Stats> {
        if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
        return await fsPromise.stat(filePath);
    }

    /**
     * monitorSkillRegistry - Automated sentinel for the 30th skill.
     * Checks Enum 1518 (Skills) and Interface 1314 (Skills Menu) for expansion.
     */
    public async monitorSkillRegistry(): Promise<void> {
        logger.info('Running skill registry forensic sentinel...');
        try {
            // 1. Check Enum 1518 (Skill IDs)
            const skillEnumRes = await rsmvBridge.getEnum(1518);
            if (skillEnumRes.ok && skillEnumRes.value?.raw?.values) {
                const skillCount = Object.keys(skillEnumRes.value.raw.values).length;
                if (skillCount > 29) {
                    logger.warn({ skillCount }, '!!! 30TH SKILL DETECTED IN ENUM 1518 !!!');
                }
            }

            // 2. Check Interface 1314 (Skills Interface)
            const skillUiRes = await rsmvBridge.getInterface(1314);
            if (skillUiRes.ok && skillUiRes.value?.raw?.components) {
                const componentCount = skillUiRes.value.raw.components.length;
                // Necromancy ends at 162-163. If > 164, a new slot was likely added.
                if (componentCount > 164) {
                    logger.warn({ componentCount }, '!!! NEW SKILL COMPONENTS DETECTED IN INTERFACE 1314 !!!');
                }
            }

            // 3. Check DBRows (Archive 41) for XP table growth in Table 1 (Skill XP Curves)
            const dbRowsRes = await rsmvBridge.getDBRows(1);
            if (dbRowsRes.ok && dbRowsRes.value) {
                const rows = dbRowsRes.value.count;
                logger.info({ skillXpRows: rows }, 'DBRows (Table 1: Skill XP) audit completed.');
            }
        } catch (e) {
            logger.error({ error: (e as Error).message }, 'Skill registry sentinel failed.');
        }
    }

    /**
     * healthCheck - Neurological diagnostic probe for the forensics substrate.
     */
    public async healthCheck(): Promise<{ online: boolean; details: string }> {
        const volatility = await this.checkCacheVolatility();
        const authoritative = await this.isAuthoritative();
        const online = authoritative && volatility.ok;

        return {
            online,
            details: `Forensics: ${online ? 'ONLINE' : 'DEGRADED'} (Auth: ${authoritative}, Volatility: ${volatility.ok ? 'OK' : 'ERROR'})`
        };
    }

    /**
     * getNpcDetails - Retrieves high-fidelity forensic data for an NPC.
     */
    public async getNpcDetails(npcId: number): Promise<Result<any, Error>> {
        if (!this.npcs) {
            const npcPath = path.join(this.rootDir, 'npcs.json');
            if (fs.existsSync(npcPath)) {
                this.npcs = JSON.parse(fs.readFileSync(npcPath, 'utf8')) as NpcEntry[];
            }
        }

        const npc = this.npcs?.find(n => n.id === npcId);
        if (!npc) return err(new Error(`NPC ${npcId} not found in forensic catalog.`));

        return ok({
            id: npc.id,
            forensics: {
                name: npc.name,
                combatLevel: npc.combatLevel || npc.combat || 0,
                models: npc.models || [],
                headModels: npc.headModels || [],
                actions: npc.actions || [npc.actions_0, npc.actions_1, npc.actions_2, npc.actions_3, npc.actions_4].filter(Boolean) as string[],
                size: npc.boundSize || 1
            }
        });
    }

    /**
     * getItemDetails - Retrieves high-fidelity forensic data for an Item.
     */
    public async getItemDetails(itemId: number): Promise<Result<any, Error>> {
        if (!this.items) {
            const itemPath = path.join(this.rootDir, 'items.json');
            if (fs.existsSync(itemPath)) {
                this.items = JSON.parse(fs.readFileSync(itemPath, 'utf8')) as ItemEntry[];
            }
        }

        const item = this.items?.find(i => i.id === itemId);
        if (!item) return err(new Error(`Item ${itemId} not found in forensic catalog.`));

        return ok({
            id: item.id,
            forensics: {
                name: item.name,
                isEquippable: item.isEquippable || !!item.equipSlotId,
                equipSlot: item.equipSlotId,
                models: [...(item.maleModels || []), ...(item.femaleModels || [])],
                actions: item.actions || [item.widget_actions_0, item.widget_actions_1, item.widget_actions_2, item.widget_actions_3, item.widget_actions_4].filter(Boolean) as string[]
            }
        });
    }

    /**
     * getObjectDetails - Retrieves high-fidelity forensic data for a game object.
     */
    public async getObjectDetails(objId: number): Promise<Result<any, Error>> {
        if (!this.objects) {
            const objPath = path.join(this.rootDir, 'objects.json');
            if (fs.existsSync(objPath)) {
                this.objects = JSON.parse(fs.readFileSync(objPath, 'utf8')) as ObjectEntry[];
            }
        }

        const obj = this.objects?.find(o => o.id === objId);
        if (!obj) return err(new Error(`Object ${objId} not found in forensic catalog.`));

        return ok({
            id: obj.id,
            forensics: {
                name: obj.name,
                actions: obj.actions || [obj.actions_0, obj.actions_1, obj.actions_2, obj.actions_3, obj.actions_4].filter(Boolean) as string[],
                models: obj.models || [],
                size: { x: obj.sizeX || obj.width || 1, z: obj.sizeZ || obj.length || 1 }
            }
        });
    }

    /**
     * findItemSlot - Identifies the human-readable equipment slot for a given item ID.
     */
    public findItemSlot(itemId: number): string | null {
        if (!this.equipmentBySlot) return null;

        for (const [slotName, data] of Object.entries(this.equipmentBySlot.equipment)) {
            if (data.items.some(i => i.id === itemId)) {
                return slotName.toLowerCase();
            }
        }
        return null;
    }

    /**
     * close - Graceful shutdown of the forensics substrate.
     */
    public async close(): Promise<void> {
        logger.info('CacheForensicsLimb shutting down.');
    }

    /**
     * queryTaxonomy - Search for a specific character, item, or object in the game database.
     */
    public queryTaxonomy(params: { layer: 'npcs' | 'items' | 'objects' | 'quests', term: string, queryType: 'exact' | 'partial' | 'regex' }): Result<any[]> {
        this.loadCatalogData(); // Ensure base catalogs are present

        let data: any[] = [];
        switch (params.layer) {
            case 'npcs':
                if (!this.npcs) {
                    const npcPath = path.join(this.rootDir, 'npcs.json');
                    if (fs.existsSync(npcPath)) this.npcs = JSON.parse(fs.readFileSync(npcPath, 'utf8'));
                }
                data = this.npcs || [];
                break;
            case 'items':
                if (!this.items) {
                    const itemPath = path.join(this.rootDir, 'items.json');
                    if (fs.existsSync(itemPath)) this.items = JSON.parse(fs.readFileSync(itemPath, 'utf8'));
                }
                data = this.items || [];
                break;
            case 'objects':
                if (!this.objects) {
                    const objPath = path.join(this.rootDir, 'objects.json');
                    if (fs.existsSync(objPath)) this.objects = JSON.parse(fs.readFileSync(objPath, 'utf8'));
                }
                data = this.objects || [];
                break;
            case 'quests':
                data = this.quests?.quests || [];
                break;
        }

        const term = params.term.toLowerCase();
        const results = data.filter(e => {
            const name = (e.name || '').toLowerCase();
            if (params.queryType === 'exact') return name === term;
            if (params.queryType === 'regex') return new RegExp(params.term, 'i').test(name);
            return name.includes(term);
        });

        return ok(results);
    }

    /**
     * crossReferenceNpc - Link a game NPC name to its model IDs for extraction.
     */
    public async crossReferenceNpc(name: string): Promise<Result<any>> {
        const npcRes = this.queryTaxonomy({ layer: 'npcs', term: name, queryType: 'exact' });
        if (!npcRes.ok || npcRes.value.length === 0) {
            const partialRes = this.queryTaxonomy({ layer: 'npcs', term: name, queryType: 'partial' });
            if (!partialRes.ok || partialRes.value.length === 0) {
                return err(new Error(`No NPC found matching "${name}"`));
            }
            return this.getCrossReferenceForNpc(partialRes.value[0]);
        }
        return this.getCrossReferenceForNpc(npcRes.value[0]);
    }

    private getCrossReferenceForNpc(npc: NpcEntry): Result<any> {
        const models = npc.models || [];
        return ok({
            npcContext: {
                id: npc.id,
                name: npc.name
            },
            id: npc.id,
            rawModelIds: models
        });
    }

    /**
     * crossReferenceItem - Link a game item or character to its 3D model IDs for extraction.
     */
    public async crossReferenceItem(name: string): Promise<Result<any>> {
        const itemRes = this.queryTaxonomy({ layer: 'items', term: name, queryType: 'exact' });
        if (!itemRes.ok || itemRes.value.length === 0) {
            // Try partial if exact fails
            const partialRes = this.queryTaxonomy({ layer: 'items', term: name, queryType: 'partial' });
            if (!partialRes.ok || partialRes.value.length === 0) {
                return err(new Error(`No item found matching "${name}"`));
            }
            return this.getCrossReferenceForEntry(partialRes.value[0]);
        }
        return this.getCrossReferenceForEntry(itemRes.value[0]);
    }

    private getCrossReferenceForEntry(item: ItemEntry): Result<any> {
        const maleModels = item.maleModels || [];
        const femaleModels = item.femaleModels || [];
        const allModels = Array.from(new Set([...maleModels, ...femaleModels]));

        return ok({
            itemContext: {
                id: item.id,
                name: item.name
            },
            rawModelIds: allModels
        });
    }

    /**
     * Search for an entity by name across all exported JSON catalogs.
     */
    public async search(query: string, type: 'npc' | 'item' | 'object' | 'all' = 'all'): Promise<Result<any[], Error>> {
        const results: any[] = [];
        if (type === 'npc' || type === 'all') {
            const res = this.queryTaxonomy({ layer: 'npcs', term: query, queryType: 'partial' });
            if (res.ok) results.push(...res.value.map(v => ({ ...v, type: 'npc' })));
        }
        if (type === 'item' || type === 'all') {
            const res = this.queryTaxonomy({ layer: 'items', term: query, queryType: 'partial' });
            if (res.ok) results.push(...res.value.map(v => ({ ...v, type: 'item' })));
        }
        if (type === 'object' || type === 'all') {
            const res = this.queryTaxonomy({ layer: 'objects', term: query, queryType: 'partial' });
            if (res.ok) results.push(...res.value.map(v => ({ ...v, type: 'object' })));
        }
        return ok(results);
    }
}