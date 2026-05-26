import { createLogger } from '../../utils/logger.js';
import { LogicalSignature, Provenance } from '../../core/models.js';
import { CanonicalClock } from '../../utils/CanonicalClock.js';
import { ClockAuthorityRegistry, ClockDomain } from '../../utils/ClockAuthorityRegistry.js';

export { LogicalSignature };

const logger = createLogger('ServerLogicRegistry');

export interface LogicMapping {
    major: number;
    archive: number;
    signature: LogicalSignature;
    context: string;
    provenance?: Partial<Provenance>;
}


/**
 * ServerLogicRegistry
 * Centralized mapping of Cache Archive IDs to High-Level Game Logic.
 * Enables the Authoritative CNS to dispatch reflexive logic based on item/object IDs.
 */
export class ServerLogicRegistry {
    private static registry: Map<string, LogicMapping> = new Map();
    
    public static readonly ADMIN_CALL = {
        teleport:   { id: 5,  action: LogicalSignature.SPATIAL_SHIFT },
        spawn:      { id: 1,  action: LogicalSignature.ENTITY_MANIFEST },
        admin_auth: { id: 33, action: LogicalSignature.PRIVILEGE_ELEVATION }
    }

    static {
        // --- 1. PRACTICE STACK (NPCS/ITEMS) ---
        this.register(18, 115, LogicalSignature.PRACTICE_SKILL_NODE, 'Melee Training Dummy (NPC)');
        this.register(18, 116, LogicalSignature.PRACTICE_SKILL_NODE, 'Ranged Training Dummy (NPC)');
        this.register(18, 125, LogicalSignature.PRACTICE_SKILL_NODE, 'Magic Training Dummy (NPC)');
        
        // Items used for deployment (Major 19)
        this.register(19, 124, LogicalSignature.PRACTICE_SKILL_NODE, 'Melee training dummy (Item)');
        this.register(19, 141, LogicalSignature.PRACTICE_SKILL_NODE, 'Thieving training dummy (Item)');
        this.register(19, 147, LogicalSignature.PRACTICE_SKILL_NODE, 'Agility training dummy (Item)');

        // --- 2. TRANSPORT ACTUATORS (MINE CARTS) ---
        this.register(16, 2230, LogicalSignature.TRANSPORT_ACTUATOR, 'Travel Cart (Keldagrim System)');
        this.register(16, 2684, LogicalSignature.TRANSPORT_ACTUATOR, 'Mine Cart (Dondakan System)');
        this.register(16, 637, LogicalSignature.TELEPORT_ACTUATOR, 'Mine Cart (Entry Trigger)');

        // --- 3. BANK BUFFERS (COAL TRUCKS) ---
        this.register(16, 462, LogicalSignature.BANK_DEPOSIT_ACTUATOR, 'Coal Truck Buffer (Seers Village)');
        this.register(16, 463, LogicalSignature.BANK_DEPOSIT_ACTUATOR, 'Coal Truck Buffer (Loaded State)');
        this.register(19, 453, LogicalSignature.CONSUMABLE_ROLL, 'Coal (Item substrate)');

        // --- 4. PORTABLE STATIONS (SKILLING) ---
        this.register(16, 8878, LogicalSignature.CONSUMABLE_SKILL_STATION, 'Portable Crafter');
        this.register(16, 8887, LogicalSignature.CONSUMABLE_SKILL_STATION, 'Portable Brazier');

        // --- 5. LEGACY ROLLS ---
        this.register(19, 7, LogicalSignature.CONSUMABLE_ROLL, 'Spinach Roll');

        // --- 6. AUTHORITATIVE ADMIN CALLS (PHASE 29) ---
        // Major 17 (Enums) are the dispatchers for admin events
        this.register(17, 5,  LogicalSignature.SPATIAL_SHIFT,      'Teleport Dispatcher (Enum 5)');
        this.register(17, 1,  LogicalSignature.ENTITY_MANIFEST,   'Spawn Dispatcher (Enum 1)');
        this.register(17, 33, LogicalSignature.PRIVILEGE_ELEVATION, 'Admin Auth Dispatcher (Enum 33)');

        // --- 7. BREAKTHROUGH ENTITIES (Phase 117) ---
        this.register(18, 2859, LogicalSignature.NPC_DIALOGUE, 'Hans (Sovereign Guide)');
        this.register(18, 0,    LogicalSignature.NPC_DIALOGUE, 'Hans (Breakthrough Manifest 0)');
        this.register(18, 30322, LogicalSignature.NPC_DIALOGUE, 'Cyrisus (Sovereign Ally)');
        this.register(18, 115,  LogicalSignature.PRACTICE_SKILL_NODE, 'Melee Training Dummy (Dual Mapping)');
    }

    private static register(major: number, archive: number, signature: LogicalSignature, context: string, provenance?: Partial<Provenance>) {
        const key = `${major}:${archive}`;
        this.registry.set(key, { 
            major, 
            archive, 
            signature, 
            context,
            provenance: provenance || {
                source: 'RS3_CACHE',
                major,
                recordId: archive,
                timestamp: 0 // Epoch marker for static registries
            }
        });
    }

    private static readonly PEDAGOGY_SUBSTRATE = 'D:\\sovereign\\memory\\pedagogy\\';

    /**
     * getPedagogyProvenance â€” Resolves a provenance link for a pedagogical instruction file.
     */
    public static getPedagogyProvenance(filename: string): Provenance {
        return {
            source: 'PEDAGOGY',
            major: 0,
            minor: 0,
            recordId: filename,
            timestamp: ClockAuthorityRegistry.resolveTime(ClockDomain.INFERENCE, 'ServerLogicRegistry'),
            path: `${this.PEDAGOGY_SUBSTRATE}${filename}`
        };
    }

    /**
     * getCanonicalProvenance â€” Resolves the specific JS5 cache file for an entity type.
     * Based on Jagex live cache structure: C:\ProgramData\Jagex\RuneScape\js5-<Major>.jcache
     */
    public static getCanonicalProvenance(type: 'NPC' | 'ITEM' | 'OBJECT' | 'SCENE' | 'OTHER', id: number | string): Provenance {
        const mappings: Record<string, { major: number, minor: number }> = {
            'NPC':    { major: 18, minor: 19 },
            'ITEM':   { major: 19, minor: 0 },
            'OBJECT': { major: 16, minor: 0 },
            'SCENE':  { major: 5,  minor: 0 }
        };

        const map = mappings[type] || { major: 0, minor: 0 };
        const major = map.major;
        
        return {
            source: 'RS3_CACHE',
            major,
            minor: map.minor,
            recordId: id,
            timestamp: ClockAuthorityRegistry.resolveTime(ClockDomain.INFERENCE, 'ServerLogicRegistry'),
            path: major > 0 
                ? `C:\\ProgramData\\Jagex\\RuneScape\\js5-${major}.jcache` 
                : 'C:\\ProgramData\\Jagex\\RuneScape\\GlobalSettings.jcache'
        };
    }



    public static getMapping(major: number, archive: number): LogicMapping | undefined {
        return this.registry.get(`${major}:${archive}`);
    }

    public static getSignature(major: number, archive: number): LogicalSignature | undefined {
        return this.registry.get(`${major}:${archive}`)?.signature;
    }
}

