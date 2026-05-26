import { existsSync, readFileSync } from 'fs';
import { GameplayModule } from './MinigameInterfaces.js';
import { GameState, SovereignAvatar } from '../../core/models.js';
import { SovereignAvatarEntity } from '../../core/SovereignAvatar.js';
import { stateProvider } from '../../utils/StateProvider.js';

export class PestControlInterpreter implements GameplayModule {
    public readonly name = 'Pest Control';
    private logicMap: any;
    
    private knightHP = 200;
    private shields = {
        purple: 100,
        blue: 100,
        yellow: 100,
        red: 100
    };

    public async mount(state: GameState, avatar: SovereignAvatar): Promise<void> {
        // Drop them at Void Knight Outpost lander
        avatar.coord = { x: 2657, y: 2639, plane: 0 };
        
        const path = 'D:/sovereign/atlas/logic/pest_control_logic.json';
        if (existsSync(path)) {
            this.logicMap = JSON.parse(readFileSync(path, 'utf8'));
            console.log(`[PEST_CONTROL] Logic map loaded. Shield varbits synced.`);
        }

        // Pre-resolve varbit definitions from the live cache before first tick
        // These are the portal shield state varbits + knight status
        const PORTAL_VARBITS = [1230, 1231, 1232, 1233, 1234];
        await stateProvider.preResolveVarbits(PORTAL_VARBITS);

        // Initialize portal states via authoritative StateProvider
        await stateProvider.setVarbit(1230, 1, state); // Purple active
        await stateProvider.setVarbit(1231, 1, state); // Blue active
        await stateProvider.setVarbit(1232, 1, state); // Yellow active
        await stateProvider.setVarbit(1233, 1, state); // Red active
        await stateProvider.setVarbit(1234, 0, state); // Knight passive
    }

    public async onTick(tickCount: number, state: GameState, avatar: SovereignAvatar): Promise<string | null> {
        // Knight takes 1 damage every 15 ticks (9 seconds) if portals are up
        const activePortals = Object.values(this.shields).filter(s => s > 0).length;
        if (activePortals > 0 && tickCount % 15 === 0) {
            this.knightHP -= activePortals * 2; // Damage scales with portals
            
            if (this.knightHP <= 0) {
                return `[PEST_CONTROL] The Void Knight has fallen. The pests overrun the island.`;
            }

            // Drop a shield periodically (Mock logic: drop a shield every 300 ticks / 3 mins for CLI)
            if (tickCount % 50 === 0) { // sped up for testing
                const colors = Object.keys(this.shields) as Array<keyof typeof this.shields>;
                for (const c of colors) {
                    if (this.shields[c] > 0) {
                        return `[PEST_CONTROL] The Void Knight drops the shield on the ${c.toUpperCase()} portal! (Attack it now)`;
                    }
                }
            }

            return `[PEST_CONTROL] The Void Knight is under attack! (HP: ${this.knightHP}/200)`;
        }

        // If all portals are dead, win
        if (activePortals === 0) {
            return `[PEST_CONTROL] All portals destroyed! The Void Knight survives. You win 5 Pest Commendations.`;
        }

        return null;
    }

    public async onAction(action: string, state: GameState, avatar: SovereignAvatar): Promise<string> {
        const parts = action.toLowerCase().split(' ');
        
        if (parts[0] === 'attack') {
            const portal = parts[1] as keyof typeof this.shields;
            
            if (!this.shields[portal]) {
                return `[PEST_CONTROL] There is no ${portal} portal or it is already destroyed.`;
            }

            if (this.shields[portal] === 100) {
                // Determine if shield is dropped (mocking based on tick count for the CLI)
                // In a real game, the tick logic sets the varbit.
                const isShielded = (state.tickNumber || 0) % 100 !== 0; // arbitrary
                if (isShielded) {
                    return `[PEST_CONTROL] The ${portal} portal's shield absorbs your attack. You must wait for the Void Knight to drop it.`;
                }
                // Plot path to target
                let success = false;
                const goal = { x: 2657, y: 2639 }; // Placeholder coordinates
                if (avatar.plotPath) {
                    success = avatar.plotPath(goal.x, goal.y, null, state);
                }
            }

            this.shields[portal] -= 25; // Player hits a 25
            
            if (this.shields[portal] <= 0) {
                // Update varbit
                const varbitMap: any = { purple: 1230, blue: 1231, yellow: 1232, red: 1233 };
                await stateProvider.setVarbit(varbitMap[portal], 0, state);
                return `[PEST_CONTROL] You shattered the ${portal} portal!`;
            }

            return `[PEST_CONTROL] You attack the ${portal} portal. (Shield Integrity: ${this.shields[portal]}%)`;
        }

        if (parts[0] === 'repair') {
            return `[PEST_CONTROL] You repair the barricades near the knight.`;
        }

        return `[PEST_CONTROL] Unknown action. Try: 'attack <purple|blue|yellow|red>', 'repair'`;
    }
}
