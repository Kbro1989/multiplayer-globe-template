/**
 * CombatRotationEngine.ts
 * 
 * March 2026 Modernized combat rotation evaluator.
 * Given a combatant's state + target, returns the optimal next ability.
 * 
 * Constraint pipeline per ability:
 *  1. Is target in range? (Chebyshev distance)
 *  2. Is ability off cooldown? (per-ability CD + GCD)
 *  3. Does attacker have enough adrenaline?
 *  4. Is attacker locked? (channeling)
 *  5. Is target stun-immune? (prevents wasted stun GCDs)
 *  6. Stack/buff gating (Bloodlust, Anima, Searing Winds, Shadow Imbued)
 * 
 * Damage model: Logarithmic scaling (March 2026)
 *   baseDamage = 145 * weaponTier * ln(1 + 0.6 * level / 145) / ln(1.6)
 * 
 * Archetype priority chains:
 *  - aggressive: Ultimate → Enhanced → Basic (promotes buff-window consumers)
 *  - methodical: Debuff → Enhanced → Basic
 *  - cowardly:   Eat Food → Defensive ultimate → Defensive enhanced → Basic → (flee)
 *  - predator:   Stun → Channeled enhanced → Basic
 */

import { performance } from 'perf_hooks';
import { AbilityBook, AbilityDefinition, CombatStyle } from './AbilityBook.js';
import { CanonicalClock } from '../../utils/CanonicalClock.js';
import { Coord, CombatantState } from '../../core/models.js';
import { GhostSplatField } from '../../substrates/GhostSplatEngine.js';
import { PADDED_SIZE } from '../../limbs/spatial/SpatialSovereigntyLimb.js';
import { createLogger } from '../../utils/logger.js';
import { PVMERotationLimb } from '../../limbs/gameplay/PVMERotationLimb.js';

const logger = createLogger('CombatRotationEngine');

// ═══════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════

export type TacticalArchetype = 'aggressive' | 'methodical' | 'cowardly' | 'predator';

export interface CombatEvaluationContext {
    /** The attacker's combatant state */
    adrenaline: number;           // 0–10000
    cooldowns: Record<string, number>;
    coord: Coord;
    currentTick: number;
    /** GCD end tick — no ability can fire before this */
    gcdEndTick: number;
    /** Channel end tick — attacker is locked if currentTick < channelEndTick */
    channelEndTick: number;
    /** Currently equipped combat style */
    combatStyle: CombatStyle;
    /** Archetype driving priority chain */
    archetype: TacticalArchetype;
    /** Attacker's full state for stack/buff checks */
    state: CombatantState;
    /** Dynamically discovered abilities available to the attacker */
    availableAbilities: AbilityDefinition[];
    /** Secondary entities in range (minions, spawns) */
    availableTargets?: TargetContext[];
}

export interface PhaseTrigger {
    boss: string;
    phase: string;
    triggers: {
        chat?: RegExp[];
        hpThreshold?: number;
        animationId?: number;
        gfxId?: number;
    };
}

export interface TargetContext {
    entityId: string;
    name: string;
    coord: Coord;
    currentHp: number;
    /** Stun immunity end tick — stun abilities wasted if currentTick < this */
    stunImmunityEndTick: number;
    /** Secondary entities in range (minions, spawns) */
    availableTargets?: TargetContext[];
}

export type CombatIntent = 
    | {
        action: 'execute_ability';
        abilityId: string;
        abilityName: string;
        targetId: string;
        tickStarted: number;
        contextHash: string;
        coord?: Coord;
      }
    | {
        action: 'switch_target';
        targetId: string;
        tickStarted: number;
        contextHash: string;
      };

export interface CombatCausalEvidence {
    signal: string;           // e.g., 'TARGET_RESOLVED_HEAT', 'PVME_PREDICATE_FAILED'
    timestamp: number;        // tick
    elapsedMs?: number;       // ms from tick start
    detail: Record<string, any>;  // contextual data
    confidence: number;       // 0-1, how certain this signal is
}

export interface CombatDecisionTrace {
    intent: CombatIntent;
    evidence: CombatCausalEvidence[];
    finalConfidence: number;  // product of all gate confidences
    fallbackUsed: boolean;    // true if Build Phase or archetype fallback triggered
}

// ═══════════════════════════════════════════════════════
// Chebyshev Distance (RS3 attack range uses this)
// ═══════════════════════════════════════════════════════

function chebyshevDistance(a: Coord, b: Coord): number {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

// ═══════════════════════════════════════════════════════
// CombatRotationEngine
// ═══════════════════════════════════════════════════════

export class CombatRotationEngine {
    private static instance: CombatRotationEngine;
    private book: AbilityBook;

    private constructor() {
        this.book = AbilityBook.getInstance();
    }

    public static getInstance(): CombatRotationEngine {
        if (!CombatRotationEngine.instance) {
            CombatRotationEngine.instance = new CombatRotationEngine();
        }
        return CombatRotationEngine.instance;
    }

    /**
     * Evaluate the optimal next ability given the attacker's state and a target.
     * Returns null if no valid ability can fire this tick (GCD, channel lock, no target, etc.)
     */
    private pushSignal(
        evidence: CombatCausalEvidence[],
        tick: number,
        tickStart: number,
        signal: string,
        detail: any,
        confidence = 1.0
    ) {
        evidence.push({
            signal,
            timestamp: tick,
            elapsedMs: parseFloat((performance.now() - tickStart).toFixed(3)),
            detail,
            confidence
        });
    }

    public evaluateRotation(
        ctx: CombatEvaluationContext,
        target: TargetContext
    ): CombatDecisionTrace | null {
        const tickStart = performance.now();
        const evidence: CombatCausalEvidence[] = [];
        const finalConfidence = 1.0;
        let fallbackUsed = false;

        const push = (sig: string, det: any, conf = 1.0) => 
            this.pushSignal(evidence, ctx.currentTick, tickStart, sig, det, conf);

        // Gate 1: Channel lock
        if (ctx.currentTick < ctx.channelEndTick) {
            push('GATE_CHANNEL_LOCKED', { remaining: ctx.channelEndTick - ctx.currentTick });
            return null;
        }

        // Gate 2: Global cooldown
        if (ctx.currentTick < ctx.gcdEndTick) {
            push('GATE_GCD_LOCKED', { remaining: ctx.gcdEndTick - ctx.currentTick });
            return null;
        }

        // Gate 3: Target alive
        if (target.currentHp <= 0) {
            push('GATE_TARGET_DEAD', { targetId: target.entityId });
            return null;
        }

        // Gate 4: Survival (Eat food if HP < 40%)
        if (ctx.state.hp && ctx.state.maxHp && (ctx.state.hp / ctx.state.maxHp) < 0.4) {
            const food = this.book.getByName('Eat Food'); // Assuming 'Eat Food' is in the book
            if (food && this.passesConstraints(food, ctx, target, evidence, tickStart)) {
                const intent: CombatIntent = {
                    action: 'execute_ability',
                    abilityId: food.id,
                    abilityName: food.name,
                    targetId: 'self',
                    tickStarted: ctx.currentTick,
                    contextHash: 'survival_heal',
                };
                push('INTENT_COMMITTED', { action: intent.action, abilityId: intent.abilityId, targetId: intent.targetId });
                return { intent, evidence, finalConfidence, fallbackUsed };
            }
        }

        // Gate 5: PVME High-Fidelity Sequence
        const pvme = PVMERotationLimb.getInstance();
        const pvmeAbilityObj = pvme.peekNextAbility(target.entityId, target.name);
        
        if (pvmeAbilityObj) {
            // Target Switching Forensic: Check if rotation calls for a different target (e.g. "Tag Fumus")
            if (pvmeAbilityObj.name.toLowerCase().includes('tag ')) {
                // Robust extraction: Match "Tag Fumus" or "Tag with [Ability] Fumus"
                // Extract last word as probable target name
                const words = pvmeAbilityObj.name.split(' ');
                const targetName = words[words.length - 1].replace(/[}{]/g, '').trim(); 
                const secondaryTarget = ctx.availableTargets?.find(t => t.name.toLowerCase().includes(targetName.toLowerCase()));
                
                if (secondaryTarget) {
                    logger.info({ targetName, entityId: secondaryTarget.entityId }, 'PVME: Target switch detected in rotation.');
                    pvme.getNextAbility(target.entityId, target.name); // Advance sequence
                    push('GATE_PVME_TARGET_SWITCH', { targetName, entityId: secondaryTarget.entityId });
                    const intent: CombatIntent = {
                        action: 'switch_target',
                        targetId: secondaryTarget.entityId,
                        tickStarted: ctx.currentTick,
                        contextHash: 'pvme_target_switch'
                    };
                    return { intent, evidence, finalConfidence, fallbackUsed };
                } else {
                    logger.warn({ targetName }, 'PVME: Target switch requested but minion not found in context. Skipping.');
                    push('GATE_PVME_TARGET_SWITCH_FAILED', { targetName });
                    pvme.getNextAbility(target.entityId, target.name);
                    // Continue to next check
                }
            }

            const pvmeAbility = this.book.getByName(pvmeAbilityObj.name);
            const predicatePassed = !pvmeAbilityObj.predicate || this.evaluatePredicate(pvmeAbilityObj.predicate, ctx);

            if (pvmeAbilityObj.predicate) {
                push(predicatePassed ? 'PVME_PREDICATE_PASSED' : 'PVME_PREDICATE_FAILED', { predicate: pvmeAbilityObj.predicate, evaluatedResult: predicatePassed });
            }

            if (pvmeAbility) {
                push('PVME_SEQUENCE_LOCKED', { abilityName: pvmeAbilityObj.name, category: pvmeAbility.category });

                // Necromancy Conjure Gate: Avoid redundant summons
                if (pvmeAbility.type === 'conjure' || pvmeAbility.name.toLowerCase().includes('conjure')) {
                    const name = pvmeAbility.name.toLowerCase();
                    let alreadyActive = false;
                    const ca = ctx.state.conjureActive;
                    if (ca) {
                        if (name.includes('skeleton')) alreadyActive = ca.skeleton;
                        else if (name.includes('zombie')) alreadyActive = ca.zombie;
                        else if (name.includes('ghost')) alreadyActive = ca.ghost;
                        else if (name.includes('phantom')) alreadyActive = ca.phantom;
                    }
                    
                    if (alreadyActive) {
                        push('CONJURE_ALREADY_ACTIVE', { abilityName: pvmeAbility.name });
                        // Skip this step and proceed to next in PVME sequence
                        pvme.getNextAbility(target.entityId, target.name);
                        return null;
                    }
                }

                if (pvmeAbility.category !== 'combat') {
                    // Soft Rejection: Advisory warning but allows execution if it's the intended rotation
                    push('CATEGORY_MISMATCH_ADVISORY', { 
                        abilityName: pvmeAbility.name, 
                        category: pvmeAbility.category, 
                        expected: 'combat',
                        status: 'WARNING_PASSTHROUGH' 
                    });
                    // Skip and continue for now as a safeguard, but logs clearly
                    pvme.getNextAbility(target.entityId, target.name);
                }

                const canExecute = predicatePassed && this.passesConstraints(pvmeAbility, ctx, target, evidence, tickStart);
                
                if (canExecute) {
                    // Success: Pop the ability and execute
                    pvme.getNextAbility(target.entityId, target.name); 
                    const intent: CombatIntent = {
                        action: 'execute_ability',
                        abilityId: pvmeAbility.id,
                        abilityName: pvmeAbility.name,
                        targetId: target.entityId,
                        tickStarted: ctx.currentTick,
                        contextHash: 'pvme_sequence',
                        coord: target.coord,
                    };

                    push('INTENT_COMMITTED', { action: intent.action, abilityId: intent.abilityId, targetId: intent.targetId });

                    return { intent, evidence, finalConfidence, fallbackUsed };
                } else if (!predicatePassed) {
                    // Skip if predicate fails (e.g., conditional branches in guide)
                    logger.debug({ ability: pvmeAbility.name, predicate: pvmeAbilityObj.predicate }, 'Skipping PVME ability: Predicate failed');
                    pvme.getNextAbility(target.entityId, target.name);
                } else {
                    // Ability on cooldown or constraints failed - WAIT to preserve sync
                    const isThresholdOrUlt = pvmeAbility.type === 'enhanced' || pvmeAbility.type === 'ultimate';
                    
                    if (isThresholdOrUlt) {
                        // Build Phase Fallback: If insufficient adrenaline, bridge with a filler basic
                        const currentAdrenaline = ctx.state.adrenaline || 0;
                        if (currentAdrenaline < (pvmeAbility.adrenalineCost || 0)) {
                            // Style-Lock: Ensure filler matches current combat style to preserve buffs
                            const filler = ctx.availableAbilities
                                .filter(a => a.type === 'basic' && 
                                            a.style === ctx.combatStyle && 
                                            this.passesConstraints(a, ctx, target, evidence, tickStart))
                                .sort((a, b) => (b.adrenalineGain || 0) - (a.adrenalineGain || 0))[0];
                            
                            if (filler) {
                                logger.info({ waitingFor: pvmeAbility.name, fillingWith: filler.name }, 'PVME: Building adrenaline. Executing filler basic.');
                                fallbackUsed = true;
                                push('BUILD_PHASE_TRIGGERED', { 
                                    stalledAbility: pvmeAbility.name, 
                                    fillerAbility: filler.name, 
                                    adrenDelta: (pvmeAbility.adrenalineCost || 0) - currentAdrenaline,
                                    reason: 'highest_gain_in_style'
                                });

                                push('BUILD_PHASE_FILLER_SELECTED', { 
                                    name: filler.name, 
                                    style: filler.style, 
                                    gained: filler.adrenalineGain,
                                    needed: (pvmeAbility.adrenalineCost || 0),
                                    remaining: (pvmeAbility.adrenalineCost || 0) - currentAdrenaline - (filler.adrenalineGain || 0),
                                    reason: 'highest_gain_in_style' 
                                });

                                const intent: CombatIntent = {
                                    action: 'execute_ability',
                                    abilityId: filler.id,
                                    abilityName: filler.name,
                                    targetId: target.entityId,
                                    tickStarted: ctx.currentTick,
                                    contextHash: 'pvme_build_phase',
                                    coord: target.coord,
                                };

                                push('INTENT_COMMITTED', { action: intent.action, abilityId: intent.abilityId, targetId: intent.targetId });

                                return { intent, evidence, finalConfidence, fallbackUsed };
                            }
                        }

                        logger.warn({ ability: pvmeAbility.name }, 'PVME Desync: Threshold/Ultimate on cooldown. Waiting.');
                        return null; // Wait to preserve sequence
                    } else {
                        logger.info({ ability: pvmeAbility.name }, 'PVME Desync: Basic on cooldown. Skipping to maintain tempo.');
                        pvme.getNextAbility(target.entityId, target.name);
                    }
                }
            } else {
                logger.warn({ name: pvmeAbilityObj.name }, 'PVME ability not found in book. Skipping.');
                pvme.getNextAbility(target.entityId, target.name);
            }
        }

        // Get prioritized ability list based on archetype
        const candidates = this.buildPriorityList(ctx, target);
        fallbackUsed = true;
        evidence.push({
            signal: 'ARCHETYPE_FALLBACK',
            timestamp: ctx.currentTick,
            elapsedMs: parseFloat((performance.now() - tickStart).toFixed(3)),
            detail: { archetype: ctx.archetype, candidateCount: candidates.length },
            confidence: 1.0
        });

        // Evaluate each candidate through the constraint pipeline
        for (const ability of candidates) {
            if (this.passesConstraints(ability, ctx, target, evidence, tickStart)) {
                const intent: CombatIntent = {
                    action: 'execute_ability',
                    abilityId: ability.id,
                    abilityName: ability.name,
                    targetId: target.entityId,
                    tickStarted: ctx.currentTick,
                    contextHash: `${ability.type}_${ability.style}`,
                    coord: target.coord,
                };

                push('INTENT_COMMITTED', { action: intent.action, abilityId: intent.abilityId, targetId: intent.targetId });

                return { intent, evidence, finalConfidence, fallbackUsed };
            }
        }

        return null;
    }

    /**
     * Resolve the highest-threat target from the GhostSplat field.
     * Returns the entity projection that generated the most heat within attack range.
     */
    public resolveTargetFromHeat(
        field: GhostSplatField,
        selfCoord: Coord,
        maxRange: number,
        isPlayer: boolean
    ): TargetContext | null {
        // Player reads entityHeat (NPC threats), NPC reads avatarHeat (player threats)
        const heatMap = isPlayer ? field.entityHeat : field.avatarHeat;
        if (!heatMap) return null;

        let bestProjection: { entityId: string; coord: Coord; heat: number } | null = null;

        for (const [entityId, ghost] of field.projections) {
            // Skip self-projections
            if (isPlayer && entityId === 'player_sovereign') continue;
            if (!isPlayer && entityId !== 'player_sovereign') continue;

            const dist = chebyshevDistance(selfCoord, ghost.projectedCoord);
            if (dist > maxRange) continue;

            // Sample heat at ghost's projected coord
            const localX = ghost.projectedCoord.x - selfCoord.x + Math.floor(PADDED_SIZE / 2);
            const localY = ghost.projectedCoord.y - selfCoord.y + Math.floor(PADDED_SIZE / 2);

            if (localX < 0 || localX >= PADDED_SIZE || localY < 0 || localY >= PADDED_SIZE) continue;

            const heatIdx = localY * PADDED_SIZE + localX;
            const heat = heatMap[heatIdx] || 0;

            if (!bestProjection || heat > bestProjection.heat) {
                bestProjection = {
                    entityId,
                    coord: ghost.projectedCoord,
                    heat
                };
            }
        }

        if (!bestProjection) return null;

        return {
            entityId: bestProjection.entityId,
            name: bestProjection.entityId.split('_')[0], // Simplified; should be real name
            coord: bestProjection.coord,
            currentHp: 1000, // Default; overridden by live NPC state when available
            stunImmunityEndTick: 0,
        };
    }

    // ═══════════════════════════════════════════════════════
    // Priority List Builders (per archetype)
    // ═══════════════════════════════════════════════════════

    private buildPriorityList(ctx: CombatEvaluationContext, target: TargetContext): AbilityDefinition[] {
        switch (ctx.archetype) {
            case 'aggressive':
                return this.buildAggressiveList(ctx);
            case 'methodical':
                return this.buildMethodicalList(ctx);
            case 'cowardly':
                return this.buildCowardlyList(ctx);
            case 'predator':
                return this.buildPredatorList(ctx, target);
            default:
                return this.buildAggressiveList(ctx);
        }
    }

    /**
     * aggressive: Ultimate → Enhanced → Basic
     * Dumps adrenaline as fast as possible into highest-damage abilities.
     * March 2026: Promotes buff-window consumers when buffs are active.
     */
    private buildAggressiveList(ctx: CombatEvaluationContext): AbilityDefinition[] {
        const ults = ctx.availableAbilities.filter(a => a.type === 'ultimate');
        const enhanced = ctx.availableAbilities.filter(a => a.type === 'enhanced');
        const basics = ctx.availableAbilities.filter(a => a.type === 'basic');

        // March 2026: Promote buff-window consumers when a buff is active
        const buffConsumers = this.getActiveBuffConsumers(ctx, [...ults, ...enhanced, ...basics]);
        const nonConsumers = [...ults, ...enhanced, ...basics].filter(a => !buffConsumers.includes(a));

        return [...buffConsumers, ...nonConsumers];
    }

    /**
     * methodical: Debuff first → Threshold → Basic
     * Applies debuffs/vulnerability before damage, respects all cooldowns.
     */
    private buildMethodicalList(ctx: CombatEvaluationContext): AbilityDefinition[] {
        const all = ctx.availableAbilities;
        
        // Debuffs first
        const debuffs = all.filter(a => a.flags.includes('debuff'));
        const enhanced = all.filter(a => a.type === 'enhanced' && !a.flags.includes('debuff'));
        const basics = all.filter(a => a.type === 'basic' && !a.flags.includes('debuff'));
        const ults = all.filter(a => a.type === 'ultimate');

        return [...debuffs, ...enhanced, ...basics, ...ults];
    }

    /**
     * cowardly: Survival → Ultimate defensive → Enhanced defensive → Basic
     */
    private buildCowardlyList(ctx: CombatEvaluationContext): AbilityDefinition[] {
        const all = ctx.availableAbilities;

        const survival = all.filter(a => a.name === 'Resonance' || a.name === 'Barricade');
        const defensives = all.filter(a => a.flags.includes('defensive'));
        const basics = all.filter(a => a.type === 'basic');

        return [...survival, ...defensives, ...basics];
    }

    /**
     * predator: Stun/Bind (if target not immune) → Channeled enhanced → Basic
     */
    private buildPredatorList(ctx: CombatEvaluationContext, target: TargetContext): AbilityDefinition[] {
        const all = ctx.availableAbilities;

        const stuns = all.filter(a => a.flags.includes('stun') || a.flags.includes('bind'));
        const channeled = all.filter(a => a.isChanneled);
        const enhanced = all.filter(a => a.type === 'enhanced');
        const basics = all.filter(a => a.type === 'basic');

        const isTargetImmune = ctx.currentTick < target.stunImmunityEndTick;
        if (isTargetImmune) {
            // Deprioritize stuns if immune
            return [...channeled, ...enhanced, ...basics, ...stuns];
        } else {
            return [...stuns, ...channeled, ...enhanced, ...basics];
        }
    }

    // ═══════════════════════════════════════════════════════
    // Constraint Pipeline
    // ═══════════════════════════════════════════════════════

    private evaluatePredicate(predicate: string, ctx: CombatEvaluationContext): boolean {
        const p = predicate.toLowerCase();

        // 1. Adrenaline Checks
        const adMatch = p.match(/adrenaline\s*([><=]+)\s*(\d+)/);
        if (adMatch) {
            const op = adMatch[1];
            const val = parseInt(adMatch[2]) * 100; // Convert % to 0-10000
            if (op === '>') return ctx.adrenaline > val;
            if (op === '<') return ctx.adrenaline < val;
            if (op === '>=') return ctx.adrenaline >= val;
            if (op === '<=') return ctx.adrenaline <= val;
        }

        // 2. Health Checks
        const hpMatch = p.match(/hp\s*([><=]+)\s*(\d+)/);
        if (hpMatch) {
            const op = hpMatch[1];
            const val = parseInt(hpMatch[2]); // Assuming percentage or raw
            const currentHpPct = ((ctx.state.hp ?? 0) / (ctx.state.maxHp || 10000)) * 100;
            if (op === '>') return currentHpPct > val;
            if (op === '<') return currentHpPct < val;
        }

        // 3. Status Checks (Simplified)
        if (p.includes('stunned')) return ctx.currentTick < (ctx.channelEndTick || 0); // Not quite right but placeholder

        return true; // Default to pass if unhandled
    }

    private passesConstraints(
        ability: AbilityDefinition,
        ctx: CombatEvaluationContext,
        target: TargetContext,
        evidence: CombatCausalEvidence[],
        tickStart: number
    ): boolean {
        const push = (sig: string, det: any, conf = 1.0) => 
            this.pushSignal(evidence, ctx.currentTick, tickStart, sig, det, conf);
        // 1. Range check (Chebyshev) — skip for self-targeted abilities (range 0)
        if (ability.range > 0) {
            const dist = chebyshevDistance(ctx.coord, target.coord);
            if (dist > ability.range) {
                push('GATE_RANGE_FAILED', { distance: dist, abilityRange: ability.range });
                return false;
            }
            push('GATE_RANGE_PASSED', { distance: dist, abilityRange: ability.range });
        }

        // 2. Per-ability cooldown
        const cdEnd = ctx.cooldowns[ability.id] || 0;
        if (ctx.currentTick < cdEnd) {
            push('GATE_COOLDOWN_FAILED', { cdEndTick: cdEnd, currentTick: ctx.currentTick });
            return false;
        }
        push('GATE_COOLDOWN_PASSED', { cdEndTick: cdEnd, currentTick: ctx.currentTick });

        // 3. Adrenaline
        if (ctx.adrenaline < ability.adrenalineCost) {
            push('GATE_ADRENALINE_FAILED', { currentAdr: ctx.adrenaline, requiredAdr: ability.adrenalineCost });
            return false;
        }
        push('GATE_ADRENALINE_PASSED', { currentAdr: ctx.adrenaline, requiredAdr: ability.adrenalineCost });

        // 4. Stun waste prevention
        if (ability.flags.includes('stun') && ctx.currentTick < (target.stunImmunityEndTick || 0)) {
            push('GATE_STUN_FAILED', { immunityEndTick: target.stunImmunityEndTick });
            return false;
        }
        if (ability.flags.includes('stun')) {
            push('GATE_STUN_PASSED', { immunityEndTick: target.stunImmunityEndTick });
        }

        // 5. Stack-aware routing (March 2026 Paradigm)
        if (ability.flags.includes('bloodlust-consumer')) {
            const stacks = ctx.state.bloodlustStacks || 0;
            // Enhanced abilities require a minimum of 4 stacks for optimal throughput
            if (stacks < 4) return false;
        }

        if (ability.flags.includes('anima-consumer')) {
            if (!ctx.state.animaCharged) return false;
        }

        // 6. Searing Winds: Only allow searing-winds-extender abilities during active Searing Winds
        if (ability.flags.includes('searing-winds-extender')) {
            if ((ctx.state.searingWindsTicksRemaining || 0) <= 0) {
                // Not forbidden, but deprioritized — handled in priority builders
            }
        }

        return true;
    }

    // ═══════════════════════════════════════════════════════
    // Buff Window Awareness (March 2026)
    // ═══════════════════════════════════════════════════════

    /**
     * Returns abilities from the candidate list that consume an active buff.
     * These should be promoted to the front of the priority queue to maximize
     * damage within limited buff windows.
     */
    private getActiveBuffConsumers(ctx: CombatEvaluationContext, candidates: AbilityDefinition[]): AbilityDefinition[] {
        const promoted: AbilityDefinition[] = [];

        const hasBloodlust = (ctx.state.bloodlustStacks || 0) >= 4;
        const hasAnima = !!ctx.state.animaCharged;
        const hasSearingWinds = (ctx.state.searingWindsTicksRemaining || 0) > 0;
        const hasShadowImbued = (ctx.state.shadowImbuedTicksRemaining || 0) > 0;

        for (const ability of candidates) {
            // Melee: Bloodlust consumers promoted when stacks are high
            if (hasBloodlust && ability.flags.includes('bloodlust-consumer')) {
                promoted.push(ability);
                continue;
            }
            // Magic: Anima consumers promoted when charged
            if (hasAnima && ability.flags.includes('anima-consumer')) {
                promoted.push(ability);
                continue;
            }
            // Ranged: Searing Winds extenders promoted during active window
            if (hasSearingWinds && ability.flags.includes('searing-winds-extender')) {
                promoted.push(ability);
                continue;
            }
            // Ranged: Shadow Imbued makes adrenaline-spending abilities more efficient
            if (hasShadowImbued && ability.adrenalineCost > 0 && ctx.combatStyle === 'ranged') {
                promoted.push(ability);
                continue;
            }
        }

        return promoted;
    }

    // ═══════════════════════════════════════════════════════
    // Public Utilities
    // ═══════════════════════════════════════════════════════

    /**
     * Calculate base damage at a given combat level.
     * March 2026: Logarithmic scaling replaces linear (2.5 × level).
     * Formula: 145 × weaponTier × ln(1 + 0.6 × level / 145) / ln(1.6)
     * 
     * @param level       Combat skill level (1–120)
     * @param weaponTier  Weapon tier (1–95+)
     * @returns Base damage value before ability % modifiers
     */
    public static logarithmicBaseDamage(level: number, weaponTier: number): number {
        return Math.floor(
            145 * weaponTier * Math.log(1 + 0.6 * level / 145) / Math.log(1.6)
        );
    }

    /**
     * Calculate damage for an ability hit.
     * March 2026: Uses logarithmic base damage instead of linear.
     * 
     * @param ability      The ability being fired
     * @param level        Attacker's combat skill level (1–120)
     * @param weaponTier   Weapon tier (1–95+)
     * @param buffState    Optional active buff multipliers
     */
    public calculateDamage(
        ability: AbilityDefinition,
        level: number,
        weaponTier: number,
        buffState?: { bloodlustStacks?: number; animaCharged?: boolean; shadowImbued?: boolean }
    ): number {
        const [minPct, maxPct] = ability.damageRange;
        if (minPct === 0 && maxPct === 0) return 0; // Buff/defensive, no damage

        const baseDamage = CombatRotationEngine.logarithmicBaseDamage(level, weaponTier);
        const rng = CanonicalClock.getInstance().rng();
        const pct = minPct + rng.next() * (maxPct - minPct);
        let damage = Math.floor(baseDamage * (pct / 100));

        // Buff multipliers (March 2026)
        if (buffState) {
            // Bloodlust: Each stack adds 2.5% damage, consumed on enhanced ability use
            if (buffState.bloodlustStacks && ability.flags.includes('bloodlust-consumer')) {
                damage = Math.floor(damage * (1 + buffState.bloodlustStacks * 0.025));
            }
            // Anima Charged: 10% bonus on next magic ability
            if (buffState.animaCharged && ability.style === 'magic') {
                damage = Math.floor(damage * 1.10);
            }
            // Shadow Imbued: 5% bonus to ranged abilities during active window
            if (buffState.shadowImbued && ability.style === 'ranged') {
                damage = Math.floor(damage * 1.05);
            }
        }

        return damage;
    }

    /**
     * @deprecated Use calculateDamage(ability, level, weaponTier) instead.
     * Legacy linear damage for backward compatibility during transition.
     */
    public calculateDamageLinear(ability: AbilityDefinition, weaponDamage: number): number {
        const [minPct, maxPct] = ability.damageRange;
        if (minPct === 0 && maxPct === 0) return 0;
        const rng = CanonicalClock.getInstance().rng();
        const pct = minPct + rng.next() * (maxPct - minPct);
        return Math.floor(weaponDamage * (pct / 100));
    }

    public handleAbilityDispatch(abilityId: string, ctx: any): void {
        logger.info({ abilityId, currentTick: ctx.currentTick }, '[CombatRotationEngine] Ability dispatch handshake completed.');
        const ability = this.book.get(abilityId) || this.book.getByName(abilityId);
        if (ability && ctx.cooldowns) {
            ctx.cooldowns[abilityId] = ctx.currentTick + (ability.cooldownTicks || 0);
        }
    }

    public healthCheck(): { online: boolean; details: string } {
        const bookHealth = this.book.healthCheck();
        return {
            online: bookHealth.online,
            details: `CombatRotationEngine [March2026]: ${bookHealth.loaded} abilities, logarithmic damage, buff-window routing.`
        };
    }
}
