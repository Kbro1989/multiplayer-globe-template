import * as fs from 'fs';
import * as path from 'path';
import { GameState, YaoState, MovingLine } from '../../core/models.js';
import { WorldForensicsLimb, ObjectDefinition } from './WorldForensicsLimb.js';
import { createLogger } from '../../utils/logger.js';
import { SpatialSovereigntyLimb } from './SpatialSovereigntyLimb.js';
import { GameplaySovereigntyLimb } from './GameplaySovereigntyLimb.js';
import { EpistemicTransitionKernel } from '../../engines/core/EpistemicTransitionKernel.js';
import { HexagramManager } from '../../routing/HexagramManager.js';
import { rsmvBridge } from '../../utils/RSMVBridge.js';

const logger = createLogger('VarbitSovereigntyLimb');

/**
 * VarbitSovereigntyLimb - Neural Link for dynamic game state.
 * Resolves which state (models/collisions) of an object is currently manifested.
 */
export class VarbitSovereigntyLimb {
    private static instance: VarbitSovereigntyLimb;
    private forensics: WorldForensicsLimb;

    private constructor() {
        this.forensics = WorldForensicsLimb.getInstance();
    }

    private definitions: Map<number, { parentVarpId: number, lsb: number, msb: number }> = new Map();
    private varpToVarbits: Map<number, number[]> = new Map(); // Index to find affected varbits quickly

    public static getInstance(): VarbitSovereigntyLimb {
        if (!VarbitSovereigntyLimb.instance) {
            VarbitSovereigntyLimb.instance = new VarbitSovereigntyLimb();
        }
        return VarbitSovereigntyLimb.instance;
    }

    public async initialize(): Promise<void> {
        await this.forensics.initialize();
        this.loadRegistry();
    }

    /**
     * loadRegistry - Ingests the authoritative varbit-to-varp mappings from the Pedagogy KB.
     */
    private loadRegistry(): void {
        const registryPath = 'D:\\sovereign\\memory\\pedagogy\\varbits_registry.json';
        if (!fs.existsSync(registryPath)) {
            logger.warn('Varbit Registry missing. Morphism resolution will use fallbacks.');
            return;
        }

        try {
            const data = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
            for (const [idStr, entry] of Object.entries(data)) {
                const id = parseInt(idStr);
                const e = entry as any;
                const def = {
                    parentVarpId: e.varid,
                    lsb: e.bits[0],
                    msb: e.bits[1]
                };
                this.definitions.set(id, def);

                // Build inverse index for collision invalidation
                if (!this.varpToVarbits.has(e.varid)) {
                    this.varpToVarbits.set(e.varid, []);
                }
                this.varpToVarbits.get(e.varid)!.push(id);
            }
            logger.info(`Varbit Registry loaded: ${this.definitions.size} mappings ingested.`);
        } catch (error) {
            logger.error({ error }, 'Failed to load Varbit Registry.');
        }
    }

    public resolveCurrentObjectIdFromDef(def: ObjectDefinition, gameState: GameState): number {
        if (!def.transforms || def.transforms.length === 0) {
            return def.id;
        }

        let index = -1;
        if (def.varbitId !== undefined && def.varbitId !== -1) {
            // AUTHORITATIVE: Resolve varbit bit-window from parent varp
            index = this.resolveVarbitValue(def.varbitId, gameState);
        } else if (def.varpId !== undefined && def.varpId !== -1) {
            // Varp fallback
            const value = gameState.varps.get(def.varpId) || 0;
            index = value;
        }

        if (index >= 0 && index < def.transforms.length) {
            const transformedId = def.transforms[index];
            if (transformedId !== -1) {
                return transformedId;
            }
        }

        return def.defaultTransformId !== undefined && def.defaultTransformId !== -1 
            ? def.defaultTransformId 
            : def.id;
    }

    /**
     * resolveVarbitValue - Extracts the bit-window from the parent Varp.
     * Logic: value = (varp >> lsb) & ((1 << (msb - lsb + 1)) - 1)
     */
    public resolveVarbitValue(varbitId: number, gameState: GameState): number {
        // Phase 11: Probe/Fallback definition. In a production run, this loads from table_X.json
        const def = this.getVarbitDefinition(varbitId);
        if (!def) return gameState.varbits.get(varbitId) || 0;

        const parentValue = gameState.varps.get(def.parentVarpId) || 0;
        const mask = ((1 << (def.msb - def.lsb + 1)) - 1);
        const resolved = (parentValue >> def.lsb) & mask;
        
        // Cache the resolved value for quick lookups
        gameState.varbits.set(varbitId, resolved);
        return resolved;
    }

    /**
     * setVarbit - Mutates a specific varbit, calculates the new parent Varp value, and triggers invalidation.
     */
    public async setVarbit(id: number, value: number, gameState: GameState): Promise<void> {
        const def = this.getVarbitDefinition(id);
        if (!def) {
            logger.warn({ id }, 'Attempted to set an undefined varbit. Storing in isolated cache.');
            gameState.varbits.set(id, value);
            return;
        }

        const parentValue = gameState.varps.get(def.parentVarpId) || 0;
        const mask = ((1 << (def.msb - def.lsb + 1)) - 1);
        
        // Clear the old bit-window
        let newVarpValue = parentValue & ~(mask << def.lsb);
        // Insert the new value
        newVarpValue |= ((value & mask) << def.lsb);

        logger.info({ varbitId: id, value, parentVarp: def.parentVarpId, oldVarp: parentValue, newVarp: newVarpValue }, 'Authoritative VARBIT Update');
        await this.setVarp(def.parentVarpId, newVarpValue, gameState);
    }

    /**
     * setVarp - Updates a player variable and triggers varbit cache invalidation.
     * In Phase 13, this also triggers Spatial manifestations for affected objects.
     */
    public async setVarp(id: number, value: number, gameState: GameState): Promise<void> {
        const oldValue = gameState.varps.get(id) || 0;
        if (oldValue === value) return;

        gameState.varps.set(id, value);
        GameplaySovereigntyLimb.getInstance().markDirty();
        logger.info({ id, oldValue, newValue: value }, 'Authoritative VARP Update');

        // Kernel signal: Varp mutation is a high-confidence gameplay state change
        // Emit as MovingLine Line 4 (external world engagement)
        const line: MovingLine = {
            position: 4,
            fromState: oldValue > 0 ? 'YANG' : 'YIN',
            toState: value > 0 ? 'YANG' : 'YIN',
            confidence: 1.0,
            source: 'VarbitSovereigntyLimb',
            timestamp: Date.now()
        };
        try {
            const kernel = EpistemicTransitionKernel.getInstance();
            const yao = HexagramManager.getInstance().getYaoState();
            kernel.observeTransition(yao, 1.0, [line]);
        } catch {
            // Initialization phase
        }

        // Phase 13: World Manifestation Trigger
        const affectedVarbits = this.varpToVarbits.get(id) || [];
        
        // Phase-aware gating: skip heavy remanifest during DEGRADING
        try {
            const kernel = EpistemicTransitionKernel.getInstance();
            if (kernel.getPhaseGateMultiplier() < 0.3) {
                logger.warn({ varpId: id, phase: kernel.getCurrentPhase() },
                    'Remanifest deferred: kernel in DEGRADING phase.');
                return;
            }
        } catch { /* kernel not initialized */ }

        // Find all objects in the current local area and check if they depend on these varbits/varp
        await this.remanifestAffectedObjects(id, affectedVarbits, gameState);
    }

    /**
     * remanifestAffectedObjects - Scans active world for objects that need a visual/collision flip.
     */
    private async remanifestAffectedObjects(varpId: number, affectedVarbits: number[], gameState: GameState): Promise<void> {
        if (!gameState.objectMap) {
            logger.debug({ varpId }, 'remanifestAffectedObjects: objectMap not present, skipping.');
            return;
        }
        logger.info({ varpId, objectMapSize: gameState.objectMap.size }, 'Entering remanifestAffectedObjects');
        const spatial = SpatialSovereigntyLimb.getInstance();
        logger.info('Spatial limb accessed.');
        
        // Scan the active world state for morphing objects
        for (const [id, obj] of gameState.objectMap.entries()) {
            try {
                const numericId = Number(id);
                const def = await this.forensics.getObjectDefinition(numericId);
                
                // Authoritative Logic Check
                const isAffected = (def.varpId === varpId) || 
                                   (def.varbitId !== undefined && affectedVarbits.includes(def.varbitId));
                
                logger.info({ 
                    id: numericId, 
                    isAffected, 
                    defVarp: def.varpId, 
                    targetVarp: varpId,
                    hasTransforms: !!def.transforms 
                }, 'Morphism Potential Checked');

                if (isAffected && def.transforms) {
                    const oldManifestedId = obj.id || obj.id;
                    const newManifestedId = this.resolveCurrentObjectIdFromDef(def, gameState);
                    
                    if (oldManifestedId !== newManifestedId) {
                        logger.info({ 
                            id: numericId, 
                            from: oldManifestedId, 
                            to: newManifestedId 
                        }, '⚠️ MORPHISM TRIGGERED');
                        
                        obj.id = newManifestedId;
                        await spatial.swapObjectManifestation(obj.x, obj.y, obj.plane, oldManifestedId, newManifestedId);

                        // Kernel signal: Confirmed world-state change = maximum confidence
                        this.emitKernelSignal(1.0);
                    } else {
                        logger.info({ id: numericId }, 'Morphism skip: Manifested ID unchanged.');
                    }
                }
            } catch (tileError) {
                logger.error({ tileError, objectId: id }, 'Error in remanifestAffectedObjects loop.');
            }
        }
    }

    public injectVarbitDefinition(id: number, def: { parentVarpId: number, lsb: number, msb: number }): void {
        this.definitions.set(id, def);
    }

    private getVarbitDefinition(varbitId: number): { parentVarpId: number, lsb: number, msb: number } | null {
        return this.definitions.get(varbitId) || null; 
    }

    public getForensics(): WorldForensicsLimb {
        return this.forensics;
    }

    /**
     * hasVarbitDefinition — Check if the L1 static registry contains a definition.
     * Used by StateProvider to decide whether to trigger async fallback.
     */
    public hasVarbitDefinition(varbitId: number): boolean {
        return this.definitions.has(varbitId);
    }

    /**
     * resolveVarbitDefinitionFromCache — Async fallback that loads a single varbit
     * definition from the live NXT JCACHE via the rsmv bridge subprocess.
     *
     * If the bridge returns valid data, the definition is permanently injected
     * into the in-memory L1 registry and the varpToVarbits inverse index.
     */
    public async resolveVarbitDefinitionFromCache(varbitId: number): Promise<{ parentVarpId: number, lsb: number, msb: number } | null> {
        // Already loaded?
        if (this.definitions.has(varbitId)) {
            return this.definitions.get(varbitId)!;
        }

        const result = await rsmvBridge.getVarbit(varbitId);
        if (!result.ok) {
            logger.warn({ varbitId, error: result.error?.message }, 'Failed to resolve varbit definition from live cache.');
            return null;
        }

        const raw = result.value;
        const parentVarpId = raw.varid;
        if (parentVarpId === undefined || parentVarpId === null) {
            logger.warn({ varbitId, raw }, 'Bridge returned varbit without varid.');
            return null;
        }

        let lsb: number;
        let msb: number;

        if (raw.bits && Array.isArray(raw.bits) && raw.bits.length === 2) {
            lsb = raw.bits[0];
            msb = raw.bits[1];
        } else if (raw.lsb !== undefined && raw.msb !== undefined) {
            lsb = raw.lsb;
            msb = raw.msb;
        } else if (raw.bitcount !== undefined && raw.bitcount > 0) {
            lsb = 0;
            msb = raw.bitcount - 1;
        } else {
            logger.warn({ varbitId, raw }, 'Bridge returned varbit without bit-window data.');
            return null;
        }

        const def = { parentVarpId, lsb, msb };
        this.injectVarbitDefinition(varbitId, def);

        // Update inverse index
        if (!this.varpToVarbits.has(parentVarpId)) {
            this.varpToVarbits.set(parentVarpId, []);
        }
        this.varpToVarbits.get(parentVarpId)!.push(varbitId);

        logger.info({ varbitId, parentVarpId, lsb, msb }, 'Varbit definition resolved from live cache and injected.');
        return def;
    }

    /**
     * emitKernelSignal — Feeds a causal confidence observation into the predictive kernel.
     * Safe to call even if the kernel or HexagramManager aren't initialized yet.
     */
    private emitKernelSignal(confidence: number): void {
        try {
            const kernel = EpistemicTransitionKernel.getInstance();
            const yao = HexagramManager.getInstance().getYaoState();
            kernel.observeTransition(yao, confidence);
        } catch {
            // Kernel or HexagramManager not yet initialized
        }
    }
}
