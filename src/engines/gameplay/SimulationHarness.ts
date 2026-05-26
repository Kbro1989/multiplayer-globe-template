import * as fs from 'fs';
import { join } from 'path';
import { getAtlasSystemPath, getAtlasSpatialPath } from '../../utils/SovereignPathResolver.js';
import { Coord, GameState, Result, YaoState, SkillId, EquipmentSlot, SovereignAvatar, Item, TruthClass, NPC } from '../../core/models.js';
import { SovereignAvatarEntity } from '../../core/SovereignAvatar.js';
import { WorldGroundingLimb } from '../../limbs/world_grounding/WorldGroundingLimb.js';
import { HexagramManager } from '../../routing/HexagramManager.js';
import { AIDispatcher } from '../../api/ai/Dispatcher.js';
import { WikiEnricher } from '../../utils/WikiEnricher.js';
import { EntityLimb } from '../../limbs/technical/EntityLimb.js';
import { HexagramNetworkBridge } from '../../limbs/technical/HexagramNetworkBridge.js';
import { createLogger } from '../../utils/logger.js';
import { NecromancyAbility, NecromancyGFX } from './NecromancyInterfaces.js';
import { SwitchboardLimb } from '../../monitor/SwitchboardLimb.js';
import { ServerLogicRegistry, LogicalSignature } from './ServerLogicRegistry.js';
import { SpatialSovereigntyLimb } from '../../limbs/spatial/SpatialSovereigntyLimb.js';
import { DirectionalPathfinder } from '../../limbs/spatial/DirectionalPathfinder.js';
import { GhostSplatEngine } from '../../substrates/GhostSplatEngine.js';
import { NpcAgent, NpcAgentConfig } from './NpcAgent.js';
import { InteractionGateway } from '../../limbs/logical/InteractionGateway.js';
import { GameplaySovereigntyLimb } from '../../limbs/spatial/GameplaySovereigntyLimb.js';
import { DBRowOracleLimb } from '../../limbs/spatial/DBRowOracleLimb.js';
import { GameplayProjectionLimb } from '../../limbs/spatial/GameplayProjectionLimb.js';
import { WorldStateLimb } from '../../limbs/logical/WorldStateLimb.js';
import { AdminCommandProcessor } from '../../limbs/logical/world/AdminCommandProcessor.js';
import { CombatRotationEngine } from './CombatRotationEngine.js';
import { AbilityBook, AbilityDefinition } from './AbilityBook.js';
import { ItemBook } from './ItemBook.js';
import { LuckTierRegistry } from './LuckTierRegistry.js';
import { LootResolutionEngine } from './LootResolutionEngine.js';
import { EpistemicTransitionKernel, PredictionRegistry } from '../core/EpistemicTransitionKernel.js';
import { CanonicalClock } from '../../utils/CanonicalClock.js';
import { stateProvider } from '../../utils/StateProvider.js';
import { resolveSovereignPath } from '../../utils/SovereignPathResolver.js';

export interface TickEvent {
    readonly id: string;
    readonly signature: 'COMBAT_HIT' | 'COMBAT_MISS' | 'SKILL_SUCCESS' | 'SKILL_FAIL' | 'ITEM_DROP' | 'EXPRESSION_TRIGGER';
    readonly metadata: any;
    readonly timestamp: number;
    readonly truthClass: TruthClass;
}

const logger = createLogger('SimulationHarness');

/**
 * ServerLogicMapper
 * Maps "Server-Only" and "Admin" game logic derived from the raw binary cache.
 * Fulfills the "Pull from cache using D: rsmv" requirement.
 */
export class ServerLogicMapper {
    private grounding: WorldGroundingLimb;
    private systemMapping: any[] = [];
    private behaviorCache: Map<number, string> = new Map();

    constructor(grounding: WorldGroundingLimb) {
        this.grounding = grounding;
        this.loadSystemMapping();
    }

    private loadSystemMapping() {
        try {
            const systemRoot = getAtlasSystemPath();
            const fallbackPath = join(systemRoot, 'cache_logic_mapping.json');

            const spatialRoot = getAtlasSpatialPath();
            const spatialPath = join(spatialRoot, 'npc_extract', 'cache_logic_mapping.json');
            const effectivePath = fs.existsSync(spatialPath) ? spatialPath : fallbackPath;

            if (fs.existsSync(effectivePath)) {
                const data = fs.readFileSync(effectivePath, 'utf8');
                const findings = JSON.parse(data);
                // Flattens the categorized findings for easy lookup
                this.systemMapping = Object.values(findings).flat();
                logger.info({ count: this.systemMapping.length, source: effectivePath }, 'Authoritative System Logic Mapping loaded.');
            }
        } catch (e) {
            logger.warn('System logic mapping unavailable. Running in visceral mode.');
        }
    }

    /**
     * Maps an NPC's behavior from the cache's categorized logic findings.
     * Incorporates "Hybrid Grounding": Cache ID + Wiki Enrichment.
     */
    public async resolveNpcBehavior(npcId: number, tick: number): Promise<string | null> {
        if (this.behaviorCache.has(npcId)) return this.behaviorCache.get(npcId)!;

        // 1. Enforce Cache Authority (Reflexive Veto)
        const cacheMatch = this.systemMapping.find(m => m.major === 18 && m.context.includes(npcId.toString()));
        const isDummy = cacheMatch?.keyword === 'dummy';

        if (isDummy) {
            const res = `[SERVER_LOGIC] Entity ${npcId} is a CACHE_DUMMY. Internalizing reflexive silence.`;
            this.behaviorCache.set(npcId, res);
            return res;
        }

        // 2. Hybrid Grounding (Wiki Enrichment)
        const cacheContext = cacheMatch?.context || `NPC ${npcId}`;
        const wikiRes = await WikiEnricher.enrichNpc(cacheContext);
        const wikiName = wikiRes.ok ? wikiRes.value.name : 'Unknown Body';

        const spatialContext = this.grounding.resolveSpatialContext(`npc-${npcId}`);
        if (!spatialContext) return null;

        const result = `[SERVER_LOGIC] ${wikiName} (ID: ${npcId}) synchronized. Role: ${wikiRes.ok ? wikiRes.value.role : 'Visceral'}.`;
        this.behaviorCache.set(npcId, result);
        return result;
    }

    /**
     * Checks if an NPC is marked as a 'dummy' in the authoritative cache mapping.
     */
    public isDummy(npcId: number): boolean {
        return this.systemMapping.some(m => m.major === 18 && m.keyword === 'dummy' && m.context.includes(npcId.toString()));
    }
}

/**
 * Sovereign Simulation Harness
 * The central CNS node for the deterministic Dual-Tick pulse.
 */
export class SimulationHarness {
    private static instance: SimulationHarness | null = null;
    private avatar: SovereignAvatar | null = null;

    public static bootstrap(
        grounding: WorldGroundingLimb,
        hexagram: HexagramManager,
        dispatcher: AIDispatcher,
        entityLimb: EntityLimb,
        switchboard: SwitchboardLimb
    ): SimulationHarness {
        if (!this.instance) {
            this.instance = new SimulationHarness(grounding, hexagram, dispatcher, entityLimb, switchboard);
        }
        return this.instance;
    }

    public setAvatar(avatar: SovereignAvatar): void {
        this.avatar = avatar;
        // Inject authoritative state immediately upon setting avatar
        const statePath = resolveSovereignPath('memory/sovereign_state.json');
        if (fs.existsSync(statePath)) {
            const stateData = fs.readFileSync(statePath, 'utf8');
            this.avatar.injectState(stateData);
            logger.info('[HARNESS] Avatar hydrated from authoritative save.');
        }
    }

    private grounding: WorldGroundingLimb;
    private hexagram: HexagramManager;
    private dispatcher: AIDispatcher;
    private serverLogic: ServerLogicMapper;
    private entityLimb: EntityLimb;
    private switchboard: SwitchboardLimb;
    private interactionGateway: InteractionGateway;
    private dbRowOracle: DBRowOracleLimb;
    public networkBridge: any; // HexagramNetworkBridge

    private lastDeepSync: number = 0;
    private isSyncing: boolean = false;

    // AI Models assigned per role (Pinned to local substrate)
    private readonly REFLEX_MODEL = 'vibethinker:1.5b'; // 600ms heartbeat
    private readonly TACTICAL_MODEL = 'deepseek-r1:8b';    // Combat Logic
    private readonly STRATEGIC_MODEL = 'kimi-k2.6:cloud';  // Strategic reasoning

    private lastChunkX: number = -1;
    private lastChunkZ: number = -1;

    // ── Movement Substrate ─────────────────────────────────────────────────────
    private pathfinder: DirectionalPathfinder | null = null;
    private walkGoal: Coord | null = null;
    private isPathfinding = false;

    // ── NPC Agent Registry ────────────────────────────────────────────────────
    private agentRegistry = new Map<number, NpcAgent>();

    constructor(grounding: WorldGroundingLimb, hexagram: HexagramManager, dispatcher: AIDispatcher, entityLimb: EntityLimb, switchboard: SwitchboardLimb) {
        this.grounding = grounding;
        this.hexagram = hexagram;
        this.dispatcher = dispatcher;
        this.entityLimb = entityLimb;
        this.switchboard = switchboard;
        this.serverLogic = new ServerLogicMapper(grounding);
        this.interactionGateway = new InteractionGateway();
        this.dbRowOracle = DBRowOracleLimb.getInstance();
        this.dbRowOracle.initialize();
        this.networkBridge = new HexagramNetworkBridge();
        // Automatically connect the bridge in the background
        this.networkBridge.connect().catch((e: Error) => logger.error(e, 'Background bridge connect failed'));

        // Bootstrap the pathfinder against the singleton spatial authority
        const spatial = SpatialSovereigntyLimb.getInstance();
        this.pathfinder = new DirectionalPathfinder(spatial);

        logger.info('Simulation Harness AWAKE. Coordinating cache-authoritative world logic nodes.');
    }

    /**
     * setWalkGoal - Authoritative walk command.
     * Called by Admin commands (::walkTo x y) or AI strategic reasoning.
     */
    public setWalkGoal(x: number, y: number, plane = 0): void {
        this.walkGoal = { x, y, plane };
        logger.info({ x, y, plane }, '[HARNESS] Walk goal set.');
    }

    /**
     * registerNpcAgent - Override behavior config for a specific NPC.
     * Call this from gameplay modules (e.g. BarrowsInterpreter, PrifddinasInterpreter)
     * to assign patrol paths or stationary stance to specific NPCs.
     */
    public registerNpcAgent(npcId: number, config: NpcAgentConfig, state: GameState): void {
        const npc = state.npcMap.get(npcId);
        if (!npc || !this.pathfinder) {
            logger.warn({ npcId }, '[HARNESS] registerNpcAgent: NPC not found or pathfinder unavailable.');
            return;
        }
        const spatial = SpatialSovereigntyLimb.getInstance();
        this.agentRegistry.set(npcId, new NpcAgent(npc, config, this.pathfinder, spatial));
        logger.info({ npcId, behavior: config.behavior }, '[HARNESS] NPC agent registered with explicit config.');
    }

    /**
     * Master Tick (Reflex) - Triggered every 600ms.
     */

    public async processTick(tickCount: number, state: GameState, avatar: SovereignAvatar): Promise<void> {
        const yao = this.hexagram.getYaoState();
        const bias = this.calculateMetabolicBias(yao);

        // Tick-synchronize the StateProvider for L2 cache invalidation diagnostics
        stateProvider.onTickBoundary(tickCount);

        // 0. Process Authoritative Switchboard Commands (Tick-Synchronized)
        const commands = this.switchboard.getAdminQueue();
        if (commands.length > 0) {
            const worldState = WorldStateLimb.getInstance(avatar);
            for (const cmd of commands) {
                if (cmd.type === 'WALK') {
                    const tx = cmd.metadata?.x;
                    const ty = cmd.metadata?.y;
                    if (tx !== undefined && ty !== undefined) {
                        if (avatar.plotPath) avatar.plotPath(tx, ty, this.pathfinder, state);
                        avatar.pendingInteraction = null;
                        this.switchboard.broadcast({ type: 'EVENT', message: `Walking to ${tx}, ${ty}` });
                    }
                } else if (cmd.type === 'INTERACT') {
                    const tx = cmd.metadata?.x;
                    const ty = cmd.metadata?.y;
                    if (tx !== undefined && ty !== undefined) {
                        if (avatar.plotPath) avatar.plotPath(tx, ty, this.pathfinder, state);
                    }
                    avatar.pendingInteraction = {
                        action: cmd.metadata?.action,
                        targetId: cmd.metadata?.targetId
                    };
                    this.switchboard.broadcast({ type: 'EVENT', message: `Walking to interact with ${cmd.metadata?.targetId}` });
                } else {
                    await AdminCommandProcessor.execute(cmd, worldState);
                }
            }
            this.switchboard.clearAdminQueue();
        }

        // 0.5 Asynchronous Loot Syntheses
        const readyDrops = LootResolutionEngine.getInstance().popReadyDrops();

        if (!state.groundItems) {
            state.groundItems = new Map();
        }

        for (const drop of readyDrops) {
            const coordKey = `${drop.coord.x},${drop.coord.y},${drop.coord.plane}`;
            const cellItems = state.groundItems.get(coordKey) || [];

            for (const item of drop.items) {
                const clock = CanonicalClock.getInstance();
                const dropId = `drop_${clock.simulatedNow()}_${clock.rng().range(0, 999)}`;
                // GE value: pulled from item if resolved by WikiEquipmentEnricher, else 0.
                // Used by LootBeamRegistry.resolveLootBeamTier() for authentic tier logic.
                const geValue: number = (item as any).geValue ?? 0;

                cellItems.push({
                    id: parseInt(dropId.split('_')[1] || "0", 10),
                    itemName: item.itemName,
                    rarityLabel: item.rollMeta.rarityLabel,
                    geValue,
                    amount: parseInt(item.quantity || "1", 10),
                    x: drop.coord.x,
                    y: drop.coord.y,
                    plane: drop.coord.plane || 0,
                    spawnTick: tickCount
                });

                this.switchboard.broadcast({
                    type: 'tick_event',
                    tick: tickCount,
                    events: [
                        EpistemicTransitionKernel.getInstance().emitExecutionEvent({
                            id: dropId,
                            action: 'ITEM_DROP',
                            metadata: {
                                source: item.sourceNpcName,
                                itemName: item.itemName,
                                quantity: item.quantity,
                                rarity: item.rollMeta.rarityLabel,
                                geValue,
                                x: drop.coord.x,
                                y: drop.coord.y
                            },
                            timestamp: CanonicalClock.getInstance().simulatedNow(),
                            tick: tickCount,
                            source: 'SIMULATION' as any,
                            inputs: {}
                        } as any)
                    ]
                });
            }
            state.groundItems.set(coordKey, cellItems);
        }

        // 0.6 Item Despawn Sweep (500 ticks)
        for (const [coordKey, items] of state.groundItems.entries()) {
            const remaining = items.filter(i => (tickCount - i.spawnTick) <= 500);
            if (remaining.length === 0) {
                state.groundItems.delete(coordKey);
            } else if (remaining.length !== items.length) {
                state.groundItems.set(coordKey, remaining);
            }
        }

        // 1. Synchronize Avatar (Player State)
        const previousPath = avatar.currentPath;
        avatar.processTick();

        // 1.5 Evaluate Pending Interactions if path just finished
        if (avatar.pendingInteraction && avatar.currentPath === null) {
            // Either they arrived, or they were already there.
            const interaction = avatar.pendingInteraction;
            avatar.pendingInteraction = null; // Clear it to prevent looping

            const activeModule = GameplaySovereigntyLimb.getInstance().activeModule || this.serverLogic /* universal fallback? */;

            const results = await this.interactionGateway.evaluateInteraction(
                avatar,
                interaction.action,
                interaction.targetId,
                state,
                activeModule
            );

            for (const log of results) {
                logger.info({ action: interaction.action, targetId: interaction.targetId }, log);
            }
        }

        // 2. Proximity Manifestation (Phase 39)
        const chunkX = avatar.coord.x >> 6;
        const chunkY = avatar.coord.y >> 6;
        if (chunkX !== this.lastChunkX || chunkY !== this.lastChunkZ) {
            this.lastChunkX = chunkX;
            this.lastChunkZ = chunkY;
            this.grounding.manifestNearbyEntities(chunkX, chunkY).catch(err => {
                logger.error({ err, chunkX, chunkY }, 'Forensic Manifestation Failed.');
            });

            // Phase 115: Populate state.npcMap from the newly manifested entities
            const manifest = this.grounding.getManifest();
            const minX = chunkX << 6;
            const minZ = chunkY << 6;
            const maxX = minX + 63;
            const maxZ = minZ + 63;

            // Clear and rebuild spatial index for this tick
            state.npcSpatialIndex.clear();

            for (const [id, entity] of Object.entries(manifest.entities)) {
                if (id.startsWith('npc_')) {
                    const data = entity.grounded.data;
                    if (data.spatial && data.spatial.x >= minX && data.spatial.x <= maxX && data.spatial.y >= minZ && data.spatial.y <= maxZ) {
                        const npcId = data.npcId || parseInt(id.split('_')[1], 10);
                        const entityKey = id;
                        
                        let npc = state.npcMap.get(entityKey as any);
                        if (!npc) {
                            npc = {
                                id: npcId,
                                // entityId: entityKey, // Removed if not in NPC type
                                name: data.name || `NPC ${npcId}`,
                                coord: { x: data.spatial.x, y: data.spatial.y, plane: data.spatial.plane || 0 },
                                x: data.spatial.x,
                                y: data.spatial.y,
                                plane: data.spatial.plane || 0,
                                combat: 0,
                                adrenaline: 0,
                                necrosisStacks: 0,
                                residualSouls: 0,
                                lastCombatTick: 0,
                                cooldowns: {},
                                metadata: data
                            } as any as NPC;
                            state.npcMap.set(entityKey as any, npc);
                        }

                        // Sync to spatial index for radar visibility
                        if (npc) {
                            const coordKey = `${npc.x},${npc.y},${npc.plane}`;
                            const tileNpcs = state.npcSpatialIndex.get(coordKey) || [];
                            tileNpcs.push(npc);
                            state.npcSpatialIndex.set(coordKey, tileNpcs);
                        }
                    }
                }
            }

            // Phase 116: Prune distant entities to prevent OOM
            this.pruneEntities(state, avatar);
        }

        // Verify spatial predictions
        for (const [npcId, npc] of state.npcMap) {
            PredictionRegistry.getInstance().verifySpatialPrediction(
                `npc_${npc.id}`,
                npc.coord,
                tickCount
            );
        }

        // 3. Map Server-Only Logic to the Current Tick
        for (const [entityKey, npc] of state.npcMap) {
            const safeName = npc.name ? npc.name.replace(/\s+/g, '_') : 'Unknown';
            const limbId = `npc_${npc.id}_${safeName}`;

            // Persistent Registration (Ensures we only register once per session)
            this.entityLimb.registerEntity({
                id: limbId,
                type: 'npc',
                name: npc.name,
                isDummy: this.serverLogic.isDummy(npc.id as any)
            }).then(() => {
                // Enrich via Wiki Pedagogy if it's a named NPC
                if (npc.name && !npc.name.includes('undefined') && npc.name !== `NPC ${npc.id}`) {
                    import('../../utils/WikiEnricher.js').then(({ WikiEnricher }) => {
                        WikiEnricher.enrichNpc(npc.name).then(wikiRes => {
                            if (wikiRes.ok) {
                                this.entityLimb.addMemory(limbId, {
                                    type: 'pedagogy',
                                    content: { source: 'wiki', tag: wikiRes.value.role, intent: wikiRes.value.intent },
                                    weight: 1.0
                                }).catch(() => {});
                            }
                        }).catch(() => {});
                    });
                }
            }).catch(() => { });

            this.serverLogic.resolveNpcBehavior(npc.id as any, tickCount).catch(err => {
                logger.error({ err, npcId: npc.id }, 'Logic resolution failure — defaulting to visceral reflex.');
            });
        }

        // 4. NPC Agent Movement Tick
        // Auto-register new NPCs; tick existing agents (non-blocking)
        for (const [npcId, npc] of state.npcMap) {
            if (!this.agentRegistry.has(npcId) && this.pathfinder) {
                // Auto-register as wander agent (default RSC-style behavior)
                const spatial = SpatialSovereigntyLimb.getInstance();
                const isDummy = this.serverLogic.isDummy(npcId);
                const config: NpcAgentConfig = isDummy
                    ? { behavior: 'stationary' }
                    : { behavior: 'wander', wanderRadius: 5, ticksPerMove: 1, tacticalArchetype: 'cowardly' }; // Default to cowardly for testing
                this.agentRegistry.set(npcId, new NpcAgent(npc, config, this.pathfinder, spatial));
                logger.debug({ npcId, behavior: config.behavior }, '[NPC] Agent registered.');
            }

            const agent = this.agentRegistry.get(npcId);
            if (agent) {
                const field = GhostSplatEngine.getInstance().getLatestField();
                agent.tick(state, field).catch(err =>
                    logger.error({ err, npcId }, '[NPC] Agent tick threw.')
                );
            }
        }

        // Prune agents for NPCs that have despawned
        for (const [agentId] of this.agentRegistry) {
            if (!state.npcMap.has(agentId)) {
                this.agentRegistry.delete(agentId);
            }
        }

        // 3. Process Reflexive Pulse (Broadcast to Renderer)
        this.processReflexivePulse(tickCount, state, avatar);

        // 4. Reflexive AI Processing (VibeThinker)
        // If the AI is "Thinking," its responses are injected into the reflex pipe
        if (tickCount % 5 === 0) {
            this.reflexLoop(avatar, state);
        }

        // 5. Idle Wander Behavior (Phase 260)
        // If the avatar is idle, has no goal, and is not busy, pick a random tile nearby every 10 ticks.
        if (tickCount % 10 === 0 && !this.walkGoal && !avatar.isBusy() && (!avatar.currentPath || avatar.currentPath.length === 0)) {
            // 20% chance to wander if idle
            const wanderRng = CanonicalClock.getInstance().rng();
            if (wanderRng.next() < 0.2) {
                const rx = avatar.coord.x + wanderRng.range(-3, 3);
                const ry = avatar.coord.y + wanderRng.range(-3, 3);
                this.setWalkGoal(rx, ry, avatar.coord.plane);
                logger.debug({ x: rx, y: ry }, '[HARNESS] Avatar initiating autonomous idle wander.');
            }
        }

        // 6. Strategic State Reconciliation (Every 6000ms)
        // Note: This is purely Game/Player State related (Brain Sync). 
        // Neurological Health (Heart Audit) has been decoupled to PulseMonitor.
        if (tickCount - this.lastDeepSync >= 10) {
            this.syncGodhead(state, avatar).catch(err => {
                logger.error({ err }, 'Strategic Deep Path sync stalled — retaining last known reality.');
            });
            this.lastDeepSync = tickCount;
        }
    }

    /**
     * pruneEntities - Removes entities from the active simulation state if they are
     * too far from the player to prevent memory exhaustion (FatalOOM).
     */
    private pruneEntities(state: GameState, avatar: SovereignAvatar): void {
        const PRUNE_RADIUS = 100; // 100 tiles
        const PRUNE_RADIUS_SQ = PRUNE_RADIUS * PRUNE_RADIUS;

        let npcPruneCount = 0;
        let itemPruneCount = 0;

        // Prune NPCs
        for (const [key, npc] of state.npcMap.entries()) {
            const dx = npc.x - avatar.coord.x;
            const dy = npc.y - avatar.coord.y;
            if (dx * dx + dy * dy > PRUNE_RADIUS_SQ) {
                state.npcMap.delete(key);
                this.agentRegistry.delete(key as any);
                npcPruneCount++;
            }
        }

        // Prune Ground Items
        if (state.groundItems) {
            for (const [coordKey, items] of state.groundItems.entries()) {
                const parts = coordKey.split(',');
                const x = parseInt(parts[0]);
                const y = parseInt(parts[1]);
                const dx = x - avatar.coord.x;
                const dy = y - avatar.coord.y;
                if (dx * dx + dy * dy > PRUNE_RADIUS_SQ) {
                    state.groundItems.delete(coordKey);
                    itemPruneCount++;
                }
            }
        }

        if (npcPruneCount > 0 || itemPruneCount > 0) {
            logger.info({ npcPruneCount, itemPruneCount }, '[HARNESS] Pruned distant entities to maintain V8 stability.');
        }
    }

    /**
     * processReflexivePulse
     * Executes authoritative logic and broadcasts "id+calls" to the 60fps Strategic Renderer.
     */
    /**
     * processReflexivePulse
     * Executes authoritative logic and broadcasts "id+calls" to the 60fps Strategic Renderer.
     */
    private processReflexivePulse(tick: number, state: GameState, avatar: SovereignAvatar): void {
        const events: TickEvent[] = [];

        // 1. Authoritative NPC Interactions (Dummies & Practice Nodes)
        for (const [npcId] of state.npcMap) {
            const mapping = ServerLogicRegistry.getMapping(18, npcId);
            if (!mapping) continue;

            switch (mapping.signature) {
                case LogicalSignature.PRACTICE_SKILL_NODE:
                    // Authoritative Practice Success Roll
                    if (this.rollSkillSuccess(70, 99, 99)) {
                        events.push({
                            id: `npc_${npcId}`,
                            signature: 'SKILL_SUCCESS',
                            metadata: { practice: true, type: mapping.context, exp: 12.5 },
                            timestamp: CanonicalClock.getInstance().simulatedNow(),
                            truthClass: TruthClass.EXECUTION
                        });
                    }
                    break;
                case LogicalSignature.TRANSPORT_ACTUATOR:
                    events.push({
                        id: `npc_${npcId}`,
                        signature: 'EXPRESSION_TRIGGER',
                        metadata: { pose: 'movement_pulse', duration: 600 },
                        timestamp: CanonicalClock.getInstance().simulatedNow(),
                        truthClass: TruthClass.EXECUTION
                    });
                    break;
            }
        }

        // 2. Object Interactions (Actuators & Stations)
        for (const [objId] of state.objectMap) {
            const mapping = ServerLogicRegistry.getMapping(16, objId);
            if (!mapping) continue;

            switch (mapping.signature) {
                case LogicalSignature.CONSUMABLE_SKILL_STATION:
                    // FOUR-BUCKET AUTHORITATIVE CHECK (Ground, Equipped, Inventory, Bank)
                    // Portable stations typically require a specific item (e.g. Logs/Fish)
                    const substrate = this.checkItemSubstrate(avatar, state, 995, 1); // 995 = Coins (Stackable Placeholder)

                    if (substrate && this.calcProductionSuccessful(1, 99, 99)) {
                        events.push({
                            id: `obj_${objId}`,
                            signature: 'SKILL_SUCCESS',
                            metadata: { substrate: substrate.bucket, amount: substrate.amount, stackable: substrate.stackable, station: true, type: mapping.context, exp: 45.0 },
                            timestamp: CanonicalClock.getInstance().simulatedNow(),
                            truthClass: TruthClass.EXECUTION
                        });
                        logger.debug({ objId, bucket: substrate.bucket, amount: substrate.amount }, 'Consumable success verified across buckets with stackability.');
                    }
                    break;
                case LogicalSignature.BANK_DEPOSIT_ACTUATOR:
                    // Coal Truck Logic: Check if player "has" coal (453) in any bucket to deposit
                    const coalSubstrate = this.checkItemSubstrate(avatar, state, 453, 1);
                    if (coalSubstrate) {
                        events.push({
                            id: `obj_${objId}`,
                            signature: 'ITEM_DROP',
                            metadata: { effect: 'deposit_vfx', source: coalSubstrate.bucket, amount: coalSubstrate.amount, destination: 'bank' },
                            timestamp: CanonicalClock.getInstance().simulatedNow(),
                            truthClass: TruthClass.EXECUTION
                        });
                    }
                    break;
            }
        }

        // 3. Reflexive Combat Processing
        this.processAbilityIntents(tick, state, avatar, events);

        // 4. Tick State Machines (Adrenaline, Cooldowns)
        const av = avatar as any;
        if (av.combatEngine && typeof av.combatEngine.tick === 'function') {
            av.combatEngine.tick();
        }
        for (const [_, npc] of state.npcMap) {
            if ((npc as any).combatEngine && typeof (npc as any).combatEngine.tick === 'function') {
                (npc as any).combatEngine.tick();
            }
        }
    }

    /**
     * Executes combat intents generated by CombatRotationEngine.
     * Evaluates hits, applies damage, and produces hit splats for the tactical loop.
     */
    private processAbilityIntents(tickCount: number, state: GameState, avatar: SovereignAvatar, events: TickEvent[]): void {
        const combatants: any[] = [
            avatar,
            ...Array.from(state.npcMap.values()).map(agent => (agent as any).getNpc ? (agent as any).getNpc() : agent)
        ];
        const engine = CombatRotationEngine.getInstance();
        const book = AbilityBook.getInstance();
        const itemBook = ItemBook.getInstance();

        const chebyshev = (c1: { x: number, y: number }, c2: { x: number, y: number }) => Math.max(Math.abs(c1.x - c2.x), Math.abs(c1.y - c2.y));
        const normalizeAngle = (angle: number) => {
            while (angle <= -Math.PI) angle += 2 * Math.PI;
            while (angle > Math.PI) angle -= 2 * Math.PI;
            return angle;
        };

        for (const entity of combatants) {
            if (!entity.intent) continue;

            const intent = entity.intent;
            if (intent.action === 'execute_ability' || intent.action === 'attack') {
                // Determine target
                let target: any = null;
                if (intent.targetId === 'player_sovereign' || intent.targetId === avatar.id || intent.targetId === 'Sovereign') {
                    target = avatar;
                } else if (typeof intent.targetId === 'number') {
                    const t = state.npcMap.get(intent.targetId);
                    target = t ? (t as any).getNpc ? (t as any).getNpc() : t : null;
                } else if (typeof intent.targetId === 'string' && intent.targetId.startsWith('npc_')) {
                    const t = state.npcMap.get(parseInt(intent.targetId.split('_')[1], 10));
                    target = t ? (t as any).getNpc ? (t as any).getNpc() : t : null;
                }

                if (target) {
                    let weaponTier = 1;
                    let combatLevel = 10; // Default for NPCs without skill data

                    if (entity.id === avatar.id || entity.username === 'Sovereign') {
                        const wId = (avatar.equipment as any)?.['weapon']?.id;
                        weaponTier = Math.max(1, Math.floor(itemBook.getWeaponScalar(wId) / 100));
                        // Derive combat level from the relevant attack skill
                        const attackSkill = avatar.skills?.[0]?.level || 10;  // SkillId.ATTACK = 0
                        const strengthSkill = avatar.skills?.[2]?.level || 10; // SkillId.STRENGTH = 2
                        const rangedSkill = avatar.skills?.[4]?.level || 10;  // SkillId.RANGED = 4
                        const magicSkill = avatar.skills?.[7]?.level || 10;   // SkillId.MAGIC = 7
                        combatLevel = Math.max(attackSkill, strengthSkill, rangedSkill, magicSkill);
                    } else {
                        weaponTier = Math.max(1, Math.floor((entity.metadata?.weaponDamage || 1000) / 100));
                        combatLevel = entity.metadata?.combatLevel || 10;
                    }

                    let ability: AbilityDefinition | undefined;
                    let damage = 0;

                    if (intent.abilityId) {
                        ability = book.get(intent.abilityId);
                        if (ability) {
                            damage = engine.calculateDamage(ability, combatLevel, weaponTier, {
                                bloodlustStacks: (entity as any).bloodlustStacks || 0,
                                animaCharged: !!(entity as any).animaCharged,
                                shadowImbued: ((entity as any).shadowImbuedTicksRemaining || 0) > 0
                            });

                            // ── Adrenaline Economy (March 2026) ──
                            const entAny = entity as any;
                            if (entAny.combatEngine && typeof entAny.combatEngine.useAbility === 'function') {
                                // Try to map the ability ID to a slot
                                const slotIdx = (entAny.actionBarSlots || []).indexOf(ability.id);
                                if (slotIdx !== -1) {
                                    // Use state machine (handles adrenaline and cooldown)
                                    entAny.combatEngine.useAbility(slotIdx);
                                    
                                    // Request animation and GFX models from cache via the bridge (Simulated)
                                    if (this.networkBridge) {
                                        // ability.animId might not exist but this requests dummy files to test the bridge flow
                                        this.networkBridge.requestCacheFile(2, (ability as any).animId || 0).catch(console.error);
                                    }

                                    damage = entAny.combatEngine.slots?.[slotIdx]?.ability?.damage 
                                        ? engine.calculateDamage(ability, combatLevel, weaponTier, {
                                            bloodlustStacks: entAny.bloodlustStacks || 0,
                                            animaCharged: !!entAny.animaCharged,
                                            shadowImbued: (entAny.shadowImbuedTicksRemaining || 0) > 0
                                        }) 
                                        : damage;
                                }
                            } else {
                                // Inline fallback for NPCs
                                if (ability.adrenalineCost > 0) {
                                    entAny.adrenaline = Math.max(0, (entAny.adrenaline || 0) - ability.adrenalineCost);
                                } else if (ability.adrenalineGain > 0) {
                                    entAny.adrenaline = Math.min(10000, (entAny.adrenaline || 0) + ability.adrenalineGain);
                                }
                            }
                        }
                    } else if (intent.action === 'attack') {
                        // Auto-attack: use logarithmic base damage at 50%
                        damage = Math.floor(CombatRotationEngine.logarithmicBaseDamage(combatLevel, weaponTier) * 0.5);
                        // Auto-attacks generate 2% adrenaline (200)
                        entity.adrenaline = Math.min(10000, (entity.adrenaline || 0) + 200);
                    }

                    const applyDamage = (t: any, d: number, modifier: number = 1.0) => {
                        const finalDamage = Math.floor(d * modifier);
                        if (finalDamage <= 0) return;

                        t.combatStats = t.combatStats || { maxHp: 1000, currentHp: 1000 };
                        t.combatStats.currentHp -= finalDamage;

                        const isDead = t.combatStats.currentHp <= 0;

                        events.push({
                            id: entity.id || 'player_sovereign',
                            signature: 'COMBAT_HIT',
                            metadata: { target: t.id || 'player', damage: finalDamage, type: intent.action, abilityId: intent.abilityId, status: isDead ? 'DEAD' : 'ALIVE' },
                            timestamp: CanonicalClock.getInstance().simulatedNow(),
                            truthClass: TruthClass.EXECUTION
                        });

                        logger.info({
                            attacker: entity.id || 'player_sovereign',
                            target: t.id || 'player',
                            damage: finalDamage,
                            ability: intent.abilityId || 'Basic Attack'
                        }, '[COMBAT EXECUTION] Hit splat generation.');

                        if (isDead) {
                            if (t.id && (String(t.id).startsWith('npc_') || typeof t.id === 'number')) {
                                const rawNpcId = typeof t.id === 'string' ? parseInt(t.id.split('_')[1], 10) : t.id;

                                const equippedNames: string[] = [];
                                if (avatar.equipment) {
                                    for (const slotKey in avatar.equipment) {
                                        const equipmentItem = avatar.equipment[slotKey];
                                        if (equipmentItem && equipmentItem.id !== undefined) {
                                            const def = ItemBook.getInstance().get(equipmentItem.id);
                                            if (def && def.name) {
                                                equippedNames.push(def.name);
                                            }
                                        }
                                    }
                                }
                                const luckSnapshot = LuckTierRegistry.getInstance().resolveEffectiveTier(equippedNames);

                                LootResolutionEngine.getInstance().queueDeath({
                                    npcId: rawNpcId,
                                    coord: { x: t.x || t.coord?.x, y: t.y || t.coord?.y, plane: t.plane || t.coord?.plane || 0 },
                                    killerId: entity.id || 'player_sovereign',
                                    tick: tickCount,
                                    luckTier: luckSnapshot
                                });

                                state.npcMap.delete(rawNpcId);
                                this.agentRegistry.delete(rawNpcId);
                            }
                        }
                    };

                    if (damage > 0) {
                        // Main target hit
                        applyDamage(target, damage, 1.0);

                        // AoE Branches
                        if (ability?.flags) {
                            const attackerCoord = entity.coord || { x: entity.x, y: entity.y, plane: entity.plane };

                            // PBAOE
                            if (ability.flags.includes('pbaoe') && ability.aoeRadius) {
                                const aoeRadius = ability.aoeRadius;
                                for (const rawNpc of state.npcMap.values()) {
                                    const npc = (rawNpc as any).getNpc ? (rawNpc as any).getNpc() : rawNpc;
                                    if (npc.id === target.id) continue;
                                    const npcCoord = npc.coord || { x: npc.x, y: npc.y, plane: npc.plane };
                                    if (chebyshev(attackerCoord, npcCoord) <= aoeRadius) {
                                        applyDamage(npc, damage, 0.6);
                                    }
                                }
                            }

                            // CONE
                            else if (ability.flags.includes('cone') && ability.coneHalfAngle) {
                                const dx = target.coord?.x !== undefined ? target.coord.x - attackerCoord.x : target.x - attackerCoord.x;
                                const dy = target.coord?.y !== undefined ? target.coord.y - attackerCoord.y : target.y - attackerCoord.y;
                                const facingAngle = Math.atan2(dy, dx);

                                for (const rawNpc of state.npcMap.values()) {
                                    const npc = (rawNpc as any).getNpc ? (rawNpc as any).getNpc() : rawNpc;
                                    if (npc.id === target.id) continue;
                                    const npcCoord = npc.coord || { x: npc.x, y: npc.y, plane: npc.plane };
                                    const ndx = npcCoord.x - attackerCoord.x;
                                    const ndy = npcCoord.y - attackerCoord.y;
                                    const npcAngle = Math.atan2(ndy, ndx);
                                    const angleDiff = Math.abs(normalizeAngle(npcAngle - facingAngle));

                                    if (angleDiff <= ability.coneHalfAngle && chebyshev(attackerCoord, npcCoord) <= ability.range) {
                                        applyDamage(npc, damage, 0.6);
                                    }
                                }
                            }

                            // CHAIN
                            else if (ability.flags.includes('chain') && ability.chainCount && ability.aoeRadius) {
                                let affectedCount = 0;
                                const primaryTargetCoord = target.coord || { x: target.x, y: target.y, plane: target.plane };
                                for (const rawNpc of state.npcMap.values()) {
                                    const npc = (rawNpc as any).getNpc ? (rawNpc as any).getNpc() : rawNpc;
                                    if (npc.id === target.id) continue;
                                    if (affectedCount >= ability.chainCount) break;

                                    // Chain hits targets close to primary target
                                    const npcCoord = npc.coord || { x: npc.x, y: npc.y, plane: npc.plane };
                                    if (chebyshev(primaryTargetCoord, npcCoord) <= ability.aoeRadius) {
                                        applyDamage(npc, damage, 0.6);
                                        affectedCount++;
                                    }
                                }
                            }
                        }
                    }
                }

                // Clear intent to prevent loop firing
                entity.intent = undefined;
            }
        }

        // Broadcast to Renderer (Strategic Limb)
        if (events.length > 0) {
            this.switchboard?.broadcast({
                type: 'tick_event',
                tick: tickCount,
                events
            });

            // Phase 113: Project combat events to gameplay filesystem cache
            const projection = GameplayProjectionLimb.getInstance();
            if (projection) {
                projection.projectCombatEvents(events, tickCount);
            }
        }
    }

    /**
     * Authoritative Four-Bucket Substrate Search
     * Checks: Ground Item (r=1), Equipped, Inventory, and Banked.
     * Handles: Stackability (Summing amounts across slots).
     */
    private checkItemSubstrate(avatar: SovereignAvatar, state: GameState, itemId: number, requiredAmount: number): { bucket: 'inventory' | 'equipped' | 'ground' | 'bank', amount: number, stackable: boolean } | null {
        // 1. Inventory Check (Stackable Summing)
        let totalInv = 0;
        avatar.inventory.forEach(i => { if (i?.id === itemId) totalInv += i.amount; });
        if (totalInv >= requiredAmount) return { bucket: 'inventory', amount: totalInv, stackable: totalInv > 1 };

        // 2. Equipment Check
        const equipSlot = Object.values(avatar.equipment).find(i => i?.id === itemId) as Item | undefined;
        if (equipSlot) return { bucket: 'equipped', amount: equipSlot.amount, stackable: equipSlot.amount > 1 };

        // 3. Bank Check (Regional Authorization)
        let totalBank = 0;
        avatar.bank.forEach((i: Item) => { if (i.id === itemId) totalBank += i.amount; });
        if (totalBank >= requiredAmount) return { bucket: 'bank', amount: totalBank, stackable: totalBank > 1 };

        // 4. Ground Item Check (Spatial Query within 1 square distance)
        // placeholder for ground item map check once implemented in models.ts

        return null;
    }

    /**
     * Ported Legacy Roll Logic from rolls.js
     */
    private rollSkillSuccess(low: number, high: number, level: number): boolean {
        const threshold = Math.floor((low * (99 - level)) / 98) + Math.floor((high * (level - 1)) / 98) + 1;
        const roll = CanonicalClock.getInstance().rng().range(0, 256);
        return roll <= threshold;
    }

    private calcProductionSuccessful(levelReq: number, skillLevel: number, levelStopFail: number): boolean {
        if (skillLevel < levelReq) return false;
        const roll = CanonicalClock.getInstance().rng().range(1, 256);
        const threshold = Math.min(255, Math.floor(64 + (skillLevel - 1) * (19200.0 / (levelStopFail * 98))));
        return roll <= threshold;
    }

    private async syncGodhead(state: GameState, avatar: SovereignAvatar): Promise<void> {
        if (this.isSyncing) return;
        this.isSyncing = true;

        try {
            logger.debug('ðŸš€ [GODHEAD] Commencing Deep Path Strategic Sync (6000ms pulse)...');

            // Strategy: Use Kimi (Cloud) for the            // 2. Strategic Orientation via DeepSeek/Kimi
            const insight = await this.dispatcher.dispatch({
                capabilityId: 'esoteric_reasoning',
                payload: JSON.stringify({
                    task: 'reconcile_simulation_drift',
                    metadata: {
                        pos: avatar.coord,
                        yao: this.hexagram.getYaoState(),
                        tick: state.tickNumber,
                        genomicContext: this.dbRowOracle.resolveRefillNeed(89) // Authoritative grounding for Pen logic
                    }
                })
            });

            if (insight.ok) {
                logger.info('[GODHEAD] Simulation drift reconciled. Aligning metabolic vectors.');
            }
        } finally {
            this.isSyncing = false;
        }
    }

    private async reflexLoop(avatar: SovereignAvatar, state: GameState): Promise<void> {
        // Only attempt pathfinding if we have a goal and the avatar is idle
        if (!this.walkGoal || !this.pathfinder || this.isPathfinding) return;
        if (avatar.currentPath && avatar.currentPath.length > 0) return; // Still walking
        if (avatar.isBusy()) return;

        const goal = this.walkGoal;

        // Guard: already at destination
        if (avatar.coord.x === goal.x && avatar.coord.y === goal.y) {
            logger.info({ goal }, '[REFLEX] Avatar reached walk goal. Clearing.');
            this.walkGoal = null;
            return;
        }

        this.isPathfinding = true;
        try {
            logger.debug({ from: avatar.coord, to: goal }, '[REFLEX] Pathfinding...');
            // Plot path to target
            let success = false;
            if (avatar.plotPath) {
                success = avatar.plotPath(goal.x, goal.y, this.pathfinder, state);
            }

            if (success) {
                const steps = avatar.currentPath?.length ?? 0;
                logger.info({ from: avatar.coord, to: goal, steps }, '[REFLEX] Path issued — avatar walking.');

                // Broadcast to 3D viewer + renderer
                this.switchboard.broadcast({
                    type: 'tick_event',
                    tick: state.tickNumber,
                    events: [{
                        id: `walk_${CanonicalClock.getInstance().simulatedNow()}`,
                        signature: 'EXPRESSION_TRIGGER',
                        metadata: {
                            pose: 'walk',
                            from: avatar.coord,
                            to: goal,
                            steps,
                        },
                        timestamp: CanonicalClock.getInstance().simulatedNow()
                    }]
                });
            } else {
                logger.warn({ from: avatar.coord, to: goal }, '[REFLEX] No path found to goal. Retrying next reflex pulse.');
            }
        } catch (err) {
            logger.error({ err }, '[REFLEX] Pathfinding threw.');
        } finally {
            this.isPathfinding = false;
        }
    }

    private calculateMetabolicBias(yao: YaoState): number {
        // Adjusts the "chaos" of the simulation based on the I Ching state
        return (yao === YaoState.OldYang) ? 1.5 : 1.0;
    }

    public healthCheck(): { online: boolean; details: string } {
        return { online: true, details: 'Simulation Harness nominal. CNS heartbeat synchronized.' };
    }
}
