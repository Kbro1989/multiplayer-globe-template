import { InteractionPair, isTransversal, getInteractionResult } from '../../forensics/ObjectBinaryStore.js';
import { SovereignInteractionLimb } from './SovereignInteractionLimb.js';

export interface KinematicProbe {
    id: number;
    type: 'MOUSE' | 'PLATYPUS';
    coords: { x: number, z: number, plane: number };
    velocity: { dx: number, dz: number };
    isWoundUp: boolean;
}

/**
 * Kinematic Probe Limb
 * Locomotion engine for autonomous spatial probes.
 */
export class KinematicProbeLimb {
    private probes: Map<number, KinematicProbe> = new Map();
    private collisionMap: any = null;
    private interactionLimb: SovereignInteractionLimb | null = null;

    constructor() {
        console.log("KinematicProbeLimb: Locomotion initialized.");
    }

    public setInteractionLimb(limb: SovereignInteractionLimb) {
        this.interactionLimb = limb;
    }

    /**
     * Injects the local mapsquare collision substrate.
     */
    public setCollisionMap(map: any) {
        this.collisionMap = map;
    }

    /**
     * Updates the position of all active probes.
     */
    public update(deltaTime: number) {
        for (const [id, probe] of this.probes) {
            this.processMovement(probe, deltaTime);
        }
    }

    private processMovement(probe: KinematicProbe, deltaTime: number) {
        if (probe.type === 'MOUSE' && !probe.isWoundUp) return;

        // 1. Calculate prospective next tile
        const nextX = Math.round(probe.coords.x + probe.velocity.dx);
        const nextZ = Math.round(probe.coords.z + probe.velocity.dz);

        // 2. Perform Collision Check (Abstracted)
        // In the real system, this queries the SpatialSovereigntyLimb
        const collision = this.checkCollision(
            probe.coords.x, probe.coords.z, 
            nextX, nextZ, 
            probe.coords.plane
        );

        if (collision) {
            this.handleCollision(probe, collision.objectId);
        } else {
            probe.coords.x = nextX;
            probe.coords.z = nextZ;
        }
    }

    private handleCollision(probe: KinematicProbe, objectId: number) {
        console.log(`Probe ${probe.id}: Bumper hit on Object ${objectId}`);
        
        if (this.interactionLimb) {
            this.interactionLimb.notifyBump(probe.id, objectId);
        }

        // Check for Transversal (Ladders/Caves)
        if (isTransversal(objectId)) {
            this.performTransversal(probe, objectId);
        }
    }

    private performTransversal(probe: KinematicProbe, objectId: number) {
        const interaction = getInteractionResult(objectId);
        if (!interaction) return;

        console.log(`Probe ${probe.id}: Transversal triggered (${interaction.type})`);

        if (interaction.type === 'LADDER') {
            if (interaction.action.includes('up')) probe.coords.plane++;
            if (interaction.action.includes('down')) probe.coords.plane--;
            console.log(`Probe ${probe.id}: Plane shifted to ${probe.coords.plane}`);
        } else if (interaction.type === 'CAVE' || interaction.type === 'PORTAL') {
            // Teleport logic (Forensic link)
            console.log(`Probe ${probe.id}: Entering Portal/Cave logic...`);
        }
    }

    /**
     * Authentic collision check against the 10/10 spatial heatmap.
     * Supports legacy bitmasks, 4-way edges (JSON), and 9-way masks (Hi-Fi).
     */
    private checkCollision(fromX: number, fromZ: number, toX: number, toZ: number, plane: number): { objectId: number } | null {
        if (!this.collisionMap) return null;

        // 1. Identify Direction
        const dx = toX - fromX;
        const dz = toZ - fromZ;
        
        // 2. Resolve Tile Logic
        // The collisionMap can be a sparse array (tiles[]) or a coordinate matrix (collision_matrix{})
        let tile: any = null;
        if (this.collisionMap.tiles) {
            tile = this.collisionMap.tiles.find((t: any) => t.x === toX && t.z === toZ && t.plane === plane);
        } else if (this.collisionMap.collision_matrix) {
            tile = this.collisionMap.collision_matrix[`${toX}_${toZ}_${plane}`] || this.collisionMap.collision_matrix[`${toX}_${toZ}`];
        }

        if (!tile) return null;

        // 3. Perform Multi-Format Collision Check
        let isBlocked = false;

        // A. Legacy Bitmask (0x80 = Solid, 0x100 = Overlay)
        if (typeof tile.collision === 'number' && (tile.collision & 0x80)) isBlocked = true;

        // B. 4-Way Edges (from mapsquare json / synthesis audit)
        if (tile.edges) {
            if (dz > 0 && tile.edges.southBlocked) isBlocked = true; // Moving North
            if (dz < 0 && tile.edges.northBlocked) isBlocked = true; // Moving South
            if (dx > 0 && tile.edges.westBlocked) isBlocked = true;  // Moving East
            if (dx < 0 && tile.edges.eastBlocked) isBlocked = true;  // Moving West
        }

        // C. 9-Way Mask (from lumbridge_collision_v1.json)
        // Note: dz > 0 is North, dx > 0 is East in Sovereign coords
        if (tile.mask) {
            if (tile.mask.center) isBlocked = true;
            if (dz > 0 && tile.mask.bottom) isBlocked = true;
            if (dz < 0 && tile.mask.top) isBlocked = true;
            if (dx > 0 && tile.mask.left) isBlocked = true;
            if (dx < 0 && tile.mask.right) isBlocked = true;
            
            // Diagonals
            if (dx > 0 && dz > 0 && tile.mask.botleft) isBlocked = true;
            if (dx < 0 && dz > 0 && tile.mask.botright) isBlocked = true;
            if (dx > 0 && dz < 0 && tile.mask.topleft) isBlocked = true;
            if (dx < 0 && dz < 0 && tile.mask.topright) isBlocked = true;
        }

        // D. Top-level walkable flag
        if (tile.walkable === false) isBlocked = true;

        if (isBlocked) {
            return { objectId: tile.objectId || 99999 };
        }

        return null;
    }

    public spawnProbe(id: number, type: 'MOUSE' | 'PLATYPUS', coords: { x: number, z: number, plane: number }) {
        this.probes.set(id, {
            id,
            type,
            coords,
            velocity: { dx: 1, dz: 0 },
            isWoundUp: true
        });
    }
}
