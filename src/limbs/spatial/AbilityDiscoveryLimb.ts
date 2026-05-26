/**
 * AbilityDiscoveryLimb.ts
 *
 * Phase 2: Cache-introspective ability discovery.
 * Replaces hardcoded rotations with environment-driven capability scanning.
 *
 * Discovery sources (priority order):
 *   1. Action Bar interface (1841) — what the player has actively bound
 *   2. AbilityBook registry — full combat parameter database
 *   3. Equipment context — infer combat style from equipped weapon
 *
 * The avatar discovers what it can do rather than being told.
 */

import { createLogger } from '../../utils/logger.js';
import { AbilityBook, AbilityDefinition, CombatStyle, AbilityType } from '../../engines/gameplay/AbilityBook.js';
import { HUDForensicsLimb, InterfaceComponent } from './HUDForensicsLimb.js';

const logger = createLogger('AbilityDiscoveryLimb');

// ═══════════════════════════════════════════════════════
// Discovery Types
// ═══════════════════════════════════════════════════════

export interface DiscoveredAbility {
    /** Ability key from AbilityBook (e.g. 'slice', 'assault') */
    id: string;
    /** Display name */
    name: string;
    /** basic | enhanced | ultimate | special */
    category: AbilityType;
    /** 0–10000 scale */
    adrenalineCost: number;
    /** 0–10000 scale */
    adrenalineGain: number;
    /** Ticks (600ms each) */
    cooldownTicks: number;
    /** [min%, max%] of weapon damage */
    damageRange: [number, number];
    /** melee | ranged | magic | necromancy | defense */
    style: CombatStyle;
    /** Action bar slot index, if bound */
    slotIndex?: number;
    /** Cache sprite reference */
    spriteId?: number;
    /** CS2 script driving this slot */
    scriptId?: number;
    /** Source of discovery */
    source: 'action_bar' | 'ability_book' | 'equipment_inference';
}

export interface RotationStep {
    ability: DiscoveredAbility;
    reason: string;
}

// ═══════════════════════════════════════════════════════
// AbilityDiscoveryLimb
// ═══════════════════════════════════════════════════════

export class AbilityDiscoveryLimb {
    private static instance: AbilityDiscoveryLimb | undefined;
    private abilityBook: AbilityBook;
    private discoveredCache = new Map<number, DiscoveredAbility[]>();

    private constructor() {
        this.abilityBook = AbilityBook.getInstance();
    }

    static getInstance(): AbilityDiscoveryLimb {
        if (!AbilityDiscoveryLimb.instance) {
            AbilityDiscoveryLimb.instance = new AbilityDiscoveryLimb();
        }
        return AbilityDiscoveryLimb.instance;
    }

    static resetInstance(): void {
        AbilityDiscoveryLimb.instance = undefined;
    }

    // ─────────────────────────────────────────────────
    // Source 1: Action Bar Interface Scanning
    // ─────────────────────────────────────────────────

    /**
     * Scan an action bar interface and discover bound abilities.
     * Extracts slot scripts, cross-references AbilityBook.
     */
    async discoverFromActionBar(interfaceId: number = 1430): Promise<DiscoveredAbility[]> {
        // Check cache first
        if (this.discoveredCache.has(interfaceId)) {
            return this.discoveredCache.get(interfaceId)!;
        }

        let hud: HUDForensicsLimb;
        try {
            hud = new HUDForensicsLimb();
        } catch {
            logger.warn('HUDForensicsLimb unavailable — falling back to AbilityBook discovery');
            return this.discoverFromAbilityBook();
        }

        const forensics = await hud.getInterface(interfaceId);
        if (!forensics.ok) {
            logger.warn({ interfaceId, error: (forensics as any).error?.message }, 'Action bar interface unavailable');
            return this.discoverFromAbilityBook();
        }

        const abilities: DiscoveredAbility[] = [];
        const bindings = this.discoverAbilityBindings(forensics.value);

        for (const comp of forensics.value.components) {
            const discovered = this.matchComponentToAbility(comp);
            if (discovered) {
                const slotIndex = bindings.get(comp.componentId);
                if (slotIndex !== undefined) {
                    discovered.slotIndex = slotIndex;
                }
                abilities.push(discovered);
            }
        }

        logger.info({ interfaceId, count: abilities.length }, 'Abilities discovered from action bar');
        this.discoveredCache.set(interfaceId, abilities);
        return abilities;
    }

    /**
     * Map action bar slot components to their logical slot indices.
     * Uses script 10896 pattern: [10896, SELF, enumOrComp, varbitId]
     */
    private discoverAbilityBindings(forensics: any): Map<number, number> {
        const bindings = new Map<number, number>();
        
        for (const comp of forensics.components) {
            if (comp.scripts?.load && comp.scripts.load[0] === 10896) {
                // Script 10896 pattern: [10896, SELF, enumOrComp, varbitId]
                // We use the inferred geometry to determine the 0-13 slot index
                const slotIndex = this.inferSlotIndex(comp);
                bindings.set(comp.componentId, slotIndex);
            }
        }
        
        return bindings;
    }

    /**
     * Heuristic: Infer slot position from layout geometry.
     * RS3 action bar: 14 slots, typically arranged in rows.
     * Slot 0-6 = first row, 7-13 = second row.
     */
    private inferSlotIndex(comp: any): number {
        const row = Math.floor(comp.baseposy / 50); // heuristic row height
        const col = Math.floor(comp.baseposx / 50);   // heuristic col width
        return row * 7 + col;
    }

    // ─────────────────────────────────────────────────
    // Source 2: Full AbilityBook Scan
    // ─────────────────────────────────────────────────

    /**
     * Discover all abilities from the AbilityBook for a given style.
     * This is the fallback when cache/HUD introspection isn't available.
     */
    discoverFromAbilityBook(style?: CombatStyle): DiscoveredAbility[] {
        const allAbilities = style
            ? this.abilityBook.getByStyle(style)
            : this.abilityBook.getAll();

        return allAbilities
            .filter(a => a.damageRange[0] > 0 || a.damageRange[1] > 0 || a.flags.includes('buff'))
            .map(a => this.abilityDefToDiscovered(a, 'ability_book'));
    }

    // ─────────────────────────────────────────────────
    // Source 3: Equipment-Inferred Style
    // ─────────────────────────────────────────────────

    /**
     * Infer combat style from equipped weapon type.
     * Used when no action bar is bound.
     */
    inferStyleFromWeapon(weaponName: string): CombatStyle {
        const lower = weaponName.toLowerCase();

        if (/sword|scimitar|mace|spear|halberd|dagger|claw|whip|godsword|lance/.test(lower)) return 'melee';
        if (/bow|crossbow|blowpipe|javelin|dart|thrown|shieldbow|shortbow|longbow/.test(lower)) return 'ranged';
        if (/staff|wand|book|orb|battlestaff|seismic|virtus/.test(lower)) return 'magic';
        if (/skull|lantern|death guard|omni guard/.test(lower)) return 'necromancy';

        return 'melee'; // Default assumption
    }

    // ─────────────────────────────────────────────────
    // Rotation Builder
    // ─────────────────────────────────────────────────

    /**
     * Build an optimal rotation from discovered abilities and current adrenaline.
     *
     * Strategy:
     *   - Basics to build adrenaline when below threshold cost
     *   - Thresholds when adrenaline ≥ 50% (1500 on internal scale)
     *   - Ultimates when adrenaline = 100% (10000)
     *   - Prioritize by damage efficiency (avg damage / effective cooldown)
     */
    buildOptimalRotation(
        availableAbilities: DiscoveredAbility[],
        currentAdrenaline: number,
        targetStyle?: CombatStyle
    ): RotationStep[] {
        // Filter by style if specified
        const pool = targetStyle
            ? availableAbilities.filter(a => a.style === targetStyle || a.style === 'defense')
            : availableAbilities;

        if (pool.length === 0) return [];

        // Separate by tier
        const basics = pool.filter(a => a.category === 'basic');
        const thresholds = pool.filter(a => a.category === 'enhanced' || a.category === 'special');
        const ultimates = pool.filter(a => a.category === 'ultimate');

        // Sort each tier by damage efficiency
        const byEfficiency = (a: DiscoveredAbility, b: DiscoveredAbility) => {
            const avgA = (a.damageRange[0] + a.damageRange[1]) / 2;
            const avgB = (b.damageRange[0] + b.damageRange[1]) / 2;
            const effA = avgA / Math.max(1, a.cooldownTicks);
            const effB = avgB / Math.max(1, b.cooldownTicks);
            return effB - effA;
        };

        basics.sort(byEfficiency);
        thresholds.sort(byEfficiency);
        ultimates.sort(byEfficiency);

        const rotation: RotationStep[] = [];
        let simAdrenaline = currentAdrenaline;

        // Phase 1: Build to threshold if needed
        if (simAdrenaline < 1500 && thresholds.length > 0) {
            const ticksNeeded = Math.ceil((1500 - simAdrenaline) / 900); // ~900 gain per basic
            for (let i = 0; i < ticksNeeded && basics.length > 0; i++) {
                const basic = basics[i % basics.length];
                rotation.push({
                    ability: basic,
                    reason: `Build adrenaline (${simAdrenaline} → ${simAdrenaline + basic.adrenalineGain})`
                });
                simAdrenaline += basic.adrenalineGain;
            }
        }

        // Phase 2: Fire best threshold
        if (simAdrenaline >= 1500 && thresholds.length > 0) {
            const best = thresholds[0];
            rotation.push({
                ability: best,
                reason: `Threshold at ${simAdrenaline} adrenaline — ${best.name} (${(best.damageRange[0] + best.damageRange[1]) / 2}% avg)`
            });
            simAdrenaline -= best.adrenalineCost;
        }

        // Phase 3: Build to ultimate if available
        if (ultimates.length > 0 && simAdrenaline < 10000) {
            const remaining = Math.ceil((10000 - simAdrenaline) / 900);
            for (let i = 0; i < remaining && basics.length > 0; i++) {
                const basic = basics[i % basics.length];
                rotation.push({
                    ability: basic,
                    reason: `Build toward ultimate (${simAdrenaline} → ${simAdrenaline + basic.adrenalineGain})`
                });
                simAdrenaline += basic.adrenalineGain;
            }
        }

        // Phase 4: Fire ultimate
        if (simAdrenaline >= 10000 && ultimates.length > 0) {
            const best = ultimates[0];
            rotation.push({
                ability: best,
                reason: `Ultimate at ${simAdrenaline} adrenaline — ${best.name}`
            });
        }

        return rotation;
    }

    // ─────────────────────────────────────────────────
    // Diagnostics
    // ─────────────────────────────────────────────────

    healthCheck(): { online: boolean; details: string } {
        const bookHealth = this.abilityBook.healthCheck();
        return {
            online: bookHealth.online,
            details: `AbilityDiscoveryLimb: ${bookHealth.loaded} abilities in book, ${this.discoveredCache.size} interfaces scanned`
        };
    }

    // ─────────────────────────────────────────────────
    // Internal Helpers
    // ─────────────────────────────────────────────────

    /**
     * Match an action bar component to an AbilityBook entry.
     * Uses sprite ID, script ID, and right-click options as heuristics.
     */
    private matchComponentToAbility(comp: InterfaceComponent): DiscoveredAbility | null {
        // Strategy 1: Match by right-click option text against ability names
        if (comp.rightclickopts && comp.rightclickopts.length > 0) {
            for (const opt of comp.rightclickopts) {
                if (!opt || opt === 'null') continue;
                const ability = this.abilityBook.getByName(opt);
                if (ability) {
                    const discovered = this.abilityDefToDiscovered(ability, 'action_bar');
                    discovered.spriteId = comp.spriteId;
                    discovered.scriptId = comp.scripts?.load?.[0] as number | undefined;
                    return discovered;
                }
            }
        }

        // Strategy 2: Match by script load args (10896 pattern or Varp 5899)
        // We look for script arguments that match known action bar varps (e.g. 5899)
        if (comp.scripts) {
            for (const [trigger, args] of Object.entries(comp.scripts)) {
                if (!args || args.length === 0) continue;
                
                // Generic Option Loader (10896) or direct Varp reference (5899)
                if (args[0] === 10896 || args.includes(5899)) {
                    // Try to infer which slot this is based on geometry
                    const slotIndex = this.inferSlotIndex(comp);
                    
                    // Cross-reference with AbilityBook based on current varp value
                    // Note: This requires active varp state, which is handled in PlayerAgent
                    logger.debug({ componentId: comp.componentId, trigger, args, slotIndex }, 'Action bar slot identified via Varp 5899');
                    
                    // We return a placeholder discovery if we can't match a name yet
                    // This allows the agent to know a slot exists even if the ability isn't identified
                }
            }
        }

        // Strategy 3: Match by high-confidence varbits
        if (comp.scripts?.load) {
            const varbitId = comp.scripts.load[3];
            if (typeof varbitId === 'number' && [49664, 29696, 2816].includes(varbitId)) {
                logger.debug({ componentId: comp.componentId, varbitId }, 'Action bar slot matched to high-confidence varbit');
            }
        }

        return null;
    }

    /**
     * Reactive system to sync discovered abilities with current Varp state.
     * Maps Varp 5899 values to AbilityBook entries.
     */
    public syncWithVarpState(varpState: Map<number, number>): DiscoveredAbility[] {
        const abilities: DiscoveredAbility[] = [];
        
        // Varp 5899 is the primary action bar container (March 2026)
        const mainBarValue = varpState.get(5899);
        if (mainBarValue !== undefined) {
            // Logic to decode packed abilities from Varp 5899 goes here
            // For now, we use it to validate known slots
            logger.debug({ varpValue: mainBarValue }, 'Syncing action bar with Varp 5899 state');
        }

        return abilities;
    }

    private abilityDefToDiscovered(a: AbilityDefinition, source: DiscoveredAbility['source']): DiscoveredAbility {
        return {
            id: a.id,
            name: a.name,
            category: a.type,
            adrenalineCost: a.adrenalineCost,
            adrenalineGain: a.adrenalineGain,
            cooldownTicks: a.cooldownTicks,
            damageRange: a.damageRange,
            style: a.style,
            source
        };
    }
}
