import { WorldForensicsLimb } from './WorldForensicsLimb.js';
import { SovereignKnowledgeDB, TileLesson } from '../../utils/SovereignKnowledgeDB.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('LessonLearner');

export interface TileMetadata {
    plane: number;
    x: number;
    y: number; // Consistently using 'y' to match internal Coord models
    objects: Array<{ id: number; name: string; type: number }>;
    terrainFlags: number;
}

/**
 * LessonLearner - Phase B3a: The "EXTRACTION" layer.
 * 
 * Responsibilities:
 * 1. Capture snapshots of tile metadata (terrain/objects).
 * 2. Maintain a session log for Phase B3b persistence.
 */
export class LessonLearner {
    private worldForensics: WorldForensicsLimb;
    private db: SovereignKnowledgeDB;
    private extractionLog: TileMetadata[] = [];

    constructor(worldForensics: WorldForensicsLimb, dbPath?: string) {
        this.worldForensics = worldForensics;
        this.db = SovereignKnowledgeDB.getInstance();
    }

    /**
     * learnTile - Extracts metadata for a specific coordinate.
     * Note: This is an async extraction from the cache.
     */
    public async learnTile(plane: number, x: number, y: number): Promise<TileMetadata> {
        const startTime = Date.now();

        // Query the Sensory Limb (Extraction)
        const [objects, terrainFlags] = await Promise.all([
            this.worldForensics.getObjectsAt(x, y, plane),
            this.worldForensics.getTerrainFlags(x, y, plane)
        ]);

        const metadata: TileMetadata = {
            plane,
            x,
            y,
            objects,
            terrainFlags
        };

        this.extractionLog.push(metadata);

        const elapsed = Date.now() - startTime;
        logger.info({ x, y, objects: objects.length, flags: terrainFlags, ms: elapsed }, 'Extracted tile lesson.');

        return metadata;
    }

    /**
     * persistSession - Flush extracted lessons to the persistent substrate (B3b).
     */
    public async persistSession(): Promise<number> {
        if (this.extractionLog.length === 0) return 0;

        const lessons: TileLesson[] = this.extractionLog.map(m => ({
            plane: m.plane,
            x: m.x,
            y: m.y,
            terrainFlags: m.terrainFlags,
            objects: m.objects
        }));

        const count = await this.db.batchUpsert(lessons);
        this.extractionLog = []; // Flush log after persist
        return count;
    }

    /**
     * queryLearned - Retrieve historical memory for a plane.
     */
    public queryLearned(plane: number): TileLesson[] {
        return this.db.getTilesByPlane(plane);
    }

    public getSummary(): {
        tilesLearned: number;
        totalObjects: number;
        databaseTiles: number;
    } {
        return {
            tilesLearned: this.extractionLog.length,
            totalObjects: this.extractionLog.reduce((acc, t) => acc + t.objects.length, 0),
            databaseTiles: this.db.getTileCount()
        };
    }

    public close(): void {
        this.db.close();
    }

    public reset(): void {
        this.extractionLog = [];
        logger.warn('Session log purged.');
    }
}
