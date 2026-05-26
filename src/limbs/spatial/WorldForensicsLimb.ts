import { Result, ok, err, DirectionalCollision } from '../../core/models.js';
import { JagexCacheReader } from '../../utils/JagexCacheReader.js';
import { getrsmvCachePath } from '../../utils/SovereignPathResolver.js';
import { createLogger } from '../../utils/logger.js';
import { ByteReader } from '../../utils/ByteReader.js';
import { getBlockedDirections } from '../../utils/DirectionalRegistry.js';
import { rsmvBridge } from '../../utils/RSMVBridge.js';
import fs from 'fs';

const logger = createLogger('WorldForensicsLimb');

export interface WorldObservation {
    x: number;
    z: number;
    plane: number;
    collision: number;
    objects: GameObjectInstance[];
}

export interface GameObjectInstance {
    id: number;
    type: number;
    rotation: number;
    worldX: number;
    worldZ: number;
    plane: number;
}

export interface ObjectDefinition {
    id: number;
    name: string;
    type: number;
    width: number;
    length: number;
    blocksMovement: boolean;
    blocksSight: boolean;
    maybe_allows_lineofsight?: boolean;
    maybe_blocks_movement?: boolean;
    varbitId?: number;
    varpId?: number;
    transforms?: number[];
    defaultTransformId?: number;
    actions?: string[]; // Phase 13: Interaction Morphism
}

/**
 * WorldForensicsLimb - The "SENSORY" substrate for real-time world observation.
 */
export class WorldForensicsLimb {
    private static instance: WorldForensicsLimb;
    private cache: JagexCacheReader | null = null;
    private readonly cachePath: string;
    private locationsCache: Map<string, GameObjectInstance[]> = new Map();
    private objectDefs: Map<number, ObjectDefinition> = new Map();
    private terrainCache: Map<string, WorldObservation[]> = new Map();

    private constructor() {
        this.cachePath = getrsmvCachePath();
    }

    public static getInstance(): WorldForensicsLimb {
        if (!WorldForensicsLimb.instance) {
            WorldForensicsLimb.instance = new WorldForensicsLimb();
        }
        return WorldForensicsLimb.instance;
    }

    public async initialize(): Promise<Result<void>> {
        try {
            if (this.cache) return ok(undefined); // Avoid double-init
            logger.info({ path: this.cachePath }, 'Initializing Multi-Archive World Observation substrate...');
            this.cache = new JagexCacheReader(this.cachePath);
            return ok(undefined);
        } catch (error) {
            logger.error({ error }, 'Failed to initialize Multi-Archive observation.');
            return err(error as Error);
        }
    }

    /**
     * injectObjectDefinition - Authoritatively inject an object definition (for missions/tests).
     */
    public injectObjectDefinition(id: number, def: ObjectDefinition): void {
        this.objectDefs.set(id, def);
    }

    /**
     * senseLocalArea - Returns a detailed world-state for a local NXT 66×66 padded grid.
     */
    public async senseLocalArea(x: number, z: number, plane: number): Promise<Result<WorldObservation[]>> {
        const mapsquareX = x >> 6;
        const mapsquareZ = z >> 6;
        const cacheKey = `${mapsquareX}_${mapsquareZ}_${plane}`;

        if (this.terrainCache.has(cacheKey)) {
            return ok(this.terrainCache.get(cacheKey)!);
        }

        const observations: WorldObservation[] = [];
        const grid: number[][][] = Array.from({ length: 4 }, () =>
            Array.from({ length: 66 }, () => new Array(66).fill(0))
        );

        // --- PHASE 43.8: JSON-FIRST SOVEREIGNTY ---
        const jsonPath = getrsmvCachePath().replace(/\\/g, '/').replace('cache_pedagogy/rsmv', `atlas/spatial/world_extract/ms_${mapsquareX}_${mapsquareZ}.json`);
        // We do not have resolveSovereignPath imported in WorldForensicsLimb, so we derive it from getrsmvCachePath or we can import it.
        // Wait, let's just import resolveSovereignPath or use a safe derivation.
        try {
            if (fs.existsSync(jsonPath)) {
                const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

                // Schema A: tileFlags array (SovereignWorldExtract output)
                if (data.tileFlags && Array.isArray(data.tileFlags)) {
                    for (const tile of data.tileFlags) {
                        if (tile && tile.plane < 4 && tile.x < 66 && tile.z < 66) {
                            // NXT flags: bit 1 (0x02) = blocking. NOT bit 0 (0x01 = visible).
                            grid[tile.plane][tile.x][tile.z] = (tile.collision & 0x02) !== 0 ? 1 : 0;
                        }
                    }
                }

                // Schema B: collision_matrix keyed by "x_z" (public heatmap output)
                if (data.collision_matrix) {
                    for (const [key, val] of Object.entries(data.collision_matrix)) {
                        const cm = val as any;
                        if (cm && cm.sourceFlags !== undefined) {
                            const parts = key.split('_').map(Number);
                            const worldX = parts.length === 3 ? parts[1] : parts[0];
                            const worldZ = parts.length === 3 ? parts[2] : parts[1];
                            const tp = parts.length === 3 ? parts[0] : 0;

                            // Map to Padded Coordinate [0..65]
                            const tx = worldX - (mapsquareX << 6) + 1;
                            const tz = worldZ - (mapsquareZ << 6) + 1;

                            if (tp < 4 && tx >= 0 && tx < 66 && tz >= 0 && tz < 66) {
                                // NXT sourceFlags: bit 1 (0x02) = blocking
                                grid[tp][tx][tz] = (cm.sourceFlags & 0x02) !== 0 ? 1 : 0;
                            }
                        }
                    }
                }

                // Authoritative Padded Observation Sweep (66x66)
                for (let curX = 0; curX < 66; curX++) {
                    for (let curZ = 0; curZ < 66; curZ++) {
                        const worldX = (mapsquareX << 6) + curX - 1; // Center 0..63
                        const worldZ = (mapsquareZ << 6) + curZ - 1;
                        observations.push({
                            x: worldX,
                            z: worldZ,
                            plane: plane,
                            collision: grid[plane][curX][curZ],
                            objects: []
                        });
                    }
                }
                this.terrainCache.set(cacheKey, observations);
                return ok(observations);
            }
        } catch (e) {
            console.log(`[WorldForensicsLimb] JSON Truth error for [${mapsquareX},${mapsquareZ}]:`, e);
        }

        // --- CACHE FALLBACK: rsmvBridge Collision Probing ---
        const bridgeRes = await rsmvBridge.getCollision(mapsquareX << 6, mapsquareZ << 6, plane);
        if (bridgeRes.ok) {
            const { data } = bridgeRes.value;
            // Bridge returns 5 shorts per tile: [h00, h01, h10, h11, collision3]
            for (let i = 0; i < 64 * 64; i++) {
                const tx = Math.floor(i / 64);
                const tz = i % 64;
                const col3 = data[i * 5 + 4];
                // col3 is base-3: center is bits 0..1 (value 0=pass, 1=block, 2=sight)
                // We want bits 0..1 for blocking.
                const centerVal = col3 % 3;
                grid[plane][tx + 1][tz + 1] = (centerVal === 1 || centerVal === 2) ? 1 : 0;

                observations.push({
                    x: (mapsquareX << 6) + tx,
                    z: (mapsquareZ << 6) + tz,
                    plane: plane,
                    collision: grid[plane][tx + 1][tz + 1],
                    objects: []
                });
            }
            this.terrainCache.set(cacheKey, observations);
            return ok(observations);
        }

        return err(new Error(`Mapsquare terrain data missing for [${mapsquareX}, ${mapsquareZ}] and rsmvBridge failed.`));
    }

    /**
     * getTerrainFlags - Specific tile terrain query.
     */
    public async getTerrainFlags(x: number, z: number, plane: number): Promise<number> {
        const res = await this.senseLocalArea(x, z, plane);
        if (!res.ok) return 0;
        const obs = res.value.find(o => o.x === x && o.z === z);
        return obs ? obs.collision : 0;
    }

    /**
     * senseLocations - Extracts game objects from Archive 5, Sub 0.
     */
    public async senseLocations(mapsquareX: number, mapsquareZ: number, plane: number): Promise<Result<GameObjectInstance[]>> {
        if (!this.cache) return err(new Error('Limb not initialized'));
        const cacheKey = `${mapsquareX}_${mapsquareZ}`;
        const fileId = (mapsquareX << 8) | mapsquareZ;

        if (this.locationsCache.has(cacheKey)) {
            return ok(this.locationsCache.get(cacheKey)!.filter(l => l.plane === plane));
        }

        const buffer = this.cache.readSubEntry(5, fileId, 0); // Sub 0 = Locations
        if (!buffer || buffer.length === 0) return ok([]);

        const reader = new ByteReader(buffer);
        const instances: GameObjectInstance[] = [];
        let objectId = -1;

        while (reader.hasRemaining()) {
            const idDelta = reader.readTailedVarUShort();
            if (idDelta === 0) break;
            objectId += idDelta;

            let locationData = 0;
            while (reader.hasRemaining()) {
                const locationDelta = reader.readVarUShort();
                if (locationDelta === 0) break;
                locationData += locationDelta - 1;

                const attributes = reader.readU8();
                const type = attributes >> 2;
                const rotation = attributes & 0x3;
                const hasExtra = attributes & 0x80;

                const curPlane = (locationData >> 12) & 0x3;
                const localX = (locationData >> 6) & 0x3F;
                const localZ = locationData & 0x3F;

                if (hasExtra) {
                    const flags = reader.readU8();
                    if (flags & 0x01) reader.skip(8); // Custom rotation (4 shorts)
                    if (flags & 0x02) reader.skip(2); // TranslateX
                    if (flags & 0x04) reader.skip(2); // TranslateY
                    if (flags & 0x08) reader.skip(2); // TranslateZ
                    if (flags & 0x10) reader.skip(2); // Scale (unsigned short)
                    if (flags & 0x20) reader.skip(2); // ScaleX
                    if (flags & 0x40) reader.skip(2); // ScaleY
                    if (flags & 0x80) reader.skip(2); // ScaleZ
                }

                instances.push({
                    id: objectId,
                    type,
                    rotation,
                    worldX: (mapsquareX << 6) + localX,
                    worldZ: (mapsquareZ << 6) + localZ,
                    plane: curPlane
                });
            }
        }

        this.locationsCache.set(cacheKey, instances);
        return ok(instances.filter(l => l.plane === plane));
    }

    /**
     * getObjectsAt - Specific tile location query with metadata.
     */
    public async getObjectsAt(x: number, z: number, plane: number): Promise<Array<{ id: number; name: string; type: number }>> {
        const mx = x >> 6;
        const mz = z >> 6;
        const res = await this.senseLocations(mx, mz, plane);
        if (!res.ok) return [];

        const matches = res.value.filter(l => l.worldX === x && l.worldZ === z);
        const results: Array<{ id: number; name: string; type: number }> = [];
        for (const m of matches) {
            const def = await this.getObjectDefinition(m.id);
            results.push({ id: m.id, name: def.name, type: m.type });
        }
        return results;
    }

    /**
     * getObjectDefinition - Parses Archive 16 for object metadata using opcodes.
     */
    public async getObjectDefinition(id: number): Promise<ObjectDefinition> {
        if (this.objectDefs.has(id)) {
            return this.objectDefs.get(id)!;
        }

        const bridgeRes = await rsmvBridge.getObject(id);
        if (bridgeRes.ok) {
            const b = bridgeRes.value;
            const def: ObjectDefinition = {
                id: b.id,
                name: b.name,
                type: 10,
                width: b.sizeX || 1,
                length: b.sizeZ || 1,
                blocksMovement: !b.probably_nocollision,
                blocksSight: false,
                maybe_blocks_movement: b.maybe_blocks_movement,
                actions: b.actions,
                varbitId: b.raw.varbit,
                varpId: b.raw.varp,
                transforms: b.raw.transforms,
                defaultTransformId: b.raw.defaultTransformId
            };
            this.objectDefs.set(id, def);
            return def;
        }

        return { id, name: `Object ${id}`, type: 0, blocksMovement: false, blocksSight: false, width: 1, length: 1 };
    }

    /**
     * buildDirectionalMask - Merges terrain and object data into a quaternary mask.
     */
    public async buildDirectionalMask(x: number, z: number, plane: number): Promise<Result<DirectionalCollision>> {
        const mx = x >> 6;
        const mz = z >> 6;

        const observationsRes = await this.senseLocalArea(x, z, plane);
        if (!observationsRes.ok) return err(observationsRes.error || new Error('Unknown error'));

        const obs = observationsRes.value.find(o => o.x === x && o.z === z);
        const mask: DirectionalCollision = {
            north: true, east: true, south: true, west: true,
            npc_only_blocks: []
        };

        // Terrain blocking (obs.collision is a base-3 packed int, center is index 0)
        if (obs && (obs.collision % 3 !== 0)) {
            mask.north = mask.east = mask.south = mask.west = false;
            return ok(mask);
        }

        // Object blocking
        const locsRes = await this.senseLocations(mx, mz, plane);
        if (locsRes.ok && locsRes.value) {
            const tileObjects = locsRes.value.filter(l => l.worldX === x && l.worldZ === z);
            for (const obj of tileObjects) {
                const def = await this.getObjectDefinition(obj.id);
                if (!def.blocksMovement) continue;

                const blocked = getBlockedDirections(obj.type, obj.rotation, def.width);
                for (const dir of blocked) {
                    (mask as any)[dir] = false;
                }
            }
        }

        return ok(mask);
    }

    public close(): void {
        this.cache?.close();
    }

    public getCache(): JagexCacheReader | null {
        return this.cache;
    }
}
