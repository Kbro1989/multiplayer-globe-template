// src/engines/gameplay/PlayerAgent.ts

import { SovereignAvatarEntity } from '../../core/SovereignAvatar.js';
import { EntityGhost } from '../../core/EntityGhost.js';
import { Coord, GameState } from '../../core/models.js';
import { GhostSplatField } from '../../substrates/GhostSplatEngine.js';
import { SpatialSovereigntyLimb, PADDED_SIZE } from '../../limbs/spatial/SpatialSovereigntyLimb.js';
import { DirectionalPathfinder } from '../../limbs/spatial/DirectionalPathfinder.js';
import { CombatRotationEngine, CombatEvaluationContext, TargetContext, CombatIntent, TacticalArchetype } from './CombatRotationEngine.js';
import { CombatStyle, AbilityBook, AbilityDefinition } from './AbilityBook.js';
import { HexagramManager } from '../../routing/HexagramManager.js';
import { ObjectiveLimb, SovereignObjective } from '../../limbs/technical/ObjectiveLimb.js';
import { CanonicalClock } from '../../utils/CanonicalClock.js';
import { AbilityDiscoveryLimb } from '../../limbs/spatial/AbilityDiscoveryLimb.js';
import { HUDForensicsLimb } from '../../limbs/spatial/HUDForensicsLimb.js';
import { PVMERotationLimb } from '../../limbs/gameplay/PVMERotationLimb.js';
import { CombatHUDBridge } from '../../utils/CombatHUDBridge.js';
import { EpistemicTransitionKernel } from '../core/EpistemicTransitionKernel.js';
import { CNSCausalityLedger } from '../core/CNSCausalityLedger.js';
import { CombatPedagogyBridge } from '../../limbs/pedagogy/CombatPedagogyBridge.js';
import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('PlayerAgent');

/**
 * Teleport Grounding Manifest Schema
 */
interface GroundingTeleport {
    name: string;
    dest: Coord | null;
}

/**
 * PlayerAgent
 * 
 * Symmetry to NpcAgent. Wraps the SovereignAvatarEntity with cognitive
 * self-awareness, allowing it to project its own ghost into the GhostSplat field
 * and manage its own temporal combat rhythms.
 */
export class PlayerAgent {
    private pathfinder: DirectionalPathfinder = new DirectionalPathfinder(SpatialSovereigntyLimb.getInstance());
    private leaderId: string | null = null;
    private ticksIdle: number = 0;
    private lastX: number = -1;
    private lastY: number = -1;
    private teleportManifest: Record<string, GroundingTeleport> = {};
    private objectives: ObjectiveLimb = ObjectiveLimb.getInstance();
    private currentObjective: SovereignObjective | null = null;

    constructor(private avatar: SovereignAvatarEntity) {
        this.loadTeleportManifest();
    }

    private loadTeleportManifest() {
        try {
            const p = path.join(process.cwd(), 'public', 'teleport_grounding.json');
            if (fs.existsSync(p)) {
                this.teleportManifest = JSON.parse(fs.readFileSync(p, 'utf8'));
            }
        } catch (err) {
            // Silently fail, grounding will just use fallback respawn
        }
    }

    public setLeader(id: string | null): void {
        this.leaderId = id;
    }

    public getCombatIntent(): TacticalArchetype {
        return this.avatar.metadata.combatArchetype || 'aggressive';
    }

    /**
     * projectSelf - Forward-project position + combat state.
     * Maps the player's current pathing queue and intent into the GhostSplat field.
     */
    public projectSelf(ticks: number): EntityGhost[] {
        const ghosts: EntityGhost[] = [];
        
        let pathCoord = this.avatar.coord;
        let source: EntityGhost['source'] = 'extrapolation';
        
        if (this.avatar.metadata?.currentPath && this.avatar.metadata.currentPath.length > 0) {
            const pathIndex = Math.min(ticks - 1, this.avatar.metadata.currentPath.length - 1);
            if (pathIndex >= 0) {
                const candidateCoord = this.avatar.metadata.currentPath[pathIndex];

                // ── Stale Path Guard (per Kimi-k2 audit) ────────────────────────────
                // Validate the path coord is still walkable. A stale path (from before
                // a door closed or an NPC moved) would project the player into a blocked
                // tile with confidence 1.0 — a false certainty that bypasses hysteresis.
                const spatial = SpatialSovereigntyLimb.getInstance();
                const isStillWalkable = spatial.isWalkable(
                    candidateCoord.plane ?? this.avatar.coord.plane,
                    candidateCoord.x,
                    candidateCoord.y
                );

                if (isStillWalkable) {
                    pathCoord = candidateCoord;
                    source = 'path_queue';
                } else {
                    // Downgrade: blocked tile — fallback to current position, lower confidence
                    pathCoord = this.avatar.coord;
                    source = 'extrapolation';
                }
            }
        } else if (this.avatar.intent?.coord) {
            pathCoord = this.avatar.intent.coord;
            source = 'intent';
        }

        ghosts.push({
            entityId: 'player_sovereign',
            projectedCoord: pathCoord,
            ticksAhead: ticks,
            confidence: source === 'path_queue' ? 1.0 : (source === 'intent' ? 0.8 : 0.5),
            originType: 'rsmv',
            combatState: {
                hp: this.avatar.currentHp || 0,
                adrenaline: this.avatar.adrenaline || 0,
                prayerActive: false // Simplified for now
            },
            source
        });

        return ghosts;
    }

    /**
     * projectOffline - Fallback state for GhostLimb if the player drops connection.
     */
    public projectOffline(): EntityGhost {
        return {
            entityId: 'player_sovereign',
            projectedCoord: this.avatar.coord,
            ticksAhead: 0,
            confidence: 1.0,
            originType: 'rsmv',
            combatState: {
                hp: this.avatar.currentHp || 0,
                adrenaline: this.avatar.adrenaline || 0,
                prayerActive: false
            },
            source: 'offline_fallback'
        };
    }

    /**
     * advanceTick - Synchronized with the 600ms CNSGodheadPulseVolley.
     * Decays adrenaline, processes cooldowns, drains prayer.
     */
    public advanceTick(deltaMs: number): void {
        const ticksPassed = Math.round(deltaMs / 600);
        
        for (let i = 0; i < ticksPassed; i++) {
            // Process player-specific mechanics
            // Cooldowns are already managed via interaction intent, but we can manage adrenaline here
            if (!this.avatar.metadata.inCombat) {
                // Decay adrenaline by 500 (5%) every tick if not in combat (simplified)
                if (this.avatar.adrenaline && this.avatar.adrenaline > 0) {
                    const decay = Math.min(500, this.avatar.adrenaline);
                    this.avatar.consumeAdrenaline(decay);
                }
            }
        }
    }

    /**
     * evaluateCombatRotation
     * 
     * Uses CombatRotationEngine to select the optimal ability based on:
     * - Current adrenaline and cooldowns
     * - GhostSplat heat-based target acquisition
     * - GCD and channel lock constraints
     * - Tactical archetype priority chain
     * 
     * Only called when NOT retreating (evaluateTacticalPosition returns no evasion).
     * Returns a CombatIntent or null if no valid ability/target exists.
     */
    public evaluateCombatRotation(
        field: GhostSplatField,
        currentTick: number
    ): CombatIntent | null {
        // Gate: Do not fight while evading
        if (this.avatar.metadata.tacticalState === 'evading') {
            return null;
        }

        // Gate: Avatar busy (locked by animation/channel)
        if (this.avatar.isBusy()) {
            return null;
        }

        const engine = CombatRotationEngine.getInstance();

        // Combat metadata initialization
        if (this.avatar.metadata.gcdEndTick === undefined) {
            this.avatar.metadata.gcdEndTick = 0;
        }
        if (this.avatar.metadata.channelEndTick === undefined) {
            this.avatar.metadata.channelEndTick = 0;
        }
        if (this.avatar.metadata.weaponDamage === undefined) {
            this.avatar.metadata.weaponDamage = 1000; // Default weapon damage scalar
        }

        // Determine combat style from equipped weapon (default melee)
        const combatStyle: CombatStyle = this.avatar.metadata.combatStyle || 'melee';
        const archetype: TacticalArchetype = this.avatar.metadata.combatArchetype || 'aggressive';

        // Resolve target via GhostSplat heat
        const maxRange = combatStyle === 'melee' ? 1 : 7;
        const target = engine.resolveTargetFromHeat(field, this.avatar.coord, maxRange, true);

        if (!target) {
            return null; // No hostile entity in range
        }

        // Enrich target HP and Name from live NPC state if available
        if (this.avatar.state?.npcMap) {
            for (const [, npc] of this.avatar.state.npcMap) {
                if (String(npc.id) === target.entityId || String(npc.npcId ?? npc.id) === target.entityId) {
                    target.currentHp = npc.currentHp ?? npc.combatStats?.currentHp ?? 1000;
                    target.name = npc.name || target.name;
                    break;
                }
            }
        }

        // Phase Detection & Rotation Sync
        const hudLimb = HUDForensicsLimb.getInstance();
        const phase = hudLimb.detectEncounterPhase(target.name, {
            targetHp: target.currentHp,
            recentChat: this.avatar.state?.messages || [],
            animationId: this.avatar.metadata.targetAnimationId, // Surfaced from target forensic
            gfxId: this.avatar.metadata.targetGfxId
        });
        if (phase) {
            PVMERotationLimb.getInstance().setPhase(target.entityId, phase);
        }

        // Multi-Target Resolution: Find minions in range
        const minions: TargetContext[] = [];
        if (this.avatar.state?.npcMap) {
            for (const [, npc] of this.avatar.state.npcMap) {
                // Heuristic: identify minions by name patterns (Nex minions, spawns)
                if (npc.name && /Fumus|Umbra|Cruor|Glacies|Minion/i.test(npc.name)) {
                    minions.push({
                        entityId: String(npc.id),
                        name: npc.name,
                        coord: npc.coord || { x: 0, y: 0, plane: 0 },
                        currentHp: npc.currentHp || 10000,
                        stunImmunityEndTick: 0
                    });
                }
            }
        }
        target.availableTargets = minions;

        // Sync HUD
        const rotationLimb = PVMERotationLimb.getInstance();
        const activeRot = rotationLimb.getActiveRotationLabel(target.entityId);
        const nextAbility = rotationLimb.peekNextAbility(target.entityId, target.name)?.name;

        CombatHUDBridge.getInstance().updateState(
            this.avatar.adrenaline || 0,
            this.avatar.metadata.archetype || 'aggressive',
            this.avatar.intent?.abilityId,
            activeRot,
            nextAbility
        );

        // Build evaluation context
        const combatantState: import('../../core/models.js').CombatantState = {
            adrenaline: this.avatar.adrenaline || 0,
            bloodlustStacks: this.avatar.metadata.bloodlustStacks || 0,
            animaCharged: this.avatar.metadata.animaCharged || false,
            searingWindsTicksRemaining: this.avatar.metadata.searingWindsTicksRemaining || 0,
            shadowImbuedTicksRemaining: this.avatar.metadata.shadowImbuedTicksRemaining || 0,
            stunCharges: this.avatar.metadata.stunCharges || {},
            hp: this.avatar.currentHp || 0,
            maxHp: this.avatar.maxHp || 10000,
            lastCombatTick: this.avatar.metadata.lastCombatTick || 0,
            cooldowns: this.avatar.cooldowns || {},
            messages: (this.avatar.state as any).messages || [],
        };

        // Utilize AbilityDiscoveryLimb to dynamically identify available combat actions
        const discoveryLimb = AbilityDiscoveryLimb.getInstance();
        // Uses fallback style-based discovery (or HUD scanning when configured)
        const discovered = discoveryLimb.discoverFromAbilityBook(combatStyle);
        
        let availableAbilities = discovered.map(d => AbilityBook.getInstance().getByName(d.name)).filter(a => a) as AbilityDefinition[];
        // Constrain to action bar slots
        if (this.avatar.actionBarSlots && this.avatar.actionBarSlots.length > 0) {
            availableAbilities = availableAbilities.filter(a => this.avatar.actionBarSlots.includes(a.id.toLowerCase()));
        }

        const ctx: CombatEvaluationContext = {
            adrenaline: this.avatar.adrenaline ? this.avatar.adrenaline * 10 : 0,
            cooldowns: this.avatar.cooldowns || {},
            coord: this.avatar.coord,
            currentTick,
            gcdEndTick: this.avatar.metadata.gcdEndTick,
            channelEndTick: this.avatar.metadata.channelEndTick,
            combatStyle,
            archetype,
            state: combatantState,
            availableAbilities,
            availableTargets: minions
        };

        const trace = engine.evaluateRotation(ctx, target);
        const rotation = trace ? trace.intent : null;

        let learningTrace: any = undefined;
        if (trace) {
            // Log to Ledger
            const event = {
                id: 'combat-intent-' + Date.now() + '-' + ctx.currentTick,
                tick: ctx.currentTick,
                action: rotation?.action || 'idle',
                source: 'AI',
                truthClass: 1, // TruthClass.EXECUTION
                signals: trace.evidence.map(e => ({
                    source: 'DOMAIN',
                    code: e.signal,
                    description: JSON.stringify(e.detail),
                    severity: 'INFO',
                    confidence: e.confidence
                })),
                outcome: 'SUCCESS'
            };
            CNSCausalityLedger.getInstance().record(event as any);
            learningTrace = CNSCausalityLedger.getInstance().compileLearningTrace(event as any);
            
            // Bridge to pedagogy!
            CombatPedagogyBridge.getInstance().bridgeCombatTrace(learningTrace, rotation);
            
            console.log("\n--- COMBAT TRACE ---");
            console.log(JSON.stringify(learningTrace, null, 2));
            console.log("--------------------\n");
        }

        // Target Switch Implementation
        if (rotation?.action === 'switch_target') {
            logger.info({ oldTarget: target.entityId, newTarget: rotation.targetId }, 'PlayerAgent: Executing target switch intent.');
            // Update internal target tracking - in a real game this would trigger a right-click or selection action
            this.avatar.metadata.activeTargetId = rotation.targetId;
        }

        // Sync with live HUD
        const bridge = CombatHUDBridge.getInstance();
        bridge.updateState(
            this.avatar.adrenaline || 0, 
            archetype, 
            rotation?.action === 'execute_ability' ? rotation.abilityName : undefined,
            activeRot,
            nextAbility,
            combatStyle,
            phase || undefined,
            target.currentHp,
            EpistemicTransitionKernel.getInstance().getCurrentPhase(),
            learningTrace
        );
        
        if (rotation) {
            if (rotation.action === 'execute_ability') {
                bridge.log(`Decided: ${rotation.abilityName}`, 'action');
            } else if (rotation.action === 'switch_target') {
                bridge.log(`Switching Target: ${rotation.targetId}`, 'system' as any);
            }
        }

        return rotation;
    }

    private getDynamicHeatThreshold(): number {
        try {
            const hexagram = HexagramManager.getInstance().getInterpretation();
            const variance = hexagram.aesthetics.thermalVariance || 0.5;
            // variance 0.0-1.0 maps to threshold 0.7-0.49
            return 0.7 - (variance * 0.21);
        } catch (e) {
            return 0.7; // Fallback
        }
    }

    /**
     * evaluateTacticalPosition
     * Subscribes to the safespots telemetry to autonomously override pathing and dodge threats.
     */
    public evaluateTacticalPosition(field: GhostSplatField): void {
        // Hysteresis Initialization
        if (!this.avatar.metadata.tacticalState) {
            this.avatar.metadata.tacticalState = 'idle';
            this.avatar.metadata.ticksInRetreat = 0;
        }

        // --- STUCK DETECTION (Phase 112: Grounding Healer) ---
        if (this.avatar.x === this.lastX && this.avatar.y === this.lastY) {
            this.ticksIdle++;
        } else {
            this.ticksIdle = 0;
            this.lastX = this.avatar.x;
            this.lastY = this.avatar.y;
        }

        // If z=0 (Hollow) or stuck for 30 ticks (18s) while trying to move
        const isHollow = this.avatar.coord.plane === 0 && !this.avatar.metadata.grounded; // Simplified check
        const isStuck = this.ticksIdle > 30 && (this.avatar.currentPath?.length || 0) > 0;

        if (isStuck) {
            this.attemptEmergencyTeleport();
            return;
        }

        // 1. Sample current tile heat
        const centerOffset = Math.floor(PADDED_SIZE / 2);
        const idx = centerOffset * PADDED_SIZE + centerOffset;
        
        // Player evaluates NPC threats via entityHeat
        const currentHeat = field.entityHeat ? field.entityHeat[idx] : field.heatmap[idx];

        const heatThreshold = this.getDynamicHeatThreshold();
        const isHeatCritical = currentHeat >= heatThreshold;

        // Composure Gate (Adrenaline vs HP)
        const adrenaline = (this.avatar.adrenaline || 0) / 100; // Convert to percentage
        const currentHp = this.avatar.currentHp || 0;
        const maxHp = this.avatar.maxHp;
        const hpPercent = (currentHp / maxHp) * 100;
        const composureBroken = adrenaline < 50 || hpPercent < 50;

        // 1.5 Follower Proximity Logic (Phase 46)
        if (this.leaderId && this.avatar.metadata.tacticalState === 'idle') {
            const leaderGhost = field.projections.get(this.leaderId);
            if (leaderGhost) {
                const dist = Math.max(
                    Math.abs(this.avatar.x - leaderGhost.projectedCoord.x),
                    Math.abs(this.avatar.y - leaderGhost.projectedCoord.y)
                );
                
                // Stay within 2-3 tiles of leader, but not ON them (Negative Space)
                if (dist > 3 || dist === 0) {
                    const safespots = field.safespots;
                    if (safespots.length > 0) {
                        // Find a safespot near the leader
                        const bestSpot = safespots
                            .filter(s => s.plane === leaderGhost.projectedCoord.plane)
                            .sort((a, b) => {
                                const distA = Math.abs(a.x - leaderGhost.projectedCoord.x) + Math.abs(a.y - leaderGhost.projectedCoord.y);
                                const distB = Math.abs(b.x - leaderGhost.projectedCoord.x) + Math.abs(b.y - leaderGhost.projectedCoord.y);
                                return distA - distB;
                            })[0];

                        if (bestSpot) {
                            const success = this.avatar.plotPath(bestSpot.x, bestSpot.y, this.pathfinder, this.avatar.state);
                            if (success) {
                                this.avatar.intent = {
                                    action: 'follow_leader',
                                    targetId: this.leaderId!,
                                    tickStarted: this.avatar.state?.tickNumber || 0,
                                    contextHash: 'follow_logic'
                                };
                                return;
                            }
                        }
                    }
                }
            }
        }

        // --- HYSTERESIS EXIT CONDITION ---
        if (this.avatar.metadata.tacticalState === 'evading') {
            this.avatar.metadata.ticksInRetreat++;
            
            // Allow exit if heat drops to 0 and we've retreated for at least 3 ticks
            // Or if composure is fully restored.
            if ((currentHeat === 0 && this.avatar.metadata.ticksInRetreat >= 3) || !composureBroken) {
                this.avatar.metadata.tacticalState = 'idle';
                this.avatar.metadata.ticksInRetreat = 0;
                return; // Safe to stop evading
            }
            
            // Continue evading if we haven't met the exit condition
            // Wait, if we are currently evading, do we need to replot a path? 
            // If we are already walking towards a safespot, let pathfinding continue.
            if (this.avatar.intent?.action === 'run_tactical_evade' && this.avatar.currentPath && this.avatar.currentPath.length > 0) {
                return; // Keep running along the established safe route
            }
        }

        // --- IDLE EXPLORATION (Wandering / Objectives) ---
        if (this.avatar.metadata.tacticalState === 'idle' && !this.avatar.isBusy() && !this.avatar.currentPath) {
            if (this.ticksIdle > 5) { // If standing for 3s
                this.seekObjective(field);
                return;
            }
        }

        // --- HYSTERESIS ENTRY CONDITION ---
        if (this.avatar.metadata.tacticalState === 'idle') {
            if (!isHeatCritical || !composureBroken) {
                return; // Safe, no evasion needed
            }
            // Trigger evasion
            this.avatar.metadata.tacticalState = 'evading';
            this.avatar.metadata.ticksInRetreat = 0;
        }

        // 3. Evasion necessary. Rank safespots.
        if (!field.safespots || field.safespots.length === 0) return;

        type ScoredSafespot = { coord: Coord, score: number };
        const scored: ScoredSafespot[] = [];

        for (const spot of field.safespots) {
            // Distance (Manhattan is fine for heuristic scoring)
            const dist = Math.abs(spot.x - this.avatar.coord.x) + Math.abs(spot.y - this.avatar.coord.y);
            scored.push({ coord: spot, score: dist });
        }

        // Sort by lowest score (closest)
        scored.sort((a, b) => a.score - b.score);

        // 4. Validate Path
        const spatial = SpatialSovereigntyLimb.getInstance();
        const pathfinder = new DirectionalPathfinder(spatial);

        for (const candidate of scored) {
            try {
                // Leverage the avatar's native plotPath which mutates currentPath automatically
                const isReachable = this.avatar.plotPath(candidate.coord.x, candidate.coord.y, pathfinder, this.avatar.state);
                
                if (isReachable) {
                    // Valid route to safespot found!
                    this.avatar.intent = {
                        action: 'run_tactical_evade',
                        targetId: -1, // No entity target
                        tickStarted: this.avatar.state.tickNumber || 0,
                        contextHash: 'evade',
                        coord: candidate.coord
                    };
                    return; 
                }
            } catch (err) {
                // Path failed, evaluate next best
            }
        }
    }

    /**
     * seekObjective - Prioritizes Discovery and Completion over random wandering.
     */
    private seekObjective(field: GhostSplatField): void {
        const best = this.objectives.selectBestObjective(this.avatar as any);
        this.currentObjective = best;

        if (best && best.targetCoord) {
            // Check if we are already there
            const dist = Math.abs(this.avatar.x - best.targetCoord.x) + Math.abs(this.avatar.y - best.targetCoord.y);
            if (dist < 3) {
                // Goal reached! Wait for syncState in next tick
                this.wander(field); // Keep moving slightly while "discovering"
                return;
            }

            // Move towards objective
            const success = this.avatar.plotPath(best.targetCoord.x, best.targetCoord.y, this.pathfinder, this.avatar.state);
            if (success) {
                this.avatar.intent = {
                    action: `seek_${best.type.toLowerCase()}`,
                    targetId: best.id,
                    tickStarted: this.avatar.state?.tickNumber || 0,
                    contextHash: 'objective_seeking',
                    coord: best.targetCoord
                };
                this.ticksIdle = 0;
                return;
            }
        }

        // Fallback to wandering if no objective or path failed
        this.wander(field);
    }

    /**
     * wander - Picks a random nearby safespot to keep the splat echoes active and simulate gameplay.
     */
    private wander(field: GhostSplatField): void {
        if (!field.safespots || field.safespots.length === 0) return;

        // Filter for local safespots within ~5 tiles
        const localSpots = field.safespots.filter(s => {
            const dx = Math.abs(s.x - this.avatar.coord.x);
            const dy = Math.abs(s.y - this.avatar.coord.y);
            return dx <= 5 && dy <= 5 && (dx > 0 || dy > 0);
        });

        if (localSpots.length === 0) return;

        const rng = CanonicalClock.getInstance().rng();
        const randomSpot = localSpots[rng.range(0, localSpots.length - 1)];
        
        const success = this.avatar.plotPath(randomSpot.x, randomSpot.y, this.pathfinder, this.avatar.state);
        if (success) {
            this.avatar.intent = {
                action: 'wander_sovereign',
                targetId: -1,
                tickStarted: this.avatar.state?.tickNumber || 0,
                contextHash: 'idle_exploration',
                coord: randomSpot
            };
            this.ticksIdle = 0;
            // Clear movement stats to prevent immediate stuck detection
            this.lastX = -1; 
        }
    }

    /**
     * attemptEmergencyTeleport - Uses grounding manifest to reset spatial state.
     */
    private attemptEmergencyTeleport(): void {
        const validTeles = Object.entries(this.teleportManifest)
            .filter(([, data]) => data.dest !== null)
            .map(([id, data]) => ({ id, ...data }));

        if (validTeles.length === 0) {
            // Fallback: Hard respawn
            this.avatar.respawn();
            return;
        }

        // Find closest grounded teleport
        validTeles.sort((a, b) => {
            const distA = Math.abs(a.dest!.x - this.avatar.x) + Math.abs(a.dest!.y - this.avatar.y);
            const distB = Math.abs(b.dest!.x - this.avatar.x) + Math.abs(b.dest!.y - this.avatar.y);
            return distA - distB;
        });

        const best = validTeles[0]!;
        const oldCoord = { ...this.avatar.coord };
        console.warn(`[GROUNDING] Sovereign Stuck! Emergency Teleport to ${best.name} [ID: ${best.id}]`);
        
        this.avatar.intent = {
            action: 'teleport',
            targetId: best.id,
            tickStarted: this.avatar.state?.tickNumber || 0,
            contextHash: 'emergency_grounding',
            coord: best.dest!
        };
        
        // Execute movement immediately for the pulse kernel to pick up
        this.avatar.coord = { ...best.dest! };
        this.avatar.x = best.dest!.x;
        this.avatar.y = best.dest!.y;
        this.avatar.plane = best.dest!.plane;
        this.avatar.currentPath = null;
        this.ticksIdle = 0;
        this.avatar.lock(5); // Teleport animation lock

        // Phase 112: Notify viewport for camera snap/FX
        (this.avatar as any).emit?.('teleport', {
            from: oldCoord,
            to: best.dest,
            animationLock: 5
        });
    }
}
