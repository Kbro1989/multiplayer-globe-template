import { CombatRotationEngine } from './CombatRotationEngine.js';
import { AbilityDefinition, CombatStyle } from './AbilityBook.js';
import { WikiMonsterMeta } from '../../utils/WikiEquipmentEnricher.js';

export interface AggressionProjection {
    hitChance: number;
    expectedHit: number;
    dps: number;
    timeToKill: number;
    recommendedStyle: CombatStyle;
    styleReasoning: string;
}

/**
 * AggressionSimulator
 * 
 * Projects DPS and TTK using the March 2026 logarithmic damage formula
 * and affinity-based hit chance calculations.
 */
export class AggressionSimulator {
    /**
     * Projects DPS and TTK against a specific monster using March 2026 rules.
     */
    public static projectEncounter(
        attackerLevel: number,
        weaponTier: number,
        attackStyle: CombatStyle,
        monster: WikiMonsterMeta,
        ability: AbilityDefinition,
        cycleTicks: number = 3
    ): AggressionProjection {
        // 1. Calculate base hit chance based on monster affinities (March 2026 rules)
        // Affinity ranges from ~40 to 90. 55 is neutral.
        let affinity = 55;
        if (attackStyle === 'melee') affinity = monster.affinityMelee || 55;
        if (attackStyle === 'ranged') affinity = monster.affinityRanged || 55;
        if (attackStyle === 'magic') affinity = monster.affinityMagic || 55;
        if (attackStyle === 'necromancy') affinity = monster.affinityNecromancy || 55;

        // Base hit chance heuristic: Affinity * (Attacker Level / Monster Defence)
        const def = Math.max(1, monster.defence || monster.combatLevel * 0.8);
        const rawHitChance = (affinity / 100) * (attackerLevel / def);
        const hitChance = Math.min(1.0, Math.max(0.1, rawHitChance));

        // 2. Damage calculation using logarithmic formula (March 2026)
        const baseDamage = CombatRotationEngine.logarithmicBaseDamage(attackerLevel, weaponTier);
        
        // Ability damage bounds
        const [minPct, maxPct] = ability.damageRange;
        const avgPct = (minPct + maxPct) / 2;
        
        // Expected hit per cast (Hit Chance * Average Damage)
        const expectedHit = hitChance * (baseDamage * (avgPct / 100));

        // 3. DPS Projection
        // 1 tick = 0.6s
        const cycleTimeSeconds = cycleTicks * 0.6;
        const dps = expectedHit / cycleTimeSeconds;

        // 4. TTK Projection
        const timeToKill = monster.lifePoints > 0 && dps > 0 
            ? monster.lifePoints / dps 
            : 0;

        // 5. Tactical Reasoning
        const styles: Record<string, number> = {
            melee: monster.affinityMelee || 55,
            ranged: monster.affinityRanged || 55,
            magic: monster.affinityMagic || 55,
            necromancy: monster.affinityNecromancy || 55
        };
        
        const bestStyleStr = Object.keys(styles).reduce((a, b) => styles[a] > styles[b] ? a : b);
        const bestStyle = bestStyleStr as CombatStyle;

        return {
            hitChance,
            expectedHit,
            dps,
            timeToKill,
            recommendedStyle: bestStyle,
            styleReasoning: `Monster has highest affinity (${styles[bestStyle]}) to ${bestStyle}, versus ${affinity} for current ${attackStyle} style.`
        };
    }
}
