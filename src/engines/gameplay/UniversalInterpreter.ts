import { GameplayModule } from './MinigameInterfaces.js';
import { GameState, SovereignAvatar } from '../../core/models.js';
import { SovereignAvatarEntity } from '../../core/SovereignAvatar.js';
import { WorldGroundingLimb } from '../../limbs/world_grounding/WorldGroundingLimb.js';

export class UniversalInterpreter implements GameplayModule {
    public readonly name = 'Universal Substrate';
    private groundingLimb: WorldGroundingLimb;

    constructor() {
        this.groundingLimb = WorldGroundingLimb.getInstance();
    }

    public async mount(state: GameState, avatar: SovereignAvatar): Promise<void> {
        // We do not override avatar.coord. We respect the saved sovereign_state.json
        console.log(`[UNIVERSAL] Spliced into the Godhead. Avatar located at [${avatar.coord.x}, ${avatar.coord.y}, ${avatar.coord.plane}]`);
        
        const truth = this.groundingLimb.resolveSpatialContext(`avatar-${avatar.username}`);
        if (!truth || !truth.position) {
            console.log(`[UNIVERSAL] Manifest sync incomplete or entity unregistered. Relying on visceral heuristics.`);
        }
    }

    public async onTick(tickCount: number, state: GameState, avatar: SovereignAvatar): Promise<string | null> {
        // Universal tick processing
        // Natural regeneration, buffs, etc., could be placed here
        return null;
    }

    public async onAction(action: string, state: GameState, avatar: SovereignAvatar): Promise<string> {
        const parts = action.toLowerCase().split(' ');
        
        if (parts[0] === 'move') {
            const dir = parts[1];
            if (!dir) return "[UNIVERSAL] Move where? (north, south, east, west)";
            
            // Very naive universal walk logic (Godhead handles real collisions elsewhere)
            if (dir === 'north') avatar.coord.y += 1;
            else if (dir === 'south') avatar.coord.y -= 1;
            else if (dir === 'east') avatar.coord.x += 1;
            else if (dir === 'west') avatar.coord.x -= 1;
            
            return `[UNIVERSAL] Avatar transitioned to [${avatar.coord.x}, ${avatar.coord.y}, ${avatar.coord.plane}].`;
        }
        
        if (parts[0] === 'teleport') {
            const x = parseInt(parts[1]);
            const y = parseInt(parts[2]);
            const p = parseInt(parts[3]) || 0;
            if (isNaN(x) || isNaN(y)) return "[UNIVERSAL] Invalid coordinates.";
            
            avatar.coord = { x, y, plane: p };
            return `[UNIVERSAL] Synthesized jump to [${x}, ${y}, ${p}].`;
        }

        if (parts[0] === 'look') {
            const transform = this.groundingLimb.getWorldTransform();
            const pos = { x: avatar.coord.x, y: avatar.coord.y, z: avatar.coord.plane };
            const region = transform.worldToRegion(pos);
            return `[UNIVERSAL] Surroundings: Region ${region.regionId}. Manifest data queries accessible via systemic nodes.`;
        }

        return `[UNIVERSAL] Action '${action}' registered to the Godhead but unresolved by absolute laws.`;
    }
}
