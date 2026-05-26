/**
 * Cache-grounded SpotAnim reference for a Necromancy ability.
 * These IDs are materialized from Major 21 (spotanims) and Major 20 (sequences).
 */
export interface NecromancyGFX {
    spotAnimId: number;
    modelId: number;
    sequenceId: number;
    /** If true, the GFX uses unk2e rendering (billboard/additive blend). */
    additiveBlend: boolean;
}

export interface NecromancyAbility {
    id: string;
    name: string;
    type: "basic" | "conjure" | "finisher" | "utility";
    adrenaline_gain?: number;
    adrenaline_cost?: number;
    rotation_weight: number;
    /** Cache-grounded GFX reference. Null if no visual effect. */
    gfx: NecromancyGFX | null;
    /** Frame archive ID (frameidhi) for the animation skeleton. */
    frameArchive?: number;
    /** Total animation duration in game ticks (each framelength unit = 1 tick). */
    animDurationTicks?: number;
}
