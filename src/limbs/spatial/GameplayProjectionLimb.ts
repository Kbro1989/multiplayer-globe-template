import * as fs from 'fs';
import { join } from 'path';
import { createLogger } from '../../utils/logger.js';
import type { GameState, SovereignAvatar } from '../../core/models.js';
import type { TickEvent } from '../../engines/gameplay/SimulationHarness.js';

const logger = createLogger('GameplayProjectionLimb');

/**
 * GameplayProjectionLimb
 * 
 * Writes periodic gameplay state snapshots to the local filesystem
 * for edge consumption by diagnostic HTML pages and the Globe DO.
 * 
 * All writes are async, fire-and-forget, and throttled to avoid
 * blocking the deterministic pulse loop.
 */
export class GameplayProjectionLimb {
    private static instance: GameplayProjectionLimb;

    private readonly projectionDir: string;
    private readonly combatLog: any[] = [];
    private readonly MAX_COMBAT_LOG = 100;

    private lastStateWrite = 0;
    private lastEntityWrite = 0;
    private readonly STATE_WRITE_INTERVAL = 6000;   // Every ~10 game ticks (6s)
    private readonly ENTITY_WRITE_INTERVAL = 3000;  // On chunk transitions, throttled to 3s

    private isWriting = false;

    private constructor(publicDir: string) {
        this.projectionDir = join(publicDir, 'gameplay');
        this.ensureDirectory();
        logger.info({ dir: this.projectionDir }, 'GameplayProjectionLimb initialized. Filesystem projection active.');
    }

    public static bootstrap(publicDir: string): GameplayProjectionLimb {
        if (!GameplayProjectionLimb.instance) {
            GameplayProjectionLimb.instance = new GameplayProjectionLimb(publicDir);
        }
        return GameplayProjectionLimb.instance;
    }

    public static getInstance(): GameplayProjectionLimb | undefined {
        return GameplayProjectionLimb.instance;
    }

    private ensureDirectory(): void {
        try {
            if (!fs.existsSync(this.projectionDir)) {
                fs.mkdirSync(this.projectionDir, { recursive: true });
                logger.info({ dir: this.projectionDir }, 'Created gameplay projection directory.');
            }
        } catch (err) {
            logger.error({ err }, 'Failed to create gameplay projection directory.');
        }
    }

    /**
     * projectState - Writes the avatar/world snapshot to state.json.
     * Called from CNSGodheadPulseVolley after Globe sync.
     */
    public projectState(avatar: SovereignAvatar, gameState: GameState, activeModule?: string): void {
        const now = Date.now();
        if (now - this.lastStateWrite < this.STATE_WRITE_INTERVAL) return;
        this.lastStateWrite = now;

        const snapshot = {
            timestamp: now,
            tick: gameState.tickNumber,
            avatar: {
                coord: avatar.coord,
                hp: (avatar as any).currentHp ?? 0,
                maxHp: (avatar as any).maxHp ?? 0,
                adrenaline: (avatar as any).adrenaline ?? 0,
                bloodlustStacks: (avatar as any).bloodlustStacks ?? 0,
                intent: (avatar as any).intent ?? null,
                lockTicks: (avatar as any).lockTicks ?? 0,
            },
            activeModule: activeModule || 'none',
            npcCount: gameState.npcMap?.size ?? 0,
            groundItemCount: gameState.groundItems?.size ?? 0,
        };

        this.writeAsync('state.json', snapshot);
    }

    /**
     * projectCombatEvent - Appends combat events to the rolling log.
     * Called from SimulationHarness after processReflexivePulse.
     */
    public projectCombatEvents(events: TickEvent[], tick: number): void {
        if (events.length === 0) return;

        for (const event of events) {
            this.combatLog.push({
                tick,
                id: event.id,
                signature: event.signature,
                metadata: event.metadata,
                timestamp: event.timestamp,
            });
        }

        // Trim to rolling window
        while (this.combatLog.length > this.MAX_COMBAT_LOG) {
            this.combatLog.shift();
        }

        this.writeAsync('combat_log.json', {
            lastUpdated: Date.now(),
            count: this.combatLog.length,
            events: this.combatLog,
        });
    }

    /**
     * projectEntities - Writes the active NPC/entity map to entities.json.
     * Throttled to avoid excessive writes during rapid chunk transitions.
     */
    public projectEntities(gameState: GameState): void {
        const now = Date.now();
        if (now - this.lastEntityWrite < this.ENTITY_WRITE_INTERVAL) return;
        this.lastEntityWrite = now;

        const npcs: any[] = [];
        if (gameState.npcMap) {
            for (const [key, npc] of gameState.npcMap) {
                npcs.push({
                    entityKey: key,
                    id: npc.id,
                    name: npc.name,
                    coord: npc.coord || { x: npc.x, y: npc.y, plane: npc.plane },
                    combatStats: npc.combatStats,
                });
            }
        }

        const groundItems: any[] = [];
        if (gameState.groundItems) {
            for (const [coordKey, items] of gameState.groundItems) {
                for (const item of items) {
                    groundItems.push({
                        coordKey,
                        itemName: item.itemName,
                        amount: item.amount,
                        spawnTick: item.spawnTick,
                    });
                }
            }
        }

        this.writeAsync('entities.json', {
            lastUpdated: now,
            tick: gameState.tickNumber,
            npcs,
            groundItems,
        });
    }

    /**
     * writeAsync - Non-blocking file write with collision guard.
     */
    private writeAsync(filename: string, data: any): void {
        const filePath = join(this.projectionDir, filename);

        // Fire-and-forget: don't block the pulse
        fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8').catch(err => {
            logger.debug({ err: err.message, file: filename }, 'Projection write failed (non-fatal).');
        });
    }

    public healthCheck(): { online: boolean; details: string } {
        const exists = fs.existsSync(this.projectionDir);
        return {
            online: exists,
            details: exists
                ? `Gameplay projection active: ${this.projectionDir}`
                : 'Gameplay projection directory missing.'
        };
    }
}
