import { Coord, Result, ok, err } from '../../core/models.js';
import { SpatialSovereigntyLimb, CORE_SIZE } from './SpatialSovereigntyLimb.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('DiscoveryLimb');

/**
 * DiscoveryLimb - Phase B1: The "MAPPING" substrate.
 * 
 * Responsibilities:
 * 1. Track tile visitation within a session.
 * 2. Scan mapsquares for "Frontier" tiles (Walkable but Unvisited).
 * 3. Calculate exploration coverage metrics.
 */
export class DiscoveryLimb {
    private visitedTiles: Set<string> = new Set();
    private readonly mapsquareSize = CORE_SIZE; // NXT: 64-tile playable core

    /**
     * markVisited - Record the avatar's presence on a tile.
     */
    public markVisited(plane: number, x: number, y: number): void {
        const key = `${plane}_${x}_${y}`;
        if (!this.visitedTiles.has(key)) {
            this.visitedTiles.add(key);
            logger.info({ plane, x, y }, 'New tile discovered.');
        }
    }

    /**
     * isVisited - Check if the avatar has prioritized this tile before.
     */
    public isVisited(plane: number, x: number, y: number): boolean {
        return this.visitedTiles.has(`${plane}_${x}_${y}`);
    }

    /**
     * getUnvisitedWalkableTiles - Scans an NXT mapsquare (64×64 core) for exploration targets.
     * This is the "Frontier Detection" logic for Phase B2.
     */
    public async getUnvisitedWalkableTiles(
        plane: number,
        mapsquareX: number,
        mapsquareY: number,
        spatial: SpatialSovereigntyLimb
    ): Promise<Coord[]> {
        return this.getFrontierExtended(plane, mapsquareX, mapsquareY, 0, spatial);
    }

    /**
     * getGlobalFrontier - Phase C2: Global World Discovery.
     * Consolidates unvisited tiles from the 3x3 mapsquare grid (192x192 tiles).
     */
    public async getGlobalFrontier(
        plane: number,
        currentX: number,
        currentY: number,
        spatial: SpatialSovereigntyLimb
    ): Promise<Coord[]> {
        const mx = currentX >> 6;
        const my = currentY >> 6;
        return this.getFrontierExtended(plane, mx, my, 1, spatial);
    }

    /**
     * getFrontierExtended - Scans a range of mapsquares.
     * radius=0: current mapsquare only (NXT 64×64 core)
     * radius=1: 3x3 mapsquare grid (192×192) - User Request: "Triple the view"
     */
    public async getFrontierExtended(
        plane: number,
        centerX: number,
        centerY: number,
        radius: number,
        spatial: SpatialSovereigntyLimb
    ): Promise<Coord[]> {
        const unvisited: Coord[] = [];
        
        for (let mx = centerX - radius; mx <= centerX + radius; mx++) {
            for (let my = centerY - radius; my <= centerY + radius; my++) {
                const startX = mx << 6;
                const startY = my << 6;

                for (let lx = 0; lx < this.mapsquareSize; lx++) {
                    for (let ly = 0; ly < this.mapsquareSize; ly++) {
                        const wx = startX + lx;
                        const wy = startY + ly;

                        if (!this.isVisited(plane, wx, wy)) {
                            // Check common walkability first, then regional check
                            if (spatial.isWalkable(plane, wx, wy)) {
                                unvisited.push({ x: wx, y: wy, plane });
                            }
                        }
                    }
                }
            }
        }
        return unvisited;
    }

    /**
     * getCoverage - Returns visitation metrics for a specific mapsquare.
     */
    public getCoverage(plane: number, mapsquareX: number, mapsquareY: number): {
        visited: number;
        total: number;
        percentage: string;
    } {
        const startX = mapsquareX << 6;
        const startY = mapsquareY << 6;
        let visitedCount = 0;
        const totalTiles = this.mapsquareSize * this.mapsquareSize;

        for (let lx = 0; lx < this.mapsquareSize; lx++) {
            for (let ly = 0; ly < this.mapsquareSize; ly++) {
                if (this.isVisited(plane, startX + lx, startY + ly)) {
                    visitedCount++;
                }
            }
        }

        return {
            visited: visitedCount,
            total: totalTiles,
            percentage: ((visitedCount / totalTiles) * 100).toFixed(2)
        };
    }

    /**
     * reset - Clear session memory (for teleportation or re-exploration).
     */
    public reset(): void {
        this.visitedTiles.clear();
        logger.warn('Discovery memory purged.');
    }
}
