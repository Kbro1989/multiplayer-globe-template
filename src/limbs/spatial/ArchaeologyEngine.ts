import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { resolve, join } from 'path';
import { getSovereignRoot } from '../../utils/SovereignPathResolver.js';

export interface ArchaeologyHit {
    keyword: string;
    id: string | number;
    name: string;
    models?: any;
    op?: string[];
    params?: any;
    extra?: any;
    boundSize?: number;
    walkRange?: number;
    respawnDirection?: number;
    movementType?: number;
    followerPriority?: number;
    actions?: any;
    morphs?: any;
}

export interface ArchaeologyReport {
    archaeologist_version: 3;
    timestamp: string;
    sources: {
        objects: string;
        npcs: string;
        unified_extract: string;
    };
    counts: {
        total_objects: number;
        total_npcs: number;
        unified_mapsquares: number;
        grounded_npcs: number;
    };
    hits: ArchaeologyHit[];
    grounded_entities: any[];
}

export class ArchaeologyEngine {
    private readonly sovereignBase: string;
    private readonly unifiedDir: string;
    private readonly outputDir: string;

    constructor() {
        this.sovereignBase = 'D:/sovereign';
        this.unifiedDir = resolve(this.sovereignBase, 'atlas/spatial/unified_extract');
        this.outputDir = resolve(this.sovereignBase, 'atlas/spatial/pathing_theory');
        
        if (!existsSync(this.outputDir)) {
            mkdirSync(this.outputDir, { recursive: true });
        }
    }

    public async runAudit(keywords: string[]): Promise<ArchaeologyReport> {
        console.log(`[Archaeology] Starting audit with ${keywords.length} keywords...`);

        const objectsPath = resolve(this.sovereignBase, 'cache_pedagogy/json_dumps/objects.json');
        const npcsPath = resolve(this.sovereignBase, 'cache_pedagogy/json_dumps/npcs.json');

        const objects = this.loadJson(objectsPath);
        const npcs = this.loadJson(npcsPath);

        const hits = this.searchEntities([...objects, ...npcs], keywords);
        const groundedData = await this.scanUnifiedDirectory();

        const report: ArchaeologyReport = {
            archaeologist_version: 3,
            timestamp: new Date().toISOString(),
            sources: {
                objects: objectsPath,
                npcs: npcsPath,
                unified_extract: this.unifiedDir
            },
            counts: {
                total_objects: objects.length,
                total_npcs: npcs.length,
                unified_mapsquares: groundedData.mapsquares,
                grounded_npcs: groundedData.entities.length
            },
            hits,
            grounded_entities: groundedData.entities
        };

        const reportPath = resolve(this.outputDir, 'unified_audit_report.json');
        writeFileSync(reportPath, JSON.stringify(report, null, 2));
        
        return report;
    }

    private loadJson(path: string): any[] {
        if (!existsSync(path)) return [];
        try {
            const raw = readFileSync(path, 'utf-8');
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return parsed;
            if (parsed.files && Array.isArray(parsed.files)) return parsed.files;
            return [parsed];
        } catch (e) {
            return [];
        }
    }

    private searchEntities(entities: any[], keywords: string[]): ArchaeologyHit[] {
        const hits: ArchaeologyHit[] = [];
        const lowerKeywords = keywords.map(k => k.toLowerCase());

        for (const entity of entities) {
            if (!entity) continue;
            const name = (entity.name || '').toLowerCase();
            const rawStr = JSON.stringify(entity).toLowerCase();

            for (const kw of lowerKeywords) {
                if (name.includes(kw) || rawStr.includes(kw)) {
                    hits.push({
                        keyword: kw,
                        id: entity.$fileid ?? entity.id ?? 'unknown',
                        name: entity.name ?? '',
                        models: entity.models,
                        op: entity.op,
                        params: entity.params,
                        extra: entity.extra,
                        boundSize: entity.boundSize,
                        walkRange: entity.walkRange,
                        respawnDirection: entity.respawnDirection,
                        movementType: entity.movementType,
                        followerPriority: entity.followerPriority,
                        actions: entity.actions,
                        morphs: entity.morphs_1 || entity.morphs_2,
                    });
                    break;
                }
            }
        }
        return hits;
    }

    private async scanUnifiedDirectory(): Promise<{ mapsquares: number, entities: any[] }> {
        if (!existsSync(this.unifiedDir)) return { mapsquares: 0, entities: [] };

        const files = readdirSync(this.unifiedDir).filter(f => f.endsWith('.json'));
        const allEntities: any[] = [];

        for (const file of files) {
            try {
                const content = JSON.parse(readFileSync(join(this.unifiedDir, file), 'utf-8'));
                if (content.pedagogy?.npcs) {
                    allEntities.push(...content.pedagogy.npcs.map((n: any) => ({
                        ...n,
                        source_file: file,
                        region: content.region || file.replace('ms_', '').replace('.json', '')
                    })));
                }
            } catch (e) {
                console.error(`[Archaeology] Failed to parse ${file}:`, e);
            }
        }

        return {
            mapsquares: files.length,
            entities: allEntities
        };
    }
}
