/**
 * GEOMETRY ANNOTATION LAYER (GAL)
 * 
 * The permanent human training signal. Encodes spatial expertise as
 * coordinate-keyed resolved facts â€” so the sovereign never needs to
 * guess at geometry it's already seen interpreted once.
 * 
 * Storage: D:\sovereign\atlas\annotations\
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// TYPES
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

export type VoidType =
    | 'pillar_top'
    | 'platform_underside'
    | 'waterfall_face'
    | 'cliff_edge'
    | 'agility_shortcut'
    | 'quest_gate'
    | 'transport_trigger'
    | 'decorative_nocollision'
    | 'cantilevered_floor'
    | 'mine_cart_track'
    | 'mine_cart_brake'
    | 'smuggler_trail'
    | 'patrol_boundary'
    | 'unknown';

export type AnnotationConfidence = 'RESOLVED' | 'INFERRED' | 'CONTESTED';
export type AnnotationSource = 'HUMAN' | 'LEARNER' | 'ARCHAEOLOGIST';

export type GeometryAnnotation = {
    id:           string;               // "<x>_<z>_<plane>_<index>"
    region:       { x: number; z: number; plane: number };
    tile_range:   { x1: number; z1: number; x2: number; z2: number };
    void_type:    VoidType;
    navigable:    boolean;
    signal:       string;               // Human-readable label
    confidence:   AnnotationConfidence;
    source:       AnnotationSource;
    object_ids?:  number[];             // Cache object IDs that match
    varbit_ids?:  number[];             // Varbits governing state
    notes?:       string;
    timestamp:    string;
};

export type GALIndex = {
    version:      number;
    updated:      string;
    count:        number;
    entries:      GALIndexEntry[];
};

type GALIndexEntry = {
    id:           string;
    region:       { x: number; z: number; plane: number };
    tile_range:   { x1: number; z1: number; x2: number; z2: number };
    void_type:    VoidType;
    navigable:    boolean;
    confidence:   AnnotationConfidence;
};

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// CORE CLASS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

export class GeometryAnnotationLayer {
    private static readonly BASE_DIR = 'D:/sovereign/atlas/annotations';
    private static readonly INDEX_PATH = `${GeometryAnnotationLayer.BASE_DIR}/index.gal.json`;

    private index: GALIndex;
    private cache: Map<string, GeometryAnnotation> = new Map();

    constructor() {
        this.ensureDir();
        this.index = this.loadIndex();
    }

    private ensureDir() {
        if (!existsSync(GeometryAnnotationLayer.BASE_DIR)) {
            mkdirSync(GeometryAnnotationLayer.BASE_DIR, { recursive: true });
        }
    }

    private loadIndex(): GALIndex {
        if (!existsSync(GeometryAnnotationLayer.INDEX_PATH)) {
            return { version: 1, updated: new Date().toISOString(), count: 0, entries: [] };
        }
        try {
            return JSON.parse(readFileSync(GeometryAnnotationLayer.INDEX_PATH, 'utf-8'));
        } catch {
            return { version: 1, updated: new Date().toISOString(), count: 0, entries: [] };
        }
    }

    private saveIndex() {
        this.index.updated = new Date().toISOString();
        this.index.count = this.index.entries.length;
        writeFileSync(GeometryAnnotationLayer.INDEX_PATH, JSON.stringify(this.index, null, 2));
    }

    private annotationPath(id: string): string {
        return resolve(GeometryAnnotationLayer.BASE_DIR, `${id}.gal.json`);
    }

    private tileKey(x: number, z: number, plane: number): string {
        return `${x}_${z}_${plane}`;
    }

    /**
     * Resolve a single tile coordinate against the annotation layer.
     * Returns null if no annotation covers this tile.
     */
    resolve(x: number, z: number, plane: number): GeometryAnnotation | null {
        // Check all index entries for range coverage
        for (const entry of this.index.entries) {
            if (entry.region.plane !== plane) continue;
            const { x1, z1, x2, z2 } = entry.tile_range;
            if (x >= x1 && x <= x2 && z >= z1 && z <= z2) {
                // Load full annotation if not cached
                const cacheKey = entry.id;
                if (!this.cache.has(cacheKey)) {
                    try {
                        const ann = JSON.parse(readFileSync(this.annotationPath(entry.id), 'utf-8'));
                        this.cache.set(cacheKey, ann);
                    } catch {
                        return null;
                    }
                }
                return this.cache.get(cacheKey) ?? null;
            }
        }
        return null;
    }

    /**
     * Check if a tile is navigable according to human annotation.
     * Returns null if no annotation exists (caller should use raw bitmask).
     */
    isNavigable(x: number, z: number, plane: number): boolean | null {
        const ann = this.resolve(x, z, plane);
        if (!ann || ann.confidence === 'CONTESTED') return null;
        return ann.navigable;
    }

    /**
     * Write a new geometry annotation.
     */
    annotate(ann: Omit<GeometryAnnotation, 'id' | 'timestamp'>): GeometryAnnotation {
        const { region, tile_range } = ann;
        const existingIndex = this.index.entries.filter(e =>
            e.region.x === region.x && e.region.z === region.z && e.region.plane === region.plane &&
            e.tile_range.x1 === tile_range.x1 && e.tile_range.z1 === tile_range.z1
        ).length;

        const id = `${region.x}_${region.z}_${region.plane}_${existingIndex}`;
        const full: GeometryAnnotation = { ...ann, id, timestamp: new Date().toISOString() };

        // Write annotation file
        writeFileSync(this.annotationPath(id), JSON.stringify(full, null, 2));

        // Update index
        const indexEntry: GALIndexEntry = {
            id, region, tile_range,
            void_type: ann.void_type,
            navigable: ann.navigable,
            confidence: ann.confidence,
        };

        // Remove existing entry with same id if present
        this.index.entries = this.index.entries.filter(e => e.id !== id);
        this.index.entries.push(indexEntry);
        this.saveIndex();

        // Invalidate cache
        this.cache.delete(id);

        console.log(`[GAL] Annotated: ${full.signal} @ (${tile_range.x1}-${tile_range.x2}, ${tile_range.z1}-${tile_range.z2}, plane ${region.plane})`);
        return full;
    }

    /**
     * Bulk load all annotations for a region (for renderer overlay).
     */
    getRegionAnnotations(regionX: number, regionZ: number, plane: number): GeometryAnnotation[] {
        const results: GeometryAnnotation[] = [];
        for (const entry of this.index.entries) {
            if (entry.region.x === regionX && entry.region.z === regionZ && entry.region.plane === plane) {
                try {
                    const ann = JSON.parse(readFileSync(this.annotationPath(entry.id), 'utf-8'));
                    results.push(ann);
                } catch {}
            }
        }
        return results;
    }

    /**
     * Get all annotations as a flat array (for renderer full overlay).
     */
    getAllAnnotations(): GALIndexEntry[] {
        return this.index.entries;
    }

    stats(): { total: number; resolved: number; regions: number } {
        const resolved = this.index.entries.filter(e => e.confidence === 'RESOLVED').length;
        const regions = new Set(this.index.entries.map(e => `${e.region.x}_${e.region.z}_${e.region.plane}`)).size;
        return { total: this.index.entries.length, resolved, regions };
    }
}
