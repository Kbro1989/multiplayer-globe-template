import { existsSync, readFileSync } from 'fs';
import { GameplayModule } from './MinigameInterfaces.js';
import { GameState, SovereignAvatar } from '../../core/models.js';
import { SovereignAvatarEntity } from '../../core/SovereignAvatar.js';
import { resolve } from 'path';
import { CanonicalClock } from '../../utils/CanonicalClock.js';

export class PrifddinasInterpreter implements GameplayModule {
    public readonly name = 'Prifddinas';
    private logicMap: any;

    private readonly VOICE_OF_SEREN_VARBIT = 19147;
    private readonly CLANS = ['Amlodd', 'Cadarn', 'Crwys', 'Hefin', 'Iorwerth', 'Ithell', 'Meilyr', 'Trahaearn'];

    public async mount(state: GameState, avatar: SovereignAvatar): Promise<void> {
        // Teleport avatar to the center of Prifddinas
        avatar.coord = { x: 2206, y: 3362, plane: 1 };
        
        // Load the logic artifact
        const path = 'D:/sovereign/atlas/spatial/prifddinas_logic.json';
        if (existsSync(path)) {
            this.logicMap = JSON.parse(readFileSync(path, 'utf8'));
        }

        // Initialize Voice of Seren to Clan 0 (Amlodd) and Clan 1 (Cadarn) by default
        state.varbits.set(this.VOICE_OF_SEREN_VARBIT, 3); // Example bitwise state
    }

    public async onTick(tickCount: number, state: GameState, avatar: SovereignAvatar): Promise<string | null> {
        // Rotate Voice of Seren every hour (6000 ticks = 1 Hour real time)
        if (tickCount % 6000 === 0) {
            // Randomly select 2 clans
            const rng = CanonicalClock.getInstance().rng();
            const a = rng.range(0, 7);
            let b = a;
            while (b === a) b = rng.range(0, 7);
            
            // Just a mock rotation logic for CLI visualization
            state.varbits.set(this.VOICE_OF_SEREN_VARBIT, a * 10 + b); 
            
            return `[PRIFDDINAS] The Voice of Seren changes! The ${this.CLANS[a]} and ${this.CLANS[b]} clans are now blessed.`;
        }
        return null;
    }

    public async onAction(action: string, state: GameState, avatar: SovereignAvatar): Promise<string> {
        const parts = action.toLowerCase().split(' ');
        
        if (parts[0] === 'voice') {
            const vos = state.varbits.get(this.VOICE_OF_SEREN_VARBIT) || 0;
            return `[PRIFDDINAS] Current Voice of Seren VarBit: ${vos}`;
        }

        if (parts[0] === 'walk' && parts.length === 3) {
            const x = parseInt(parts[1], 10);
            const y = parseInt(parts[2], 10);
            return `[PRIFDDINAS] Attempting to walk to ${x}, ${y}... (Directional Pathfinding hook)`;
        }

        return `[PRIFDDINAS] Unknown action. Try: 'voice', 'walk <x> <y>'`;
    }
}
