/**
 * CacheMappingRegistry.ts
 * 
 * Centralized schema, index, and definition mappings for the RS3/POG2 Cache Substrate.
 * Used by CacheForensicsLimb, DBRowOracleLimb, and CacheWatcherLimb to properly decode
 * and assign context to raw cache queries.
 */

// ─────────────────────────────────────────────────────────────────────────────
// CORE CACHE INDICES (JS5)
// ─────────────────────────────────────────────────────────────────────────────
export enum CacheIndex {
    ANIMATIONS = 0,
    BASES = 1,
    CONFIG = 2,
    INTERFACES = 3,
    SYNTH_SOUNDS = 4,
    MAPS = 5,
    MIDI_INSTRUMENTS = 6,
    MODELS = 7,
    SPRITES = 8,
    TEXTURES = 9,
    HUFFMAN = 10,
    MUSIC = 11,
    CS2_SCRIPTS = 12,
    FONTS = 13,
    SOUND_EFFECTS = 14,
    MIDI_PATCHES = 15,
    LOCATIONS = 16,
    ENUM_INDEX_ALT = 17, // Often used in modern RS3 for enums
    NPC_INDEX_ALT = 18,
    OBJ_INDEX_ALT = 19,
    SEQ_INDEX_ALT = 20,
    SPOT_ANIM_INDEX_ALT = 21,
    STRUCT_INDEX_ALT = 22,
    WORLD_MAP = 23,
    QUICK_CHAT = 24,
    QUICK_CHAT_GLOBAL = 25,
    MATERIALS = 26,
    PARTICLES = 27,
    DEFAULTS = 28,
    BILLBOARDS = 29,
    DLLS = 30,
    SHADERS = 31,
    LOADING_SPRITES = 32,
    LOADING_SCREENS = 33,
    LOADING_SPRITES_RAW = 34,
    CUTSCENES = 35,
    // Modern RS3 DB Indices
    DB_TABLES_INDEX = 39,
    DB_ROWS_INDEX = 41
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG ARCHIVES (Found within CacheIndex.CONFIG (2))
// ─────────────────────────────────────────────────────────────────────────────
export enum ConfigArchive {
    UNDERLAYS = 1,
    IDENTKITS = 3,
    OVERLAYS = 4,
    INVENTORIES = 5,
    OBJECTS = 6,
    ENUMS = 8,
    NPCS = 9,
    ITEMS = 10,
    PARAMS = 11,
    SEQUENCES = 12,
    SPOT_ANIMATIONS = 13,
    VARBITS = 14,
    VARCLAN = 15,
    VARPS = 16,
    VAROBJ = 17,
    STRUCTS = 26,
    DB_TABLES_CONFIG = 39,
    DB_ROWS_CONFIG = 41
}

// ─────────────────────────────────────────────────────────────────────────────
// CRITICAL ENUM DEFINITIONS (RS3)
// ─────────────────────────────────────────────────────────────────────────────
export const KnownEnums = {
    // Skills
    SKILL_IDS: 1518,              // Maps skill enum ID to skill string
    SKILL_LEVEL_XP: 1519,         // Might map level to XP required
    // Items
    WEAPON_TYPES: 681,            // Maps weapon IDs to stance/combat type
    ITEM_SLOT_MAP: 749,           // Maps equip slot to item type
    // Spells & Abilities
    MAGIC_SPELLBOOK: 3327,        // Maps spell ID to spellbook
    ABILITY_TYPES: 6734,          // Maps ability to type (Basic, Threshold, Ultimate)
    // Geography
    TELEPORT_LOCATIONS: 5046,     // Maps teleport IDs to physical coordinates
    // Pets & Summoning
    FAMILIAR_IDS: 3343,           // Maps pouch IDs to NPC IDs
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// CRITICAL VARPS (Player Variables)
// ─────────────────────────────────────────────────────────────────────────────
export const KnownVarps = {
    AUTO_RETALIATE: 172,          // 0 = On, 1 = Off
    ATTACK_STYLE: 43,             // Weapon stance
    SPECIAL_ATTACK: 301,          // 0 = Off, 1 = On (Old), RS3 uses adrenaline
    RUN_MODE: 173,                // 0 = Walk, 1 = Run
    PRAYER_POINTS: 83,            // Legacy Prayer
    COMBAT_LEVEL_SETTING: 1056,   // Legacy combat setting
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// CRITICAL VARBITS (Variable Bits packed into Varps)
// ─────────────────────────────────────────────────────────────────────────────
export const KnownVarbits = {
    // Combat
    ADRENALINE: 679,              // Often tracked here or in 1720
    OVERLOAD_TIMER: 500,          // Example tracking
    // UI
    ACTIVE_SPELLBOOK: 4070,       // Which spellbook is active
    ACTIVE_PRAYERBOOK: 3251,      // Normal vs Curses
    // General
    QUEST_POINTS: 111,            // Total quest points
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// DB TABLES (CacheIndex.DB_TABLES_INDEX / DB_ROWS_INDEX)
// ─────────────────────────────────────────────────────────────────────────────
export const KnownDBTables = {
    SKILL_XP_CURVE: 1,            // Maps levels to XP required (245 rows)
    QUEST_DATABASE: 2,            // Contains quest names, requirements, points (25 rows)
    ACHIEVEMENT_DIARIES: 3,       // Task sets (0 rows)
    ITEM_STATS_RANGED: 4,         // Weapon accuracy, damage for ranged (0 rows)
    ITEM_STATS_MELEE: 5,          // Weapon accuracy, damage for melee (0 rows)
    ITEM_STATS_MAGIC: 6,          // Weapon stats for magic (215 rows)
    MONSTER_DROPS: 7,             // Drop tables (9 rows)
    NPC_STATS: 8,                 // HP, Weaknesses, Affinity (0 rows)
    NPC_TEMPLATES: 11,            // Forensically filled NPC templates/stats (145 rows)
    SEQUENCE_ACTIONS: 18,         // Animations sequence mappings (70 rows)
    LOOT_CONTAINERS: 47,          // Special chests and interactive interactive loot containers (35 rows)
    COMBAT_ABILITY_MAPS: 56,      // Active combat abilities mapping (52 rows)
    ITEM_PASSIVES: 72,            // Passive descriptions and guides (132 rows)
    TASK_TEMPLATES: 74,           // Interactive activity task templates (21 rows)
    STRING_HASH_REGISTRY: 126,    // Forensically mapped string varp hashes (38 rows)
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// DB COLUMNS MAP (Examples of typical row layouts for specific tables)
// ─────────────────────────────────────────────────────────────────────────────
export const DBColumnMapping: Record<number, Record<number, string>> = {
    // Table 1: Skill XP Curve
    [KnownDBTables.SKILL_XP_CURVE]: {
        1: 'Level',
        2: 'Required_XP',
        3: 'Delta_XP'
    },
    // Table 8: NPC Stats
    [KnownDBTables.NPC_STATS]: {
        1: 'Base_HP',
        2: 'Attack_Level',
        3: 'Strength_Level',
        4: 'Defence_Level',
        5: 'Magic_Level',
        6: 'Ranged_Level',
        7: 'Primary_Weakness_Type',
        8: 'Affinity_Melee',
        9: 'Affinity_Ranged',
        10: 'Affinity_Magic'
    }
};

/**
 * Utility to get human-readable name for a cache index.
 */
export function getIndexName(indexId: number): string {
    return CacheIndex[indexId] || `UNKNOWN_INDEX_${indexId}`;
}

/**
 * Utility to get human-readable name for a config archive.
 */
export function getConfigArchiveName(archiveId: number): string {
    return ConfigArchive[archiveId] || `UNKNOWN_ARCHIVE_${archiveId}`;
}
