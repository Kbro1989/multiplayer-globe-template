import { Result, ok, err } from '../../core/models.js';
import { createLogger } from "../../utils/logger.js";
import { getrsmvCachePath, getCachePedagogyPath } from '../../utils/SovereignPathResolver.js';
import { rsmvBridge } from '../../utils/RSMVBridge.js';
import * as fs from 'fs';

import * as path from 'path';

const logger = createLogger('SystemTaxonomyLimb');

/**
 * SystemTaxonomyLimb - Extractor for systemic relational layers.
 * Extracts Cache Major 2, Minors 40 (dbtables) and 41 (dbrows) to anchor
 * deeply relational datastores (e.g. Archaeology paths, Currency values) 
 * into the Sovereign Atlas.
 */
export class SystemTaxonomyLimb {
    private readonly outDir = getCachePedagogyPath();

    constructor() {
        logger.info('SystemTaxonomyLimb initialized (Bridge-mediated).');
    }

    /**
     * Extracts DB Tables and DB Rows into a cohesive relational JSON.
     */
    public async extractSystemTaxonomy(): Promise<Result<boolean>> {
        try {
            logger.info('Commencing System Taxonomy Extraction (Bridge-mediated)...');

            const tablesResult = await rsmvBridge.getDBTables();
            if (!tablesResult.ok) return err(new Error(`Failed to extract DBTables: ${tablesResult.error}`));

            const rowsResult = await rsmvBridge.getDBRows();
            if (!rowsResult.ok) return err(new Error(`Failed to extract DBRows: ${rowsResult.error}`));

            const varpsResult = await rsmvBridge.getVarps();
            if (!varpsResult.ok) logger.warn(`Failed to extract Varps: ${varpsResult.error}`);

            const varbitsResult = await rsmvBridge.getVarbits();
            if (!varbitsResult.ok) logger.warn(`Failed to extract Varbits: ${varbitsResult.error}`);

            const payload = {
                metadata: {
                    extractedAt: new Date().toISOString(),
                    tableCount: tablesResult.value.count,
                    rowCount: rowsResult.value.count,
                    varpCount: varpsResult.ok ? varpsResult.value.count : 0,
                    varbitCount: varbitsResult.ok ? varbitsResult.value.count : 0
                },
                tables: tablesResult.value.results,
                rows: rowsResult.value.results,
                varps: varpsResult.ok ? varpsResult.value.results : [],
                varbits: varbitsResult.ok ? varbitsResult.value.results : []
            };

            const outPath = path.join(this.outDir, 'system_taxonomy.json');
            fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));

            // Legacy support for dbtables.json
            const legacyPath = path.join(this.outDir, 'dbtables.json');
            fs.writeFileSync(legacyPath, JSON.stringify(payload, null, 2));

            const legacyRowsPath = path.join(this.outDir, 'dbrows.json');
            // Ensure we remove the directory if it exists before writing a file
            if (fs.existsSync(legacyRowsPath) && fs.lstatSync(legacyRowsPath).isDirectory()) {
                fs.rmSync(legacyRowsPath, { recursive: true, force: true });
            }
            fs.writeFileSync(legacyRowsPath, JSON.stringify(rowsResult.value.results, null, 2));

            // Extra pedagogy exports
            const varbitsRegistryPath = path.join(this.outDir, 'varbits_registry_new.json');
            if (varbitsResult.ok) {
                const varbitsMap: Record<number, any> = {};
                varbitsResult.value.results.forEach((v: any) => {
                    varbitsMap[v.id] = { varid: v.varid, bits: v.bits };
                });
                fs.writeFileSync(varbitsRegistryPath, JSON.stringify(varbitsMap, null, 2));
            }

            logger.info({ path: outPath, tables: payload.metadata.tableCount }, 'System Taxonomy successfully anchored.');
            return ok(true);
        } catch (error) {
            logger.error({ error: (error as Error).message }, 'System Taxonomy Extraction Failed.');
            return err(error as Error);
        }
    }

    public healthCheck(): { online: boolean; details: string; status: 'ONLINE' | 'DEGRADED' | 'OFFLINE' } {
        const isOnline = rsmvBridge.isOnline;
        return {
            online: isOnline,
            details: `Systax: ${isOnline ? 'NOMINAL' : 'OFFLINE'} (Bridge)`,
            status: isOnline ? 'ONLINE' : 'OFFLINE'
        };
    }

    public close() {
        // Bridge manages its own lifecycle
    }
}
