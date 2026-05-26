import { createLogger } from '../../utils/logger.js';
import { CacheForensicsLimb } from './CacheForensicsLimb.js';
import * as fs from 'fs';
import * as path from 'path';
import { SovereignAvatarEntity } from '../../core/SovereignAvatar.js';
import { HUDForensicsLimb } from './HUDForensicsLimb.js';
import { CacheWatcherLimb, CacheInvalidationListener } from './CacheWatcherLimb.js';

const logger = createLogger('AvatarStateLimb');

export interface CharacterCreationUIState {
  activePanel: 'game_mode' | 'skin_colour' | 'randomise' | 'choose_appearance' | 'unknown';
}

// Authoritative Varp 5745 Layout (Avatar Refresh)
export const VARP_5745 = {
  BODY_BASE: 28554,       // bits [0-2]
  TORSO_LEGS: 28555,      // bits [3-5]
  BODY_TYPE_GENDER: 28556, // bits [6-8]
  GAME_MODE: 28557,       // bits [9-11]
  OLD_HEAD_FALLBACK: 28558, // bit [12]
  TORSO_OVERRIDE: 28559,  // bit [13]
};

// Authoritative Varp 5746 Layout (Category Indices)
export const VARP_5746 = {
  HEAD: 28547,
  TORSO: 28548,
  LEGS: 28549,
  SHOES: 28550,
  BEARD: 28551,
  SKIN_MAT: 28552,
  HAIR_MAT: 28553
};

// Authoritative Varp 524476 Layout (Appearance Indices)
export const VARP_524476 = {
  SKIN_COLOR: 2827,
  HAIR_COLOR: 2828,
  TORSO_COLOR: 2829,
  RANDOM_SEED: 2830,
  SHOE_COLOR: 2831
};

export interface MorphologyState {
  // Varp 5745
  bodyBase: number;
  torsoLegsStyle: number;
  bodyType: 'refresh_male' | 'refresh_female' | 'classic'; // mapped from 28556
  gameMode: number;         // mapped from 28557
  oldHeadFallback: boolean;
  torsoOverride: boolean;
  
  // Varp 5746
  categoryIndices: {
    head: number; torso: number; legs: number;
    shoes: number; beard: number; skinMat: number; hairMat: number;
  };
  
  // Varp 524476
  appearanceIndices: {
    skinColor: number; hairColor: number; torsoColor: number;
    randomSeed: number; shoeColor: number;
  };
}

export interface AvatarConfiguration {
  ui: CharacterCreationUIState;
  morphology: MorphologyState;
  
  // Equipment overlay (existing 29-skill state)
  helmId: number;
  capeId: number;
  bodyId: number;
  legsId: number;
  weaponId: number;
  
  // Animation state
  idlePose: 'stand' | 'walk' | 'combat' | 'emote';
  emoteId: number;

  // Semantic human-readable mappings resolved from raw indices
  semantic?: {
    headStyle: string;
    beardStyle: string;
    skinColor: string;
    hairColor: string;
  };
}

// Curated 2026 Player Avatar Refresh Semantic Mappings
const FEMALE_HAIRSTYLES: Record<number, string> = {
  0: "Bald",
  1: "Bun neat",
  2: "Bun messy",
  3: "Short straight",
  4: "Short curly",
  5: "Long straight",
  6: "Long waves",
  7: "Spiked wild",
  8: "Spiked tidy",
  9: "Ponytail high",
  10: "Ponytail low",
  11: "Dreadlocks short",
  12: "Dreadlocks long",
  13: "Afro",
  14: "Mohawk",
  15: "Braid single",
  16: "Braid double",
  17: "Braid crown",
  18: "Bob straight",
  19: "Bob curly",
  20: "Pixie cut",
  21: "Curtains",
  22: "Fringe sweeping",
  23: "Fringe straight",
  24: "Curly wild",
  25: "Curly tight",
  26: "Side braid",
  27: "Top knot",
  28: "Space buns",
  29: "Pigtails",
  30: "Bowl cut",
  31: "Shaved sides",
  32: "Asymmetrical bob",
  33: "French braid"
};

const MALE_HAIRSTYLES: Record<number, string> = {
  0: "Bald",
  1: "Spiked short",
  2: "Spiked long",
  3: "Mohawk",
  4: "Dreadlocks",
  5: "Afro",
  6: "Undercut",
  7: "Curtains",
  8: "Ponytail spiked",
  9: "Ponytail smooth",
  10: "Slick back",
  11: "Side parting",
  12: "Tousled",
  13: "Short crop",
  14: "Dreads long",
  15: "Dreads tied",
  16: "Top knot",
  17: "Messy bun",
  18: "Buzz cut",
  19: "Comb over",
  20: "Quiff",
  21: "Curly fade",
  22: "Flat top",
  23: "Mullet",
  24: "Shaved sides",
  25: "Waves",
  26: "Braid short",
  27: "Braid long",
  28: "E-boy parting"
};

const BEARDS: Record<number, string> = {
  0: "Clean shaven",
  1: "Moustache",
  2: "Handlebar",
  3: "Sensei",
  4: "Half goatee",
  5: "Imperial",
  6: "Goatee",
  7: "Short beard",
  8: "Short full",
  9: "Full mutton",
  10: "Medium beard",
  11: "Long beard",
  12: "Waxed",
  13: "Sideburns",
  14: "Mutton",
  15: "Full moustache",
  16: "Vizier",
  17: "Split beard",
  18: "Dali"
};

const SKIN_COLORS: Record<number, string> = {
  0: "Pale",
  1: "Fair",
  2: "Olive",
  3: "Dark",
  4: "Tanned",
  5: "Alien Green",
  6: "Demon Red",
  7: "Zaros Purple",
  8: "Icy Blue",
  9: "Ashen Grey"
};

const HAIR_COLORS: Record<number, string> = {
  0: "Blood red",
  1: "Brine red",
  2: "Ruby vermillion",
  3: "Bloodveld pink",
  4: "Phoenix orange",
  5: "Golden hoard",
  6: "Ripe peach",
  7: "Willow brown",
  8: "Mahogany brown",
  9: "Longbow brown",
  10: "Mint cake",
  11: "Cooking apple",
  12: "Jade vine green",
  13: "Saradomin blue",
  14: "Runeplate blue"
};


export class AvatarStateLimb implements CacheInvalidationListener {
  private static instance: AvatarStateLimb;
  private entity: SovereignAvatarEntity | null = null;
  private cache: CacheForensicsLimb;
  private hudForensics: HUDForensicsLimb;
  private state: AvatarConfiguration;
  private varbitCache = new Map<number, { varid: number; base: number; size: number } | null>();
  
  constructor() {
    this.cache = CacheForensicsLimb.getInstance();
    this.hudForensics = new HUDForensicsLimb();
    this.state = this.getDefaultState();

    // Subscribe to CacheWatcherLimb updates to auto-refresh state when cache updates
    try {
      const watcher = CacheWatcherLimb.getInstance();
      watcher.onCacheChange = (event) => {
        logger.info({ majorIndex: event.majorIndex }, 'CacheWatcherLimb triggered dynamic refresh in AvatarStateLimb.');
        this.syncFromVarps();
      };
      watcher.registerListener(17, this);
    } catch (e) {
      logger.warn({ err: e }, 'Failed to subscribe to CacheWatcherLimb updates.');
    }
  }

  public async onCacheInvalidated(majorIndex: number, details: string): Promise<void> {
    if (majorIndex === 17) {
      logger.info('AvatarStateLimb notified of cache enum invalidation. Performing hot-reload...');
      try {
        const modulePath = '../../generated/cache-schemas/AppearanceEnums.js';
        const newEnums = await import(`${modulePath}?t=${Date.now()}`);

        if (newEnums) {
          if (newEnums.FemaleHairStyles) {
            for (const key of Object.keys(FEMALE_HAIRSTYLES)) {
              delete (FEMALE_HAIRSTYLES as any)[key];
            }
            Object.assign(FEMALE_HAIRSTYLES, newEnums.FemaleHairStyles);
            logger.info('Hot-reloaded FEMALE_HAIRSTYLES.');
          }

          if (newEnums.MaleHairStyles) {
            for (const key of Object.keys(MALE_HAIRSTYLES)) {
              delete (MALE_HAIRSTYLES as any)[key];
            }
            Object.assign(MALE_HAIRSTYLES, newEnums.MaleHairStyles);
            logger.info('Hot-reloaded MALE_HAIRSTYLES.');
          }

          if (newEnums.BeardNames) {
            for (const key of Object.keys(BEARDS)) {
              delete (BEARDS as any)[key];
            }
            Object.assign(BEARDS, newEnums.BeardNames);
            logger.info('Hot-reloaded BEARDS.');
          }
        }
      } catch (err) {
        logger.error({ err }, 'Failed to hot-reload appearance enums in AvatarStateLimb.');
      }
    }
  }

  public bindEntity(entity: SovereignAvatarEntity): void {
    this.entity = entity;
    logger.info(`AvatarStateLimb bound to entity: ${entity.username}`);
  }

  public static getInstance(): AvatarStateLimb {
    if (!AvatarStateLimb.instance) {
      AvatarStateLimb.instance = new AvatarStateLimb();
    }
    return AvatarStateLimb.instance;
  }
  
  private getDefaultState(): AvatarConfiguration {
    return {
      ui: {
        activePanel: 'unknown'
      },
      morphology: {
        bodyBase: 0, torsoLegsStyle: 0, bodyType: 'refresh_male', gameMode: 0,
        oldHeadFallback: false, torsoOverride: false,
        categoryIndices: { head: 0, torso: 0, legs: 0, shoes: 0, beard: 0, skinMat: 0, hairMat: 0 },
        appearanceIndices: { skinColor: 0, hairColor: 0, torsoColor: 0, randomSeed: 0, shoeColor: 0 }
      },
      helmId: -1,
      capeId: -1,
      bodyId: -1,
      legsId: -1,
      weaponId: -1,
      idlePose: 'stand',
      emoteId: -1,
      semantic: {
        headStyle: 'Bald',
        beardStyle: 'Clean shaven',
        skinColor: 'Pale',
        hairColor: 'Dark brown'
      }
    };
  }
  
  private getVarbitMeta(varbitId: number): { varid: number; base: number; size: number } | null {
    if (this.varbitCache.has(varbitId)) return this.varbitCache.get(varbitId)!;
    
    const filePath = `D:/sovereign/memory/pedagogy/varbits_json/varbits-${varbitId}.json`;
    try {
        if (!fs.existsSync(filePath)) { this.varbitCache.set(varbitId, null); return null; }
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (data.varid == null || data.bits == null) { this.varbitCache.set(varbitId, null); return null; }
        
        const meta = { 
            varid: data.varid, 
            base: data.bits[0], 
            size: data.bits[1] 
        };
        this.varbitCache.set(varbitId, meta);
        return meta;
    } catch { 
        this.varbitCache.set(varbitId, null); 
        return null; 
    }
  }
  
  // VarBit read/write — the core state machine operation
  readVarBit(varbitId: number): number {
    const meta = this.getVarbitMeta(varbitId);
    if (!meta) return 0;
    
    // Read the base variable (varp)
    const varpValue = this.readVarp(meta.varid);
    
    // Extract bits
    const bitSize = meta.size - meta.base + 1;
    return (varpValue >> meta.base) & ((1 << bitSize) - 1);
  }
  
  writeVarBit(varbitId: number, value: number): void {
    const meta = this.getVarbitMeta(varbitId);
    if (!meta) return;
    
    const bitSize = meta.size - meta.base + 1;
    const mask = ((1 << bitSize) - 1) << meta.base;
    const current = this.readVarp(meta.varid);
    const newValue = (current & ~mask) | ((value & ((1 << bitSize) - 1)) << meta.base);
    
    this.writeVarp(meta.varid, newValue);
  }
  
  private readVarp(varid: number): number {
    if (!this.entity) return 0;
    return this.entity.state.varps.get(varid) ?? 0;
  }
  
  private writeVarp(varid: number, value: number): void {
    if (!this.entity) return;
    this.entity.state.varps.set(varid, value);
    
    // Notify subscribers
    this.entity.emit('varp_change', { varid, value });
    logger.debug({ varid, value }, 'Varp updated');
  }
  
  // Avatar Refresh - Part 1 specific mappings
  setBodyType(type: MorphologyState['bodyType']): void {
    this.state.morphology.bodyType = type;
    
    // Sync to varp 5745 (varbit 28556)
    let vbValue = 0;
    if (type === 'refresh_male') vbValue = 0; // Assuming 0 is male
    if (type === 'refresh_female') vbValue = 1; // Assuming 1 is female
    this.writeVarBit(VARP_5745.BODY_TYPE_GENDER, vbValue);
    
    logger.debug({ bodyType: type, varbitValue: vbValue }, 'Avatar body type updated and synced to 28556');
  }
  
  setGameMode(mode: number): void {
    this.state.morphology.gameMode = mode;
    this.writeVarBit(VARP_5745.GAME_MODE, mode);
    logger.debug({ gameMode: mode }, 'Avatar game mode updated and synced to 28557');
  }
  
  // setBodyMorph has been removed as the UI parameters for scale/muscle/fat
  // are no longer tracked as independent varbits in the beta avatar refresh.

  // Refresh entire state based on active varps
  public syncFromVarps(): void {
    if (!this.entity) return;
    
    // Varp 5745
    this.state.morphology.bodyBase = this.readVarBit(VARP_5745.BODY_BASE);
    this.state.morphology.torsoLegsStyle = this.readVarBit(VARP_5745.TORSO_LEGS);
    const bodyVal = this.readVarBit(VARP_5745.BODY_TYPE_GENDER);
    this.state.morphology.bodyType = bodyVal === 1 ? 'refresh_female' : 'refresh_male';
    this.state.morphology.gameMode = this.readVarBit(VARP_5745.GAME_MODE);
    this.state.morphology.oldHeadFallback = this.readVarBit(VARP_5745.OLD_HEAD_FALLBACK) === 1;
    this.state.morphology.torsoOverride = this.readVarBit(VARP_5745.TORSO_OVERRIDE) === 1;
    
    // Varp 5746
    this.state.morphology.categoryIndices = {
      head: this.readVarBit(VARP_5746.HEAD),
      torso: this.readVarBit(VARP_5746.TORSO),
      legs: this.readVarBit(VARP_5746.LEGS),
      shoes: this.readVarBit(VARP_5746.SHOES),
      beard: this.readVarBit(VARP_5746.BEARD),
      skinMat: this.readVarBit(VARP_5746.SKIN_MAT),
      hairMat: this.readVarBit(VARP_5746.HAIR_MAT)
    };
    
    // Varp 524476
    this.state.morphology.appearanceIndices = {
      skinColor: this.readVarBit(VARP_524476.SKIN_COLOR),
      hairColor: this.readVarBit(VARP_524476.HAIR_COLOR),
      torsoColor: this.readVarBit(VARP_524476.TORSO_COLOR),
      randomSeed: this.readVarBit(VARP_524476.RANDOM_SEED),
      shoeColor: this.readVarBit(VARP_524476.SHOE_COLOR)
    };

    // Resolve semantic appearance names from raw indices
    const bodyType = this.state.morphology.bodyType;
    const headIndex = this.state.morphology.categoryIndices.head;
    const beardIndex = this.state.morphology.categoryIndices.beard;
    const skinColorIndex = this.state.morphology.appearanceIndices.skinColor;
    const hairColorIndex = this.state.morphology.appearanceIndices.hairColor;

    let headStyleName = "Bald";
    if (bodyType === 'refresh_female') {
      headStyleName = FEMALE_HAIRSTYLES[headIndex] ?? `Female Hair ${headIndex}`;
    } else {
      headStyleName = MALE_HAIRSTYLES[headIndex] ?? `Male Hair ${headIndex}`;
    }

    this.state.semantic = {
      headStyle: headStyleName,
      beardStyle: BEARDS[beardIndex] ?? `Beard ${beardIndex}`,
      skinColor: SKIN_COLORS[skinColorIndex] ?? `Skin Color ${skinColorIndex}`,
      hairColor: HAIR_COLORS[hairColorIndex] ?? `Hair Color ${hairColorIndex}`
    };
  }
  
  getRenderState(): AvatarConfiguration {
    return { ...this.state };
  }
  
  serialize(): string {
    return JSON.stringify(this.state);
  }
  
  deserialize(data: string): void {
    this.state = { ...this.getDefaultState(), ...JSON.parse(data) };
  }

  /**
   * Validates the avatar slider variables against the decompiled BETA cache interfaces
   * and synchronizes the baseline morphology to the SovereignAvatarEntity for telemetry.
   */
  public async syncWithForensics(): Promise<void> {
    if (!this.entity) {
      logger.warn('Cannot sync with forensics: no entity bound.');
      return;
    }

    try {
      const charCreationRes = await this.hudForensics.getCharacterCreation();
      const wardrobeRes = await this.hudForensics.getEquipmentWardrobe();

      if (charCreationRes.ok) {
        const hasMorphology = charCreationRes.value.textLabels.some(t => 
          t.toLowerCase().includes('skin colour') || t.toLowerCase().includes('appearance')
        );
        
        if (hasMorphology) {
          logger.info('Avatar Refresh morphology components validated in BETA interface 1420.');
          // Initialize baseline morph telemetry to the entity state if empty
          this.setBodyType('refresh_male'); // Or default
        }
      }

      if (wardrobeRes.ok) {
        logger.info(`Wardrobe interface validated with ${wardrobeRes.value.components.length} components.`);
      }

      // Sync the computed configuration back to the entity's telemetry matrix
      this.entity.updateMorphology(this.getRenderState());
      logger.info('Avatar state machine synchronized morphology telemetry.');
    } catch (err) {
      logger.error({ error: (err as Error).message }, 'Failed to sync AvatarStateLimb with forensics');
    }
  }
}
