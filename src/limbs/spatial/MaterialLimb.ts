import { createRequire } from 'module';
import * as path from 'path';
const require = createRequire(import.meta.url);
let GameCacheLoader: any = null;
let parse: any = null;

import { Result, ok, err } from '../../core/models.js';
import { createLogger } from "../../utils/logger.js";
import { getrsmvCachePath, getCachePedagogyPath, getrsmvSubstratePath } from '../../utils/SovereignPathResolver.js';
import * as fs from 'fs';

const rsmv = getrsmvSubstratePath();
try { ({ GameCacheLoader } = require(path.join(rsmv, 'src', 'cache', 'sqlite.js'))); } catch { }
try { ({ parse } = require(path.join(rsmv, 'src', 'opdecoder.js'))); } catch { }

const logger = createLogger('MaterialLimb');

/**
 * MaterialLimb - Extractor for shader layer materials.
 * Extracts Cache Major 26 (Materials) to map PBR properties, textures,
 * and visual components into the Sovereign Atlas. 
 */
export class MaterialLimb {
    private readonly cachePath = getrsmvCachePath();
    private readonly outDir = getCachePedagogyPath();
    private cache: any | null = null;

    constructor() {
        try {
            if (GameCacheLoader) {
                this.cache = new GameCacheLoader(this.cachePath);
                logger.info({ path: this.cachePath }, 'MaterialLimb connected to substrate.');
            } else {
                logger.warn('MaterialLimb: GameCacheLoader not available.');
            }
        } catch (e) {
            logger.error({ error: (e as Error).message }, 'Failed to connect GameCacheLoader.');
        }
    }

    /**
     * Extracts Materials into a cohesive sensory JSON.
     */
    public async extractMaterials(): Promise<Result<boolean>> {
        if (!this.cache) return err(new Error('Cache connection offline.'));
        if (!parse || !parse.materials) return err(new Error('Required RS3 parser (materials) not available.'));

        try {
            logger.info('Commencing Material Shader Extraction (Major 26)...');
            const MAJOR_MATERIALS = 26;

            // Materials typically sit in archive 0, or fileids correspond to material IDs across archives
            // In RS3, Major 26 often has archive 0 with many files, or multiple archives with file 0
            // Let's attempt to load all available archives in Major 26
            const index = await this.cache.getCacheIndex(MAJOR_MATERIALS);
            const materials: Record<number, any> = {};
            let count = 0;

            for (const archiveInfo of index) {
                if (!archiveInfo) continue;
                const archive = await this.cache.getArchiveById(MAJOR_MATERIALS, archiveInfo.minor);
                for (const f of archive) {
                    try {
                        const matId = archiveInfo.minor | f.fileid; // depending on RS3 packaging, but storing flat ID
                        const decoded = parse.materials.read(f.buffer, this.cache);
                        decoded.id = matId;
                        materials[matId] = decoded;
                        count++;
                    } catch (e) {
                        logger.warn({ archive: archiveInfo.minor, file: f.fileid, error: (e as Error).message }, 'Failed to decode material substrate entry. Skipping corrupt file.');
                    }
                }
            }

            const payload = {
                metadata: {
                    extractedAt: new Date().toISOString(),
                    materialCount: count
                },
                materials
            };

            const outPath = path.join(this.outDir, 'materials.json');
            fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));

            logger.info({ path: outPath, materials: count }, 'Material Database successfully anchored.');
            return ok(true);
        } catch (error) {
            logger.error({ error: (error as Error).message }, 'Material Extraction Failed.');
            return err(error as Error);
        }
    }

    public healthCheck(): { online: boolean; details: string; status: 'ONLINE' | 'DEGRADED' | 'OFFLINE' } {
        const cacheExists = this.cache !== null;
        let status: 'ONLINE' | 'DEGRADED' | 'OFFLINE' = 'ONLINE';
        const details = `Material: ${cacheExists ? 'NOMINAL' : 'OFFLINE'}`;

        if (!cacheExists) {
            status = 'OFFLINE';
        }
        return { online: cacheExists, details, status };
    }

    public close() {
        if (this.cache) {
            try {
                this.cache.close();
                this.cache = null;
                logger.info('MaterialLimb cache connection closed.');
            } catch (e) {
                logger.error({ error: (e as Error).message }, 'Failed to gracefully close MaterialLimb cache connection.');
            }
        }
    }
}
