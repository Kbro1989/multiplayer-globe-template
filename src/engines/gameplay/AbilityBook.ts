/**
 * AbilityBook.ts
 * 
 * Cache-grounded ability definition registry.
 * Consumes D:\sovereign\memory\pedagogy\sovereign_ability_registry.json for GFX/taxonomy
 * and layers wiki-sourced combat parameters (adrenaline, cooldowns, damage) on top.
 * 
 * Adrenaline scale: 0–10000 (matches SovereignAvatarEntity.addAdrenaline/consumeAdrenaline).
 * Distance: Chebyshev (max(|dx|, |dy|)) per RS3 range calculation.
 */

import { readFileSync, existsSync } from 'fs';
import { resolveSovereignPath } from '../../utils/SovereignPathResolver.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('AbilityBook');

// ═══════════════════════════════════════════════════════
// Core Types
// ═══════════════════════════════════════════════════════

export type CombatStyle = 'melee' | 'ranged' | 'magic' | 'necromancy' | 'taming' | 'merchanting' | 'defense' | 'movement';
export type AbilityType = 'basic' | 'enhanced' | 'ultimate' | 'special' | 'conjure' | 'companion' | 'economic' | 'action' | 'teleport';
export type AbilityCategory = 'combat' | 'companion' | 'utility';

export interface AbilityGFX {
    spotAnimId: number;
    modelId: number;
    sequenceId: number;
    additiveBlend: boolean;
    frameCount?: number;
    frameArchive?: number;
    totalTicks?: number;
    resolved: boolean;
}

export interface AbilityDefinition {
    id: string;                    // Lowercase key, e.g. 'slice', 'assault'
    name: string;                  // Display name from registry
    style: CombatStyle;
    type: AbilityType;
    category: AbilityCategory;
    adrenalineCost: number;        // 0–10000 scale. 0 for basics, 1500 for thresholds, 10000 for ults.
    adrenalineGain: number;        // 0–10000 scale. 800 for basics (8%), 0 for thresholds/ults.
    cooldownTicks: number;         // Individual ability cooldown in game ticks (600ms each).
    gcdTicks: number;              // Global cooldown contribution (default 3 = 1.8s).
    damageRange: [number, number]; // [min%, max%] of weapon damage.
    range: number;                 // Chebyshev attack distance (1 for melee, 7+ for ranged/magic).
    isChanneled: boolean;
    channelTicks: number;          // Duration of channel. 0 if not channeled.
    flags: string[];               // 'stun', 'bleed', 'aoe', 'debuff', 'heal', 'shield', 'stun-buff'
    aoeRadius?: number;            // Splash radius for pbaoe/chain
    chainCount?: number;           // Max additional targets for chain
    coneHalfAngle?: number;        // Radians for cone attacks
    gfx: AbilityGFX[];             // Cache-grounded GFX from sovereign_ability_registry.json
    wired: boolean;                // true if GFX fully resolved from cache
}

function getAbilityCategory(style: CombatStyle): AbilityCategory {
    if (style === 'taming') return 'companion';
    if (style === 'merchanting' || style === 'movement') return 'utility';
    return 'combat';
}

// ═══════════════════════════════════════════════════════
// Registry File Shape (from sovereign_ability_registry.json)
// ═══════════════════════════════════════════════════════

interface RegistryAbility {
    style: string;
    type: string;
    gfx: AbilityGFX[];
    wired: boolean;
}

interface RegistryFile {
    _meta: {
        generated: string;
        totalSpotAnims: number;
        totalSequences: number;
        knownAbilities: number;
        wiredAbilities: number;
        discoveredFamilies: number;
    };
    abilities: Record<string, RegistryAbility>;
}

// ═══════════════════════════════════════════════════════
// Wiki-Sourced Combat Parameters
// Damage ranges as [min%, max%] of weapon damage. min% = max% / 5
// Adrenaline on 0–10000 scale.
// Cooldowns in game ticks (1 tick = 600ms).
// ═══════════════════════════════════════════════════════

interface CombatParams {
    adrenalineCost: number;
    adrenalineGain: number;
    cooldownTicks: number;
    damageRange: [number, number];
    range: number;
    isChanneled: boolean;
    channelTicks: number;
    flags: any[];
    aoeRadius?: number;
    chainCount?: number;
    coneHalfAngle?: number;
}

const MELEE_RANGE = 1;
const RANGED_RANGE = 7;
const MAGIC_RANGE = 7;
const NECRO_RANGE = 7;
const GCD = 3; // Global cooldown in ticks

/**
 * Wiki-sourced combat parameters for known abilities.
 * Keys must match ability names from sovereign_ability_registry.json exactly.
 */
const COMBAT_PARAMS: Record<string, CombatParams> = {
    // ─── MELEE BASICS (March 2026: Slice, Sever, Smash removed) ───
    'Havoc':          { adrenalineCost: 0, adrenalineGain: 900, cooldownTicks: 17, damageRange: [31.4, 157], range: MELEE_RANGE, isChanneled: false, channelTicks: 0, flags: [] },
    'Dismember':      { adrenalineCost: 0, adrenalineGain: 900, cooldownTicks: 25, damageRange: [37.6, 188], range: MELEE_RANGE, isChanneled: false, channelTicks: 0, flags: ['bleed'] },
    'Fury':           { adrenalineCost: 0, adrenalineGain: 900, cooldownTicks: 9, damageRange: [31.4, 157], range: MELEE_RANGE, isChanneled: true, channelTicks: 3, flags: [] },
    'Punish':         { adrenalineCost: 0, adrenalineGain: 900, cooldownTicks: 5, damageRange: [18.8, 94], range: MELEE_RANGE, isChanneled: false, channelTicks: 0, flags: ['stun-buff'] },
    'Backhand':       { adrenalineCost: 0, adrenalineGain: 900, cooldownTicks: 25, damageRange: [20, 100], range: MELEE_RANGE, isChanneled: false, channelTicks: 0, flags: ['stun'] },

    // ─── MELEE ENHANCED (March 2026: Cleave, Decimate, Destroy removed; Quake removed) ───
    'Flurry':         { adrenalineCost: 1500, adrenalineGain: 0, cooldownTicks: 34, damageRange: [31.4, 157], range: MELEE_RANGE, isChanneled: true, channelTicks: 6, flags: ['pbaoe', 'bloodlust-consumer'], aoeRadius: 1 },
    'Hurricane':      { adrenalineCost: 1500, adrenalineGain: 0, cooldownTicks: 34, damageRange: [42, 210], range: MELEE_RANGE, isChanneled: false, channelTicks: 0, flags: ['pbaoe', 'bloodlust-consumer'], aoeRadius: 2 },
    'Slaughter':      { adrenalineCost: 1500, adrenalineGain: 0, cooldownTicks: 50, damageRange: [50, 250], range: MELEE_RANGE, isChanneled: false, channelTicks: 0, flags: ['bleed'] },
    'Assault':        { adrenalineCost: 1500, adrenalineGain: 0, cooldownTicks: 34, damageRange: [53, 265], range: MELEE_RANGE, isChanneled: true, channelTicks: 8, flags: ['bloodlust-consumer'] },

    // ─── MELEE ULTIMATES ───
    'Overpower':      { adrenalineCost: 10000, adrenalineGain: 0, cooldownTicks: 100, damageRange: [60, 300], range: MELEE_RANGE, isChanneled: false, channelTicks: 0, flags: [] },
    'Meteor Strike':  { adrenalineCost: 10000, adrenalineGain: 0, cooldownTicks: 100, damageRange: [60, 300], range: MELEE_RANGE, isChanneled: false, channelTicks: 0, flags: ['aoe'] },
    'Berserk':        { adrenalineCost: 10000, adrenalineGain: 0, cooldownTicks: 100, damageRange: [0, 0], range: 0, isChanneled: false, channelTicks: 0, flags: ['buff', 'bloodlust-empower'] },
    'Pulverise':      { adrenalineCost: 10000, adrenalineGain: 0, cooldownTicks: 100, damageRange: [60, 300], range: MELEE_RANGE, isChanneled: false, channelTicks: 0, flags: [] },

    // ─── RANGED BASICS (March 2026: Fragmentation Shot, Dazing Shot, Needle Strike removed) ───
    'Piercing Shot':  { adrenalineCost: 0, adrenalineGain: 900, cooldownTicks: 5, damageRange: [18.8, 94], range: RANGED_RANGE, isChanneled: false, channelTicks: 0, flags: ['stun-buff'] },
    'Snipe':          { adrenalineCost: 0, adrenalineGain: 900, cooldownTicks: 17, damageRange: [43.8, 219], range: RANGED_RANGE, isChanneled: true, channelTicks: 6, flags: [] },
    'Ricochet':       { adrenalineCost: 0, adrenalineGain: 900, cooldownTicks: 17, damageRange: [20, 100], range: RANGED_RANGE, isChanneled: false, channelTicks: 0, flags: ['aoe'] },
    'Binding Shot':   { adrenalineCost: 0, adrenalineGain: 900, cooldownTicks: 25, damageRange: [20, 100], range: RANGED_RANGE, isChanneled: false, channelTicks: 0, flags: ['stun'] },
    'Corruption Shot':{ adrenalineCost: 2000, adrenalineGain: 0, cooldownTicks: 25, damageRange: [60, 300], range: RANGED_RANGE, isChanneled: false, channelTicks: 0, flags: ['corruption'] },
    'Galeshot':       { adrenalineCost: 0, adrenalineGain: 900, cooldownTicks: 12, damageRange: [31.4, 157], range: RANGED_RANGE, isChanneled: false, channelTicks: 0, flags: ['searing-winds-trigger'] },

    // ─── RANGED ENHANCED (March 2026: Unload, Incendiary Shot removed) ───
    'Snap Shot':      { adrenalineCost: 1500, adrenalineGain: 0, cooldownTicks: 34, damageRange: [53, 265], range: RANGED_RANGE, isChanneled: false, channelTicks: 0, flags: [] },
    'Rapid Fire':     { adrenalineCost: 1500, adrenalineGain: 0, cooldownTicks: 34, damageRange: [75.2, 376], range: RANGED_RANGE, isChanneled: true, channelTicks: 8, flags: ['searing-winds-extender'] },
    'Shadow Tendrils':{ adrenalineCost: 1500, adrenalineGain: 0, cooldownTicks: 75, damageRange: [100, 500], range: RANGED_RANGE, isChanneled: false, channelTicks: 0, flags: [] },
    'Bombardment':    { adrenalineCost: 1500, adrenalineGain: 0, cooldownTicks: 50, damageRange: [43.8, 219], range: RANGED_RANGE, isChanneled: false, channelTicks: 0, flags: ['pbaoe'], aoeRadius: 3 },

    // ─── RANGED ULTIMATES (March 2026: Unload removed) ───
    "Death's Swiftness": { adrenalineCost: 10000, adrenalineGain: 0, cooldownTicks: 100, damageRange: [0, 0], range: 0, isChanneled: false, channelTicks: 0, flags: ['buff'] },
    'Deadshot':       { adrenalineCost: 10000, adrenalineGain: 0, cooldownTicks: 100, damageRange: [60, 300], range: RANGED_RANGE, isChanneled: false, channelTicks: 0, flags: [] },
    'Imbue Shadows':  { adrenalineCost: 10000, adrenalineGain: 0, cooldownTicks: 100, damageRange: [0, 0], range: 0, isChanneled: false, channelTicks: 0, flags: ['buff', 'shadow-imbue-trigger'] },

    // ─── MAGIC BASICS (March 2026: Wrack, Detonate, Shock, Horror, Deep Impact removed) ───
    'Dragon Breath':  { adrenalineCost: 0, adrenalineGain: 900, cooldownTicks: 17, damageRange: [37.6, 188], range: MAGIC_RANGE, isChanneled: false, channelTicks: 0, flags: ['cone', 'combust-synergy'], coneHalfAngle: Math.PI / 4, aoeRadius: 2 },
    'Sonic Wave':     { adrenalineCost: 0, adrenalineGain: 900, cooldownTicks: 9, damageRange: [31.4, 157], range: MAGIC_RANGE, isChanneled: false, channelTicks: 0, flags: ['adrenaline-discount'] },
    'Concentrated Blast':{ adrenalineCost: 0, adrenalineGain: 900, cooldownTicks: 9, damageRange: [35, 105], range: MAGIC_RANGE, isChanneled: true, channelTicks: 5, flags: ['crit-boost'] },
    'Impact':         { adrenalineCost: 0, adrenalineGain: 900, cooldownTicks: 25, damageRange: [20, 100], range: MAGIC_RANGE, isChanneled: false, channelTicks: 0, flags: ['stun'] },
    'Combust':        { adrenalineCost: 0, adrenalineGain: 900, cooldownTicks: 25, damageRange: [30, 300], range: MAGIC_RANGE, isChanneled: false, channelTicks: 0, flags: ['bleed'] },
    'Chain':          { adrenalineCost: 0, adrenalineGain: 900, cooldownTicks: 17, damageRange: [16, 80], range: MAGIC_RANGE, isChanneled: false, channelTicks: 0, flags: ['chain', 'greater-chain-baseline'], chainCount: 2, aoeRadius: 2 },

    // ─── MAGIC ENHANCED (March 2026: Corruption Blast & Magma Tempest promoted to enhanced; Metamorphosis removed) ───
    'Asphyxiate':     { adrenalineCost: 2500, adrenalineGain: 0, cooldownTicks: 34, damageRange: [37.6, 188], range: MAGIC_RANGE, isChanneled: true, channelTicks: 8, flags: ['stun'] },
    'Wild Magic':     { adrenalineCost: 2500, adrenalineGain: 0, cooldownTicks: 9, damageRange: [56, 280], range: MAGIC_RANGE, isChanneled: false, channelTicks: 0, flags: [] },
    'Smoke Tendrils': { adrenalineCost: 0, adrenalineGain: 0, cooldownTicks: 75, damageRange: [63, 315], range: MAGIC_RANGE, isChanneled: false, channelTicks: 0, flags: [] },
    'Magma Tempest':  { adrenalineCost: 2000, adrenalineGain: 0, cooldownTicks: 34, damageRange: [40, 320], range: MAGIC_RANGE, isChanneled: false, channelTicks: 0, flags: ['pbaoe'], aoeRadius: 2 },
    'Corruption Blast':{ adrenalineCost: 2000, adrenalineGain: 0, cooldownTicks: 25, damageRange: [60, 300], range: MAGIC_RANGE, isChanneled: false, channelTicks: 0, flags: ['corruption'] },

    // ─── MAGIC ULTIMATES (March 2026: Omnipower cost 60%) ───
    'Sunshine':       { adrenalineCost: 10000, adrenalineGain: 0, cooldownTicks: 100, damageRange: [0, 0], range: 0, isChanneled: false, channelTicks: 0, flags: ['buff'] },
    'Omnipower':      { adrenalineCost: 6000, adrenalineGain: 0, cooldownTicks: 50, damageRange: [92, 460], range: MAGIC_RANGE, isChanneled: false, channelTicks: 0, flags: [] },

    // ─── NECROMANCY BASICS ───
    'Touch of Death': { adrenalineCost: 0, adrenalineGain: 900, cooldownTicks: 25, damageRange: [40, 200], range: NECRO_RANGE, isChanneled: false, channelTicks: 0, flags: [] },
    'Soul Sap':       { adrenalineCost: 0, adrenalineGain: 900, cooldownTicks: 5, damageRange: [24, 120], range: NECRO_RANGE, isChanneled: false, channelTicks: 0, flags: [] },
    'Soul Strike':    { adrenalineCost: 0, adrenalineGain: 900, cooldownTicks: 9, damageRange: [31.4, 157], range: NECRO_RANGE, isChanneled: false, channelTicks: 0, flags: [] },
    'Necrotic Burst': { adrenalineCost: 0, adrenalineGain: 900, cooldownTicks: 9, damageRange: [37.6, 188], range: NECRO_RANGE, isChanneled: false, channelTicks: 0, flags: ['aoe'] },
    'Command Undead': { adrenalineCost: 0, adrenalineGain: 0, cooldownTicks: 25, damageRange: [0, 0], range: NECRO_RANGE, isChanneled: false, channelTicks: 0, flags: [] },
    'Conjure Undead': { adrenalineCost: 0, adrenalineGain: 0, cooldownTicks: 50, damageRange: [0, 0], range: NECRO_RANGE, isChanneled: false, channelTicks: 0, flags: ['conjure'] },

    // ─── NECROMANCY EMPOWERED ───
    'Finger of Death':{ adrenalineCost: 1500, adrenalineGain: 0, cooldownTicks: 25, damageRange: [60, 300], range: NECRO_RANGE, isChanneled: false, channelTicks: 0, flags: [] },
    'Volley of Souls':{ adrenalineCost: 1500, adrenalineGain: 0, cooldownTicks: 34, damageRange: [50, 250], range: NECRO_RANGE, isChanneled: false, channelTicks: 0, flags: [] },

    // ─── NECROMANCY ULTIMATES ───
    'Death Skulls':   { adrenalineCost: 10000, adrenalineGain: 0, cooldownTicks: 100, damageRange: [60, 300], range: NECRO_RANGE, isChanneled: false, channelTicks: 0, flags: ['aoe'] },

    // ─── DEFENSE EMPOWERED ───
    'Resonance':      { adrenalineCost: 1500, adrenalineGain: 0, cooldownTicks: 50, damageRange: [0, 0], range: 0, isChanneled: false, channelTicks: 0, flags: ['shield', 'heal'] },
    'Devotion':       { adrenalineCost: 1500, adrenalineGain: 0, cooldownTicks: 100, damageRange: [0, 0], range: 0, isChanneled: false, channelTicks: 0, flags: ['shield'] },
    'Debilitate':     { adrenalineCost: 1500, adrenalineGain: 0, cooldownTicks: 50, damageRange: [20, 100], range: MELEE_RANGE, isChanneled: false, channelTicks: 0, flags: ['debuff'] },
    'Reflect':        { adrenalineCost: 1500, adrenalineGain: 0, cooldownTicks: 25, damageRange: [0, 0], range: 0, isChanneled: false, channelTicks: 0, flags: ['shield'] },

    // ─── DEFENSE ULTIMATES ───
    'Barricade':      { adrenalineCost: 10000, adrenalineGain: 0, cooldownTicks: 100, damageRange: [0, 0], range: 0, isChanneled: false, channelTicks: 0, flags: ['shield'] },
    'Immortality':    { adrenalineCost: 10000, adrenalineGain: 0, cooldownTicks: 200, damageRange: [0, 0], range: 0, isChanneled: false, channelTicks: 0, flags: ['shield', 'heal'] },
    'Rejuvenate':     { adrenalineCost: 10000, adrenalineGain: 0, cooldownTicks: 100, damageRange: [0, 0], range: 0, isChanneled: false, channelTicks: 0, flags: ['shield', 'heal'] },

    // ─── MOVEMENT ───
    'Surge':          { adrenalineCost: 0, adrenalineGain: 0, cooldownTicks: 34, damageRange: [0, 0], range: 0, isChanneled: false, channelTicks: 0, flags: [] },
    'Escape':         { adrenalineCost: 0, adrenalineGain: 0, cooldownTicks: 34, damageRange: [0, 0], range: 0, isChanneled: false, channelTicks: 0, flags: [] },
    'Bladed Dive':    { adrenalineCost: 0, adrenalineGain: 0, cooldownTicks: 34, damageRange: [24, 120], range: MELEE_RANGE, isChanneled: false, channelTicks: 0, flags: [] },
    'Eat Food':       { adrenalineCost: 300, adrenalineGain: 0, cooldownTicks: 3, damageRange: [0, 0], range: 0, isChanneled: false, channelTicks: 0, flags: ['heal'] }, // March 2026: 3% drain (was 10%)
};

// ═══════════════════════════════════════════════════════
// Registry Type Normalizer
// Backward-compatibility shim: sovereign_ability_registry.json was generated
// with the pre-March-2026 "threshold" taxonomy. This maps it to "enhanced"
// without requiring a mass-edit of the 6500-line JSON.
// ═══════════════════════════════════════════════════════

function normalizeAbilityType(raw: string): AbilityType {
    if (raw === 'threshold') return 'enhanced';
    return raw as AbilityType;
}

// ═══════════════════════════════════════════════════════
// Default Parameters for Unparameterized Abilities
// ═══════════════════════════════════════════════════════

function getDefaultParams(type: AbilityType, style: CombatStyle): CombatParams {
    const range = style === 'melee' ? MELEE_RANGE
        : style === 'ranged' ? RANGED_RANGE
        : style === 'magic' ? MAGIC_RANGE
        : style === 'necromancy' ? NECRO_RANGE
        : 0;

    switch (type) {
        case 'basic':
            return { adrenalineCost: 0, adrenalineGain: 900, cooldownTicks: 5, damageRange: [24, 120], range, isChanneled: false, channelTicks: 0, flags: [] };
        case 'enhanced':
            return { adrenalineCost: 1500, adrenalineGain: 0, cooldownTicks: 34, damageRange: [50, 250], range, isChanneled: false, channelTicks: 0, flags: [] };
        case 'ultimate':
            return { adrenalineCost: 10000, adrenalineGain: 0, cooldownTicks: 100, damageRange: [60, 300], range, isChanneled: false, channelTicks: 0, flags: [] };
        case 'special':
            return { adrenalineCost: 1500, adrenalineGain: 0, cooldownTicks: 50, damageRange: [50, 250], range, isChanneled: false, channelTicks: 0, flags: [] };
        case 'conjure':
            return { adrenalineCost: 0, adrenalineGain: 0, cooldownTicks: 100, damageRange: [0, 0], range: 0, isChanneled: false, channelTicks: 0, flags: [] };
        default:
            return { adrenalineCost: 0, adrenalineGain: 0, cooldownTicks: 5, damageRange: [0, 0], range: 0, isChanneled: false, channelTicks: 0, flags: [] };
    }
}

// ═══════════════════════════════════════════════════════
// AbilityBook Singleton
// ═══════════════════════════════════════════════════════

export class AbilityBook {
    private static instance: AbilityBook;
    private abilities: Map<string, AbilityDefinition> = new Map();
    private registryMeta: RegistryFile['_meta'] | null = null;

    private constructor() {
        this.loadRegistry();
        this.loadHudForensics();
    }

    private loadHudForensics(): void {
        try {
            const hudPath = resolveSovereignPath('cache_pedagogy/atlas/interfaces/interface_1496_decomposed.json');
            if (existsSync(hudPath)) {
                const raw = readFileSync(hudPath, 'utf8');
                const parsed = JSON.parse(raw);
                logger.info({ interfaceId: parsed.interfaceId, components: parsed.totalComponents }, 'AbilityBook HUD forensics bound.');
            }
        } catch (e) {
            logger.warn('Failed to bind AbilityBook HUD forensics');
        }
    }

    public static getInstance(): AbilityBook {
        if (!AbilityBook.instance) {
            AbilityBook.instance = new AbilityBook();
        }
        return AbilityBook.instance;
    }

    private loadRegistry(): void {
        const registryPath = resolveSovereignPath('memory/pedagogy/sovereign_ability_registry.json');

        if (!existsSync(registryPath)) {
            logger.warn({ path: registryPath }, 'sovereign_ability_registry.json not found. Using wiki-only combat parameters.');
            this.buildFromWikiOnly();
            return;
        }

        try {
            const raw: any = JSON.parse(readFileSync(registryPath, 'utf8'));
            this.registryMeta = raw._meta || { generated: new Date().toISOString(), knownAbilities: 0 };

            // Handle both legacy (abilities object) and modern (styles manifest) shapes
            const abilitiesSource: Record<string, any> = raw.abilities || {};
            
            // If abilities is empty but styles exists, populate from styles
            if (Object.keys(abilitiesSource).length === 0 && raw.styles) {
                for (const [styleName, names] of Object.entries(raw.styles)) {
                    for (const name of (names as string[])) {
                        abilitiesSource[name] = {
                            style: styleName.toLowerCase(),
                            type: 'basic', // default, refined by COMBAT_PARAMS
                            gfx: [],
                            wired: false
                        };
                    }
                }
            }

            for (const [name, entry] of Object.entries(abilitiesSource)) {
                const id = name.toLowerCase().replace(/[\s()]/g, '_');
                const style = (entry.style || 'melee') as CombatStyle;
                const type = normalizeAbilityType(entry.type || 'basic');
                const params = COMBAT_PARAMS[name] || getDefaultParams(type, style);

                this.abilities.set(id, {
                    id,
                    name,
                    style,
                    type,
                    category: getAbilityCategory(style),
                    adrenalineCost: params.adrenalineCost,
                    adrenalineGain: params.adrenalineGain,
                    cooldownTicks: params.cooldownTicks,
                    gcdTicks: GCD,
                    damageRange: params.damageRange,
                    range: params.range,
                    isChanneled: params.isChanneled,
                    channelTicks: params.channelTicks,
                    flags: params.flags,
                    aoeRadius: params.aoeRadius,
                    chainCount: params.chainCount,
                    coneHalfAngle: params.coneHalfAngle,
                    gfx: entry.gfx || [],
                    wired: entry.wired || false,
                });
            }

            logger.info({
                loaded: this.abilities.size,
                wired: Array.from(this.abilities.values()).filter(a => a.wired).length,
                registry: this.registryMeta
            }, 'AbilityBook loaded from sovereign_ability_registry.json.');

        } catch (err) {
            logger.error({ err, path: registryPath }, 'Failed to parse sovereign_ability_registry.json — falling back to wiki-only.');
            this.buildFromWikiOnly();
        }
    }

    private buildFromWikiOnly(): void {
        for (const [name, params] of Object.entries(COMBAT_PARAMS)) {
            const id = name.toLowerCase().replace(/[\s()]/g, '_');
            const style: CombatStyle = params.range === MELEE_RANGE ? 'melee'
                : params.range === RANGED_RANGE ? 'ranged'
                : params.range === MAGIC_RANGE ? 'magic'
                : params.range === NECRO_RANGE ? 'necromancy'
                : 'defense';
            
            let type: AbilityType = 'basic';
            if (params.adrenalineCost === 1500) type = 'enhanced';
            if (params.adrenalineCost === 10000) type = 'ultimate';
            if (params.flags.includes('conjure')) type = 'conjure';

            this.abilities.set(id, {
                id,
                name,
                style,
                type,
                category: getAbilityCategory(style),
                ...params,
                gcdTicks: GCD,
                gfx: [],
                wired: false,
            });
        }
        logger.info({ loaded: this.abilities.size }, 'AbilityBook built from wiki-only parameters (no GFX).');
    }

    public get(id: string): AbilityDefinition | undefined {
        return this.abilities.get(id);
    }

    public getByName(name: string): AbilityDefinition | undefined {
        const id = name.toLowerCase().replace(/[\s()]/g, '_');
        return this.abilities.get(id);
    }

    public getAll(): AbilityDefinition[] {
        return Array.from(this.abilities.values());
    }

    public getByStyle(style: CombatStyle): AbilityDefinition[] {
        return this.getAll().filter(a => a.style === style);
    }

    public getBasics(style: CombatStyle): AbilityDefinition[] {
        return this.getByStyle(style).filter(a => a.type === 'basic');
    }

    public getEnhancedAbilities(style: CombatStyle): AbilityDefinition[] {
        return this.getByStyle(style).filter(a => a.type === 'enhanced');
    }

    public getUltimates(style: CombatStyle): AbilityDefinition[] {
        return this.getByStyle(style).filter(a => a.type === 'ultimate');
    }

    public getDefensiveAbilities(): AbilityDefinition[] {
        return this.getAll().filter(a => a.style === 'defense');
    }

    public getMeta(): RegistryFile['_meta'] | null {
        return this.registryMeta;
    }

    public healthCheck(): { online: boolean; details: string; loaded: number } {
        return {
            online: this.abilities.size > 0,
            details: `AbilityBook: ${this.abilities.size} abilities loaded (${Array.from(this.abilities.values()).filter(a => a.wired).length} GFX wired).`,
            loaded: this.abilities.size
        };
    }
}
