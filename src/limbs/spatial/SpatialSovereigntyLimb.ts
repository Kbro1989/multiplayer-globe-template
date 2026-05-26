import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from "../../utils/logger.js";
import { getSovereignRoot, resolveLogicFragment, getAtlasSpatialPath } from '../../utils/SovereignPathResolver.js';
import { VarbitSovereigntyLimb } from './VarbitSovereigntyLimb.js';
import { WorldForensicsLimb } from './WorldForensicsLimb.js';
import { Result, ok, err, GameState, Direction, Coord, DirectionalCollision } from '../../core/models.js';
import { MechanicalSovereigntyLimb } from '../technical/MechanicalSovereigntyLimb.js';
import { DirectionalPathfinder } from './DirectionalPathfinder.js';
import { GeometryAnnotationLayer } from './GeometryAnnotationLayer.js';
import { PlaneTransitionRegistry } from './PlaneTransitionRegistry.js';
import { rsmvBridge } from '../../utils/RSMVBridge.js';

// const logger = createLogger('SpatialSovereigntyLimb');
const logger = {
    info: (...args: any[]) => console.log('[INFO]', ...args),
    warn: (...args: any[]) => console.log('[WARN]', ...args),
    error: (...args: any[]) => console.log('[ERROR]', ...args)
};

export interface CollisionMatrix {
    [key: string]: number | DirectionalCollision; // "plane_x_y" -> bitmask OR directional object
}

// Spatial Authority Constants (Authoritative RS3/NXT Standard)
export const FLAG_BLOCKED   = 0x1;
export const FLAG_OVERLAY   = 0x2;   // Raised floor/Bridge participation
export const FLAG_ROOF      = 0x4;   // Visibility only
export const FLAG_FORCEDRAW = 0x8;
export const FLAG_WATER     = 0x80;  // NXT Water bit

// NXT 66×66 Padded Mapsquare Constants
// Modern NXT tiles include a 1-tile border for neighbor blending/stitching.
// Core playable area is [1..64] in the padded grid. Index 0 and 65 are neighbor bleed.
export const CORE_SIZE    = 64;   // Playable area per axis
export const PADDED_SIZE  = 66;   // Full NXT tile footprint per axis
export const TILES_PER_LEVEL = 4356; // PADDED_SIZE × PADDED_SIZE
export const PADDING_OFFSET = 1;  // Offset from padded index to core index

export interface SurfaceLayer {
    type: 'terrain' | 'water' | 'object' | 'bridge';
    z: number;
    walkable: boolean;
    blocks: boolean;
    plane: number;
    metadata?: Record<string, any>;
}

export interface SurfaceStack {
    layers: SurfaceLayer[];
    highestWalkableZ: number;
}

export interface SpatialLogicArtifact {
    city: string;
    metadata: any;
    anchors: any;
    meta: {
        bounds: {
            wx_min: number;
            wx_max: number;
            wy_min: number;
            wy_max: number;
        };
    };
    collision_matrix: CollisionMatrix;
}

/**
 * SpatialSovereigntyLimb - The "Ground Truth" Spatial Reasoning Substrate.
 * 
 * Responsibilities:
 * 1. Ingest synthesized logic artifacts (JSON collision matrices).
 * 2. Provide deterministic walkability queries (isWalkable).
 * 3. Bridge modern NXT cache topology to deterministic tile-locked pathfinding.
 */
export class SpatialSovereigntyLimb {
    private static instance: SpatialSovereigntyLimb | undefined;
    private readonly atlasDir: string;
    private loadedMatrices: Map<string, SpatialLogicArtifact> = new Map();
    private loadedMapsquares: Map<string, { flags: Uint16Array, heights: Int16Array }> = new Map();
    private groundedNPCs: Map<string, any[]> = new Map(); // "x,y,plane" -> npc objects
    private gal: GeometryAnnotationLayer;

    private getSourceDir(): string {
        const source = (globalThis as any).SOVEREIGN_SUBSTRATE || 'ATLAS_FALLBACK';
        return source === 'NXT_LIVE_CACHE'
            ? 'D:/sovereign/cache_pedagogy/rsmv_inspector/generated'
            : this.atlasDir;
    }

    public static getInstance(): SpatialSovereigntyLimb {
        if (!this.instance) {
            this.instance = new SpatialSovereigntyLimb();
        }
        return this.instance;
    }

    public static resetInstance(): void {
        if (process.env.NODE_ENV === 'production') {
            throw new Error('resetInstance is forbidden in production');
        }
        this.instance = undefined;
    }

    private constructor() {
        if (SpatialSovereigntyLimb.instance) {
            throw new Error('Singleton violation: use SpatialSovereigntyLimb.getInstance()');
        }
        this.atlasDir = getAtlasSpatialPath();
        this.gal = new GeometryAnnotationLayer();
    }

    /**
     * getGAL - Expose the annotation layer for external tools (renderer overlay, etc.)
     */
    public getGAL(): GeometryAnnotationLayer {
        return this.gal;
    }

    /**
     * initialize - Loads canonical logic files into memory.
     */
    public async initialize(): Promise<Result<boolean>> {
        try {
            logger.info({ dir: this.atlasDir }, 'Initializing SpatialSovereigntyLimb...');
            
            if (!fs.existsSync(this.atlasDir)) {
                fs.mkdirSync(this.atlasDir, { recursive: true });
                logger.warn('Spatial Atlas directory missing. Created blank substrate.');
                return ok(true);
            }

            // Load known regions via dynamic cache queries instead of eager JSON files
            logger.info('SpatialSovereigntyLimb active in dynamic cache query mode.');
            return ok(true);
        } catch (error) {
            logger.error({ error }, 'Failed to initialize SpatialSovereigntyLimb.');
            return err(error as Error);
        }
    }

    public async loadLogic(name: string): Promise<Result<void>> {
        // NXT Live Cache dynamic check
        const sourceDir = this.getSourceDir();
        const filename = name.endsWith('.json') ? name : `${name}_logic.json`;
        const cachePath = path.join(sourceDir, filename);
        if (fs.existsSync(cachePath)) {
            return this.performLoad(cachePath);
        }

        // Resolve path via Sovereign Authority (Priority: D:\atlas\spatial -> D:\atlas\logic)
        const fullPath = resolveLogicFragment(name);
        
        if (!fullPath || !fs.existsSync(fullPath)) {
            // Fallback to internal name resolution if authority fails
            const fallbackPath = path.join(this.atlasDir, filename);
            if (!fs.existsSync(fallbackPath)) {
                return err(new Error(`Spatial Authority: fragment '${name}' not resolved.`));
            }
            return this.performLoad(fallbackPath);
        }

        return this.performLoad(fullPath);
    }

    private performLoad(fullPath: string): Result<void> {
        try {
            const data = JSON.parse(fs.readFileSync(fullPath, 'utf8')) as SpatialLogicArtifact;
            this.loadedMatrices.set(data.city.toLowerCase(), data);
            
            // Log once per successful ingestion
            logger.info({ city: data.city, path: fullPath }, 'Ingested Sovereignty Artifact.');
            return ok(undefined);
        } catch (error) {
            return err(error as Error);
        }
    }

    /**
     * setRegionAuthority - Authoritatively shifts the spatial context to a new mapsquare.
     * Triggers hydration of terrain and collision logic.
     */
    public async setRegionAuthority(rx: number, ry: number): Promise<void> {
        logger.info({ rx, ry }, "[SPATIAL] Shifting Authority to new MapSquare.");
        
        // 1. Ensure mapsquare is in memory
        await this.loadMapsquare(rx, ry);
        
        // 2. Resolve 'Logic Substrate' if it exists (e.g. Prifddinas/Barrows logic)
        // [Optional: Future refinement could auto-detect logic fragments based on RX/RY]
    }

    /**
     * loadMapsquare - Ingests a raw mapsquare fragment (ms_X_Z.json) from world_extract.
     * Implements "Composite Bitwise Ingestion Merge" (Phase 41).
     */
    public async loadMapsquare(x: number, z: number): Promise<Result<void>> {
        const key = `${x}_${z}`;
        if (this.loadedMapsquares.has(key)) return ok(undefined);

        // Phase 41: Eager marking to prevent redundant loads or false-negatives
        this.loadedMapsquares.set(key, { flags: new Uint16Array(0), heights: new Int16Array(0) });

        const sourceDir = this.getSourceDir();
        let fullPath = path.join(sourceDir, 'world_extract', `ms_${x}_${z}.json`);
        if (!fs.existsSync(fullPath)) {
            // Try flat in sourceDir
            const flatPath = path.join(sourceDir, `ms_${x}_${z}.json`);
            if (fs.existsSync(flatPath)) {
                fullPath = flatPath;
            }
        }

        if (!fs.existsSync(fullPath)) {
            // FALLBACK: Dynamically query rsmvBridge for mapsquare tiles from local cache!
            logger.info({ x, z }, 'Static Mapsquare fragment missing on disk. Querying NXT Live Cache via RSMVBridge...');
            try {
                const res = await rsmvBridge.getMapsquareTiles(x, z);
                if (!res.ok) {
                    return err(new Error(`Failed to load mapsquare [${x}, ${z}] dynamically: ${res.error.message}`));
                }

                const data = res.value;
                if (data.tiles) {
                    const flags = new Uint16Array(4 * TILES_PER_LEVEL);
                    const heights = new Int16Array(4 * TILES_PER_LEVEL);
                    for (const tile of data.tiles) {
                        const tx = tile.x;
                        const tz = tile.z;
                        const plane = tile.plane;
                        if (tx < 0 || tx > 65 || tz < 0 || tz > 65 || plane < 0 || plane > 3) continue;

                        const index = (plane * TILES_PER_LEVEL) + (tx * PADDED_SIZE) + tz;
                        flags[index] |= (tile.collision || 0);
                        if (tile.height !== null && tile.height !== undefined) {
                            heights[index] = Math.max(heights[index], tile.height);
                        }
                    }
                    this.loadedMapsquares.set(key, { flags, heights });
                    logger.info({ x, z, count: data.tiles.length }, 'Successfully ingested Mapsquare from NXT Live Cache dynamically.');
                    return ok(undefined);
                } else {
                    return err(new Error(`No tile definitions returned for mapsquare [${x}, ${z}]`));
                }
            } catch (fallbackError) {
                return err(fallbackError as Error);
            }
        }

        try {
            const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));

            // Phase 41 Hybrid Ingestion: Load BOTH semantic matrices and padded binary buffers
            if (data.collision_matrix) {
                const syntheticArtifact: SpatialLogicArtifact = {
                    city: `ms_${x}_${z}`,
                    metadata: data.metadata || {},
                    anchors: {},
                    meta: {
                        bounds: {
                            wx_min: x * 64,
                            wx_max: (x * 64) + 63,
                            wy_min: z * 64,
                            wy_max: (z * 64) + 63
                        }
                    },
                    collision_matrix: data.collision_matrix
                };
                this.loadedMatrices.set(syntheticArtifact.city, syntheticArtifact);
                logger.info({ x, z }, 'Ingested Semantic Phase B3 Mapsquare Fragment.');
            }

            if (data.tiles) {
                // NXT 66×66 Padded Ingestion
                const flags = new Uint16Array(4 * TILES_PER_LEVEL);
                const heights = new Int16Array(4 * TILES_PER_LEVEL);
                for (const tile of data.tiles) {
                    const tx = tile.x;
                    const tz = tile.z;
                    const plane = tile.plane;
                    if (tx < 0 || tx > 65 || tz < 0 || tz > 65 || plane < 0 || plane > 3) continue;

                    const index = (plane * TILES_PER_LEVEL) + (tx * PADDED_SIZE) + tz;
                    flags[index] |= (tile.collision || 0);
                    if (tile.height !== null && tile.height !== undefined) {
                        heights[index] = Math.max(heights[index], tile.height);
                    }
                }
                this.loadedMapsquares.set(key, { flags, heights });
            }

            // Hydrate vertical plane transitions from extracted objects
            if (data.objects && Array.isArray(data.objects)) {
                PlaneTransitionRegistry.getInstance().hydrateFromObjects(data.objects);
            }

            // Also attempt to load unified grounding (NPCs) if available
            await this.loadUnifiedGrounding(x, z);

            return ok(undefined);
        } catch (error) {
            return err(error as Error);
        }
    }

    public async loadUnifiedGrounding(x: number, z: number): Promise<void> {
        const sourceDir = this.getSourceDir();
        let fullPath = path.join(sourceDir, 'unified_extract', `ms_${x}_${z}.json`);
        if (!fs.existsSync(fullPath)) {
            const flatPath = path.join(sourceDir, `ms_${x}_${z}.json`);
            if (fs.existsSync(flatPath)) {
                fullPath = flatPath;
            }
        }

        if (!fs.existsSync(fullPath)) return;

        try {
            const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
            if (data.pedagogy?.npcs) {
                for (const npc of data.pedagogy.npcs) {
                    const key = `${npc.worldX},${npc.worldZ},${npc.plane || 0}`;
                    if (!this.groundedNPCs.has(key)) this.groundedNPCs.set(key, []);
                    this.groundedNPCs.get(key)!.push(npc);
                }
                logger.info({ x, z, count: data.pedagogy.npcs.length }, 'Grounded NPCs indexed from Unified Extract.');
            }
        } catch (e) {
            logger.warn({ x, z }, 'Failed to load unified grounding.');
        }
    }

    /**
     * hasRegion - Check if a region is already loaded.
     */
    public hasRegion(name: string): boolean {
        return this.loadedMatrices.has(name.toLowerCase());
    }

    /**
     * resolveSurfaceStack - Volumetric Resolution of a coordinate.
     * Maps NXT cache fragments to a single authoritative surface per plane.
     * Implements "Safe Hybrid Z" (Phase 41 logic - Option C).
     */
    public resolveSurfaceStack(x: number, y: number): SurfaceStack {
        const msX = x >> 6;
        const msZ = y >> 6;
        const msKey = `${msX}_${msZ}`;
        const ms = this.loadedMapsquares.get(msKey);

        const stack: SurfaceStack = {
            layers: [],
            highestWalkableZ: 0
        };

        if (!ms) {
            // If mapsquare loaded as matrix but no heightmap exists, default to flat Plane 0
            stack.layers.push({ type: 'terrain', z: 0, walkable: true, blocks: false, plane: 0 });
            return stack;
        }

        // +1 offset: local 0-63 coords map to padded indices 1-64
        const tx = (x & 0x3F) + PADDING_OFFSET;
        const tz = (y & 0x3F) + PADDING_OFFSET;

        // NXT Pattern: 4 authoritative planes (0-3) across a 66×66 padded stride
        for (let plane = 0; plane < 4; plane++) {
            const index = (plane * TILES_PER_LEVEL) + (tx * PADDED_SIZE) + tz;
            const flag = ms.flags[index];
            const terrainHeight = ms.heights[index];
            
            // Absolute Priority Resolver (Overlay > Water > Terrain)
            const isOverlay = (flag & FLAG_OVERLAY) !== 0;  // 0x2
            const isWater   = (flag & FLAG_WATER) !== 0;    // 0x80
            const isBlocked = (flag & FLAG_BLOCKED) !== 0;  // 0x1 (Standard Blocking Bit)

            // --- Phase 41: Safe Hybrid Z (Option C) ---
            // deterministic overlay height sourcing
            const baseZ = terrainHeight * 32;
            let z = baseZ;

            let type: 'terrain' | 'water' | 'bridge' = 'terrain';
            let walkable = !isBlocked;

            // Priority Logic (The Absolute Truth)
            if (isOverlay) {
                type = 'bridge';
                walkable = true; // Overlay ALWAYS replaces base collision
                // Bridge Z is authoritative from the cache heightmap
                z = baseZ; 
            } else if (isWater) {
                type = 'water';
                walkable = false; 
                // Option C Epsilon: max(terrainZ, waterZ + 0.1)
                z = baseZ + 0.1;
            } else {
                // Standard Terrain
                z = baseZ;
            }

            stack.layers.push({
                type,
                z,
                walkable,
                blocks: !walkable,
                plane
            });

            if (walkable && z > stack.highestWalkableZ) {
                stack.highestWalkableZ = z;
            }
        }

        return stack;
    }


    /**
     * isWalkable - Unified Navigation Arbiter (Phase 41)
     * Checks authority layers in order:
     * 1. GAL (Geometry Annotation Layer - Human Override)
     * 2. Matrix (Sovereign Logic Artifacts)
     * 3. Surface Stack (Volumetric Cache Substrate)
     */
    public isWalkable(plane: number, x: number, y: number, direction?: Direction | string): boolean {
        // --- LAYER 0: Geometry Annotation Layer (Sovereign Instruction) ---
        const galResult = this.gal.isNavigable(x, y, plane);
        if (galResult !== null) return galResult;

        // --- LAYER 0.5: Vertical Transition Exemption ---
        // Tiles with registered transitions (ladders, stairs) are walkable for approach/entry
        if (PlaneTransitionRegistry.getInstance().hasLink({ x, y, plane })) {
            return true;
        }

        // --- LAYER 1: Logic Matrix (Decoded Artifacts) ---
        const matrix = this.findMatrixForCoords(x, y);
        if (matrix) {
            const key = `${plane}_${x}_${y}`;
            const altKey = `${x}_${y}`; // Plane-agnostic fallback (Ground Level)
            const collision = matrix.collision_matrix[key] || matrix.collision_matrix[altKey];

            if (collision !== undefined) {
                // Legacy bitmask matrix
                if (typeof collision === 'number') return (collision & 0x1) === 0;
                
                // Semantic Matrix Object (Phase B3)
                if (typeof collision === 'object') {
                    const c = collision as any;
                    
                    // 1. Check Directional Edge blocking BEFORE tile occupancy
                    if (direction && (c.edges || c.north !== undefined)) {
                        const edges = c.edges || c; // Support both {edges:{northBlocked}} and {north:true} formats
                        const dir = typeof direction === 'string' ? direction.toLowerCase() : direction;
                        
                        const northBlocked = edges.northBlocked ?? (edges.north === false);
                        const southBlocked = edges.southBlocked ?? (edges.south === false);
                        const eastBlocked = edges.eastBlocked ?? (edges.east === false);
                        const westBlocked = edges.westBlocked ?? (edges.west === false);

                        if (northBlocked && dir === 'north') return false;
                        if (southBlocked && dir === 'south') return false;
                        if (eastBlocked && dir === 'east') return false;
                        if (westBlocked && dir === 'west') return false;
                    }

                    // 2. Check general structural tile occupancy
                    if (c.walkable !== undefined) return c.walkable;
                    
                    // Fallback for logic artifacts (Barrows) that use direction only
                    return c.north !== undefined || c.edges !== undefined;
                }
            }

            // Fallback: If we have a matrix for this region but this specific tile is missing,
            // default to walkable (unless it's a known void or perimeter).
            return true;
        }

        // --- LAYER 2: Surface Stack (Absolute Deterministic Resolution) ---
        const surfaces = this.resolveSurfaceStack(x, y);
        const planeSurface = surfaces.layers.find(l => l.plane === plane);
        
        return planeSurface ? planeSurface.walkable : false;
    }

    /**
     * resolveEntitySurface - Plane-Constrained Z-Resolution.
     * Primary rule: Plane selects the layer -> Z resolves within that layer.
     */
    public resolveEntitySurface(x: number, y: number, plane: number): number {
        const stack = this.resolveSurfaceStack(x, y);
        const planeLayer = stack.layers.find(l => l.plane === plane && l.walkable);
        
        if (planeLayer) return planeLayer.z;
        return stack.highestWalkableZ; // Fallback to highest available surface
    }

    /**
     * getAltitude - Forensic Altitude Retrieval (Heightmap Grounding)
     * Utilizes Plane-Constrained Z-Resolution to prevent clipping and roof-climbing.
     */
    public getAltitude(plane: number, x: number, y: number): number {
        const msX = x >> 6;
        const msZ = y >> 6;
        const ms = this.loadedMapsquares.get(`${msX}_${msZ}`);
        if (!ms) return 0;

        const tx = (x & 0x3F) + PADDING_OFFSET;
        const tz = (y & 0x3F) + PADDING_OFFSET;
        const index = (plane * TILES_PER_LEVEL) + (tx * PADDED_SIZE) + tz;
        
        return ms.heights[index] * 32;
    }

    /**
     * ensureMapsquare - Pre-fetches a mapsquare fragment if not loaded.
     * Essential for A* pathfinding blocks where we need O(1) sync access.
     */
    public async ensureMapsquare(x: number, y: number): Promise<void> {
        const msX = x >> 6;
        const msZ = y >> 6;
        await this.loadMapsquare(msX, msZ);
    }

    /**
     * isWalkableContextual - Evaluates walkability including dynamic state-gated effects.
     * Uses O(1) spatial indexing from the GameState context.
     */
    public async isWalkableContextual(
        plane: number,
        x: number,
        y: number,
        context: GameState,
        mechanical: MechanicalSovereigntyLimb
    ): Promise<boolean> {
        // 1. Check static cache first (Terrain/Objects)
        const staticWalkable = this.isWalkable(plane, x, y);
        if (!staticWalkable) return false;

        // 2. Resolve coordinate key for spatial index
        const coordKey = `${x},${y},${plane}`;

        // 3. Check for dynamic NPCs (Followers, etc.) from live context
        const npcsOnTile = context.npcSpatialIndex.get(coordKey) || [];
        for (const npc of npcsOnTile) {
            // Check if NPC is explicitly acting as an object blocker
            if (npc.metadata?.isObject) return false;

            const sideEffect = await mechanical.getSpatialSideEffects((npc.npcId ?? npc.id) as number, context);
            if (sideEffect?.blocks_movement) {
                return false; // Blocked by dynamic entity rules
            }
        }

        // 3b. Check for GROUNDED NPCs (Sovereign Truth)
        // Note: Grounded NPCs from unified extracts only block if they manifest as objects or have explicit blocking rules.
        const groundedHits = this.groundedNPCs.get(coordKey);
        if (groundedHits && groundedHits.length > 0) {
            for (const npc of groundedHits) {
                if (npc.metadata?.isObject) return false;

                const sideEffect = await mechanical.getSpatialSideEffects((npc.npcId ?? npc.id) as number, context);
                if (sideEffect?.blocks_movement) {
                    return false;
                }
            }
        }

        // 4. Check for dynamic Objects (Locked doors, etc.)
        // Refactored for NXT 66x66: We coordinate-match using World Coordinates
        // Note: Future refinement would use a spatial index for O(1) object lookup.
        for (const [id, obj] of context.objectMap.entries()) {
            if (obj.x === x && obj.y === y && obj.plane === plane) {
                const varbitLimb = VarbitSovereigntyLimb.getInstance();
                // Morphism resolution...
            }
        }

        return true;
    }

    /**
     * toggleDynamicDoor - Live-toggles the collision matrix for a dynamic door/gate.
     * When opened, the directional edges are cleared. When closed, they are restored.
     */
    public toggleDynamicDoor(x: number, y: number, plane: number, open: boolean): boolean {
        const matrix = this.findMatrixForCoords(x, y);
        if (!matrix) return false;
        
        const keys = [`${plane}_${x}_${y}`, `${x}_${y}`];
        for (const key of keys) {
            const collision = matrix.collision_matrix[key];
            if (collision !== undefined && typeof collision === 'object') {
                const c = collision as any;
                if (open) {
                    if (!c._originalEdges && c.edges) {
                        c._originalEdges = { ...c.edges };
                    }
                    c.edges = { northBlocked: false, southBlocked: false, eastBlocked: false, westBlocked: false };
                } else {
                    if (c._originalEdges) {
                        c.edges = { ...c._originalEdges };
                    }
                }
                // logger.info({ x, y, plane, open }, '[SPATIAL] Dynamic door toggled.');
                return true;
            }
        }
        return false;
    }

    /**
     * swapObjectManifestation - Live-updates the collision matrix when an object morphism occurs.
     */
    public async swapObjectManifestation(x: number, y: number, plane: number, oldId: number, newId: number): Promise<void> {
        const matrix = this.findMatrixForCoords(x, y);
        if (!matrix) return;

        const key = `${plane}_${x}_${y}`;
        const altKey = `${x}_${y}`;
        const targetKey = matrix.collision_matrix[key] !== undefined ? key : altKey;

        // Perform atomic collision swap
        const forensics = WorldForensicsLimb.getInstance();
        const oldDef = await forensics.getObjectDefinition(oldId);
        const newDef = await forensics.getObjectDefinition(newId);

        // Calculate masks
        // Note: For simplicity, we currently assume single-tile objects (Doors/Gates)
        // Future refinement: Handle multi-tile width/length swaps.
        
        let collision: any = matrix.collision_matrix[targetKey] || { walkable: true, edges: {} };
        if (typeof collision === 'number') {
            collision = { walkable: (collision & 0x1) === 0, edges: {} };
        }

        if (newDef.blocksMovement && !oldDef.blocksMovement) {
            // Manifestation became SOLID
            collision.walkable = false;
        } else if (!newDef.blocksMovement && oldDef.blocksMovement) {
            // Manifestation became WALKABLE
            collision.walkable = true;
        }

        // Handle directional edges for doors
        // [Logic: Use WorldForensicsLimb.buildDirectionalMask to get canonical edges for the new ID]
        const newMaskRes = await forensics.buildDirectionalMask(x, y, plane);
        if (newMaskRes.ok) {
            collision.edges = {
                northBlocked: !newMaskRes.value.north,
                southBlocked: !newMaskRes.value.south,
                eastBlocked: !newMaskRes.value.east,
                westBlocked: !newMaskRes.value.west
            };
        }

        matrix.collision_matrix[targetKey] = collision;
        logger.info({ x, y, plane, oldId, newId }, '[SPATIAL] Object Manifestation Swapped.');
    }

    /**
     * getLogicAt - Returns the raw collision data at a coordinate.
     */
    public getLogicAt(plane: number, x: number, y: number): number | DirectionalCollision {
        const matrix = this.findMatrixForCoords(x, y);
        if (matrix) {
            let collision = matrix.collision_matrix[`${plane}_${x}_${y}`];
            if (collision === undefined) {
                collision = matrix.collision_matrix[`${x}_${y}`];
            }
            return collision || 0;
        }

        const msX = x >> 6;
        const msZ = y >> 6;
        const ms = this.loadedMapsquares.get(`${msX}_${msZ}`);
        if (ms) {
            const tx = (x & 0x3F) + PADDING_OFFSET;
            const tz = (y & 0x3F) + PADDING_OFFSET;
            const index = (plane * TILES_PER_LEVEL) + (tx * PADDED_SIZE) + tz;
            const tile = ms.flags[index];
            return tile || 0;
        }

        return -1;
    }

    /**
     * getLegacyMask - Returns strictly the numeric bitmask (for backward compat).
     */
    public getLegacyMask(plane: number, x: number, y: number): number {
        const raw = this.getLogicAt(plane, x, y);
        if (typeof raw === 'number') return raw;
        let mask = 0;
        if (!raw.north || !raw.south || !raw.east || !raw.west) mask |= 0x100;
        return mask;
    }

    /**
     * auditTile - POG2 Autonomous Spatial Audit.
     * Aligned with Phase 41 refined bitmasks.
     */
    public auditTile(plane: number, x: number, y: number): {
        coord: Coord;
        walkable: boolean;
        collisionType: 'legacy_bitmask' | 'directional' | 'unmapped' | 'mapsquare_fragment';
        raw: any;
        directional?: { north: boolean; south: boolean; east: boolean; west: boolean };
        npcOnlyBlocks?: Direction[];
        region?: string;
        ms?: string;
        stack?: SurfaceStack;
    } {
        const coord: Coord = { x, y, plane };
        const matrix = this.findMatrixForCoords(x, y);

        if (matrix) {
            let raw = matrix.collision_matrix[`${plane}_${x}_${y}`];
            if (raw === undefined) {
                raw = matrix.collision_matrix[`${x}_${y}`];
            }
            
            if (!raw) return { coord, walkable: true, collisionType: 'legacy_bitmask', raw: 0, region: matrix.city };

            if (typeof raw === 'object') {
                return {
                    coord,
                    walkable: (raw as any).walkable,
                    collisionType: 'directional',
                    raw,
                    directional: (raw as any).edges || { 
                        north: (raw as any).north, 
                        south: (raw as any).south, 
                        east: (raw as any).east, 
                        west: (raw as any).west 
                    },
                    npcOnlyBlocks: (raw as any).npc_only_blocks,
                    region: matrix.city
                };
            }

            const blocked = (raw & 0x100) !== 0 || (raw & 0x200000) !== 0 || (raw & 0x1) !== 0;
            return { coord, walkable: !blocked, collisionType: 'legacy_bitmask', raw, region: matrix.city };
        }

        // Mapsquare Fragment Audit (Volumetric Truth)
        const stack = this.resolveSurfaceStack(x, y);
        const walkable = this.isWalkable(plane, x, y);
        const msX = x >> 6;
        const msZ = y >> 6;
        
        return {
            coord,
            walkable,
            collisionType: 'mapsquare_fragment',
            raw: stack, 
            ms: `${msX}_${msZ}`,
            stack
        };
    }

    /**
     * findMatrixForCoords - Resolves which loaded artifact contains the coordinate.
     */
    private findMatrixForCoords(x: number, y: number): SpatialLogicArtifact | undefined {
        for (const [name, artifact] of this.loadedMatrices.entries()) {
            const b = artifact.meta.bounds;
            if (x >= b.wx_min && x <= b.wx_max && y >= b.wy_min && y <= b.wy_max) {
                return artifact;
            }
        }
        return undefined;
    }

    public healthCheck(): { online: boolean; details: string } {
        const count = this.loadedMatrices.size;
        return {
            online: true,
            details: `Spatial Sovereignty: ${count} regions mapped. (${[...this.loadedMatrices.keys()].join(', ')})`
        };
    }
}
