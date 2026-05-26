// src/engines/gameplay/JsonLogicInterpreter.ts
// Generic interpreter for pedagogy-driven JSON logic files.
// Handles state transitions, conditions, and spatial interactions.

import { GameplayModule } from './MinigameInterfaces.js';
import { GameState, SovereignAvatar } from '../../core/models.js';
import { SovereignAvatarEntity } from '../../core/SovereignAvatar.js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getAtlasSystemPath } from '../../utils/SovereignPathResolver.js';
import { createLogger } from '../../utils/logger.js';
import { CloudflareSyncLimb } from '../../limbs/spatial/CloudflareSyncLimb.js';

const logger = createLogger('JsonLogicInterpreter');

export class JsonLogicInterpreter implements GameplayModule {
    public name: string = "Json Logic Engine";
    private logic: any = null;
    private fileName: string;
    private edgeSync: CloudflareSyncLimb;

    constructor(fileName: string) {
        this.fileName = fileName.endsWith('.json') ? fileName : `${fileName}.json`;
        this.edgeSync = new CloudflareSyncLimb();
    }

    public async mount(state: GameState, avatar: SovereignAvatar): Promise<void> {
        const path = join(getAtlasSystemPath(), this.fileName);
        if (!existsSync(path)) {
            throw new Error(`Logic file not found at: ${path}`);
        }

        try {
            this.logic = JSON.parse(readFileSync(path, 'utf8'));
            this.name = this.logic.name || "JSON Logic Interpreter";
            logger.info({ name: this.name }, `Mounted logic module from ${this.fileName}`);

            // If the logic contains spatial grounding, teleport the avatar there for testing
            if (this.logic.spatial_grounding?.coordinates) {
                const { x, z, level } = this.logic.spatial_grounding.coordinates;
                avatar.coord = { x, y: z, plane: level }; // RS Map Y is often POG2 Z
                logger.info(`Grounding Avatar at logic anchor: [${x}, ${z}, ${level}]`);
            }

            // Sync pedagogy markers to global state
            if (this.logic.pedagogy_markers?.varbits) {
                for (const vid of this.logic.pedagogy_markers.varbits) {
                    if (!state.varbits.has(vid)) state.varbits.set(vid, 0);
                }
            }

        } catch (e) {
            logger.error({ error: (e as Error).message }, "Failed to mount JSON logic");
            throw e;
        }
    }

    public async onTick(tickCount: number, state: GameState, avatar: SovereignAvatar): Promise<string | null> {
        // Standard tick processing for JSON logic (timers, environmental effects)
        return null;
    }

    public async onAction(action: string, state: GameState, avatar: SovereignAvatar): Promise<string> {
        if (!this.logic?.interactions) return "[Logic] No interactive definitions found.";

        const lowerAction = action.toLowerCase();

        // 1. NPC Interactions (e.g. "talk professor")
        for (const [key, def] of Object.entries(this.logic.interactions)) {
            if (key.startsWith('npc_')) {
                const npcId = parseInt(key.split('_')[1]);
                const npcName = (def as any).name?.toLowerCase() || "";
                
                if (lowerAction.includes('talk') || lowerAction.includes('speak')) {
                    // Check if the query mentions this NPC ID or name
                    if (lowerAction.includes(npcId.toString()) || (npcName && lowerAction.includes(npcName))) {
                        return this.evaluateInteraction((def as any).on_talk, state);
                    }
                }
            }
            
            // 2. Object Interactions (e.g. "click gate", "open door")
            if (key.startsWith('object_')) {
                const objId = parseInt(key.split('_')[1]);
                const objName = (def as any).name?.toLowerCase() || "";
                
                if (lowerAction.includes('click') || lowerAction.includes('open') || lowerAction.includes('use')) {
                    if (lowerAction.includes(objId.toString()) || (objName && lowerAction.includes(objName))) {
                        return this.evaluateInteraction((def as any).on_click, state);
                    }
                }
            }
        }

        return `[Logic] You try to ${action}, but nothing happens.`;
    }

    private evaluateInteraction(branches: any[], state: GameState): string {
        if (!branches || !Array.isArray(branches)) return "[Logic] No behavior defined for this interaction.";

        for (const branch of branches) {
            if (branch.condition === 'default') return branch.action;

            if (this.testCondition(branch.condition, state)) {
                if (branch.next_state) {
                    // Placeholder for actual state-machine transition logic
                    logger.info(`Transitioning logic state: ${branch.next_state}`);
                    // BROADCAST EXACT-MATCH LOGIC TO CLOUDFLARE EDGE
                    this.edgeSync.broadcastStateTransition(this.name, branch.next_state).catch(e => logger.error(e, "Sync failed"));
                }
                return branch.action;
            }
        }

        return "[Logic] The entity stares at you blankly.";
    }

    private testCondition(condition: string, state: GameState): boolean {
        // Simple condition parser: varbit(172) == 0
        const varbitMatch = condition.match(/varbit\((\d+)\)\s*([<>=!]+)\s*(\d+)/);
        if (varbitMatch) {
            const vid = parseInt(varbitMatch[1]);
            const op = varbitMatch[2];
            const val = parseInt(varbitMatch[3]);
            const current = state.varbits.get(vid) || 0;

            if (op === '==' || op === '=') return current === val;
            if (op === '!=') return current !== val;
            if (op === '>=') return current >= val;
            if (op === '<=') return current <= val;
            if (op === '>') return current > val;
            if (op === '<') return current < val;
        }

        return false;
    }
}
