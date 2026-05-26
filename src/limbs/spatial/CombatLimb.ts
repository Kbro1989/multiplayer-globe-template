import { createLogger } from '../../utils/logger.js';
import { GameState, NPC } from '../../core/models.js';

const logger = createLogger('CombatLimb');

export interface AbilityDefinition {
    id: string;
    name: string;
    style: 'melee' | 'ranged' | 'magic' | 'necromancy';
    type: 'basic' | 'threshold' | 'ultimate' | 'conjure';
    range: number;
    adrenalineGained?: number;
    adrenalineCost?: number;
    necrosisGained?: number;
    soulsGained?: number;
    cooldownTicks?: number;
    damageRange?: [number, number]; // [min, max]
}

export class CombatLimb {
    private static instance: CombatLimb;
    private abilityRegistry: Map<string, AbilityDefinition> = new Map();

    private constructor() {
        this.registerDefaultAbilities();
    }

    public static getInstance(): CombatLimb {
        if (!CombatLimb.instance) {
            CombatLimb.instance = new CombatLimb();
        }
        return CombatLimb.instance;
    }

    private registerDefaultAbilities() {
        // Based on necromancy_logic.json
        this.abilityRegistry.set('1', {
            id: '1',
            name: 'Basic Attack',
            style: 'necromancy',
            type: 'basic',
            range: 7, 
            adrenalineGained: 900, // 9.00%
            damageRange: [200, 450]
        });

        this.abilityRegistry.set('13', {
            id: '13',
            name: 'Touch of Death',
            style: 'necromancy',
            type: 'basic',
            range: 1, // Research says "Touch"
            adrenalineGained: 900,
            necrosisGained: 4,
            damageRange: [400, 800]
        });

        this.abilityRegistry.set('8', {
            id: '8',
            name: 'Finger of Death',
            style: 'necromancy',
            type: 'threshold',
            range: 7,
            adrenalineCost: 6000, // 60.00%
            damageRange: [1200, 2500]
        });
    }

    /**
     * canCast - Validates spatial and resource constraints.
     */
    public canCast(castor: NPC, target: NPC, abilityId: string, currentTick: number): { success: boolean; reason?: string; inRange?: boolean } {
        const ability = this.abilityRegistry.get(abilityId);
        if (!ability) return { success: false, reason: 'Ability not recognized' };

        // 1. Cooldown Check
        const cd = castor.cooldowns?.[abilityId] || 0;
        if (currentTick < cd) {
            return { success: false, reason: `Cooldown: ${cd - currentTick} ticks remaining` };
        }

        // 2. Spatial Check
        const dist = Math.max(Math.abs(castor.x - target.x), Math.abs(castor.y - target.y));
        const inRange = dist <= ability.range;

        if (!inRange) {
            return { success: false, reason: 'Out of range', inRange: false };
        }

        // 3. Resource Check
        if (ability.adrenalineCost && (castor.adrenaline || 0) < ability.adrenalineCost) {
            return { success: false, reason: 'Insufficient Adrenaline' };
        }

        return { success: true, inRange: true };
    }

    /**
     * execute - Performs the world-state mutation for the ability.
     */
    public execute(castor: NPC, target: NPC, abilityId: string, currentTick: number): void {
        const ability = this.abilityRegistry.get(abilityId);
        if (!ability) return;

        logger.info(`EXECUTING: ${ability.name} by ${castor.name} on ${target.name} (Tick: ${currentTick})`);

        // 1. Mutate Castor State
        if (ability.adrenalineGained) {
            if ((castor as any).addAdrenaline) {
                (castor as any).addAdrenaline(ability.adrenalineGained);
            } else {
                castor.adrenaline = Math.min(10000, (castor.adrenaline || 0) + ability.adrenalineGained);
            }
        }
        if (ability.adrenalineCost) {
            castor.adrenaline = Math.max(0, (castor.adrenaline || 0) - ability.adrenalineCost);
        }
        if (ability.necrosisGained) {
            castor.necrosisStacks = (castor.necrosisStacks || 0) + ability.necrosisGained;
        }

        // 2. Set Cooldowns (Modernized: Auto-attack rhythm is usually 4 ticks)
        const ticks = ability.cooldownTicks || 4; 
        castor.cooldowns[abilityId] = currentTick + ticks;
        castor.lastCombatTick = currentTick;

        // 3. Apply Damage to Target
        if (ability.damageRange) {
            const [min, max] = ability.damageRange;
            const damage = Math.floor(Math.random() * (max - min + 1)) + min;
            
            const wasDead = (target as any).isDead;
            if ((target as any).applyDamage) {
                (target as any).applyDamage(damage);
                logger.info(`DAMAGE: ${damage} applied to ${target.name}. New HP: ${(target as any).currentHp}`);
            }

            // 4. Single-shot Death Check
            if ((target as any).isDead && !wasDead) {
                logger.info(`💀 SOVEREIGN_DEATH: ${target.name} has fallen.`);
                // Emit event via metadata or a central emitter if we had one.
                // For now, we flag it in target metadata.
                (target as any).metadata = {
                    ...(target.metadata || {}),
                    deathEvent: true,
                    deathTick: currentTick
                };
            }
        }

        // 5. Apply "Hit Flash" metadata for the Radar
        (target as any).metadata = {
            ...(target.metadata || {}),
            lastHitTick: Date.now(),
            hitFlash: true,
            lastHitDamage: ability.damageRange ? true : false // for UI hit-splats later
        };
    }
}
