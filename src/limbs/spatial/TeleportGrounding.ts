import fs from 'fs';
import path from 'path';
import { Coord } from '../../core/models.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('TeleportGrounding');

export interface TeleportGroundingNode {
    name: string;
    dest: Coord | null;
}

export interface TeleportGroundingManifest {
    region: string;
    metadata: any;
    endpoints: Record<string, TeleportGroundingNode>;
    objects: Record<string, TeleportGroundingNode>;
}

export class TeleportGrounding {
    private static instance: TeleportGrounding;
    private manifest: TeleportGroundingManifest | null = null;

    private constructor() {
        this.loadManifest();
    }

    public static getInstance(): TeleportGrounding {
        if (!this.instance) {
            this.instance = new TeleportGrounding();
        }
        return this.instance;
    }

    private loadManifest() {
        try {
            // Load grounding manifest synchronously for atomic resolution
            const targetPath = path.resolve(process.cwd(), 'public/teleport_grounding.json');
            if (fs.existsSync(targetPath)) {
                const raw = fs.readFileSync(targetPath, 'utf-8');
                this.manifest = JSON.parse(raw) as TeleportGroundingManifest;
                const endpointsCount = Object.keys(this.manifest.endpoints ?? {}).length;
                const objectsCount = Object.keys(this.manifest.objects ?? {}).length;
                logger.info({ endpointsCount, objectsCount }, '[TeleportGrounding] Hydrated spatial truth from manifest.');
            } else {
                logger.warn(`[TeleportGrounding] Manifest not found at ${targetPath}. Run grounding synthesizer.`);
            }
        } catch (e) {
            logger.error({ error: e }, `[TeleportGrounding] Failed to parse teleport_grounding.json`);
        }
    }

    /**
     * Resolves the spatial coordinates for a given UI Teleport Menu Endpoint (DBRow ID)
     * @param dbRowId The Jagex DBTable row ID extracted from the Lodestone/Teleport menus
     * @returns Coord if grounded, null if the gap has not been manually bridged yet.
     */
    public getEndpointCoord(dbRowId: number): Coord | null {
        if (!this.manifest || !this.manifest.endpoints) return null;
        const node = this.manifest.endpoints[dbRowId.toString()];
        return node?.dest || null;
    }

    /**
     * Resolves the spatial destination for a given transportation Object ID
     * (e.g. Minecarts, trapdoors, ladders) when cache lacks .params
     * @param objectId The Object ID clicked
     * @returns Coord if grounded, null if unknown.
     */
    public getObjectDest(objectId: number): Coord | null {
        if (!this.manifest || !this.manifest.objects) return null;
        const node = this.manifest.objects[objectId.toString()];
        return node?.dest || null;
    }
}
