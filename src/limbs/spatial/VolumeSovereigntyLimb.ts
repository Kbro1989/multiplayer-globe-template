import * as fs from 'fs';
import * as path from 'path';
import { GameState, MapZone, Coord, VolumeContext } from '../../core/models.js';
import { createLogger } from '../../utils/logger.js';
import { VarbitSovereigntyLimb } from './VarbitSovereigntyLimb.js';

const logger = createLogger('VolumeSovereigntyLimb');

/**
 * VolumeSovereigntyLimb - The "Regional Context" substrate.
 * Manages 764 geographic mapzones with spatial binning for O(1) lookups.
 */
export class VolumeSovereigntyLimb {
    private static instance: VolumeSovereigntyLimb;
    private zones: Map<string, MapZone> = new Map();
    
    // Spatial Binning: "mapsquare_plane" -> [Zone IDs]
    // mapsquare = (worldX >> 6) << 8 | (worldZ >> 6)
    private spatialIndex: Map<string, string[]> = new Map();

    private constructor() {
        this.loadRegistry();
    }

    public static getInstance(): VolumeSovereigntyLimb {
        if (!VolumeSovereigntyLimb.instance) {
            VolumeSovereigntyLimb.instance = new VolumeSovereigntyLimb();
        }
        return VolumeSovereigntyLimb.instance;
    }

    private loadRegistry() {
        try {
            const registryPath = 'D:\\sovereign\\memory\\pedagogy\\mapzones_registry.json';
            const data = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
            
            for (const [id, zone] of Object.entries(data)) {
                const z = zone as MapZone;
                z.id = id;
                this.zones.set(id, z);
                this.indexZone(z);
            }
            
            logger.info({ zoneCount: this.zones.size }, 'MapZone Registry synchronized.');
        } catch (err) {
            logger.error({ err }, 'Failed to load MapZone Registry from Pedagogy.');
        }
    }

    /**
     * indexZone - Bins a zone into all NXT mapsquares (64×64 core) it overlaps.
     */
    private indexZone(zone: MapZone) {
        for (const bound of zone.bounds) {
            const dst = bound.dst;
            const plane = bound.plane;
            
            // Calculate overlapping mapsquares
            const startX = dst.xstart >> 6;
            const endX = dst.xend >> 6;
            const startZ = dst.zstart >> 6;
            const endZ = dst.zend >> 6;
            
            for (let mx = startX; mx <= endX; mx++) {
                for (let mz = startZ; mz <= endZ; mz++) {
                    const key = `${mx}_${mz}_${plane}`;
                    const list = this.spatialIndex.get(key) || [];
                    if (!list.includes(zone.id)) {
                        list.push(zone.id);
                        this.spatialIndex.set(key, list);
                    }
                }
            }
        }
    }

    /**
     * resolveVolumeContext - Returns all volumes and the primary (most specific) one.
     */
    public resolveVolumeContext(coord: Coord, gameState: GameState): VolumeContext {
        const mx = coord.x >> 6;
        const mz = coord.y >> 6;
        const key = `${mx}_${mz}_${coord.plane}`;
        
        const candidateIds = this.spatialIndex.get(key) || [];
        const matches: MapZone[] = [];
        
        for (const id of candidateIds) {
            const zone = this.zones.get(id)!;
            if (this.isInside(coord, zone)) {
                matches.push(zone);
            }
        }

        // Smallest Area Wins (Highest Specificity)
        let primary: MapZone | null = null;
        let minArea = Infinity;

        for (const m of matches) {
            const area = this.calculateArea(m);
            if (area < minArea) {
                minArea = area;
                primary = m;
            }
        }

        return {
            allVolumes: matches,
            primaryVolume: primary
        };
    }

    private isInside(coord: Coord, zone: MapZone): boolean {
        for (const bound of zone.bounds) {
            if (bound.plane !== coord.plane) continue;
            const dst = bound.dst;
            if (coord.x >= dst.xstart && coord.x <= dst.xend &&
                coord.y >= dst.zstart && coord.y <= dst.zend) {
                return true;
            }
        }
        return false;
    }

    private calculateArea(zone: MapZone): number {
        let total = 0;
        for (const bound of zone.bounds) {
            const dst = bound.dst;
            total += (dst.xend - dst.xstart + 1) * (dst.zend - dst.zstart + 1);
        }
        return total;
    }

    /**
     * checkVolumeActive - Implementation of state-gating (Phase 14 gating).
     * Currently a stub for specific pedagogy varbit links.
     */
    public checkVolumeActive(zone: MapZone, gameState: GameState): { active: boolean; reason: string | null } {
        // Logic will be expanded as we ingest specific "Area Varbit" logic
        return { active: true, reason: null };
    }
}
