import { GameplayModule } from './MinigameInterfaces.js';
import { SubstrateState, YaoState, GameState, SovereignAvatar } from '../../core/models.js';
import { SovereignAvatarEntity } from '../../core/SovereignAvatar.js';
import { existsSync, readFileSync } from 'fs';
import { CanonicalClock } from '../../utils/CanonicalClock.js';
import { stateProvider } from '../../utils/StateProvider.js';

export class BarrowsInterpreter implements GameplayModule {
    public readonly name = 'Barrows';
    private logicMap: any;
    private killedBrothers: Set<string> = new Set();
    private activeBrother: string | null = null;
    private hiddenTunnel: string = '';

    private readonly BROTHERS = ['Ahrim', 'Dharok', 'Guthan', 'Karil', 'Torag', 'Verac'];

    // RS3 Barrows state varbits/varps:
    //   Varbit 457 — Crypt progress (which crypts have been entered)
    //   Varp 24   — Killed brothers bitmask (bit 0=Ahrim, 1=Dharok, etc.)
    private static readonly VARBIT_CRYPT_PROGRESS = 457;
    private static readonly VARP_KILLED_BROTHERS = 24;

    public async mount(state: GameState, avatar: SovereignAvatar): Promise<void> {
        // Drop them at Barrows 
        avatar.coord = { x: 3564, y: 3288, plane: 0 };
        
        const path = 'D:/sovereign/atlas/logic/barrows_logic.json';
        if (existsSync(path)) {
            this.logicMap = JSON.parse(readFileSync(path, 'utf8'));
        }

        // Pre-resolve Barrows varbit definitions from live cache
        await stateProvider.preResolveVarbits([BarrowsInterpreter.VARBIT_CRYPT_PROGRESS]);

        // Randomize the hidden tunnel for this run
        this.hiddenTunnel = this.BROTHERS[CanonicalClock.getInstance().rng().range(0, this.BROTHERS.length - 1)];
        this.killedBrothers.clear();
        this.activeBrother = null;
        
        // Reset Barrows state via authoritative varps
        await stateProvider.setVarp(BarrowsInterpreter.VARP_KILLED_BROTHERS, 0, state);
        await stateProvider.setVarbit(BarrowsInterpreter.VARBIT_CRYPT_PROGRESS, 0, state);

        console.log(`[BARROWS] Initialization complete. Hidden tunnel is randomized.`);
    }

    public async onTick(tickCount: number, state: GameState, avatar: SovereignAvatar): Promise<string | null> {
        // Drain prayer passively every ~18 ticks (10.8s) if underground
        if (avatar.coord.plane === -1 && tickCount % 18 === 0) {
            // Import not needed if we hardcode 7, but let's assume 7 for Prayer
            const prayerSkill = avatar.skills[7];
            if (prayerSkill && prayerSkill.level > 0) {
                prayerSkill.level = Math.max(0, prayerSkill.level - 8);
                return '[BARROWS] The cursed energy of the crypt drains your Prayer points.';
            }
        }
        return null; // Silent tick normally
    }

    public async onAction(action: string, state: GameState, avatar: SovereignAvatar): Promise<string> {
        const parts = action.toLowerCase().split(' ');
        
        if (parts[0] === 'dig') {
            const mound = parts[1];
            if (!mound) return "[BARROWS] Dig where? (e.g., 'dig dharok')";

            const brotherName = this.BROTHERS.find(b => b.toLowerCase() === mound);
            if (!brotherName) return `[BARROWS] There is no mound for '${mound}'.`;

            // Drop into the crypt
            avatar.coord.plane = -1;
            return `[BARROWS] You dig into ${brotherName}'s crypt. The air is cold and stale.`;
        }

        if (parts[0] === 'search') {
            if (avatar.coord.plane !== -1) return "[BARROWS] You are not in a crypt.";
            
            // Assume they are searching the crypt they are currently in based on previous 'dig'
            // For this CLI sim, we just take the last 'dig' action or require them to name it if we want it perfect
            // Simplification: Mounding sets a state var. Let's just randomize a brother they haven't killed for CLI logic test
            const potentialSpawn = this.BROTHERS.find(b => !this.killedBrothers.has(b));
            
            if (!potentialSpawn) {
                return "[BARROWS] You search the sarcophagus, but find nothing. You have defeated them all.";
            }

            if (potentialSpawn === this.hiddenTunnel) {
                return `[BARROWS] You search the sarcophagus. You find a hidden tunnel leading deeper into the earth!`;
            }

            this.activeBrother = potentialSpawn;
            return `[BARROWS] The sarcophagus bursts open! ${potentialSpawn} the Wretched attacks!`;
        }
        
        if (parts[0] === 'kill') {
            if (!this.activeBrother) return "[BARROWS] There is no brother to kill right now.";
            
            this.killedBrothers.add(this.activeBrother);
            const killed = this.activeBrother;
            this.activeBrother = null;

            // Update killed brothers bitmask via authoritative varp
            const brotherIndex = this.BROTHERS.indexOf(killed);
            if (brotherIndex !== -1) {
                const currentMask = stateProvider.getVarp(BarrowsInterpreter.VARP_KILLED_BROTHERS, state);
                await stateProvider.setVarp(BarrowsInterpreter.VARP_KILLED_BROTHERS, currentMask | (1 << brotherIndex), state);
            }

            return `[BARROWS] You have defeated ${killed}. (${this.killedBrothers.size}/${this.BROTHERS.length})`;
        }

        if (parts[0] === 'chest') {
            if (this.killedBrothers.size < 6) {
                return "[BARROWS] The chest is locked. You hear the whispers of the undefeat brothers.";
            }
            return "[BARROWS] You open the Barrows Chest! Loot acquired. Minigame cycle complete.";
        }

        return `[BARROWS] Unknown action. Try: 'dig <mound>', 'search', 'kill', 'chest'`;
    }
}
