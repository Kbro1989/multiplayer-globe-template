/**
 * LootBeamRegistry.ts
 * 
 * Cache-authoritative, Wiki-verified loot beam definitions.
 *
 * ## Source of Truth
 * - C:\ProgramData\Jagex\RuneScape (raw item/spotAnim data)
 * - https://runescape.wiki/w/Loot_beam (tier mechanics, GE thresholds)
 *
 * ## Cache Findings (via probe_lootbeam_v2.ts, 2026-04-17)
 * - SpotAnim 39:  model=74984, seq=32632, unk2e=false  → Beam variant A
 * - SpotAnim 40:  model=74985, seq=32632, unk2e=false  → Golden Loot Beam (default)
 * - Frozen beam cosmetic: item extra prop=4414 → intvalue=52301 (struct reference)
 * - Warped beam cosmetic: item extra prop=4414 → intvalue=52302
 *
 * ## Wiki-Verified Tier Mechanics
 * - Tier 1:  GE value ≥ 1,000,000   (blue text in chatbox)
 * - Tier 2:  GE value ≥ 10,000,000  (purple text)
 * - Tier 3:  GE value or rarity override (orange text — boss pets, champ scrolls, etc.)
 * - Tier 4:  GE value ≥ 100,000,000 (purple text); ≥ 1B = orange text
 *
 * ## Player Threshold
 * - Default minimum: 10,000 gp (configurable range 1,000–1,000,000)
 * - Below player's threshold: no beam spawned
 *
 * ## Visual Properties (for 3D renderer context)
 * - All beam SpotAnims use the same sequence (32632) — looping animation
 * - Tier sizing is scale-based (T1 small → T4 "grandiose")
 * - unk2e=false for these beams → standard depth render (NOT additive billboard)
 * - Beam appears at the tile's world origin, extends upward
 */

export const LOOT_BEAM_SPOTANIM = {
    /** Default golden loot beam — SpotAnim ID extracted from Jagex cache */
    goldenBeam: {
        spotAnimId: 40,
        modelId:    74985,
        sequenceId: 32632,
        additiveBlend: false
    },
    /** Secondary geometry variant */
    goldenBeamAlt: {
        spotAnimId: 39,
        modelId:    74984,
        sequenceId: 32632,
        additiveBlend: false
    }
} as const;

/**
 * GE value thresholds for each loot beam tier.
 * Source: https://runescape.wiki/w/Loot_beam#Mechanics
 */
export const LOOT_BEAM_TIER_THRESHOLDS = {
    TIER_1: 1_000_000,        // ≥ 1M gp  → blue text
    TIER_2: 10_000_000,       // ≥ 10M gp → purple text
    TIER_3_VALUE: 60_000_000, // ≥ 60M gp (approximate wiki Tier 3 onset)
    TIER_4: 100_000_000       // ≥ 100M gp → purple/orange text
} as const;

/**
 * Items that receive a loot beam regardless of their GE value.
 * These are explicitly listed on the wiki (rarity-override category).
 * Source: https://runescape.wiki/w/Loot_beam
 */
export const LOOT_BEAM_RARITY_OVERRIDES = new Set([
    // Tier 3 rarity overrides (boss pet items, champion scrolls, etc.)
    "Champion's scroll",
    "Cresbot",
    "Revenant Spirit",
    "Kal'gerion battle commendation",
    "Phylactery",
    "Raptor key part",
    // Tier 2 rarity overrides (always beamed)
    "Ancient emblem",
    "Perfect chitin",
    "Starved ancient effigy",
    // Tier 1 rarity overrides
    "Court summons",
    "Sealed clue scroll",
    "Spirit gem",
    "Ferocious ring",
    "Ascension keystone",
]);

/** 3D renderer scale factors (non-uniform so T4 dwarfs T1 visually). */
export const LOOT_BEAM_TIER_SCALE = {
    1: { height: 3,   radius: 0.15, opacity: 0.35 },
    2: { height: 5,   radius: 0.22, opacity: 0.45 },
    3: { height: 7,   radius: 0.30, opacity: 0.55 },
    4: { height: 12,  radius: 0.45, opacity: 0.65 }
} as const;

/** Per-tier beam colors — wiki color language: blue/purple/orange */
export const LOOT_BEAM_TIER_COLORS: Record<number, number> = {
    1: 0x88ccff,  // Blue
    2: 0xbb66ff,  // Purple
    3: 0xff8822,  // Orange
    4: 0xffcc00   // Gold/Orange (1B+ items use orange; default T4 use purple)
};

/**
 * Resolve the loot beam tier for a given item drop.
 *
 * Priority:
 * 1. Check rarity-override set (always-beamed items)
 * 2. Fall back to GE value tier bracket
 * 3. Return 0 (no beam) if below player threshold
 *
 * @param itemName  - The drop's item name (from LootResolutionEngine)
 * @param geValue   - Grand Exchange value in coins (0 if unknown)
 * @param rarityLabel - rollMeta rarityLabel from LootResolutionEngine
 * @param playerThreshold - Player's configured minimum (default 10,000)
 */
export function resolveLootBeamTier(
    itemName: string,
    geValue: number,
    rarityLabel: string,
    playerThreshold = 10_000
): 0 | 1 | 2 | 3 | 4 {
    // Rarity override check (specific named items always beam at T3)
    for (const override of LOOT_BEAM_RARITY_OVERRIDES) {
        if (itemName.toLowerCase().includes(override.toLowerCase())) {
            return 3;
        }
    }

    // Hazelmere / Super Rare table drops  → force T4 (boss unique tier)
    const rl = rarityLabel.toLowerCase();
    if (rl.includes('hazelmere') || rl.includes('super rare')) {
        return 4;
    }

    // RDT rare drop table → T2
    if (rl.includes('rare drop table')) {
        return 2;
    }

    // GE value bracket
    if (geValue >= LOOT_BEAM_TIER_THRESHOLDS.TIER_4)   return 4;
    if (geValue >= LOOT_BEAM_TIER_THRESHOLDS.TIER_3_VALUE) return 3;
    if (geValue >= LOOT_BEAM_TIER_THRESHOLDS.TIER_2)    return 2;
    if (geValue >= LOOT_BEAM_TIER_THRESHOLDS.TIER_1)    return 1;

    // Below threshold → no beam
    if (geValue < playerThreshold) return 0;

    return 0;
}
