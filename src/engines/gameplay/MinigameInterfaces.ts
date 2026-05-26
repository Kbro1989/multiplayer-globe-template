import { SovereignAvatarEntity } from '../../core/SovereignAvatar.js';
import { GameState, SovereignAvatar } from '../../core/models.js';

export interface GameplayModule {
    /**
     * The internal name of the minigame/region.
     */
    readonly name: string;

    /**
     * Initializes the module with the current global GameState and active Avatar.
     * Loads the specific _logic.json files needed.
     */
    mount(state: GameState, avatar: SovereignAvatar): Promise<void>;

    /**
     * The 600ms tick cycle for this specific module.
     * Returns a string describing what happened this tick (useful for CLI output), or null if silent.
     */
    onTick(tickCount: number, state: GameState, avatar: SovereignAvatar): Promise<string | null>;

    /**
     * Process an external CLI action from the user.
     * @param action Command string (e.g., 'dig dharok', 'enter portal')
     * @returns Status/Narration of the event.
     */
    onAction(action: string, state: GameState, avatar: SovereignAvatar): Promise<string>;
}
