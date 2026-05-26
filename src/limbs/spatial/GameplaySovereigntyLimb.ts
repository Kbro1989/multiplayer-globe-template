import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { GameState, Result, Item, SkillId, EquipmentSlot, NPC, SovereignAvatar, ok, err } from '../../core/models.js';
import { SovereignAvatarEntity } from '../../core/SovereignAvatar.js';
import { GameplayModule } from '../../engines/gameplay/MinigameInterfaces.js';
import { createLogger } from '../../utils/logger.js';
import { CloudflareSyncLimb } from './CloudflareSyncLimb.js';
import { SwitchboardLimb } from '../../monitor/SwitchboardLimb.js';
import { EntityLimb } from '../technical/EntityLimb.js';
import { getSovereignRoot, resolveSovereignPath } from '../../utils/SovereignPathResolver.js';
import * as fs from 'fs';
import * as path from 'path';
import { SimulationHarness } from '../../engines/gameplay/SimulationHarness.js';
import { WorldGroundingLimb } from '../world_grounding/WorldGroundingLimb.js';
import { HexagramManager } from '../../routing/HexagramManager.js';
import { AIDispatcher } from '../../api/ai/Dispatcher.js';
import { ModelClient } from '../../clients/ModelClient.js';
import { SovereignConfig } from '../../config/SovereignConfig.js';
import { TernaryRouter } from '../../routing/TernaryRouter.js';
import { Renderer } from '../../ui/Renderer.js';
import { CombatLimb } from './CombatLimb.js';
import { BankLimb } from './BankLimb.js';
import { ItemLifecycleLimb } from './ItemLifecycleLimb.js';
import { AvatarStateLimb } from './AvatarStateLimb.js';

const logger = createLogger('GameplaySovereigntyLimb');

// Pedagogical Mappings
const CURRENCY_COINS = 22159;
const BANK_BUTTON_DEPOSIT_ALL = 141184642;
const BANK_BUTTON_DEPOSIT_EQUIPMENT = 141184643;

export class GameplaySovereigntyLimb {
    private static instance: GameplaySovereigntyLimb | undefined;
    private isRunning: boolean = false;
    private tickInterval: NodeJS.Timeout | null = null;
    public tickCount: number = 0;
    /** Dirty flag — set on any state mutation, cleared after disk write */
    private stateDirty: boolean = false;
    
    public edgeSync: CloudflareSyncLimb;
    private switchboard: SwitchboardLimb | null = null;
    private entityBrain: EntityLimb | null = null;
    private harness: SimulationHarness | null = null;
    public combat: CombatLimb;
    public items: ItemLifecycleLimb;
    public bankLimb: BankLimb;
    public avatarState: AvatarStateLimb;
    public playerAgent: any; // PlayerAgent brain
    
    public globalState: GameState = {
        plane: 0,
        tickNumber: 0,
        players: new Map(),
        npcMap: new Map(),
        npcSpatialIndex: new Map(),
        objectMap: new Map(),
        groundItems: new Map(),
        graves: new Map(),
        varps: new Map(),
        varcs: new Map(),
        varbits: new Map(),
        lastTickTime: Date.now()
    };

    public avatar: SovereignAvatar;
    private modules: Map<string, GameplayModule> = new Map();
    private activeModuleName: string | null = null;

    protected constructor() {
        if (GameplaySovereigntyLimb.instance) {
            throw new Error('Singleton violation: use GameplaySovereigntyLimb.getInstance()');
        }
        this.avatar = new SovereignAvatarEntity('POG2_Sovereign');
        this.globalState.players.set(this.avatar.username, this.avatar as any);
        this.edgeSync = new CloudflareSyncLimb();
        this.combat = CombatLimb.getInstance();
        this.items = ItemLifecycleLimb.getInstance();
        this.bankLimb = BankLimb.getInstance();
        this.avatarState = AvatarStateLimb.getInstance();
        this.avatarState.bindEntity(this.avatar as SovereignAvatarEntity);
        
        // --- PHASE 72: GROUNDING THE PLAYER TEMPLATE ---
        const templatePath = path.join(process.cwd(), 'public', 'sovereign_entity_player.json');
        if (fs.existsSync(templatePath)) {
            try {
                const template = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
                (this.avatar as SovereignAvatarEntity).hydrate(template);
                logger.info({ npcId: template.entity?.npcId }, 'Avatar grounded in public player template.');
            } catch (err) {
                logger.error({ err }, 'Failed to ground avatar in player template.');
            }
        }
        
        this.playerAgent = null; // Lazy loaded via engagePlayerHarness()
        
        this.loadSovereignState();

        // Phase 112: Hook state changes to Switchboard for real-time viewport sync
        (this.avatar as SovereignAvatarEntity).onStateChange = (type, delta) => {
            if (this.switchboard) {
                this.switchboard.broadcast({
                    type: 'AVATAR_STATE_CHANGE',
                    payload: {
                        type,
                        delta,
                        username: this.avatar.username,
                        timestamp: Date.now()
                    }
                });
            }
        };

        logger.info('GameplaySovereigntyLimb booted as a CNS-authoritative node.');
    }

    public engagePlayerHarness() {
        if (!this.playerAgent) {
            const { PlayerAgent } = require('../../engines/gameplay/PlayerAgent.js');
            this.playerAgent = new PlayerAgent(this.avatar as SovereignAvatarEntity);
            logger.info("Player Harness Engaged via explicit VOLITION (pog2 play or chat command).");
        }
    }

    public static getInstance(): GameplaySovereigntyLimb {
        if (!this.instance) {
            this.instance = new GameplaySovereigntyLimb();
        }
        return this.instance;
    }

    public static resetInstance(): void {
        if (process.env.NODE_ENV === 'production') {
            throw new Error('resetInstance is forbidden in production');
        }
        this.instance = undefined;
    }

    public injectSwitchboard(switchboard: SwitchboardLimb) {
        this.switchboard = switchboard;
        logger.info('Switchboard Bridge injected into Gameplay Limb.');
    }

    public injectEntityLimb(entityLimb: EntityLimb) {
        this.entityBrain = entityLimb;
        logger.info('Entity Brain injected into Gameplay Limb.');
    }

    private loadSovereignState() {
        const statePath = resolveSovereignPath('memory/sovereign_state.json');
        if (fs.existsSync(statePath)) {
            try {
                const data = JSON.parse(fs.readFileSync(statePath, 'utf8'));
                if (data.origin) {
                    this.avatar.coord.x = data.origin.x;
                    this.avatar.coord.y = data.origin.z; 
                    this.avatar.coord.plane = data.origin.plane;
                } else if (data.x !== undefined && data.y !== undefined) {
                    // [LEGACY MIGRATION] Support old RSC Save Format
                    this.avatar.coord.x = data.x;
                    this.avatar.coord.y = data.y;
                    this.avatar.coord.plane = 0; // RSC default
                    logger.info({ x: data.x, y: data.y }, '[SOVEREIGN PERSISTENCE] Legacy RSC origin coordinates ingested.');
                }

                if (data.inventory) {
                    this.avatar.inventory = data.inventory;
                }
                if (data.bank) {
                    this.avatar.bank = data.bank;
                }
                if (data.wallet) {
                    this.avatar.wallet = data.wallet;
                }

                if (data.skills) {
                    // Detect legacy named skills object vs POG2 ID-based object
                    if (data.skills.attack && typeof data.skills.attack.experience === 'number') {
                        // [LEGACY MIGRATION] Map RSC string keys to RS3 IDs
                        const rscSkillMap: Record<string, number> = {
                            attack: 1, defense: 5, strength: 2, hits: 6, ranged: 3, prayer: 7, magic: 4,
                            cooking: 16, woodcutting: 18, fletching: 19, fishing: 15, firemaking: 17,
                            crafting: 11, smithing: 14, mining: 13, herblaw: 9, agility: 8, thieving: 10
                        };
                        for (const [rscName, skillData] of Object.entries(data.skills)) {
                            const rs3Id = rscSkillMap[rscName];
                            if (rs3Id) {
                                const s = skillData as any;
                                this.avatar.skills[rs3Id] = {
                                    id: rs3Id,
                                    name: rscName.toUpperCase(),
                                    level: s.base || s.current || 1,
                                    xp: s.experience || 0
                                };
                            }
                        }
                        logger.info('[SOVEREIGN PERSISTENCE] Legacy RSC skills migrated to RS3 IDs.');
                    } else {
                        Object.entries(data.skills).forEach(([id, skill]: [string, any]) => {
                            this.avatar.skills[parseInt(id)] = skill;
                        });
                    }
                }

                if (data.quests) {
                    this.avatar.quests = data.quests;
                } else if (data.questStages) {
                    // Legacy RSC Quest Stage mapping
                    this.avatar.quests = {
                        points: data.questPoints || 0,
                        completedCount: Object.keys(data.questStages).length,
                        quests: data.questStages
                    };
                }

                if (data.varps) {
                    for (const [id, value] of Object.entries(data.varps)) {
                        this.globalState.varps.set(parseInt(id), value as number);
                    }
                }
                if (data.varbits) {
                    for (const [id, value] of Object.entries(data.varbits)) {
                        this.globalState.varbits.set(parseInt(id), value as number);
                    }
                }
                
                // Legacy custom RSC cache mapped to modern metadata
                if (data.cache) {
                    this.avatar.metadata = { ...this.avatar.metadata, legacyCache: data.cache };
                }
                logger.info({ origin: data.origin }, 'Loaded Sovereign Save State.');
            } catch (err) {
                logger.error({ err }, 'Failed to parse sovereign_state.json');
            }
        }
    }

    public saveSovereignState() {
        const statePath = resolveSovereignPath('memory/sovereign_state.json');
        const state = {
            origin: {
                x: this.avatar.coord.x,
                z: this.avatar.coord.y,
                plane: this.avatar.coord.plane
            },
            inventory: this.avatar.inventory,
            bank: this.avatar.bank,
            wallet: this.avatar.wallet,
            skills: this.avatar.skills,
            quests: this.avatar.quests,
            varps: Object.fromEntries(this.globalState.varps),
            varbits: Object.fromEntries(this.globalState.varbits),
            timestamp: new Date().toISOString()
        };
        fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
        this.stateDirty = false;
        logger.debug('Sovereign State Saved.');
    }

    /** Mark state as dirty — call whenever any avatar field is mutated */
    public markDirty(): void {
        this.stateDirty = true;
    }


    /**
     * Handles interacting with the Bank (Nardah Banker Map)
     */
    public openBank() {
        logger.info('Banking interface manifest triggers. Syncing HUD IDs 141184642+');
        // Logic for bank UI population goes here...
    }

    /**
     * Relief of Inventory -> Bank Transfer
     */
    public depositItem(slot: number, amount: number = 1) {
        const item = this.avatar.removeItem(slot);
        if (item) {
            const existing = this.avatar.bank.find(i => i.id === item.id);
            if (existing) {
                existing.amount += item.amount;
            } else {
                this.avatar.bank.push(item);
            }
            this.stateDirty = true;
            this.saveSovereignState();
        }
    }

    /**
     * Achievement Trigger: Fruitful Labour (ID 346)
     */
    public triggerAchievement(id: number) {
        if (id === 346) {
            logger.info('Achievement: Fruitful Labour triggered. Rewarding 30 Coins.');
            this.awardCurrency(CURRENCY_COINS, 30);
        }
    }

    private awardCurrency(id: number, amount: number) {
        this.avatar.wallet[id] = (this.avatar.wallet[id] || 0) + amount;
        this.stateDirty = true;
        this.saveSovereignState();
    }

    /**
     * registerModule - Attach a new logic interpreter to the limb.
     */
    public registerModule(module: GameplayModule): void {
        this.modules.set(module.name.toLowerCase(), module);
        logger.info({ module: module.name }, 'Gameplay module registered.');
    }

    /**
     * setActiveModule - Docks a specific Region/Minigame logic module onto the active server.
     */
    public async setActiveModule(name: string): Promise<Result<boolean>> {
        const module = this.modules.get(name.toLowerCase());
        if (!module) return err(new Error(`Module '${name}' not found.`));

        if (this.activeModuleName) {
            const current = this.modules.get(this.activeModuleName);
            if (current && (current as any).unmount) {
                await (current as any).unmount(this.globalState, this.avatar);
            }
        }

        logger.info(`Mounting Gameplay Module: ${module.name}`);
        await module.mount(this.globalState, this.avatar);
        this.activeModuleName = name.toLowerCase();
        
        logger.info(`Module ${module.name} loaded and pedagogy synthesized.`);
        return ok(true);
    }

    public get activeModule(): GameplayModule | null {
        return this.activeModuleName ? this.modules.get(this.activeModuleName) || null : null;
    }

    /**
     * Executes a single mechanical tick manually, gated by the CanonicalClock only if simulation is running.
     */
    public async forceTick(): Promise<string | null> {
        if (this.isRunning && !require('../../utils/CanonicalClock.js').clock.isTickingPermitted()) {
            logger.warn('[Sovereign] forceTick() blocked by active cognitive window.');
            return '[Engine] Simulation locked: Cognitive window active.';
        }
        return await this.processTick();
    }

    public async initialize(): Promise<Result<void>> {
        try {
            this.startClock();
            return { ok: true, value: undefined };
        } catch (err) {
            return { ok: false, error: err as Error };
        }
    }

    public startClock() {
        if (this.isRunning) return;
        this.isRunning = true;
        // The 600ms interval is now managed by CNSGodheadPulseVolley (Kernel)
        logger.info('Godhead Sovereign Server Clock handed over to CNS Kernel.');
        
        // Phase 259: Initialize Simulation Harness
        if (!this.harness) {
            logger.warn('[Gameplay] Simulation Harness not yet injected. Running in viscerally grounded mode.');
        }
    }

    public injectHarness(harness: SimulationHarness) {
        this.harness = harness;
        logger.info('Simulation Harness injected into Gameplay Limb.');
    }

    public stopClock() {
        this.isRunning = false;
        logger.info('Server Clock stopped.');
    }

    /**
     * processTick - Authoritative State Advancement, structured by temporal lattice.
     */
    public async processTick(isGameTick: boolean = true): Promise<string | null> {
        this.tickCount++;
        this.globalState.tickNumber = this.tickCount;

        // Vitality Check
        if (this.avatar.isDead && this.avatar.metadata?.deathEvent) {
             this.handlePlayerDeath();
        }

        // --- T3: Optional Cognitive Layer (Always evaluate) ---
        if (this.playerAgent) {
            const ghostSplat = (require('../../substrates/GhostSplatEngine.js')).GhostSplatEngine.getInstance();
            const field = ghostSplat.getLatestField();
            if (field) {
                const hex = HexagramManager.getInstance().getInterpretation();
                const strategy = hex.strategy || '';
                
                if (strategy.includes('EXPANSION') || strategy.includes('ACCELERATION')) this.avatar.metadata.combatArchetype = 'aggressive';
                else if (strategy.includes('STABILIZATION') || strategy.includes('CAUTION')) this.avatar.metadata.combatArchetype = 'methodical';
                else if (strategy.includes('RETREAT') || strategy.includes('PAUSE')) this.avatar.metadata.combatArchetype = 'cowardly';

                this.playerAgent.evaluateTacticalPosition(field);
                if (this.avatar.metadata?.tacticalState !== 'evading' && !this.avatar.isBusy()) {
                    const rotation = this.playerAgent.evaluateCombatRotation(field, this.tickCount);
                    if (rotation) this.avatar.intent = rotation;
                }
            }
        }

        // --- T2: Player Reflex Pulse (300ms) ---
        if (this.playerAgent) {
            this.playerAgent.advanceTick(300);
        }

        // --- T1: Game Truth Boundary (600ms) ---
        if (isGameTick) {
            // T1 Metabolic Pulse (Sync every 6s)
            if (this.tickCount % 10 === 0 && this.playerAgent) {
                HexagramManager.getInstance().updateState({ buildPass: true, userActive: true, noRecentErrors: true, substrateHealthy: !this.avatar.isDead, authorityLocal: true, auditSync: true });
            }
            
            // NPC World Pulse
            for (const npc of this.globalState.npcMap.values()) {
                if (npc.brain) npc.brain.think(this.tickCount, this.globalState, this.avatar);
                if (npc.interactionState === 'MOVING' && npc.target && typeof npc.target !== 'number') {
                    npc.x += Math.sign(npc.target.x - npc.x);
                    npc.y += Math.sign(npc.target.y - npc.y);
                }
            }
            
            // Deterministic Harness Sync
            if (this.harness) await this.harness.processTick(this.tickCount, this.globalState, this.avatar);

            // Persistence
            if (this.stateDirty && this.tickCount % 10 === 0) this.saveSovereignState();
        }

        // Finalize Mechanics (T1/T2 shared)
        this.processCombatTick();
        this.avatar.processTick();

        // Finalize Sync
        let moduleResult: string | null = null;
        if (this.activeModule) moduleResult = await this.activeModule.onTick(this.tickCount, this.globalState, this.avatar);

        if (this.switchboard) {
            this.switchboard.syncGameState({
                tick: this.tickCount,
                avatar: {
                    username: this.avatar.username,
                    x: this.avatar.coord.x,
                    y: this.avatar.coord.y,
                    plane: this.avatar.coord.plane,
                    inventory: this.avatar.inventory,
                    wallet: this.avatar.wallet,
                    bank: this.avatar.bank,
                    skills: this.avatar.skills,
                    quests: this.avatar.quests,
                    isBusy: this.avatar.isBusy()
                },
                activeModule: this.activeModule?.name || 'idle'
            });
        }

        return moduleResult;
    }

    public async pushAction(action: string): Promise<string> {
        if (!this.activeModule) {
            return "[Engine] No active gameplay module mounted.";
        }
        
        if (this.avatar.isBusy()) {
            return `[Engine] You are busy for ${this.avatar.lockTicks} more ticks.`;
        }

        return await this.activeModule.onAction(action, this.globalState, this.avatar);
    }

    private processCombatTick() {
        const combatants: NPC[] = [this.avatar, ...Array.from(this.globalState.npcMap.values())];

        for (const actor of combatants) {
            if (!actor.intent) continue;

            if (actor.intent.action === 'castAbility' || actor.intent.action === 'COMBAT_ABILITY' || actor.intent.action === 'execute_ability' || actor.intent.action === 'attack') {
                this.resolveCombatIntent(actor);
            }
        }
    }

    private resolveCombatIntent(actor: NPC) {
        const intent = actor.intent as any;
        const targetId = intent.targetId;

        // Resolve target
        let target: NPC | undefined;
        if (targetId === 'player') {
            target = this.avatar;
        } else if (typeof targetId === 'string' && targetId.startsWith('npc_')) {
            const id = parseInt(targetId.split('_')[1]);
            target = this.globalState.npcMap.get(id);
        } else if (typeof targetId === 'number') {
            target = this.globalState.npcMap.get(targetId);
        }

        if (!target) return;

        const abilityId = intent.abilityId || '1'; // Default to Basic Attack if undefined
        const check = this.combat.canCast(actor, target, abilityId, this.tickCount);

        if (check.success) {
            // FIRE!
            this.combat.execute(actor, target, abilityId, this.tickCount);
            
            // Set interaction state
            actor.interactionState = 'EXECUTING';

            // If it's the avatar, clear intent after non-auto ability? 
            // For now, keep simple auto-attack loop logic.
        } else if (check.reason?.includes('Out of range') || check.inRange === false) {
            // OUT OF RANGE: Actor enters MOVING state towards target
            actor.interactionState = 'MOVING';
            // Authoritative target update
            actor.target = { x: target.x, y: target.y, plane: target.plane };
        }
    }

    private handlePlayerDeath() {
        const x = this.avatar.x;
        const y = this.avatar.y;
        const p = this.avatar.plane;

        logger.info(`AUTHENTIC DEATH: Sovereign falling at (${x}, ${y}). Dropping Grave.`);

        // 1. Process Item Loss (Keep 3 Rule)
        const droppedItems = this.avatar.authenticDie();

        // 2. Spawn Grave Marker (ID 13296)
        const graveId = `grave_${this.avatar.username}_${this.tickCount}`;
        const graveKey = `${x},${y},${p}`;
        
        const graveMarker = {
            id: graveId,
            items: droppedItems,
            x: x,
            y: y,
            plane: p,
            owner: this.avatar.username,
            creationTick: this.tickCount,
            expiryTick: this.tickCount + 6000 // 1 Hour (Authentic)
        };
        
        this.globalState.graves!.set(graveKey, graveMarker);

        // Visible Entity for Grounding
        this.globalState.npcMap.set(this.tickCount + 5000, {
            id: 13296, // Gravelord / Standard Grave
            name: `${this.avatar.username}'s Grave`,
            x: x,
            y: y,
            plane: p,
            combat: 0,
            adrenaline: 0,
            necrosisStacks: 0,
            residualSouls: 0,
            lastCombatTick: 0,
            cooldowns: {},
            metadata: { isGrave: true, graveId: graveId }
        } as any);

        // 3. Relocation to Last Hub (Lumbridge by default)
        this.avatar.respawn();

        this.saveSovereignState();
    }

    public handleInteraction(targetId: string, actionId: number) {
        logger.info(`INTERACTION: ${targetId} with Action ${actionId}`);
        
        // 1. Grave Recovery Logic
        if (targetId.startsWith('grave_') || actionId === 1) {
            const graveKey = `${this.avatar.x},${this.avatar.y},${this.avatar.plane}`;
            const grave = this.globalState.graves!.get(graveKey);
            
            if (grave && grave.owner === this.avatar.username) {
                logger.info(`RECOVERING GRAVE: Restoring ${grave.items.length} items.`);
                grave.items.forEach(item => this.avatar.addItem(item));
                this.globalState.graves!.delete(graveKey);
                // Remove visual marker
                for (const [id, npc] of this.globalState.npcMap.entries()) {
                     if ((npc as any).metadata?.graveId === grave.id) {
                         this.globalState.npcMap.delete(id);
                     }
                }
                return;
            }
        }

        // 2. Ground Item Logic (Action 1: Pick Up)
        if (actionId === 1 && targetId.startsWith('ground_')) {
            const key = `${this.avatar.x},${this.avatar.y},${this.avatar.plane}`;
            const items = this.globalState.groundItems!.get(key);
            if (items && items.length > 0) {
                const item = items.shift()!;
                if (this.avatar.addItem(item)) {
                    logger.info(`PICK UP: ${item.id} added to inventory.`);
                } else {
                    items.unshift(item); // Put it back
                    logger.warn('PICK UP FAILED: Inventory full.');
                }
                return;
            }
        }

        // 3. Bank Logic (Action 184: Bank)
        if (actionId === 184) {
             this.avatar.metadata = {
                 ...this.avatar.metadata,
                 activeInterface: 762,
                 bankOpen: true
             };
             logger.info('NIS Bank Interface (ID 762) requested.');
        }

        // 4. Bank Shortcuts (Cache Derived)
        if (actionId === 141184642) { // Deposit All
             logger.info('BANK_SHORTCUT: Deposit All');
             this.avatar.inventory.forEach((item, slot) => {
                 if (item) this.bankLimb.deposit(this.avatar, slot, item.amount);
             });
        }

        if (actionId === 141184643) { // Deposit Equipment
             logger.info('BANK_SHORTCUT: Deposit Equipment');
             Object.keys(this.avatar.equipment).forEach(slot => {
                 const item = this.avatar.equipment[slot];
                 if (item) {
                     // Move to inv then bank or direct? Direct for shortcut.
                     this.bankLimb.deposit(this.avatar as any, -1, item.amount); // -1 triggers direct equip depo in logic
                     this.avatar.setEquipmentSlot(slot as any, null);
                 }
             });
        }
    }
}

