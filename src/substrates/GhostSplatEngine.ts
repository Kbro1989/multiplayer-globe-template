import { GameState, Coord, NPC, ChaosPhase, YaoState } from '../core/models.js';
import { SovereignAvatarEntity } from '../core/SovereignAvatar.js';
import { EntityGhost } from '../core/EntityGhost.js';
import { PlayerAgent } from '../engines/gameplay/PlayerAgent.js';
import type { TacticalArchetype } from '../engines/gameplay/CombatRotationEngine.js';
import { PADDED_SIZE, SpatialSovereigntyLimb } from '../limbs/spatial/SpatialSovereigntyLimb.js';
import { NecromancerBrain, type NTXBuffer, type SpatialGaussian } from '../engines/core/NecromancerBrain.js';
import { createLogger } from '../utils/logger.js';
import { HexagramManager } from '../routing/HexagramManager.js';
import { EpistemicTransitionKernel, PredictionRegistry } from '../engines/core/EpistemicTransitionKernel.js';
import { performance } from 'perf_hooks';
import { SwitchboardLimb } from '../monitor/SwitchboardLimb.js';
import { SpatialMetricsRegistry } from '../limbs/spatial/SpatialMetricsRegistry.js';
import { CanonicalClock } from '../utils/CanonicalClock.js';

const logger = createLogger('GhostSplatEngine');

export interface GhostSplatField {
    tickDepth: number;
    heatmap: Uint8Array;
    entityHeat?: Uint8Array;
    avatarHeat?: Uint8Array;
    projections: Map<string, EntityGhost>;
    safespots: Coord[];
    gaussians?: Float32Array; // Packed [N, 13]: pos(3), cov(6), color(3), opacity(1)
}

export interface ThreatModulation {
    intent: TacticalArchetype;
    multiplier: number; // Range scaling
    safespotWeight: number; // How much to value safespots
    targetFocus: number; // How much to ignore non-primary NPCs
}

/**
 * GhostSplatEngine
 * 
 * Predictive spatial intelligence layer. Forecasts future world states (tick N+1 to N+3)
 * by layering temporal projections over the authoritative 66x66 NXT world model.
 */
export class GhostSplatEngine {
    private static instance: GhostSplatEngine;
    private readonly MAX_COMPUTE_MS = 50;
    private latestField: GhostSplatField | null = null;
    private spatialRegistry: SpatialMetricsRegistry;

    private persistentHeat: Uint8Array = new Uint8Array(PADDED_SIZE * PADDED_SIZE);
    private throttleMs: number = 0;

    private constructor() {
        this.spatialRegistry = SpatialMetricsRegistry.getInstance();
    }

    public static getInstance(): GhostSplatEngine {
        if (!GhostSplatEngine.instance) {
            GhostSplatEngine.instance = new GhostSplatEngine();
        }
        return GhostSplatEngine.instance;
    }

    public purgePersistentHeat(): void {
        logger.info('[GhostSplatEngine] Purging persistent red-splat heat memory.');
        this.persistentHeat.fill(0);
    }

    public setThrottle(ms: number): void {
        logger.info({ throttleMs: ms }, '[GhostSplatEngine] Setting predictive compute throttle.');
        this.throttleMs = ms;
    }

    /**
     * project - Generates a GhostSplatField for a given number of ticks into the future.
     */
    public project(state: GameState, tickDepth: number = 2, playerAgent?: PlayerAgent): GhostSplatField | null {
        const start = performance.now();
        
        try {
            const field: GhostSplatField = {
                tickDepth,
                heatmap: new Uint8Array(PADDED_SIZE * PADDED_SIZE),
                entityHeat: new Uint8Array(PADDED_SIZE * PADDED_SIZE),
                avatarHeat: new Uint8Array(PADDED_SIZE * PADDED_SIZE),
                projections: new Map(),
                safespots: []
            };

            // Calculate entity projections
            this.projectNpcMovement(state, field);
            this.projectPlayer(playerAgent, field);
            this.calculateThreatHeatmap(field, state, playerAgent); // Pass state and playerAgent for modulation
            this.identifySafespots(playerAgent, field);

            // Weight entity confidence by historical prediction accuracy
            const registry = PredictionRegistry.getInstance();
            const limbAccuracy = registry.getLimbAccuracy('GhostSplatEngine', 10);
            field.projections.forEach(ghost => {
                ghost.confidence *= limbAccuracy; // downweight if we've been wrong
            });

            this.generateGaussianTensor(field);

            const duration = performance.now() - start;
            if (duration > this.MAX_COMPUTE_MS) {
                logger.warn({ duration, limit: this.MAX_COMPUTE_MS }, 
                    'Ghost Splat Engine threshold exceeded - Predictive logic too heavy'
                );
            }

            this.latestField = field;

            // ── Kernel Integration: Feed spatial volatility into predictive controller ──
            this.feedKernelSpatialSignal(field, duration);

            // Broadcast to Switchboard if connected
            const switchboard = SwitchboardLimb.getInstance();
            if (switchboard && typeof (switchboard as any).broadcastGhostSplat === 'function') {
                switchboard.broadcastGhostSplat(this.serializeField(field, state));
            }

            return field;
        } catch (err) {
            logger.error({ err }, 'Failed to compute predictive Ghost Splat Field');
            return null;
        }
    }

    private serializeField(field: GhostSplatField, state?: GameState): any {
        return {
            tickDepth: field.tickDepth,
            heatmap: Array.from(field.heatmap),
            projections: Array.from(field.projections.entries()).map(([id, ghost]) => {
                // Enrich projections with cache-derived metrics
                let metrics: any = null;
                if (id.startsWith('npc_')) {
                    const npcId = parseInt(id.replace('npc_', ''), 10);
                    metrics = this.spatialRegistry.getMetrics(npcId);
                }
                return [id, {
                    ...ghost,
                    metrics: metrics ? {
                        radius: metrics.tileScale.radius,
                        height: metrics.tileScale.height,
                        volume: metrics.tileScale.volume
                    } : null
                }];
            }),
            gaussians: field.gaussians ? Array.from(field.gaussians) : null,
            safespots: field.safespots,
            center: (() => {
                if (!state) return { x: 0, y: 0, plane: 0 };
                const firstPlayer = state.players.values().next().value;
                return firstPlayer
                    ? { x: firstPlayer.x, y: firstPlayer.y, plane: firstPlayer.plane }
                    : { x: 0, y: 0, plane: 0 };
            })()
        };
    }

    public getLatestField(): GhostSplatField | null {
        return this.latestField;
    }

    public healthCheck(): { online: boolean; details: string; status: 'ONLINE' | 'DEGRADED' | 'OFFLINE' } {
        return {
            online: true,
            status: 'ONLINE',
            details: `GhostSplatEngine active. Max compute budget: ${this.MAX_COMPUTE_MS}ms.`
        };
    }

    private projectNpcMovement(state: GameState, field: GhostSplatField): void {
        // Iterate the authoritative npcMap registry (always populated by SimulationHarness).
        // npcSpatialIndex is a secondary index that isn't reliably maintained.
        for (const [npcId, npc] of state.npcMap) {
            const source = (npc.path && npc.path.length > 0) ? 'path_queue'
                : (npc.interactionState === 'MOVING' && npc.metadata?.targetCoord) ? 'extrapolation'
                : 'offline_fallback';
            const projectedCoord = this.extrapolate(npc, field.tickDepth);
            
            const ghost: EntityGhost = {
                entityId: `npc_${npc.id}`,
                projectedCoord,
                ticksAhead: field.tickDepth,
                confidence: source === 'path_queue' ? 1.0 : source === 'extrapolation' ? 0.8 : 0.5,
                originType: 'rsmv',
                source
            };
            
            field.projections.set(ghost.entityId, ghost);
            
            // Log prediction
            const clock = CanonicalClock.getInstance();
            const currentTick = clock.simulatedNow();
            const metrics = this.spatialRegistry.getMetrics(npc.id);
            const contextStr = JSON.stringify({
                name: npc.name || `NPC ${npc.id}`,
                radius: metrics?.tileScale?.radius || 1,
                source: source,
                pathLength: npc.path?.length || 0,
                targetCoord: npc.metadata?.targetCoord,
                tickDepth: field.tickDepth
            });
            
            PredictionRegistry.getInstance().logSpatialPrediction({
                tick: currentTick + field.tickDepth,
                entityId: ghost.entityId,
                predictedCoord: projectedCoord,
                confidence: ghost.confidence,
                context: contextStr
            });
            
            // Splat the projection onto the heatmap
            if (projectedCoord) {
                // Map world coords to inner 64x64 grid (indices 1-64), padding at 0 and 65
                const INNER_SIZE = 64;
                const PADDING = 1;

                // Euclidean modulo: handles negative world coords correctly
                const innerX = ((projectedCoord.x % INNER_SIZE) + INNER_SIZE) % INNER_SIZE;
                const innerY = ((projectedCoord.y % INNER_SIZE) + INNER_SIZE) % INNER_SIZE;

                // Offset by padding to place in 1-64 range
                const localX = innerX + PADDING;
                const localY = innerY + PADDING;

                // Only splat on inner tiles, never on sentinel padding
                if (localX >= PADDING && localX < PADDING + INNER_SIZE && 
                    localY >= PADDING && localY < PADDING + INNER_SIZE) {
                    const idx = localY * PADDED_SIZE + localX;
                    field.heatmap[idx] += 1; // Increase combined threat weight
                    if (field.entityHeat) field.entityHeat[idx] += 1; // Factional weighting
                }
            }
        }
    }

    private projectPlayer(playerAgent: PlayerAgent | undefined, field: GhostSplatField): void {
        if (!playerAgent) return;
        
        const ghosts = playerAgent.projectSelf(field.tickDepth);
        for (const ghost of ghosts) {
            field.projections.set(ghost.entityId, ghost);

            // Splat player's ghost onto the heatmap as self-awareness
            const localX = ghost.projectedCoord.x % PADDED_SIZE;
            const localY = ghost.projectedCoord.y % PADDED_SIZE;
            
            if (localX >= 0 && localX < PADDED_SIZE && localY >= 0 && localY < PADDED_SIZE) {
                const idx = localY * PADDED_SIZE + localX;
                field.heatmap[idx] += 1;
                if (field.avatarHeat) field.avatarHeat[idx] += 1; // Factional weighting
            }
        }
    }

    private extrapolate(npc: NPC, ticksAhead: number): Coord {
        // High-Fidelity Projection: Consume actual A* path geometry if available
        if (npc.path && npc.path.length > 0) {
            const index = Math.min(ticksAhead - 1, npc.path.length - 1);
            if (index >= 0) {
                return npc.path[index];
            }
        }

        // Visceral Fallback: Linear Extrapolation for dummy/legacy endpoints
        if (npc.interactionState === 'MOVING' && npc.metadata?.targetCoord) {
            return {
                x: npc.metadata.targetCoord.x,
                y: npc.metadata.targetCoord.y,
                plane: npc.metadata.targetCoord.plane ?? npc.coord.plane
            };
        }
        return npc.coord;
    }

    private getThreatModulation(playerAgent?: PlayerAgent): ThreatModulation {
        const intent = playerAgent?.getCombatIntent() || 'aggressive';
        switch (intent) {
            case 'cowardly': return { intent, multiplier: 1.5, safespotWeight: 2.0, targetFocus: 0.3 };
            case 'aggressive': return { intent, multiplier: 0.7, safespotWeight: 0.5, targetFocus: 1.5 };
            case 'predator': return { intent, multiplier: 0.4, safespotWeight: 0.1, targetFocus: 2.0 };
            case 'methodical': return { intent, multiplier: 1.0, safespotWeight: 1.0, targetFocus: 1.0 };
            default: return { intent, multiplier: 1.0, safespotWeight: 1.0, targetFocus: 1.0 };
        }
    }

    private calculateThreatHeatmap(field: GhostSplatField, state?: GameState, playerAgent?: PlayerAgent): void {
        const tempHeatmap = new Uint8Array(PADDED_SIZE * PADDED_SIZE);
        const mod = this.getThreatModulation(playerAgent);
        
        field.projections.forEach((ghost, entityId) => {
            if (entityId.startsWith('player_')) return;

            const INNER_SIZE = 64;
            const PADDING = 1;

            const innerX = ((ghost.projectedCoord.x % INNER_SIZE) + INNER_SIZE) % INNER_SIZE;
            const innerY = ((ghost.projectedCoord.y % INNER_SIZE) + INNER_SIZE) % INNER_SIZE;
            const localX = innerX + PADDING;
            const localY = innerY + PADDING;
            
            // ── Cache-Derived Attack Range ─────────────────────────────────────
            // Pull attack range from live NPC state (populated by CacheForensicsLimb
            // entity records). Falls back to 2 only when metadata is absent.
            let aggroRange = 2;
            if (state) {
                const npcIdStr = entityId.replace('npc_', '');
                const npcId = parseInt(npcIdStr, 10);
                if (!isNaN(npcId)) {
                    const npc = state.npcMap.get(npcId);
                    const cacheRange = (npc as any)?.combatStats?.attackRange;
                    if (typeof cacheRange === 'number' && cacheRange > 0) {
                        aggroRange = cacheRange;
                    } else {
                        logger.debug({ entityId }, '[GhostSplat] attackRange not in cache — using default 2');
                    }
                }
            }

            // --- COGNITIVE ADAPTATION (Phase 45) ---
            try {
                const hexagram = HexagramManager.getInstance().getInterpretation();
                const variance = hexagram.aesthetics.thermalVariance || 0.5;
                // Scale base range by variance: variance 0.0 (Quiet) -> 1.0x, variance 1.0 (Agitated) -> 1.5x
                aggroRange = Math.max(1, Math.round(aggroRange * (1 + variance * 0.5)));
            } catch (e) {
                // Fallback to base aggroRange
            }

            // Apply combat intent modulation
            aggroRange = Math.max(1, Math.round(aggroRange * mod.multiplier));

            // Target focus check: ignore minor NPCs if focus is high
            const primaryTargetId = (playerAgent as any)?.avatar?.metadata?.currentTargetId;
            if (mod.targetFocus > 1.0 && primaryTargetId && entityId !== primaryTargetId && aggroRange > 2) {
                return; // Skip this NPC in heatmap
            }

            for (let dx = -aggroRange; dx <= aggroRange; dx++) {
                for (let dy = -aggroRange; dy <= aggroRange; dy++) {
                    const nx = localX + dx;
                    const ny = localY + dy;
                    if (nx >= PADDING && nx < PADDING + INNER_SIZE && ny >= PADDING && ny < PADDING + INNER_SIZE) {
                        tempHeatmap[ny * PADDED_SIZE + nx] += 1;
                    }
                }
            }
        });

        // Merge back into original heatmap.
        for (let i = 0; i < field.heatmap.length; i++) {
            field.heatmap[i] += tempHeatmap[i];
        }
    }

    private identifySafespots(playerAgent: PlayerAgent | undefined, field: GhostSplatField): void {
        const startX = Math.floor(PADDED_SIZE / 2) - 10;
        const startY = Math.floor(PADDED_SIZE / 2) - 10;

        for (let dx = 0; dx < 20; dx++) {
            for (let dy = 0; dy < 20; dy++) {
                const lx = startX + dx;
                const ly = startY + dy;
                if (lx >= 0 && lx < PADDED_SIZE && ly >= 0 && ly < PADDED_SIZE) {
                    const idx = ly * PADDED_SIZE + lx;
                    if (field.heatmap[idx] === 0 && playerAgent) {
                        // World translation:
                        // Find the rx, ry offset from player coord vs PADDED_SIZE origin
                        const playerGhost = playerAgent.projectOffline(); // Provides safe fallback
                        const worldX = playerGhost.projectedCoord.x + (lx - (Math.floor(PADDED_SIZE / 2)));
                        const worldY = playerGhost.projectedCoord.y + (ly - (Math.floor(PADDED_SIZE / 2)));
                        field.safespots.push({ x: worldX, y: worldY, plane: playerGhost.projectedCoord.plane });
                    }
                }
            }
        }
    }

    private generateGaussianTensor(field: GhostSplatField): void {
        const entityCount = field.projections.size;
        const tileCount = PADDED_SIZE * PADDED_SIZE;
        const totalCount = entityCount + tileCount;

        // ── Phase-Aware Compute Scaling ──
        // During DEGRADING, the kernel restricts resources. Scale gaussian
        // resolution by the phase multiplier to shed load gracefully.
        let effectiveCount = totalCount;
        let downscaleFactor = 1.0;
        try {
            const kernel = EpistemicTransitionKernel.getInstance();
            const multiplier = kernel.getPhaseGateMultiplier();
            downscaleFactor = multiplier;
            if (multiplier < 1.0) {
                effectiveCount = Math.max(1, Math.floor(totalCount * multiplier));
                if (effectiveCount < totalCount) {
                    logger.debug({ original: totalCount, effective: effectiveCount, phase: kernel.getCurrentPhase() },
                        'Gaussian tensor downscaled by kernel phase gate');
                }
            }
        } catch {
            // Kernel not yet initialized
        }

        const tensor = new Float32Array(effectiveCount * 13);
        let offset = 0;
        let processed = 0;

        // ── 1. NTX 66x66 Environment Splats (The Echo Buffer) ──
        // We only generate the background if we have enough compute budget
        if (effectiveCount > entityCount) {
            const center = this.getCenterCoord(field);
            const spatial = SpatialSovereigntyLimb.getInstance();
            const brain = NecromancerBrain.getInstance();
            
            const startX = center.x - Math.floor(PADDED_SIZE / 2);
            const startY = center.y - Math.floor(PADDED_SIZE / 2);
            const plane = center.plane;

            // Extract NTXBuffer
            const ntxBuffer: NTXBuffer = new Array(PADDED_SIZE);
            const baseSH = new Float32Array([
                0.5, 0.5, 0.5, 
                0.5, 0.5, 0.5, 
                0.5, 0.5, 0.5
            ]);

            for (let x = 0; x < PADDED_SIZE; x++) {
                ntxBuffer[x] = new Array(PADDED_SIZE);
                for (let y = 0; y < PADDED_SIZE; y++) {
                    const wx = startX + x;
                    const wy = startY + y;
                    const height = spatial.getAltitude(plane, wx, wy) / 32;
                    const flags = spatial.getLegacyMask(plane, wx, wy);
                    ntxBuffer[x][y] = {
                        mu: [wx, height, wy],
                        sigma: [[0.5, 0, 0], [0, 0.1, 0], [0, 0, 0.5]],
                        opacity: 1.0,
                        sh_coeffs: baseSH,
                        tile_flags: flags
                    };
                }
            }

            // Apply predictive lighting (Spherical Harmonics)
            const litBuffer = brain.predictLighting(ntxBuffer, field.tickDepth);

            // Serialize into tensor (skipping based on downscale to maintain spread)
            const skipStep = Math.max(1, Math.floor(1 / downscaleFactor));
            
            for (let x = 0; x < PADDED_SIZE; x += skipStep) {
                for (let y = 0; y < PADDED_SIZE; y += skipStep) {
                    if (processed >= effectiveCount - entityCount) break;
                    
                    const g = litBuffer[x][y];
                    if (!g) continue;

                    // Position (relative to center)
                    tensor[offset + 0] = g.mu[0] - center.x;
                    tensor[offset + 1] = g.mu[1]; // height
                    tensor[offset + 2] = g.mu[2] - center.y;

                    // Covariance (Diag approx)
                    tensor[offset + 3] = 0.5;
                    tensor[offset + 4] = 0;
                    tensor[offset + 5] = 0;
                    tensor[offset + 6] = 0.1;
                    tensor[offset + 7] = 0;
                    tensor[offset + 8] = 0.5;

                    // Color (extract SH degree 0)
                    tensor[offset + 9]  = g.sh_coeffs[0];
                    tensor[offset + 10] = g.sh_coeffs[1];
                    tensor[offset + 11] = g.sh_coeffs[2];

                    // Opacity
                    tensor[offset + 12] = g.opacity;

                    offset += 13;
                    processed++;
                }
            }
        }

        // ── 2. Dynamic Entity Splats ──
        field.projections.forEach((ghost, id) => {
            if (processed >= effectiveCount) return;
            processed++;

            // 1. Position (Relative to local 66x66 center)
            const center = this.getCenterCoord(field);
            const lx = ghost.projectedCoord.x - center.x;
            const ly = ghost.projectedCoord.y - center.y;
            const lz = (ghost.projectedCoord.plane || 0) * 2; // Vertical separation

            tensor[offset + 0] = lx;
            tensor[offset + 1] = lz; // Y-up convention for many renderers
            tensor[offset + 2] = ly;

            // 2. Covariance (Approximated as a sphere/ellipsoid)
            // [s11, s12, s13, s22, s23, s33]
            const isNpc = id.startsWith('npc_');
            let scale = isNpc ? 0.8 : 0.5; // Fallback default

            if (isNpc) {
                const npcId = parseInt(id.replace('npc_', ''), 10);
                if (!isNaN(npcId)) {
                    const metrics = this.spatialRegistry.getMetrics(npcId);
                    if (metrics) {
                        // Cache-derived physical presence shapes the Gaussian
                        scale = metrics.tileScale.radius;
                        
                        // Optional: Shape the ellipsoid based on actual proportions
                        // If height > radius*2, stretch vertically (flying/crawling entities)
                        const heightScale = metrics.tileScale.height / (metrics.tileScale.radius * 2);
                        if (heightScale > 1.5) {
                            // Tall entity — stretch Y (s33 in Y-up convention)
                            tensor[offset + 8] = scale * Math.min(heightScale, 3.0); // Cap at 3x
                        }
                    }
                }
            }

            tensor[offset + 3] = scale; // s11 (X)
            tensor[offset + 4] = 0;     // s12
            tensor[offset + 5] = 0;     // s13
            tensor[offset + 6] = scale; // s22 (Z, horizontal)
            tensor[offset + 7] = 0;     // s23
            tensor[offset + 8] = isNpc && tensor[offset + 8] > scale ? tensor[offset + 8] : scale; // s33 (Y, vertical)

            // 3. Color (SH Level 0 - RGB)
            if (ghost.sh_coeffs && ghost.sh_coeffs.length >= 3) {
                tensor[offset + 9]  = ghost.sh_coeffs[0];
                tensor[offset + 10] = ghost.sh_coeffs[1];
                tensor[offset + 11] = ghost.sh_coeffs[2];
            } else if (isNpc) {
                // Threat color: Orange to Red
                tensor[offset + 9] = 1.0;  // R
                tensor[offset + 10] = 0.4; // G
                tensor[offset + 11] = 0.0; // B
            } else {
                // Player color (or default): Cyan
                tensor[offset + 9] = 0.0;  // R
                tensor[offset + 10] = 1.0; // G
                tensor[offset + 11] = 1.0; // B
            }

            // 4. Opacity & Origin Status
            tensor[offset + 12] = ghost.confidence;
            
            // Note: originType differentiation (rsmv vs web_ui) could be stored 
            // in an additional gaussian property if rendering logic needs it.
            
            offset += 13;
        });

        field.gaussians = tensor;
    }

    private getCenterCoord(field: GhostSplatField): Coord {
        const playerGhost = field.projections.get('player_sovereign');
        if (playerGhost) return playerGhost.projectedCoord;
        
        // Fallback if no player
        if (field.projections.size > 0) {
            const firstProjection = field.projections.values().next().value;
            if (firstProjection) {
                return firstProjection.projectedCoord;
            }
        }
        return { x: 3200, y: 3200, plane: 0 };
    }

    // ══════════════════════════════════════════════════════════════
    //  KERNEL INTEGRATION: Spatial Volatility Signal Feed
    // ══════════════════════════════════════════════════════════════

    /**
     * feedKernelSpatialSignal — Converts the GhostSplat heatmap into a
     * causal confidence value for the EpistemicTransitionKernel.
     *
     * High threat density + low prediction confidence = high spatial volatility.
     * This signal feeds into the kernel's EMA, allowing the phase classifier
     * to distinguish between genuine spatial chaos and background noise.
     */
    private feedKernelSpatialSignal(field: GhostSplatField, computeMs: number): void {
        try {
            const kernel = EpistemicTransitionKernel.getInstance();
            const hexManager = HexagramManager.getInstance();
            const currentYao = hexManager.getYaoState();

            // 1. Spatial threat density: ratio of hot tiles to total tiles
            let hotTiles = 0;
            for (let i = 0; i < field.heatmap.length; i++) {
                if (field.heatmap[i] > 0) hotTiles++;
            }
            const threatDensity = hotTiles / (PADDED_SIZE * PADDED_SIZE);

            // 2. Average projection confidence
            let totalConfidence = 0;
            let projCount = 0;
            field.projections.forEach(ghost => {
                totalConfidence += ghost.confidence;
                projCount++;
            });
            const avgConfidence = projCount > 0 ? totalConfidence / projCount : 1.0;

            // 3. Compute budget pressure: how close to the limit
            const computePressure = Math.min(1.0, computeMs / this.MAX_COMPUTE_MS);

            // 4. Synthesize causal confidence:
            //    High confidence + low threat + low compute pressure = high causal confidence (stable)
            //    Low confidence + high threat + high compute pressure = low causal confidence (volatile)
            const causalConfidence = Math.max(0.1, avgConfidence * (1 - threatDensity * 0.5) * (1 - computePressure * 0.3));

            // 5. Feed into kernel observation loop
            kernel.observeTransition(currentYao, causalConfidence);

            logger.debug({
                threatDensity: threatDensity.toFixed(4),
                avgConfidence: avgConfidence.toFixed(3),
                computePressure: computePressure.toFixed(3),
                causalConfidence: causalConfidence.toFixed(3),
                kernelPhase: kernel.getCurrentPhase()
            }, '🔮 GhostSplat → Kernel: Spatial volatility signal emitted.');

        } catch {
            // Kernel or HexagramManager not yet initialized — silently skip
        }
    }
}
