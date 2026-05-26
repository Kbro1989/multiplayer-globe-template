import { Coord, GameState, NPC } from '../../core/models.js';
import { DirectionalPathfinder } from '../../limbs/spatial/DirectionalPathfinder.js';
import { SpatialSovereigntyLimb } from '../../limbs/spatial/SpatialSovereigntyLimb.js';
import { createLogger } from '../../utils/logger.js';
import { EventBus } from '../../events/EventBus.js';
import { CombatRotationEngine, CombatEvaluationContext, TargetContext, CombatIntent, TacticalArchetype } from './CombatRotationEngine.js';
import { AbilityBook, CombatStyle } from './AbilityBook.js';
import { CanonicalClock } from '../../utils/CanonicalClock.js';
const logger = createLogger('NpcAgent');

export type NpcBehavior = 'wander' | 'patrol' | 'stationary' | 'follow';

export interface NpcAgentConfig {
    behavior: NpcBehavior;
    wanderRadius?: number;       // Max tile distance from spawn to wander
    patrolPath?: Coord[];        // Explicit waypoints for patrol
    followTargetId?: string;     // Player username for 'follow' behavior
    ticksPerMove?: number;       // How many ticks to wait between moves (default 1 = RS standard)
    tacticalArchetype?: TacticalArchetype;
    combatStyle?: CombatStyle;
}

/**
 * NpcAgent
 * Autonomous movement controller for a single NPC entity.
 * Integrates with SimulationHarness.processTick() — one agent per NPC.
 */
export class NpcAgent {
    private npc: NPC;
    private config: NpcAgentConfig;
    private spawnCoord: Coord;
    private pathfinder: DirectionalPathfinder;
    private spatial: SpatialSovereigntyLimb;

    private currentPath: Coord[] = [];
    private patrolIndex = 0;
    private ticksSinceLastMove = 0;
    private isPathfinding = false;

    // Per-agent blacklist: tiles we already tried and failed to reach
    private blacklist = new Set<string>();

    // Hysteresis State
    private tacticalState: 'idle' | 'evading' = 'idle';
    private ticksInRetreat = 0;

    constructor(npc: NPC, config: NpcAgentConfig, pathfinder: DirectionalPathfinder, spatial: SpatialSovereigntyLimb) {
        this.npc = npc;
        this.config = config;
        this.pathfinder = pathfinder;
        this.spatial = spatial;
        this.spawnCoord = { x: npc.x, y: npc.y, plane: npc.plane };
    }

    /**
     * tick — Called every 600ms by SimulationHarness.
     * Returns true if the NPC moved this tick.
     */
    public async tick(state: GameState, field?: any): Promise<boolean> { // field: GhostSplatField | undefined
        // Throttle: some NPCs are slow-movers (e.g., 1 move every 2 ticks)
        const rate = this.config.ticksPerMove ?? 1;
        this.ticksSinceLastMove++;
        
        // --- TACTICAL EVALUATION ---
        if (field && this.config.tacticalArchetype && this.config.tacticalArchetype !== 'aggressive') {
            await this.evaluateTacticalPosition(field, state);
        }

        // --- COMBAT EVALUATION ---
        if (field && this.config.tacticalArchetype && this.tacticalState !== 'evading') {
            this.evaluateCombatRotation(field, state.tick || 0, state);
        }

        if (this.ticksSinceLastMove < rate) return false;
        this.ticksSinceLastMove = 0;

        // Step along existing path if one is active
        if (this.currentPath.length > 0) {
            const next = this.currentPath.shift()!;
            this.npc.x = next.x;
            this.npc.y = next.y;
            this.npc.plane = next.plane;
            this.npc.path = [...this.currentPath]; // Keep NPC model in sync

            // Phase 19: Broadcast movement to the Global Consensus (Multiplayer Globe)
            EventBus.getInstance().publish({
                type: 'direct_perception',
                source: 'NpcAgent',
                payload: {
                    entityId: `npc_${this.npc.id}`,
                    name: this.npc.name,
                    x: this.npc.x,
                    y: this.npc.y,
                    plane: this.npc.plane,
                    timestamp: CanonicalClock.getInstance().simulatedNow()
                }
            });

            return true;
        }

        // No active path — compute a new goal
        if (this.isPathfinding) return false;

        const goal = this.selectGoal(state);
        if (!goal) return false;

        const goalKey = `${goal.plane}_${goal.x}_${goal.y}`;
        if (this.blacklist.has(goalKey)) return false;

        this.isPathfinding = true;
        try {
            const from: Coord = { x: this.npc.x, y: this.npc.y, plane: this.npc.plane };
            const path = await this.pathfinder.findPath(from, goal, state);

            if (path.length <= 1) {
                // Path[0] is current tile — unreachable or already there
                this.blacklist.add(goalKey);
                // Clear blacklist occasionally so NPCs don't get permanently stuck
                if (this.blacklist.size > 20) this.blacklist.clear();
                return false;
            }

            // Remove current tile from head
            this.currentPath = path.slice(1);
            this.npc.path = [...this.currentPath];
            logger.debug({ npcId: this.npc.id, from, goal, steps: this.currentPath.length }, '[NpcAgent] Path issued.');
        } catch (err) {
            logger.error({ err, npcId: this.npc.id }, '[NpcAgent] Pathfind threw.');
        } finally {
            this.isPathfinding = false;
        }

        return false; // Will start moving next tick
    }

    /**
     * selectGoal — Returns the next movement target based on behavior mode.
     */
    private selectGoal(state: GameState): Coord | null {
        switch (this.config.behavior) {
            case 'wander':
                return this.pickWanderTile();

            case 'patrol':
                return this.advancePatrol();

            case 'follow': {
                if (!this.config.followTargetId) return null;
                const target = state.players.get(this.config.followTargetId);
                if (!target) return null;
                return { x: target.x, y: target.y, plane: target.plane };
            }

            case 'stationary':
            default:
                return null;
        }
    }

    /**
     * pickWanderTile — Picks a random walkable tile within wanderRadius of spawn.
     */
    private pickWanderTile(): Coord | null {
        const radius = this.config.wanderRadius ?? 5;
        const maxAttempts = 12;

        for (let i = 0; i < maxAttempts; i++) {
            const rng = CanonicalClock.getInstance().rng();
            const dx = rng.range(-radius, radius);
            const dy = rng.range(-radius, radius);
            const tx = this.spawnCoord.x + dx;
            const ty = this.spawnCoord.y + dy;
            const plane = this.spawnCoord.plane;

            // Must be walkable and not current position
            if (this.spatial.isWalkable(plane, tx, ty) &&
                !(tx === this.npc.x && ty === this.npc.y)) {
                return { x: tx, y: ty, plane };
            }
        }
        return null;
    }

    /**
     * advancePatrol — Steps through the configured patrol waypoints cyclically.
     */
    private advancePatrol(): Coord | null {
        const patrol = this.config.patrolPath;
        if (!patrol || patrol.length === 0) return null;

        const current = this.npc;
        const waypoint = patrol[this.patrolIndex];

        // Already at this waypoint — advance to next
        if (current.x === waypoint.x && current.y === waypoint.y) {
            this.patrolIndex = (this.patrolIndex + 1) % patrol.length;
            return patrol[this.patrolIndex];
        }

        return waypoint;
    }

    public getNpc(): NPC {
        return this.npc;
    }

    /**
     * evaluateTacticalPosition
     * Subscribes to Safespots telemetry. Allows advanced AI behaviors like kiting or fleeing 
     * based on avatar heat.
     */
    private async evaluateTacticalPosition(field: any, state: GameState): Promise<void> {
        // Evaluate heat relative to field PADDED_SIZE
        // PADDED_SIZE is 66, center is 33
        const PADDED_SIZE = 66; // duplicate strictly for typing ease without touching imports for now
        const centerOffset = Math.floor(PADDED_SIZE / 2);
        
        // We calculate heat based on distance. Wait, the PADDED_SIZE is always centered on the player currently!
        // The NPC is NOT at the center! We must determine NPC offset relative to Player offset!
        // The GhostSplat heatmap is centered on the player coordinate.
        // Wait, `field.heatmap` center is NOT the player if it's universal, BUT `GhostSplatEngine.project()` sets player as center?
        // Let's resolve the NPC coordinate onto the heatmap.
        // Or simply, `avatarHeat` contains exactly where the player is.
        // A far simpler heuristic for NPC: If `tacticalState === 'idle'`, and distance to player <= 3 (or whatever avatarHeat says), evade.
        
        // For Phase 6 proxy (without rebuilding the whole spatial grid logic in this method):
        // Flee if HP < 50% and cowardly
        if (this.config.tacticalArchetype === 'cowardly') {
            const currentHp = this.npc.combatStats?.currentHp || 0;
            const maxHp = this.npc.combatStats?.maxHp || 1;
            const isCowardTriggered = (currentHp / maxHp) < 0.5;

            // Hysteresis
            if (this.tacticalState === 'evading') {
                this.ticksInRetreat++;
                if (this.ticksInRetreat >= 3 && !isCowardTriggered) {
                    this.tacticalState = 'idle';
                    this.ticksInRetreat = 0;
                } else if (this.currentPath.length > 0) {
                    return; // Already retreating
                }
            }

            if (this.tacticalState === 'idle' && isCowardTriggered) {
                this.tacticalState = 'evading';
                this.ticksInRetreat = 0;
            }

            if (this.tacticalState === 'evading') {
                // Flee to farthest safespot
                if (field.safespots && field.safespots.length > 0) {
                    const bestSpot = field.safespots[0];
                    let maxDist = 0;
                    let furthestCoord: Coord | null = null;
                    const npcCoord = { x: this.npc.x, y: this.npc.y, plane: this.npc.plane };
                    const safes = field.safespots;
                    for (const safe of safes) {
                        const dist = Math.abs(safe.x - npcCoord.x) + Math.abs(safe.y - npcCoord.y); // Manhattan for simple evaluation
                        if (dist > maxDist) {
                            maxDist = dist;
                            furthestCoord = safe;
                        }
                    }

                    if (!furthestCoord) return;

                    try {
                        const escapePath = await this.pathfinder.findPath(npcCoord, furthestCoord, state);
                        if (escapePath && escapePath.length > 0) {
                            this.currentPath = escapePath;
                            this.tacticalState = 'evading';
                            this.ticksInRetreat = 0;
                        }
                    } catch (err) {
                        logger.warn({ id: this.npc.id }, 'Tactical pathing failed during evade attempt.');
                    }
                }
            }
        }
    }

    /**
     * evaluateCombatRotation
     */
    private evaluateCombatRotation(field: any, currentTick: number, state: GameState): void {
        const engine = CombatRotationEngine.getInstance();
        
        if (!this.npc.metadata) this.npc.metadata = {};
        if (this.npc.metadata.gcdEndTick === undefined) this.npc.metadata.gcdEndTick = 0;
        if (this.npc.metadata.channelEndTick === undefined) this.npc.metadata.channelEndTick = 0;
        if (this.npc.metadata.weaponDamage === undefined) this.npc.metadata.weaponDamage = 500; // NPC default damage scalar
        
        const style = this.config.combatStyle || 'melee';
        const maxRange = style === 'melee' ? 1 : 7;
        
        // NPCs resolve target from AvatarHeat (player threats)
        const target = engine.resolveTargetFromHeat(field, this.npc.coord, maxRange, false);
        
        if (!target) return; // No targets in range
        
        // Enrich target HP (assume player target for now)
        if (target.entityId === 'player_sovereign') {
            const playerState = state.players.get('Sovereign');
            if (playerState) {
                target.currentHp = playerState.currentHp ?? 1000;
            }
        }
        
        const ctx: CombatEvaluationContext = {
            adrenaline: this.npc.adrenaline || 0,
            cooldowns: this.npc.cooldowns || {},
            coord: this.npc.coord,
            currentTick,
            gcdEndTick: this.npc.metadata.gcdEndTick,
            channelEndTick: this.npc.metadata.channelEndTick,
            combatStyle: style,
            archetype: this.config.tacticalArchetype || 'aggressive',
            state: {
                adrenaline: this.npc.adrenaline || 0,
                hp: this.npc.combatStats?.currentHp,
                maxHp: this.npc.combatStats?.maxHp,
                bloodlustStacks: this.npc.metadata.bloodlustStacks || 0,
                animaCharged: this.npc.metadata.animaCharged || false,
                lastCombatTick: this.npc.metadata.lastCombatTick || 0,
                cooldowns: this.npc.cooldowns || {},
            },
            availableAbilities: AbilityBook.getInstance().getByStyle(style),
        };
        
        const intent = engine.evaluateRotation(ctx, target);
        
        if (intent) {
            // Apply lock to NpcAgent
            this.npc.metadata.gcdEndTick = currentTick + 3; 
            this.npc.intent = intent as any;
        }
    }
}
