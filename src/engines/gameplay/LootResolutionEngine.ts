import { GameState, Coord } from '../../core/models.js';
import { createLogger } from '../../utils/logger.js';
import { WikiEquipmentEnricher, WikiDropTable } from '../../utils/WikiEquipmentEnricher.js';
import { ServerLogicRegistry } from './ServerLogicRegistry.js';
import { WikiEnricher } from '../../utils/WikiEnricher.js';
import { SwitchboardLimb } from '../../monitor/SwitchboardLimb.js';
import { CanonicalClock } from '../../utils/CanonicalClock.js';

const logger = createLogger('LootResolutionEngine');

export interface LootDeathEvent {
    npcId: number;
    coord: Coord;
    killerId: string;
    tick: number;
    luckTier: number; // Snapped at the exact moment of death
    fallbackName?: string;
}

export interface ResolvedDrop {
    coord: Coord;
    items: Array<{
        itemName: string;
        quantity: string;
        sourceNpcName: string;
        /** GE mid-price in coins. 0 = unknown/untradeable. Forwarded to SimulationHarness for LootBeamRegistry. */
        geValue: number;
        rollMeta: {
            luckTier: number;
            rarityLabel: string;
        };
    }>;
}

/**
 * LootResolutionEngine
 * Asynchronous Substrate for determining physical drops.
 * Follows the GhostSplatEngine "Compute Off-Tick, Read On-Tick" pattern.
 * Connects Jagex Cache hollow deaths to robust Wikipedia drop tables.
 */
export class LootResolutionEngine {
    private static instance: LootResolutionEngine;
    private deathQueue: LootDeathEvent[] = [];
    private readyDrops: ResolvedDrop[] = [];
    private isProcessing: boolean = false;
    
    private constructor() {}

    public static getInstance(): LootResolutionEngine {
        if (!this.instance) {
            this.instance = new LootResolutionEngine();
        }
        return this.instance;
    }

    /**
     * queueDeath
     * Fired by the Master Tick. Snags the player's luck ring precisely when the killing blow connects.
     */
    public queueDeath(event: LootDeathEvent): void {
        this.deathQueue.push(event);
        logger.debug({ npcId: event.npcId, tick: event.tick }, '[LOOT ENGINE] Death recorded. Resolution pending.');
        this.processQueue(); // Fire and forget (Background Async)
    }

    /**
     * popReadyDrops
     * Fired by the Master Tick. Yields any fully synthesized drops so they can materialize into the world.
     */
    public popReadyDrops(): ResolvedDrop[] {
        if (this.readyDrops.length === 0) return [];
        const drops = [...this.readyDrops];
        this.readyDrops = [];
        return drops;
    }

    /**
     * Resolves pending deaths asynchronously without blocking the primary 600ms heartbeat.
     */
    private async processQueue(): Promise<void> {
        if (this.isProcessing || this.deathQueue.length === 0) return;
        this.isProcessing = true;

        try {
            while (this.deathQueue.length > 0) {
                const event = this.deathQueue.shift();
                if (!event) continue;

                const drop = await this.resolveLootForEvent(event);
                if (drop && drop.items.length > 0) {
                    this.readyDrops.push(drop);
                }
            }
        } catch (err) {
            logger.error({ err }, '[LOOT ENGINE] Background queue failure.');
        } finally {
            this.isProcessing = false;
        }
    }

    private async resolveLootForEvent(event: LootDeathEvent): Promise<ResolvedDrop | null> {
        let wikiName = event.fallbackName || `NPC ${event.npcId}`;
        
        // 1. Resolve true semantic name via ServerLogic / Legacy Wiki Enricher
        const cacheMatch = ServerLogicRegistry.getMapping(18, event.npcId);
        if (cacheMatch && cacheMatch.context) {
            wikiName = cacheMatch.context;
        } else {
            const wikiRes = await WikiEnricher.enrichNpc(`NPC ${event.npcId}`);
            if (wikiRes.ok && wikiRes.value.name) {
                wikiName = wikiRes.value.name;
            }
        }

        // 2. Fetch authoritative drop tables via the Equipment Enricher
        // (Includes Rare Drop Table inheritance)
        const tables = await WikiEquipmentEnricher.getInstance().parseDropTables(wikiName);
        if (!tables || tables.length === 0) {
            logger.debug({ wikiName }, '[LOOT ENGINE] No drops found for NPC.');
            return null;
        }

        const itemsToDrop = await this.rollTables(tables, event);
        if (itemsToDrop.length === 0) return null;

        return {
            coord: event.coord,
            items: itemsToDrop.map(i => ({
                itemName: i.itemName,
                quantity: i.quantity,
                sourceNpcName: wikiName,
                geValue: i.geValue ?? 0,  // GE value from WikiDropEntry — used by LootBeamRegistry
                rollMeta: {
                    luckTier: event.luckTier,
                    rarityLabel: i.rarity
                }
            }))
        };
    }

    /**
     * Execute the RNG rolls against the parsed drop tables.
     * Incorporates Player equipment Luck Tiers.
     */
    private async rollTables(tables: WikiDropTable[], event: LootDeathEvent): Promise<{itemName: string, quantity: string, rarity: string, geValue: number}[]> {
        const drops: {itemName: string, quantity: string, rarity: string, geValue: number}[] = [];
        const mainRngDrops: {itemName: string, quantity: string, rarity: string, geValue: number}[] = [];

        // Build deterministic RNG for this event
        const prng = this.seededRandom(`${event.npcId}:${event.killerId}:${event.tick}`);

        for (const table of tables) {
            // Isolate RDT calculation using specific RS3 Sub-table fractional weights
            if (table.section.toLowerCase().includes('rare drop table')) {
                const rdtDrop = this.rollRDT(table.entries, event.luckTier, prng);
                if (rdtDrop) drops.push(rdtDrop);
                continue;
            }

            for (const entry of table.entries) {
                const r = entry.rarity.toLowerCase();
                if (r.includes('always')) {
                    drops.push({ itemName: entry.itemName, quantity: entry.quantity, rarity: entry.rarity, geValue: entry.geValue ?? 0 });
                } else if (this.evaluateRarity(entry.rarity, event.luckTier, prng)) {
                    mainRngDrops.push({ itemName: entry.itemName, quantity: entry.quantity, rarity: entry.rarity, geValue: entry.geValue ?? 0 });
                }
            }
        }

        // Apply standard RS rule: 1 main drop per kill from the common/uncommon/rare pool
        if (mainRngDrops.length > 0) {
            drops.push(mainRngDrops[Math.floor(prng() * mainRngDrops.length)]);
        }

        return drops;
    }

    /**
     * Executes strict RS3 Rare Drop Table math based on Wiki weights.
     * Incorporates Gem (R), Super Rare (S), and Hazelmere (H) sub-table unlocking.
     */
    private rollRDT(entries: any[], luckTier: number, prng: () => number): {itemName: string, quantity: string, rarity: string, geValue: number} | null {
        // Base RDT access chance
        let enterChance = 1 / 64.0;
        enterChance *= (1.0 + (luckTier * 0.01)); // standard 1% bump per luck tier
        if (prng() > enterChance) return null;

        let totalWeight = 0;
        const pool: {entry: any, weight: number}[] = [];

        for (const entry of entries) {
            if (!entry.rarity.includes('CalculateRDTNaked')) continue;

            const reqLuckMatch = entry.rarity.match(/luck=(\d+)/);
            if (reqLuckMatch && luckTier < parseInt(reqLuckMatch[1], 10)) {
                continue; // Cannot roll if tier is insufficient
            }

            // Explicit Tier Removal logic ("Notes: removedt2", "removedt4")
            if (entry.notes) {
                if (luckTier >= 2 && entry.notes.includes('removedt2')) continue;
                if (luckTier >= 3 && entry.notes.includes('removedt3')) continue;
                if (luckTier >= 4 && entry.notes.includes('removedt4')) continue;
            }

            // Exclude Cheese+Tom Batta if tier is 4+ (where HSR/Blurberry take over)
            if (luckTier >= 4 && entry.itemName.includes("Cheese+tom batta")) continue;

            let weight = 0;
            // R_weight: Standard Gem/Rare Drop Table Items
            const rMatch = entry.rarity.match(/R_weight=([\d.]+)/);
            if (rMatch) weight += parseFloat(rMatch[1]);
            
            // S_weight: Super Rare Drop Table (Unlocked at Tier 2 - Ring of Wealth)
            if (luckTier >= 2) {
                const sMatch = entry.rarity.match(/S_weight=([\d.]+)/);
                if (sMatch) weight += parseFloat(sMatch[1]);
            }

            // H_weight: Hazelmere's Table
            const hMatch = entry.rarity.match(/H_weight=([\d.]+)/);
            if (hMatch) weight += parseFloat(hMatch[1]);

            if (weight > 0) {
                pool.push({ entry, weight });
                totalWeight += weight;
            }
        }

        if (pool.length === 0) return null;

        let roll = prng() * totalWeight;
        for (const p of pool) {
            roll -= p.weight;
            if (roll <= 0) {
                p.entry.rarity = 'Rare drop table'; // Override messy template tag for clean output
                return p.entry;
            }
        }
        
        return pool[pool.length - 1].entry;
    }

    private evaluateRarity(rarity: string, luckTier: number, prng: () => number): boolean {
        const r = rarity.toLowerCase();
        let chance = 0.0;

        if (r.includes('always')) chance = 1.0;
        else if (r.includes('common')) chance = 0.15;
        else if (r.includes('uncommon')) chance = 0.05;
        else if (r.includes('rare')) chance = 0.01;
        else if (r.includes('very rare')) chance = 0.002;
        
        // Look for exact fractions like "1/128" or "1/50"
        const fracMatch = r.match(/1\/(\d+)/);
        if (fracMatch) {
            chance = 1.0 / parseInt(fracMatch[1], 10);
        }

        // Apply Luck Modifier (+1% to rate per tier is standard RS3 math proxy)
        const luckMultiplier = 1.0 + (luckTier * 0.01);
        chance = chance * luckMultiplier;

        return prng() <= chance;
    }

    /** Simple deterministic PRNG */
    private seededRandom(seedStr: string): () => number {
        let h = 1779033703 ^ seedStr.length;
        for (let i = 0; i < seedStr.length; i++) {
            h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
            h = (h << 13) | (h >>> 19);
        }
        return function() {
            h = Math.imul(h ^ (h >>> 16), 2246822507);
            h = Math.imul(h ^ (h >>> 13), 3266489909);
            return ((h ^= h >>> 16) >>> 0) / 4294967296;
        };
    }

    private selectPlausibleDrops(potentialDrops: {itemName: string, quantity: string, rarity: string}[]): {itemName: string, quantity: string, rarity: string}[] {
        // Enforce 100% drops (bones/ashes) and 1 sub-table drop
        const alwaysDrops = potentialDrops.filter(d => d.rarity.toLowerCase().includes('always'));
        const rngDrops = potentialDrops.filter(d => !d.rarity.toLowerCase().includes('always'));
        
        // Pick one (or zero) rng drop if table triggered heavily
        if (rngDrops.length > 0) {
            // Shuffle and pick 1 just to mimic RS standard table (1 main drop per kill)
            alwaysDrops.push(rngDrops[CanonicalClock.getInstance().rng().range(0, rngDrops.length - 1)]);
        }
        return alwaysDrops;
    }
}
