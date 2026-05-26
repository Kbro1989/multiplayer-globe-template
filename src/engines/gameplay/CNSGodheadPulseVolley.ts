import { getLastIOLatencyMs } from '../../utils/RSMVBridge.js';
import { EventBus } from '../../events/EventBus.js';
import { createLogger } from '../../utils/logger.js';
import { CanonicalClock } from '../../utils/CanonicalClock.js';
import { performance } from 'perf_hooks';
import { TernaryRouter } from '../../routing/TernaryRouter.js';
import { SubstrateState, YaoState, GameState, SovereignAvatar, LearningFidelity, type RoutingSnapshot, type WorldDelta, type CausalEvidence, type EventOutcome, type EventSource, type TickEvent, type TileLock, TruthClass, ChaosPhase } from '../../core/models.js';
import { RSMVController } from '../../vision/RSMVController.js';
import { CacheForensicsLimb } from '../../limbs/spatial/CacheForensicsLimb.js';
import { SwitchboardLimb, type AdminCommand } from '../../monitor/SwitchboardLimb.js';
import { SpatialVisionEngine } from '../SpatialVisionEngine.js';
import { WorldGroundingLimb } from '../../limbs/world_grounding/WorldGroundingLimb.js';
import { GameplaySovereigntyLimb } from '../../limbs/spatial/GameplaySovereigntyLimb.js';
import { GlobeStateLimb } from '../../limbs/spatial/GlobeStateLimb.js';
import { GameplayProjectionLimb } from '../../limbs/spatial/GameplayProjectionLimb.js';
import { GameplayModule } from './MinigameInterfaces.js';
import { TransientObserver } from '../../vision/TransientObserver.js';
import { ChromanumberEngine } from '../ChromanumberEngine.js';
import { SubstrateResolver } from './SubstrateResolver.js';
import { GlobeReconciliationKernel } from '../../routing/GlobeReconciliationKernel.js';
import { NodeTester } from '../../monitor/NodeTester.js';
import { CNSCausalityLedger } from '../core/CNSCausalityLedger.js';
import { CausalPatternExtractor } from '../core/CausalPatternExtractor.js';
import { EpistemicTransitionKernel } from '../core/EpistemicTransitionKernel.js';
import { InvariantCompiler } from '../core/InvariantCompiler.js';
import { TruthReconciler } from '../core/TruthReconciler.js';
import { Renderer } from '../../ui/Renderer.js';
import { SovereignAvatarEntity } from '../../core/SovereignAvatar.js';
import { GhostSplatEngine } from '../../substrates/GhostSplatEngine.js';
import { PlayerAgent } from './PlayerAgent.js';
import crypto from 'crypto';
import { WaitDecisionMaker } from '../core/WaitDecisionMaker.js';
import { HexagramManager } from '../../routing/HexagramManager.js';
import { TransitionPrediction } from '../../core/models.js';
import type { TransitionalVector } from '../core/WaitDecisionMaker.js';

const logger = createLogger('CNSGodheadPulseVolley');

interface VolleyBatch {
    timestamp: number;
    commands: AdminCommand[];
}

type DeferredOp = () => Promise<void> | void;

interface QueueBudget {
    maxMs: number;              // hard time cap for queue execution
    maxOps?: number;            // optional safety cap per tick
    label?: string;             // debug tagging
}

interface QueueResult {
    executed: number;
    skipped: number;
    durationMs: number;
    budgetExceeded: boolean;
}

export type QueueTier = "CRITICAL" | "NORMAL" | "VISUAL_ONLY";

interface PendingCommand {
    id: string;
    action: any; // We'll simplify Action typing for now since it wasn't provided fully
    predictedOutcome: TransitionPrediction;
    transitionalVector: TransitionalVector;
    commitDeadline: number;
    state: 'PENDING' | 'COMMITTED' | 'CANCELLED';
}

/**
 * CNSGodheadPulseVolley
 * The deterministic execution kernel for POG2 Sovereign.
 * Implements Phase 31 Authoritative Substrate Runtime (Deterministic, Graded, Verified).
 */
export class CNSGodheadPulseVolley {
    private static instance: CNSGodheadPulseVolley | undefined;
    private readonly TICK_INTERVAL = 300; // 300ms Player Reflex Pulse
    private readonly BUDGET_MS = 150; // max budget for simulation

    private pendingCommands: Map<string, PendingCommand> = new Map();
    private waitDecisionMaker: WaitDecisionMaker;
    private lastAuditScore: number = 1.0; // Perceptual grounding persistence
    private lastTickStart: number = 0;
    private readonly GAME_TICK_INTERVAL = 600; // 600ms World Pulse

    // Dependencies resolved lazily via resolve() to avoid boot-order violations.
    private switchboard?: SwitchboardLimb;
    private grounding?: WorldGroundingLimb;
    private vision?: SpatialVisionEngine;
    private gameplay?: GameplaySovereigntyLimb;
    private rsmv?: RSMVController;
    private forensics?: CacheForensicsLimb;
    private router: TernaryRouter;
    private nodeTester?: NodeTester;
    private renderer?: Renderer;
    private ghostSplat?: GhostSplatEngine;
    private globe?: GlobeStateLimb;
    private observer?: TransientObserver;
    private readonly ledger = CNSCausalityLedger.getInstance();
    private pulseStartTime: number = 0;
    private readonly PULSE_DEADLINE_MS = 300;

    private currentTickQueues: Record<QueueTier, DeferredOp[]> = {
        CRITICAL: [],
        NORMAL: [],
        VISUAL_ONLY: []
    };
    private nextTickQueues: Record<QueueTier, DeferredOp[]> = {
        CRITICAL: [],
        NORMAL: [],
        VISUAL_ONLY: []
    };
    private routingSnapshot?: RoutingSnapshot;

    public getRoutingSnapshot(): RoutingSnapshot | undefined {
        return this.routingSnapshot;
    }

    public enqueueNow(op: DeferredOp, tier: QueueTier = "NORMAL"): void {
        this.currentTickQueues[tier].push(op);
    }

    public enqueueNextTick(op: DeferredOp, tier: QueueTier = "NORMAL"): void {
        this.nextTickQueues[tier].push(op);
    }

    /**
     * resolve - Lazy dependency resolution.
     * Prevents accessing substrates before they are configured by OrchestrateEngine.
     */
    private resolve(): void {
        if (!this.switchboard) this.switchboard = SwitchboardLimb.getInstance();
        if (!this.grounding) this.grounding = WorldGroundingLimb.getInstance();
        if (!this.vision) this.vision = SpatialVisionEngine.getInstance();
        if (!this.gameplay) this.gameplay = GameplaySovereigntyLimb.getInstance();
        if (!this.rsmv) this.rsmv = RSMVController.getInstance();
        if (!this.forensics) this.forensics = CacheForensicsLimb.getInstance();
        if (!this.ghostSplat) this.ghostSplat = GhostSplatEngine.getInstance();
        if (!this.globe) this.globe = GlobeStateLimb.getInstance() || (this.gameplay as any)?.globe; // Usually initialized in NeurologicalMap
        if (!this.observer) this.observer = TransientObserver.getInstance();
    }

    private static readonly PRIORITY: Record<string, number> = {
        ADMIN: 0,
        SYSTEM: 1,
        AI: 2,
        WORLD_SCRIPT: 3,
        USER: 4,
        POG2: 5,
        NETWORK: 6
    };

    private substrateState: SubstrateState = SubstrateState.OFFLINE;
    private tickCount = 0;
    private isStarted = false;

    private constructor() {
        if (CNSGodheadPulseVolley.instance) {
            throw new Error('Singleton violation: use CNSGodheadPulseVolley.getInstance()');
        }
        // Router will be injected by OrchestrateEngine to ensure shared context.
        // It's initialized with a dummy config first to satisfy types.
        this.router = new TernaryRouter({} as any);
        this.waitDecisionMaker = WaitDecisionMaker.getInstance();
    }

    public static getInstance(): CNSGodheadPulseVolley {
        if (!this.instance) {
            this.instance = new CNSGodheadPulseVolley();
        }
        return this.instance;
    }

    public static resetInstance(): void {
        if (process.env.NODE_ENV === 'production') {
            throw new Error('resetInstance is forbidden in production');
        }
        this.instance = undefined;
    }

    public setRouter(router: TernaryRouter) {
        this.router = router;
    }

    public setNodeTester(nodeTester: NodeTester) {
        this.nodeTester = nodeTester;
    }

    public setRenderer(renderer: Renderer) {
        this.renderer = renderer;
    }

    public getRenderer(): Renderer | undefined {
        return this.renderer;
    }

    public getAvatar(): SovereignAvatar | undefined {
        this.resolve();
        return this.gameplay?.avatar;
    }

    /**
     * startLoop - Deterministic Heartbeat (Hardened Recursive).
     * Implements self-correcting drift logic inspired by RSC Evolution alarms.
     */
    public startLoop(): void {
        CanonicalClock.assertBootstrapped();
        if (this.isStarted) {
            logger.warn('CNS Godhead Pulse already active. Ignition aborted.');
            return;
        }

        this.isStarted = true;
        logger.info('CNS Godhead Pulse (Hardened Heartbeat) Started. Player Tick: 300ms | Game Tick: 600ms');

        // Phase 112: Inject deterministic execution boundary into the global EventBus
        EventBus.getInstance().setQueueHandler((op) => {
            this.enqueueNextTick(async () => op());
        });

        // Phase 112: Register pulse with CanonicalClock
        CanonicalClock.getInstance().registerPulse({
            domain: 'INFERENCE',
            callback: (tick: number) => this.tick(),
            priority: 0, // highest
            name: 'CNSGodheadPulseVolley'
        });

        // POG2 Thinking Sub-loop (Async User-behind-Player)
        this.startPog2ThinkingLoop();
    }

    private async startPog2ThinkingLoop(): Promise<void> {
        // Runs entirely independently of the deterministic tick
        while (this.isStarted) {
            try {
                this.resolve();
                if (this.gameplay?.globalState && this.gameplay.avatar) {
                    // This mirrors "user looking at screen, then clicking"
                    const harness = (this.gameplay as any).harness;
                    if (harness && harness.syncGodhead) {
                        await harness.syncGodhead(this.gameplay.globalState, this.gameplay.avatar);
                    }
                }
            } catch (err) {
                logger.error({ err }, 'POG2 Async Thinking Loop Error');
            }
            // Think every 5-8 seconds asynchronously (T3 cognitive — wall-clock acceptable here since this is outside tick boundary)
            const thinkDelay = 5000 + CanonicalClock.getInstance().rng().range(0, 3000);
            await new Promise(resolve => setTimeout(resolve, thinkDelay));
        }
    }

    private async tick(): Promise<void> {
        const start = performance.now();
        this.tickCount++;

        // CANONICAL CLOCK ADVANCEMENT — This is the heartbeat.
        // Every tick advances the deterministic clock by one phase (300ms).
        // All downstream simulatedNow() and rng() calls derive from this.
        CanonicalClock.getInstance().pulse();

        // Swap deterministic queues at start of tick
        this.currentTickQueues = { ...this.nextTickQueues };
        this.nextTickQueues = {
            CRITICAL: [],
            NORMAL: [],
            VISUAL_ONLY: []
        };

        try {
            // Resolve lazy dependencies before first pulse
            this.resolve();

            // 1. Health Probe (Substrate Authority via Resolver)
            this.substrateState = await SubstrateResolver.resolve();
            this.updateTernaryState(this.substrateState);

            // 2. Substrate Veto (Hard Abort if OFFLINE)
            if (this.substrateState === SubstrateState.OFFLINE) {
                logger.error('[CNS GODHEAD] Pulse aborted: Substrate OFFLINE');
                return;
            }

            const pendingAdminCommands = this.switchboard!.drainAdminQueue();
            this.lastTickStart = performance.now();
            const tickId = crypto.randomUUID();

            // ═══════════════════════════════════════════════════════════════
            // PHASE 1: PREDICTION [0-150ms]
            // ═══════════════════════════════════════════════════════════════

            // [0-50ms] GhostSplat projection
            const ghostSplat = GhostSplatEngine.getInstance();
            const field = ghostSplat.project(this.gameplay?.globalState as any, 2, this.gameplay?.playerAgent);

            if (!field) {
                logger.warn('GhostSplat projection failed — executing fallback');
                await this.pulse(pendingAdminCommands);
                return;
            }

            // [50-100ms] Transitional state computation
            const hexManager = HexagramManager.getInstance();
            const kernel = EpistemicTransitionKernel.getInstance();
            const diagnostics = kernel.getDiagnostics();

            const transitionalState = hexManager.getTransitionalState(field, diagnostics as any);
            const transitionalVector: TransitionalVector = {
                movingLines: transitionalState.movingLines,
                transitionProgress: transitionalState.transitionProgress,
                energyFlow: transitionalState.energyFlow,
                falseStability: transitionalState.falseStability
            };

            logger.debug({
                tickId,
                movingLines: transitionalVector.movingLines.length,
                energyFlow: transitionalVector.energyFlow,
                falseStability: transitionalVector.falseStability,
                progress: transitionalVector.transitionProgress.toFixed(3)
            }, '🔮 Transitional vector computed');

            // [100-150ms] Prediction
            const currentYao = this.getHexYaoState();
            const proposedAction = { type: 'PULSE', commands: pendingAdminCommands }; // simplified

            const prediction = kernel.predictTransition(currentYao, `action-${tickId}`);

            // ═══════════════════════════════════════════════════════════════
            // PHASE 2: WAIT DECISION [150-300ms]
            // ═══════════════════════════════════════════════════════════════

            const decision = this.waitDecisionMaker.evaluate(
                prediction,
                transitionalVector,
                0, // timeInWaitMs = 0 (fresh decision)
                this.lastAuditScore
            );

            logger.debug({
                tickId,
                decision: decision.state,
                confidence: decision.confidence.toFixed(3),
                deadline: decision.deadlineMs
            }, '⏳ Wait decision rendered');

            // Broadcast Hysteresis Telemetry
            if (this.switchboard) {
                this.switchboard.broadcast({
                    type: 'hysteresis_state',
                    payload: {
                        tickId,
                        decision: decision.state,
                        confidence: decision.confidence,
                        deadlineMs: decision.deadlineMs,
                        movingLines: transitionalVector.movingLines,
                        abilityQueue: this.getCurrentAbilityQueue(),
                        timestamp: CanonicalClock.getInstance().simulatedNow()
                    }
                });
            }

            // ── HARD COMMIT ──
            if (decision.state === 'COMMIT') {
                await this.executeAction(tickId, pendingAdminCommands, prediction, transitionalVector);
                this.scheduleObservation(tickId, currentYao, prediction, 300);
            }
            // ── PREPARE (deferred commit at 300ms) ──
            else if (decision.state === 'PREPARE') {
                const cmd: PendingCommand = {
                    id: tickId,
                    action: pendingAdminCommands,
                    predictedOutcome: prediction,
                    transitionalVector,
                    commitDeadline: this.lastTickStart + 300,
                    state: 'PENDING'
                };
                this.pendingCommands.set(tickId, cmd);

                // Schedule commit at 300ms boundary
                setTimeout(() => this.commitPendingCommand(tickId), 300);
                this.scheduleObservation(tickId, currentYao, prediction, 300);
            }
            // ── HARD WAIT ──
            else if (decision.state === 'WAIT') {
                const cmd: PendingCommand = {
                    id: tickId,
                    action: pendingAdminCommands,
                    predictedOutcome: prediction,
                    transitionalVector,
                    commitDeadline: this.lastTickStart + decision.deadlineMs,
                    state: 'PENDING'
                };
                this.pendingCommands.set(tickId, cmd);

                this.installTriggerListeners(tickId, decision.triggerConditions);
                setTimeout(() => this.evaluateWaitTimeout(tickId), decision.deadlineMs);
                this.scheduleObservation(tickId, currentYao, prediction, 300);
            }

            // 3. Post-Actuation Verification (Spatial Vision) - Non-blocking to pulse rhythm
            if (this.substrateState === SubstrateState.ONLINE && this.vision && this.tickCount % 10 === 0) {
                this.vision.verifySpatialAnchor().then(verification => {
                    if (!verification.ok) {
                        logger.warn({ error: (verification.error as Error)?.message }, '[CNS GODHEAD] Visual verification drift detected. Substrate link degraded.');
                    }
                }).catch(err => {
                    logger.error({ err }, '[CNS GODHEAD] Vision Substrate Critical Failure.');
                });
            }

        } catch (err) {
            logger.error({ err }, '[CNS GODHEAD] Pulse failure â€” potential world desync.');
        } finally {
            const duration = performance.now() - start;

            // Self-Correcting Scheduling (Drift Compensation)
            const nextDelay = Math.max(0, this.TICK_INTERVAL - duration);

            if (duration > this.BUDGET_MS) {
                logger.warn({ duration, limit: this.TICK_INTERVAL }, 'CNS Tick Overflow — authoritative simulation drift detected.');
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // DEFERRED EXECUTION HANDLERS
    // ═══════════════════════════════════════════════════════════════

    private commitPendingCommand(tickId: string): void {
        const cmd = this.pendingCommands.get(tickId);
        if (!cmd || cmd.state !== 'PENDING') return;

        const kernel = EpistemicTransitionKernel.getInstance();
        const currentDiagnostics = kernel.getDiagnostics();

        if (currentDiagnostics.phaseGateMultiplier < 0.3) {
            logger.warn({ tickId }, 'Phase gate too low — cancelling deferred commit');
            cmd.state = 'CANCELLED';
            this.pendingCommands.delete(tickId);
            return;
        }

        cmd.state = 'COMMITTED';
        this.executeAction(tickId, cmd.action, cmd.predictedOutcome, cmd.transitionalVector);
        this.pendingCommands.delete(tickId);
    }

    private evaluateWaitTimeout(tickId: string): void {
        const cmd = this.pendingCommands.get(tickId);
        if (!cmd || cmd.state !== 'PENDING') return;

        const kernel = EpistemicTransitionKernel.getInstance();
        const currentYao = this.getHexYaoState();

        const freshPrediction = kernel.predictTransition(currentYao, `action-${tickId}`);

        if (freshPrediction.confidence > 0.3) {
            logger.info({ tickId }, 'Wait deadline — forced commit');
            cmd.state = 'COMMITTED';
            this.executeAction(tickId, cmd.action, freshPrediction, cmd.transitionalVector);
        } else {
            logger.warn({ tickId }, 'Wait deadline — forced cancel');
            cmd.state = 'CANCELLED';
        }

        this.pendingCommands.delete(tickId);
    }

    private getCurrentAbilityQueue(): any[] {
        return Array.from(this.pendingCommands.values())
            .filter(cmd => cmd.state === 'PENDING')
            .map(cmd => {
                // Determine the primary action name from the command batch
                let actionName = 'PULSE_SYNC';
                if (Array.isArray(cmd.action) && cmd.action.length > 0) {
                    const first = cmd.action[0];
                    actionName = first.type || (first.metadata?.abilityName) || 'ADMIN_CMD';
                }

                return {
                    id: cmd.id,
                    actionType: actionName,
                    deadlineMs: Math.max(0, cmd.commitDeadline - CanonicalClock.getInstance().simulatedNow()),
                    confidence: cmd.predictedOutcome.confidence
                };
            });
    }

    private installTriggerListeners(tickId: string, conditions: string[]): void {
        const kernel = EpistemicTransitionKernel.getInstance();
        for (const condition of conditions) {
            // Simplified: we'll just listen to phase shifts for now as an example trigger
            if (condition === 'phase_shifts_to_recovering') {
                kernel.once('phaseShift', (phase: any) => {
                    if (phase === 'RECOVERING') this.onTrigger(tickId, condition);
                });
            }
        }
    }

    private onTrigger(tickId: string, condition: string): void {
        const cmd = this.pendingCommands.get(tickId);
        if (!cmd || cmd.state !== 'PENDING') return;

        logger.debug({ tickId, condition }, 'Wait trigger fired — early commit');
        cmd.state = 'COMMITTED';
        this.executeAction(tickId, cmd.action, cmd.predictedOutcome, cmd.transitionalVector);
        this.pendingCommands.delete(tickId);
    }

    // ═══════════════════════════════════════════════════════════════
    // OBSERVATION PHASE [300ms]
    // ═══════════════════════════════════════════════════════════════

    private scheduleObservation(
        tickId: string,
        prevYao: YaoState,
        prediction: TransitionPrediction,
        delayMs: number
    ): void {
        setTimeout(async () => {
            const kernel = EpistemicTransitionKernel.getInstance();
            const actualYao = this.getHexYaoState();

            // Observe transition
            kernel.observeTransition(actualYao, prediction.confidence);

            // Phase 42: Autonomous Chromatic Auditing
            if (this.observer) {
                // We use the predicted name to verify the chromatic reality
                const targetName = (prediction as any).targetName || 'Sovereign';
                const obsRes = await this.observer.observe(targetName, 'latest_frame.png');
                if (obsRes.ok) {
                    const engine = ChromanumberEngine.getInstance();
                    const auditRes = await engine.analyzeImage({
                        imagePath: obsRes.value.imagePath || 'latest_frame.png',
                        prompt: `Validate ${targetName} chromaticity`,
                        anatomyFacts: {},
                        expectedPalette: obsRes.value.expectedPalette
                    });

                    // Update authoritative grounding score
                    if (auditRes.ok) {
                        this.lastAuditScore = auditRes.value.confidence || 0.95;
                        logger.info({ score: this.lastAuditScore }, 'Perceptual grounding updated');
                    } else {
                        this.lastAuditScore *= 0.8; // Decay on failure
                    }
                }
            }

            // Fetch latest error metrics from registry
            const error = 0.1; // placeholder for derived error

            // Feed error back to GhostSplat
            this.feedbackToGhostSplat(tickId, error);

        }, delayMs);
    }

    private feedbackToGhostSplat(tickId: string, error: number): void {
        // Reduced confidence feedback loop
    }

    private async executeAction(
        tickId: string,
        commands: AdminCommand[],
        prediction: TransitionPrediction,
        transitionalVector: TransitionalVector
    ): Promise<void> {
        const kernel = EpistemicTransitionKernel.getInstance();
        const gate = kernel.getPhaseGateMultiplier();

        logger.info({
            tickId,
            actionCount: commands.length,
            phase: prediction.targetPhase,
            gate: gate.toFixed(2),
            movingLines: transitionalVector.movingLines.length
        }, '⚡ Action committed');

        // Export to Sovereign renderer for observer window
        const ui = require('../../ui/Renderer.js').Renderer.getInstance();
        ui.exportActionOutcome({
            tickId,
            commands,
            prediction,
            vector: transitionalVector,
            timestamp: CanonicalClock.getInstance().simulatedNow()
        });

        // Phase 11: Action Pipeline Feedback
        kernel.recordAction('PULSE_COMMIT', prediction.confidence);

        // Execute via pulse (which contains original conflict resolution logic)
        await this.pulse(commands);
    }


    /**
     * updateTernaryState - Maps substrate health to the POG2 Yin/Yang/Yao logic.
     */
    private updateTernaryState(state: SubstrateState): void {
        switch (state) {
            case SubstrateState.ONLINE:
                this.router.setYaoState(YaoState.YoungYang); // Balanced Action
                break;
            case SubstrateState.DEGRADED:
            case SubstrateState.DEGRADED_IO:
                this.router.setYaoState(YaoState.YoungYin);  // Perceptive Only (Wait states)
                break;
            case SubstrateState.OFFLINE:
                this.router.setYaoState(YaoState.OldYin);    // Shutdown/Stasis
                break;
        }
    }

    /**
     * getHexYaoState — Safe accessor for the HexagramManager's current Yao state.
     * Falls back to substrate-based inference if the manager is unavailable.
     */
    private getHexYaoState(): YaoState {
        try {
            return HexagramManager.getInstance().getYaoState();
        } catch {
            // Fallback: infer from substrate state
            return this.substrateState === SubstrateState.ONLINE ? YaoState.YoungYang
                : this.substrateState === SubstrateState.OFFLINE ? YaoState.OldYin
                    : YaoState.YoungYin;
        }
    }


    public async pulse(commands: AdminCommand[]): Promise<GameState | undefined> {
        this.pulseStartTime = performance.now();
        this.resolve();
        // 0. Resolve Substrate Health once per pulse
        this.substrateState = await SubstrateResolver.resolve();
        this.updateTernaryState(this.substrateState);

        // 1. Build Routing Snapshot (Pure function of substrate state)
        this.routingSnapshot = await this.buildRoutingSnapshot(this.substrateState);

        // 2. Prepare Local Pulse Scopes (No temporal bleed)
        const pulseDeltas: WorldDelta[] = [];

        // 3. Snapshot valid events
        const events = commands.map(cmd => this.createTickEvent(cmd));

        // 2. Sort (Priority -> Time -> ID)
        const sorted = this.sortEvents(events);

        // 3. Resolve Conflicts (Tile Locking)
        const resolved = this.resolveConflicts(sorted);

        const isGameTick = this.tickCount % 2 === 0;

        // 4. Atomic World Transaction (Only full commits on game tick)
        const tx = this.grounding!.beginTick();

        // 5. Execute valid events
        for (let event of resolved) {
            // A. Signal Accumulation Phase
            const signals: CausalEvidence[] = [];

            // 1. Spatial Signal (from resolveConflicts)
            if (event.outcome === "REJECTED_COLLISION") {
                signals.push({
                    source: "SPATIAL",
                    code: "TILE_LOCK_CONTENTION",
                    description: "Target tile is locked by a higher-priority event.",
                    severity: "BLOCKER"
                });
            }

            // 2. Policy Signal (from Ledger Validation)
            const validation = this.ledger.validateCausality(event);
            signals.push(...validation.signals);

            // B. Resolve Final Outcome (Causal Signal Reduction)
            // We pass the signals to the ledger which will resolve them deterministically
            event = {
                ...event,
                signals: [...(event.signals || []), ...signals],
                outputs: { ...(event.outputs || {}), ...(validation.outputs || {}) }
            };

            // C. Final Decision Gate (Sealing: EXECUTION -> CAUSAL)
            const kernel = EpistemicTransitionKernel.getInstance();
            const finalized = kernel.promoteToCausal(event, (ev) => {
                this.ledger.record(ev);
                return this.ledger.getTickEvents(this.ledger.getCurrentTick())?.find(e => e.id === ev.id)!;
            });

            // D. Post-Hoc Explanation (Non-inferential)
            if (finalized) {
                const trace = this.ledger.compileLearningTrace(finalized);
                SwitchboardLimb.getInstance().broadcastLearningTrace(trace);

                // Phase 200: Wisdom Ingestion (Lossy Abstraction: CAUSAL -> INTERPRETATION)
                kernel.deriveInterpretation(finalized, (ev) => {
                    return CausalPatternExtractor.getInstance().ingestTrace(ev)!;
                });

                // Phase 210: CANONICAL LEARNING EVENT (The Spine)
                EventBus.getInstance().publish({
                    type: 'cognitive.learning',
                    source: 'CNSGodheadPulseVolley',
                    fidelity: LearningFidelity.CAUSAL,
                    payload: {
                        tick: finalized.tick,
                        timestamp: finalized.timestamp,
                        trace: this.ledger.getTickTrace(finalized.id),
                        resolution: finalized,
                        patterns: CausalPatternExtractor.getInstance().getTopInsights(5),
                        invariants: InvariantCompiler.getInstance().getManifest().rules
                    }
                });
            }

            // E. Execution Phase (Layer 3)
            if (finalized && finalized.outcome === "SUCCESS") {
                await this.executeEvent(tx, finalized, pulseDeltas);
            }
        }

        // 6. Broadcast Cognitive Insights (Every 10 ticks)
        if (this.tickCount % 10 === 0) {
            const insights = CausalPatternExtractor.getInstance().getTopInsights(3);
            if (insights.length > 0) {
                SwitchboardLimb.getInstance().broadcast({
                    type: 'COGNITIVE_INSIGHTS',
                    payload: insights
                });
            }
        }

        // 7. Compile Structural Invariants (Every 100 ticks)
        if (this.tickCount % 100 === 0) {
            const memory = CausalPatternExtractor.getInstance().getMemory();
            const rules = InvariantCompiler.getInstance().compilePatterns(memory, this.tickCount);
            if (rules.length > 0) {
                SwitchboardLimb.getInstance().broadcast({
                    type: 'INVARIANT_MANIFEST',
                    payload: InvariantCompiler.getInstance().getManifest()
                });
                logger.info({ rules: rules.length }, '[CNS] Structural Invariant Manifest updated and broadcasted.');
            }
        }

        // --- TIERED BUDGET EXECUTION (Torpor-Safe) ---
        const tickBudgetMs = this.PULSE_DEADLINE_MS * 0.35; // Reserve 35% for deferred
        const state = this.substrateState;

        // 1. CRITICAL Tier (Always runs if possible)
        await this.processQueueWithBudget(this.currentTickQueues.CRITICAL, {
            maxMs: tickBudgetMs * 0.5,
            maxOps: 100,
            label: `tick_${this.ledger.getCurrentTick()}_CRITICAL`
        });

        // 2. NORMAL Tier (Skipped in OFFLINE/Torpor)
        if (state !== SubstrateState.OFFLINE) {
            await this.processQueueWithBudget(this.currentTickQueues.NORMAL, {
                maxMs: tickBudgetMs * 0.3,
                maxOps: 50,
                label: `tick_${this.ledger.getCurrentTick()}_NORMAL`
            });
        } else {
            logger.debug('[CNS] Skipping NORMAL queue: Torpor Stasis active.');
        }

        // 3. VISUAL_ONLY Tier (Skipped in DEGRADED/OFFLINE)
        if (state === SubstrateState.ONLINE) {
            await this.processQueueWithBudget(this.currentTickQueues.VISUAL_ONLY, {
                maxMs: tickBudgetMs * 0.2,
                maxOps: 20,
                label: `tick_${this.ledger.getCurrentTick()}_VISUAL`
            });
        } else {
            logger.debug('[CNS] Skipping VISUAL_ONLY queue: Substrate DEGRADED.');
        }

        // Clear all current queues
        this.currentTickQueues = { CRITICAL: [], NORMAL: [], VISUAL_ONLY: [] };

        // Apply world changes
        await this.grounding!.commitTick(tx);

        // Authoritative Gameplay Tick (Dual-Tick Architecture)
        await this.gameplay!.processTick(isGameTick);

        if (this.gameplay?.globalState) {
            const playerAgent = (this.gameplay as any).playerAgent;

            // Authoritative player state → NORMAL tier (survives DEGRADED substrate)
            if (this.gameplay!.avatar && this.globe) {
                this.enqueueNow(async () => {
                    const avatar = this.gameplay!.avatar as SovereignAvatarEntity;
                    const activeModuleName = this.gameplay!.activeModule?.name || 'UNKNOWN_NODE';
                    this.globe!.pushNodeState('player_sovereign', {
                        coord: avatar.coord,
                        equipment: avatar.equipment,
                        adrenaline: avatar.adrenaline,
                        bloodlustStacks: avatar.bloodlustStacks,
                        hp: avatar.currentHp,
                        maxHp: avatar.maxHp,
                        intent: avatar.intent,
                        lockTicks: avatar.lockTicks,
                        mapNode: activeModuleName,
                        searchActive: avatar.metadata?.searchActive || false,
                        activeSearchQuery: avatar.metadata?.activeSearchQuery || '',
                        activeSearchComponent: avatar.metadata?.activeSearchComponent || ''
                    });

                    // Mirror POG2 Entities into the Globe 3D Engine
                    if (this.gameplay!.globalState!.npcMap) {
                        const entityBatch: any[] = [];
                        for (const [key, npc] of this.gameplay!.globalState!.npcMap) {
                            entityBatch.push({
                                entityId: npc.id || key,
                                name: npc.name || 'NPC',
                                x: npc.coord?.x ?? npc.x,
                                y: npc.coord?.y ?? npc.y
                            });
                        }
                        if (entityBatch.length > 0) {
                            this.globe!.pushBatchPerception(entityBatch);
                        }
                    }
                }, "NORMAL");
            }

            // Enqueue visual side-effects to the VISUAL_ONLY tier
            this.enqueueNow(async () => {
                // We project ghost splats on player ticks too for smooth client visuals
                const field = this.ghostSplat!.project(this.gameplay!.globalState!, 3, playerAgent);
                if (field) {
                    this.switchboard!.broadcastGhostSplat(field);
                }

                // Phase 113: Gameplay Filesystem Projection
                const projection = GameplayProjectionLimb.getInstance();
                if (projection && this.gameplay!.avatar) {
                    const activeModuleName = this.gameplay!.activeModule?.name || 'none';
                    projection.projectState(this.gameplay!.avatar, this.gameplay!.globalState!, activeModuleName);
                    projection.projectEntities(this.gameplay!.globalState!);
                }
            }, "VISUAL_ONLY");
        }

        // 7. BROADCAST Phase (Layer 4)
        for (const delta of pulseDeltas) {
            this.switchboard?.broadcastWorldDelta(delta).catch(err =>
                logger.error({ err: err.message }, '[CNS] World delta broadcast failed')
            );
        }

        // 8. Commit Ledger (Logs & history rotation)
        if (isGameTick) {
            this.ledger.commitTick();
            // Phase 250: Epistemic Reconciliation (Reality Lattice Audit)
            await TruthReconciler.getInstance().reconcileTick(this.ledger.getCurrentTick() - 1);
        }

        const elapsed = performance.now() - this.pulseStartTime;
        if (elapsed > this.PULSE_DEADLINE_MS * 0.8) {
            logger.warn({ duration: elapsed.toFixed(1) }, `[CNS] Pulse at ${elapsed.toFixed(1)}ms`);
        }

        return this.gameplay?.globalState;
    }

    private createTickEvent(cmd: AdminCommand): TickEvent {
        const source = (cmd as any).source || cmd.metadata?.source || "ADMIN";
        // CANONICAL TIME AUTHORITY: External timestamps are forensic-only.
        // The simulation clock is the sole source of truth for event ordering.
        const timestamp = CanonicalClock.getInstance().simulatedNow();
        const originalTimestamp = (cmd as any).timestamp || cmd.metadata?.timestamp; // preserved for audit trail
        const inputs = cmd.metadata || {};

        // Resolve coordinate if present
        let coord;
        if (cmd.type === 'teleport' || cmd.type === 'spawn') {
            const rawCoord = inputs.coords || (inputs.regionId ? this.grounding!.getSpatialTruth(inputs.regionId) : null);
            if (rawCoord) {
                const zVal = rawCoord.z ?? rawCoord.plane ?? 0;
                coord = { x: rawCoord.x, y: rawCoord.y, z: zVal, plane: zVal };
            }
        }

        const action = cmd.type;
        const stableId = `ev_${this.ledger.getCurrentTick()}_${timestamp}_${CanonicalClock.getInstance().rng().range(0, 999)}`;

        return {
            id: stableId,
            tick: this.ledger.getCurrentTick(),
            timestamp,
            action,
            source: source as EventSource,
            inputs,
            coord,
            outcome: "SUCCESS",
            truthClass: TruthClass.EXECUTION
        };
    }

    private sortEvents(events: TickEvent[]): TickEvent[] {
        return [...events].sort((a, b) => {
            const pA = CNSGodheadPulseVolley.PRIORITY[a.source] ?? 99;
            const pB = CNSGodheadPulseVolley.PRIORITY[b.source] ?? 99;

            if (pA !== pB) return pA - pB;
            if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
            return a.id.localeCompare(b.id);
        });
    }

    private resolveConflicts(events: TickEvent[]): TickEvent[] {
        return events.map(event => {
            if (event.coord) {
                const tileKey = `${event.coord.x},${event.coord.y},${event.coord.plane}`;
                const activeLocks = this.ledger.getActiveLocks();

                if (activeLocks.has(tileKey)) {
                    logger.warn({ eventId: event.id, tileKey }, '[CNS GODHEAD] REJECTED_COLLISION: Tile already locked.');
                    return { ...event, outcome: "REJECTED_COLLISION" as EventOutcome };
                }

                this.ledger.setTileLock(tileKey, {
                    ownerEventId: event.id,
                    action: event.action
                });
            }
            return event;
        });
    }

    /**
     * processQueueWithBudget - Deterministic, bounded execution of deferred operations.
     * Prevents async leakage and runaway tick duration.
     */
    private async processQueueWithBudget(
        queue: DeferredOp[],
        budget: QueueBudget
    ): Promise<QueueResult> {

        const start = performance.now();
        let executed = 0;
        let skipped = 0;

        const maxOps = budget.maxOps ?? Number.MAX_SAFE_INTEGER;

        for (let i = 0; i < queue.length; i++) {
            const op = queue[i];

            // hard op cap first (prevents death spirals)
            if (executed >= maxOps) {
                skipped += (queue.length - i);
                logger.warn({
                    label: budget.label,
                    executed,
                    skipped,
                    reason: 'MAX_OPS_REACHED'
                }, '[QUEUE_BUDGET] Ops cap hit, truncating execution');
                break;
            }

            const now = performance.now();
            const elapsed = now - start;

            // time budget check (core deterministic safety rail)
            if (elapsed >= budget.maxMs) {
                skipped += (queue.length - i);

                logger.warn({
                    label: budget.label,
                    executed,
                    skipped,
                    elapsed,
                    maxMs: budget.maxMs,
                    reason: 'TIME_BUDGET_EXCEEDED'
                }, '[QUEUE_BUDGET] Tick budget exhausted, deferring remaining ops');

                break;
            }

            try {
                const result = op();

                // allow sync or async ops without breaking tick determinism
                if (result instanceof Promise) {
                    await result;
                }

                executed++;
            } catch (err) {
                skipped++;

                logger.error({
                    label: budget.label,
                    err
                }, '[QUEUE_BUDGET] Deferred op failed');
            }
        }

        const durationMs = performance.now() - start;

        return {
            executed,
            skipped,
            durationMs,
            budgetExceeded: skipped > 0
        };
    }

    private async executeEvent(tx: Map<string, any>, event: TickEvent, deltas: WorldDelta[]): Promise<void> {
        switch (event.action) {
            case 'teleport':
                if (event.coord) {
                    // DEFERRED to NEXT TICK to prevent re-entrancy corruption
                    this.enqueueNextTick(async () => {
                        await this.grounding!.applyWorldTransform(tx, { x: event.coord!.x, y: event.coord!.y, z: event.coord!.z }).catch(err =>
                            logger.error({ err: err.message }, `[CNS] Deferred transform failed`)
                        );
                    }, "CRITICAL");

                    logger.debug({ coords: event.coord }, '[VOLLEY] SPATIAL_SHIFT enqueued for NEXT_TICK.');

                    // Collect World Delta
                    deltas.push({
                        tick: event.tick,
                        entityId: 'player_sovereign',
                        type: 'MOVE',
                        x: event.coord!.x,
                        y: event.coord!.y,
                        z: event.coord!.z,
                        source: 'POG2',
                        confidence: 1.0
                    });
                }
                break;

            case 'walkTo': {
                // Route to SimulationHarness.setWalkGoal() → reflexLoop → avatar.plotPath
                const { x, y, plane } = event.inputs;
                if (typeof x === 'number' && typeof y === 'number') {
                    const harness = (this.gameplay as any)?.harness;
                    if (harness?.setWalkGoal) {
                        harness.setWalkGoal(x, y, plane ?? 0);
                        logger.debug({ x, y, plane }, '[VOLLEY] Walk goal delegated to Simulation Harness.');
                    } else {
                        logger.warn('[VOLLEY] walkTo received but no harness found on gameplay limb.');
                    }
                }
                break;
            }

            case 'spawn':
                const sid = event.inputs.entityId;
                const entityDef = this.grounding!.getEntityManifest(sid);
                if (entityDef) {
                    const defWithId = { ...entityDef, id: sid };
                    if (event.coord) {
                        defWithId.coord = event.coord;
                    }
                    // DEFERRED: Entity spawn inside tick boundaries
                    this.enqueueNow(async () => {
                        await this.grounding!.spawnEntity(tx, defWithId).catch(err =>
                            logger.error({ err: err.message }, `[CNS] Deferred spawn failed`)
                        );
                    });
                    logger.debug({ id: sid }, '[VOLLEY] ENTITY_MANIFEST staged for deterministic spawn.');

                    // Collect World Delta
                    if (event.coord) {
                        deltas.push({
                            tick: event.tick,
                            entityId: sid,
                            type: 'SPAWN',
                            x: event.coord.x,
                            y: event.coord.y,
                            z: event.coord.z,
                            source: 'POG2',
                            confidence: 1.0
                        });
                    }
                }
                break;

            case 'admin_auth':
                const rank = event.inputs.rank || 'admin';
                this.switchboard!.setPrivilege(rank);
                logger.debug({ rank }, '[VOLLEY] PRIVILEGE_ELEVATION logged.');
                break;

            default:
                logger.error({ action: event.action, eventId: event.id }, '[VOLLEY] Critical Execution Failure: Unknown action passed validation.');
                // We cannot mutate the finalized event outcome here.
                // Instead, we record this as a severe cognitive/mechanical divergence.
                TruthReconciler.getInstance().reconcileTick(event.tick); // Force an audit
        }
    }

    /**
     * healthCheck - Neurological diagnostic probe.
     */
    public healthCheck(): { online: boolean; details: string; status: 'ONLINE' | 'DEGRADED' | 'DEGRADED_IO' | 'OFFLINE' } {
        const ioLatency = getLastIOLatencyMs();
        const online = this.substrateState !== SubstrateState.OFFLINE;
        return {
            online,
            status: this.substrateState as any,
            details: `CNS Pulse Kernel: ${this.substrateState} (Heartbeat: ${this.TICK_INTERVAL}ms | IO Latency: ${ioLatency}ms)`
        };
    }

    /**
     * injectVolley - Batch injection hook for programmatic control.
     */
    public injectVolley(commands: AdminCommand[]): void {
        this.resolve();
        commands.forEach(cmd => this.switchboard!.pushAdminCommand(cmd));
        logger.info({ count: commands.length }, 'Programmatic Volley Injection confirmed.');
    }

    private async buildRoutingSnapshot(substrateHealth: SubstrateState): Promise<RoutingSnapshot> {
        const cloudSignal = SubstrateResolver.getCloudSignal();
        // const substrateState = await SubstrateResolver.resolve(); // REMOVED: redundant call

        const modelHealthMap: Record<string, boolean> = {};
        if (this.nodeTester) {
            const rolodex = this.nodeTester.getRouter()?.getRolodex();
            if (rolodex) {
                const models = rolodex.getAllModels();
                for (const m of models) {
                    modelHealthMap[m.id] = rolodex.isModelHealthy(m.id);
                }
            }
        }

        return {
            tick: this.ledger.getCurrentTick(),
            cloudHealth: {
                status: cloudSignal.status,
                effect: cloudSignal.effect
            },
            substrateHealth: substrateHealth,
            modelHealthMap,
            timestamp: CanonicalClock.getInstance().simulatedNow()
        };
    }
}
