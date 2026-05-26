/**
 * LuckTierRegistry.ts
 *
 * Sovereign Substrate: Luck Mechanic Heat Map
 * 
 * Static, AI-queryable registry that maps bosses, slayer monsters, equipment,
 * and skilling activities to their RS3 luck tiers (1–4).
 * 
 * Used by the AI for:
 *   - Equipment optimization (which ring to equip for which boss)
 *   - Loot resolution (does current luck tier affect this drop table?)
 *   - Heat mapping (prioritizing content where luck ring matters)
 *   - Drop rate modifiers in SimulationHarness
 *
 * Data Source: D:\sovereign\memory\pedagogy\sovereign_luck_registry.json
 * Wiki Source: https://runescape.wiki/w/Luck
 */

import { createLogger } from '../../utils/logger.js';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const logger = createLogger('LuckTierRegistry');

// ═══════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════

export type LuckTier = 0 | 1 | 2 | 3 | 4;

export interface LuckBossEntry {
    name: string;
    wikiSlug: string;
    tier: LuckTier;
    notes?: string;
    immune?: boolean;
    immuneReason?: string;
}

export interface LuckEnhancer {
    name: string;
    tier: LuckTier;
    type: 'equipment' | 'relic' | 'potion';
}

export interface LuckQuery {
    /** The luck tier required to affect this entity's drops */
    requiredTier: LuckTier;
    /** Whether the entity is immune to luck (e.g., ED bosses) */
    immune: boolean;
    /** Optional notes about special behavior */
    notes?: string;
}

export interface EquipmentLuckQuery {
    /** What tier this enhancer provides */
    providedTier: LuckTier;
    /** Type of enhancer */
    type: 'equipment' | 'relic' | 'potion';
}

// ═══════════════════════════════════════════════════════
// Registry Singleton
// ═══════════════════════════════════════════════════════

const REGISTRY_PATH = join('D:', 'sovereign', 'memory', 'pedagogy', 'sovereign_luck_registry.json');

export class LuckTierRegistry {
    private static instance: LuckTierRegistry;

    // Normalized lookup maps (lowercase key → data)
    private bossMap = new Map<string, LuckBossEntry>();
    private slayerMap = new Map<string, { tier: LuckTier; levelRange: string }>();
    private enhancerMap = new Map<string, EquipmentLuckQuery>();
    private clueMap = new Map<string, LuckTier>();
    private rawData: any = null;

    private constructor() {
        this.load();
    }

    public static getInstance(): LuckTierRegistry {
        if (!LuckTierRegistry.instance) {
            LuckTierRegistry.instance = new LuckTierRegistry();
        }
        return LuckTierRegistry.instance;
    }

    // ───────────────────────────────────────────────────
    // Load
    // ───────────────────────────────────────────────────

    private load(): void {
        if (!existsSync(REGISTRY_PATH)) {
            logger.warn({ path: REGISTRY_PATH }, '[LuckTierRegistry] Registry file not found. Operating with empty data.');
            return;
        }

        try {
            this.rawData = JSON.parse(readFileSync(REGISTRY_PATH, 'utf-8'));
            this.indexBosses();
            this.indexSlayer();
            this.indexEnhancers();
            this.indexClues();
            logger.info({
                bosses: this.bossMap.size,
                slayer: this.slayerMap.size,
                enhancers: this.enhancerMap.size
            }, '[LuckTierRegistry] Loaded successfully.');
        } catch (err) {
            logger.error({ err }, '[LuckTierRegistry] Failed to parse registry.');
        }
    }

    // ───────────────────────────────────────────────────
    // Indexers
    // ───────────────────────────────────────────────────

    private indexBosses(): void {
        const bosses = this.rawData?.bosses;
        if (!bosses) return;

        for (const tier of [1, 2, 3, 4] as LuckTier[]) {
            const key = `tier${tier}` as const;
            const entries = bosses[key];
            if (!Array.isArray(entries)) continue;

            for (const entry of entries) {
                this.bossMap.set(this.normalize(entry.name), {
                    name: entry.name,
                    wikiSlug: entry.wikiSlug,
                    tier,
                    notes: entry.notes
                });
            }
        }

        // Index immune bosses
        if (Array.isArray(bosses.immune)) {
            for (const entry of bosses.immune) {
                this.bossMap.set(this.normalize(entry.name), {
                    name: entry.name,
                    wikiSlug: entry.wikiSlug,
                    tier: 0,
                    immune: true,
                    immuneReason: entry.reason
                });
            }
        }
    }

    private indexSlayer(): void {
        const slayer = this.rawData?.slayerMonsters;
        if (!slayer) return;

        for (const tier of [1, 2, 3] as LuckTier[]) {
            const key = `tier${tier}` as const;
            const block = slayer[key];
            if (!block?.monsters) continue;

            for (const name of block.monsters) {
                this.slayerMap.set(this.normalize(name), {
                    tier,
                    levelRange: block.levelRange
                });
            }
        }
    }

    private indexEnhancers(): void {
        const enhancers = this.rawData?.luckEnhancers;
        if (!enhancers) return;

        for (const tier of [1, 2, 3, 4] as LuckTier[]) {
            const key = `tier${tier}` as const;
            const block = enhancers[key];
            if (!block) continue;

            for (const name of block.equipment || []) {
                this.enhancerMap.set(this.normalize(name), { providedTier: tier, type: 'equipment' });
            }
            for (const name of block.relicPowers || []) {
                this.enhancerMap.set(this.normalize(name), { providedTier: tier, type: 'relic' });
            }
            for (const name of block.potions || []) {
                this.enhancerMap.set(this.normalize(name), { providedTier: tier, type: 'potion' });
            }
        }
    }

    private indexClues(): void {
        const clues = this.rawData?.clueScrolls;
        if (!clues) return;

        // Map each clue difficulty to the minimum tier that covers it
        this.clueMap.set('easy', 1);
        this.clueMap.set('medium', 2);
        this.clueMap.set('hard', 3);
        this.clueMap.set('elite', 4);
        this.clueMap.set('master', 4);
    }

    // ───────────────────────────────────────────────────
    // Query API — Boss
    // ───────────────────────────────────────────────────

    /**
     * Look up a boss by name. Returns the luck tier required to affect its drops.
     * Returns tier 0 if immune, or undefined if not found in registry.
     */
    public queryBoss(name: string): LuckQuery | undefined {
        const entry = this.bossMap.get(this.normalize(name));
        if (!entry) return undefined;

        return {
            requiredTier: entry.tier,
            immune: entry.immune ?? false,
            notes: entry.immune ? entry.immuneReason : entry.notes
        };
    }

    /**
     * Check if the player's current luck tier is sufficient for a boss.
     */
    public isLuckEffective(bossName: string, playerLuckTier: LuckTier): boolean {
        const query = this.queryBoss(bossName);
        if (!query) return false;        // Unknown boss
        if (query.immune) return false;   // ED bosses etc.
        return playerLuckTier >= query.requiredTier;
    }

    /**
     * Get all bosses at or below a given luck tier.
     * Useful for heat-mapping: "what bosses benefit from my Ring of Fortune (T3)?"
     */
    public getBossesAtTier(tier: LuckTier): LuckBossEntry[] {
        const results: LuckBossEntry[] = [];
        for (const entry of this.bossMap.values()) {
            if (!entry.immune && entry.tier <= tier && entry.tier > 0) {
                results.push(entry);
            }
        }
        return results;
    }

    // ───────────────────────────────────────────────────
    // Query API — Slayer
    // ───────────────────────────────────────────────────

    /**
     * Look up a slayer monster. Returns tier needed to affect its unique drops.
     */
    public querySlayer(name: string): LuckQuery | undefined {
        const entry = this.slayerMap.get(this.normalize(name));
        if (!entry) return undefined;

        return {
            requiredTier: entry.tier,
            immune: false,
            notes: `Slayer level range: ${entry.levelRange}`
        };
    }

    // ───────────────────────────────────────────────────
    // Query API — Equipment
    // ───────────────────────────────────────────────────

    /**
     * Look up a luck enhancer item and find what tier it provides.
     */
    public queryEnhancer(itemName: string): EquipmentLuckQuery | undefined {
        return this.enhancerMap.get(this.normalize(itemName));
    }

    /**
     * Given a list of equipped item names, resolve the effective luck tier.
     * Highest tier wins (they don't stack).
     */
    public resolveEffectiveTier(equippedItems: string[]): LuckTier {
        let best: LuckTier = 0;
        for (const item of equippedItems) {
            const enhancer = this.enhancerMap.get(this.normalize(item));
            if (enhancer && enhancer.providedTier > best) {
                best = enhancer.providedTier;
            }
        }
        return best;
    }

    // ───────────────────────────────────────────────────
    // Query API — Clue Scrolls
    // ───────────────────────────────────────────────────

    /**
     * Get the minimum luck tier needed to boost a clue scroll difficulty.
     */
    public queryClue(difficulty: string): LuckTier {
        return this.clueMap.get(difficulty.toLowerCase()) ?? 0 as LuckTier;
    }

    // ───────────────────────────────────────────────────
    // Query API — Skilling
    // ───────────────────────────────────────────────────

    /**
     * Get the metamorphic geode bonus chance for a given luck tier.
     */
    public getGeodeBonus(tier: LuckTier): number {
        const bonuses = this.rawData?.skillingEffects?.metamorphicGeode;
        if (!bonuses) return 0;
        const key = `tier${tier}`;
        return bonuses[key] ?? 0;
    }

    /**
     * Get the crystal chest / triskelion rare drop bonus for a given luck tier.
     */
    public getCrystalChestBonus(tier: LuckTier): number {
        const bonuses = this.rawData?.crystalChestAndTriskelion;
        if (!bonuses) return 0;
        const key = `tier${tier}`;
        return bonuses[key] ?? 0;
    }

    // ───────────────────────────────────────────────────
    // Heat Map Query — AI Decision Support
    // ───────────────────────────────────────────────────

    /**
     * For AI heat-mapping: Given the player's current equipment loadout,
     * returns a priority-sorted list of bosses where luck is effective,
     * along with bosses where upgrading the ring would unlock new benefits.
     */
    public getHeatMap(equippedItems: string[]): {
        effective: LuckBossEntry[];
        upgradeTargets: LuckBossEntry[];
        currentTier: LuckTier;
    } {
        const currentTier = this.resolveEffectiveTier(equippedItems);
        const effective: LuckBossEntry[] = [];
        const upgradeTargets: LuckBossEntry[] = [];

        for (const entry of this.bossMap.values()) {
            if (entry.immune) continue;
            if (entry.tier === 0) continue;

            if (entry.tier <= currentTier) {
                effective.push(entry);
            } else {
                upgradeTargets.push(entry);
            }
        }

        // Sort by tier descending (highest-value content first)
        effective.sort((a, b) => b.tier - a.tier);
        upgradeTargets.sort((a, b) => a.tier - b.tier);

        return { effective, upgradeTargets, currentTier };
    }

    /**
     * Recommend the best luck enhancer for a specific boss.
     */
    public recommendEnhancer(bossName: string): { minimumItem: string; tier: LuckTier } | undefined {
        const query = this.queryBoss(bossName);
        if (!query || query.immune) return undefined;

        // Find cheapest enhancer at the required tier
        const tier = query.requiredTier;
        const candidates: string[] = [];
        for (const [name, enhancer] of this.enhancerMap.entries()) {
            if (enhancer.providedTier >= tier) {
                candidates.push(name);
            }
        }

        // Return the first equipment-type at minimum matching tier
        const tierKey = `tier${tier}` as const;
        const equipment = this.rawData?.luckEnhancers?.[tierKey]?.equipment;
        if (equipment && equipment.length > 0) {
            return { minimumItem: equipment[0], tier };
        }

        return undefined;
    }

    // ───────────────────────────────────────────────────
    // Utilities
    // ───────────────────────────────────────────────────

    private normalize(name: string): string {
        return name.toLowerCase().trim().replace(/['']/g, "'");
    }

    /** Get the raw registry data for direct inspection */
    public getRawData(): any {
        return this.rawData;
    }

    /** Get summary stats for diagnostics */
    public getSummary(): string {
        return [
            `[LuckTierRegistry]`,
            `  Bosses indexed: ${this.bossMap.size}`,
            `  Slayer monsters indexed: ${this.slayerMap.size}`,
            `  Luck enhancers indexed: ${this.enhancerMap.size}`,
            `  Clue tiers indexed: ${this.clueMap.size}`,
        ].join('\n');
    }
}
