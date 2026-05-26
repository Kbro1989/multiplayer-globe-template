import { createLogger } from "../../utils/logger.js";
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { ServerSideInjector, YaoState } from "../../core/models.js";
import { PedagogyForensicsLimb } from "../pedagogy/PedagogyForensicsLimb.js";
import { EpistemicTransitionKernel } from '../../engines/core/EpistemicTransitionKernel.js';
import { HexagramManager } from '../../routing/HexagramManager.js';

const logger = createLogger('DBRowOracleLimb');

export interface DBRow {
    id: number;
    table: number;
    unk01?: {
        cols: number;
        columndata: {
            id: number;
            flags: number;
            columns: {
                type: number;
                value: (number | string)[];
            }[];
        }[];
    };
    unk02?: any; // Standardised for new era formats
}

/**
 * DBRowOracleLimb
 * 
 * The Rosetta Stone of the Sovereign Server.
 * Translates raw RuneScape Genome data (DBTables/DBRows) into semantic gameplay logic.
 */
export class DBRowOracleLimb {
    private static instance: DBRowOracleLimb;
    private dbrows: Map<number, DBRow> = new Map();
    private projectRoot: string;
    private _cachedInjectors: ServerSideInjector[] | null = null; // High-fidelity cache substrate

    private constructor(projectRoot: string) {
        this.projectRoot = projectRoot;
    }

    public static getInstance(projectRoot: string = process.cwd()): DBRowOracleLimb {
        if (!DBRowOracleLimb.instance) {
            DBRowOracleLimb.instance = new DBRowOracleLimb(projectRoot);
        }
        return DBRowOracleLimb.instance;
    }

    // --- ORACLE COORDINATE LOGIC ---
    public static readonly ORACLE_BIT_OFFSET = 1; // NXT padding: 64×64 core sits at [1..64] within 66×66 padded grid

    /**
     * toWorld - Transforms a local padded coordinate (0..65) to world coordinates.
     */
    public static toWorld(lx: number, ly: number, rx: number, ry: number) {
        return {
            x: (rx << 6) + lx - DBRowOracleLimb.ORACLE_BIT_OFFSET,
            y: (ry << 6) + ly - DBRowOracleLimb.ORACLE_BIT_OFFSET
        };
    }

    /**
     * toPadded - Transforms a world coordinate to local padded index for 66x66 buffer access.
     */
    public static toPadded(wx: number, wy: number, rx: number, ry: number) {
        return {
            lx: (wx - (rx << 6)) + DBRowOracleLimb.ORACLE_BIT_OFFSET,
            ly: (wy - (ry << 6)) + DBRowOracleLimb.ORACLE_BIT_OFFSET
        };
    }

    public async initialize(): Promise<void> {
        logger.info('Waking Genomic Oracle...');

        const dbrowPath = 'D:/sovereign/atlas/system/dbrows.json';
        if (!existsSync(dbrowPath)) {
            logger.error({ path: dbrowPath }, 'Genome Substrate Missing: dbrows.json');
            return;
        }

        try {
            const data = JSON.parse(readFileSync(dbrowPath, 'utf-8'));
            if (Array.isArray(data)) {
                data.forEach(row => this.dbrows.set(row.id, row));
                logger.info({ count: this.dbrows.size }, 'Genomic Rows Indexed.');

                // Kernel signal: Cache substrate loaded = maximum confidence
                this.emitKernelSignal(1.0);
            }
        } catch (err) {
            logger.error({ error: (err as Error).message }, 'Failed to parse DBRow catalog');
            // Kernel signal: substrate parse failure = degraded
            this.emitKernelSignal(0.2);
        }
    }

    /**
     * resolveRefillNeed
     * Translates a DBRow ID into a semantic Refill instruction.
     * Grounded in Table 39 (POF) and Table 1 (Standard) logic.
     */
    public resolveRefillNeed(rowId: number): string {
        const row = this.dbrows.get(rowId);
        if (!row) return "UNKNOWN_GENOME";

        // Logic Grounding for Table 39 (Pens)
        if (row.table === 39 && row.unk01) {
            const nameCol = row.unk01.columndata.find(c => c.id === 7);
            const refillCol = row.unk01.columndata.find(c => c.id === 11);

            const penName = nameCol?.columns[0]?.value[0] || "Unnamed Pen";
            const refillData = refillCol?.columns.map(c => c.value).flat() || [];

            // Refill Genome: [Ingredient, Amount, Adrenaline, ...]
            if (refillData.length >= 2) {
                const ingredient = refillData[0];
                const amount = refillData[1];
                return `${penName} requires ${amount}x Ingredient [${ingredient}] for replenishment.`;
            }

            return `${penName} state active but refill requirements undefined.`;
        }

        return `DBRow [${rowId}] resolved from Table [${row.table}]. Unmapped logic domain.`;
    }

    /**
     * publishInjectors
     * Translates the entire genomic substrate into executable Mechanical Rules.
     * Tier: CACHE (Biological Truth)
     */
    public publishInjectors(): ServerSideInjector[] {
        if (this._cachedInjectors) return this._cachedInjectors;

        const injectors: ServerSideInjector[] = [];
        const pedagogy = PedagogyForensicsLimb.getInstance();

        for (const row of this.dbrows.values()) {
            // DEEP FORENSIC FALLBACK: Check for pedagogical overrides in D:/sovereign
            const pedigree = pedagogy.resolvePedigree(`dbrow_${row.table}_${row.id}`);
            const tier = pedigree ? 'SYNTHESIZED' : 'CACHE';

            // Table 39: Player Owned Farm Pens (Interaction Gating)
            if (row.table === 39 && row.unk01) {
                const penIdCol = row.unk01.columndata.find(c => c.id === 1); // Pen Index
                const varbitCol = row.unk01.columndata.find(c => c.id === 8); // Status Varbit

                if (penIdCol && varbitCol) {
                    injectors.push({
                        objectId: 123456, // TODO: Resolve exact Object ID from rsmvCacheDB
                        trigger: 'click',
                        validation: {
                            varbitChecks: [{ id: Number(varbitCol.columns[0].value[0]), value: 1 }]
                        },
                        handler: 'POFInterpreter',
                        method: 'onPenInteract',
                        authorityTier: tier,
                        provenance: pedigree ? { source: 'PEDAGOGY' as any, recordId: pedigree, timestamp: Date.now(), path: pedigree } : undefined
                    });
                }
            }

            // Table 69: Varbit-driven Global Hooks
            if (row.table === 69 && row.unk01) {
                const varbitId = row.unk01.columndata.find(c => c.id === 1);
                if (varbitId) {
                    injectors.push({
                        trigger: 'tick',
                        validation: {
                            varbitChecks: [{ id: Number(varbitId.columns[0].value[0]), value: 1 }]
                        },
                        handler: 'GlobalStateInterpreter',
                        method: 'onGlobalTick',
                        authorityTier: tier,
                        provenance: pedigree ? { source: 'PEDAGOGY' as any, recordId: pedigree, timestamp: Date.now(), path: pedigree } : undefined
                    });
                }
            }
        }

        this._cachedInjectors = injectors;
        logger.info({ count: injectors.length }, 'Genomic Injectors Published and Memoized.');

        // Kernel signal: injector publication is a confirmed cache-authority event
        this.emitKernelSignal(1.0);

        return injectors;
    }

    public healthCheck(): Promise<{ online: boolean; details: string }> {
        const isOnline = this.dbrows.size > 0;
        return Promise.resolve({
            online: isOnline,
            details: isOnline ? `Genome Active: ${this.dbrows.size} rows ready.` : 'Genome Substrate Offline.'
        });
    }

    /**
     * emitKernelSignal — Feeds a causal confidence observation into the predictive kernel.
     */
    private emitKernelSignal(confidence: number): void {
        try {
            const kernel = EpistemicTransitionKernel.getInstance();
            const yao = HexagramManager.getInstance().getYaoState();
            kernel.observeTransition(yao, confidence);
        } catch {
            // Kernel or HexagramManager not yet initialized
        }
    }
}
