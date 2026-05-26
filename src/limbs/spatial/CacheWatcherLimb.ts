/**
 * CacheWatcherLimb.ts
 * 
 * Filesystem-level sentinel for the RuneScape-BETA cache directory.
 * Watches for SQLite database changes (js5-*.jcache files) and triggers
 * targeted extraction of morph-control scripts, avatar varbits, and
 * interface definitions on cache update.
 * 
 * Architecture:
 *   - fs.watch on the beta cache directory for .jcache file modifications
 *   - On change, auto-extracts the priority script set (7888, 7893, 7901, 7937, 28556, 28557)
 *   - Compares extracted script bytecodes against known baselines to detect delta
 *   - Emits structured alerts to the CombatHUDBridge for operator visibility
 * 
 * Dependencies:
 *   - GameCacheLoader from rsmv substrate
 *   - SovereignPathResolver for beta cache path
 *   - CacheSentinelLimb for 30th-skill coordination
 */

import { existsSync, watch, FSWatcher, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, basename } from 'path';
import Database from 'better-sqlite3';
import { createLogger } from '../../utils/logger.js';
import { getrsmvBetaCachePath, getrsmvLiveCachePath, resolveSovereignPath } from '../../utils/SovereignPathResolver.js';

const logger = createLogger('CacheWatcherLimb');

// Priority scripts for Avatar Refresh morph control
const PRIORITY_SCRIPTS = [
    7888,   // Varbit trigger — morph map initialization (Interface 1420 comp 68)
    7893,   // Appearance category selection handler
    7897,   // Rotate interaction (unk13)
    7898,   // Rotate interaction (unk12)
    7901,   // Color picker (param 1/0)
    7937,   // Interface bootstrap (comp 2 load)
    10642,  // TYPE_10 component init
    10896,  // Action Bar bootstrap pattern — dispatches 28557
    28556,  // UNRESOLVED: hypothesized avatar model update trigger
    28557,  // Avatar hook — game mode / skin color / randomize dispatch
] as const;

// Priority interfaces for Avatar Refresh
const PRIORITY_INTERFACES = [
    1420,   // Avatar Creation (main)
    1421,   // Potentially related avatar panel
    1430,   // Action Bar (linked via 10896 pattern)
    1797,   // Wardrobe
] as const;

export interface CacheChangeEvent {
    filename: string;
    majorIndex: number;  // e.g., 11 for clientscript, 3 for interfaces
    timestamp: number;
    deltaSummary: string;
}

export interface ScriptBaseline {
    scriptId: number;
    length: number;
    hash: string;  // sha256 of raw bytes
    lastSeen: number;
}

export interface CacheInvalidationListener {
    onCacheInvalidated(majorIndex: number, details: string): void | Promise<void>;
}

export class CacheWatcherLimb {
    private static instance: CacheWatcherLimb;
    private watchers: FSWatcher[] = [];
    private betaCachePath: string | null;
    private liveCachePath: string | null;
    private baselines: Map<number, ScriptBaseline> = new Map();
    private baselinePath: string;
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;
    private isProcessing = false;
    private fileHashes: Map<string, string> = new Map();
    private listeners: Map<number, Set<CacheInvalidationListener>> = new Map();

    // Callback for external systems (HUD, sentinel) to subscribe to changes
    public onCacheChange?: (event: CacheChangeEvent) => void;

    public registerListener(majorIndex: number, listener: CacheInvalidationListener): void {
        if (!this.listeners.has(majorIndex)) {
            this.listeners.set(majorIndex, new Set());
        }
        this.listeners.get(majorIndex)!.add(listener);
        logger.info({ majorIndex }, 'Registered new CacheInvalidationListener.');
    }

    private constructor() {
        this.betaCachePath = getrsmvBetaCachePath();
        this.liveCachePath = getrsmvLiveCachePath();
        this.baselinePath = resolveSovereignPath('cache_pedagogy/script_baselines.json');
        this.loadBaselines();
    }

    public static getInstance(): CacheWatcherLimb {
        if (!CacheWatcherLimb.instance) {
            CacheWatcherLimb.instance = new CacheWatcherLimb();
        }
        return CacheWatcherLimb.instance;
    }

    /**
     * Start watching both live and beta cache directories for changes.
     * Uses fs.watch with 500ms debounce to coalesce rapid writes.
     */
    public startWatching(): boolean {
        const pathsToWatch: { path: string; name: string }[] = [];
        if (this.betaCachePath && existsSync(this.betaCachePath)) {
            pathsToWatch.push({ path: this.betaCachePath, name: 'Beta' });
        }
        if (this.liveCachePath && existsSync(this.liveCachePath)) {
            pathsToWatch.push({ path: this.liveCachePath, name: 'Live' });
        }

        if (pathsToWatch.length === 0) {
            logger.warn('Neither Beta nor Live cache directories were found. Watcher not started.');
            return false;
        }

        if (this.watchers.length > 0) {
            logger.info('Watchers already active. Skipping re-initialization.');
            return true;
        }

        let startedAny = false;
        for (const item of pathsToWatch) {
            try {
                const watcher = watch(item.path, { recursive: false }, (eventType, filename) => {
                    if (!filename || !filename.endsWith('.jcache')) return;

                    // Debounce: Jagex cache writes are multi-step; wait for quiescence
                    if (this.debounceTimer) clearTimeout(this.debounceTimer);
                    this.debounceTimer = setTimeout(() => {
                        this.handleCacheFileChange(filename, item.path);
                    }, 500);
                });

                this.watchers.push(watcher);
                logger.info({ path: item.path, type: item.name }, `Cache watcher started on ${item.name} directory.`);
                startedAny = true;
            } catch (e) {
                logger.error({ err: e, path: item.path }, `Failed to start cache watcher on ${item.name} directory.`);
            }
        }

        return startedAny;
    }

    /**
     * Stop watching.
     */
    public stopWatching(): void {
        if (this.watchers.length > 0) {
            for (const watcher of this.watchers) {
                watcher.close();
            }
            this.watchers = [];
            logger.info('All cache watchers stopped.');
        }
    }

    /**
     * Handle a cache file modification event.
     * Determines which major index changed and triggers targeted extraction.
     */
    private async handleCacheFileChange(filename: string, cachePath: string): Promise<void> {
        if (this.isProcessing) return;
        this.isProcessing = true;

        try {
            const filePath = join(cachePath, filename);
            if (!existsSync(filePath)) {
                this.isProcessing = false;
                return;
            }

            // 1. Hash the file (detect change vs. identical)
            let buf: Buffer;
            try {
                buf = readFileSync(filePath);
            } catch (e) {
                logger.warn({ filePath, err: e }, 'Could not read cache file, it might be locked. Retrying next time.');
                this.isProcessing = false;
                return;
            }
            const hash = this.simpleHash(buf);
            const prevHash = this.fileHashes.get(filename);
            
            if (prevHash === hash) {
                logger.debug({ filename }, 'Cache file content identical (spurious event). Skipping.');
                this.isProcessing = false;
                return;
            }
            this.fileHashes.set(filename, hash);

            // Parse major index from filename (e.g., "js5-11.jcache" → 11)
            const match = filename.match(/js5-(\d+)\.jcache/);
            if (!match) {
                this.isProcessing = false;
                return;
            }

            const majorIndex = parseInt(match[1], 10);
            const isLive = cachePath.toLowerCase().includes('runescape') && !cachePath.toLowerCase().includes('beta');
            logger.info({ filename, majorIndex, hash, isLive }, 'Cache file change validated and processing.');

            const event: CacheChangeEvent = {
                filename,
                majorIndex,
                timestamp: Date.now(),
                deltaSummary: ''
            };

            // Route based on major index
            switch (majorIndex) {
                case 11: // clientscript
                    event.deltaSummary = await this.extractPriorityScripts(cachePath);
                    break;
                case 3:  // interfaces
                    event.deltaSummary = `Interface archive updated. Priority interfaces: ${PRIORITY_INTERFACES.join(', ')}`;
                    break;
                case 45: // varbits
                    event.deltaSummary = 'Varbit archive updated. Morph control varbits may have changed.';
                    break;
                case 17: // enums (js5-17)
                case 40: // enums fallback
                    event.deltaSummary = await this.extractPriorityEnums(cachePath);
                    try {
                        const { generateAppearanceEnums } = await import('../../generators/CacheSchemaGenerator.js');
                        await generateAppearanceEnums(cachePath);
                        event.deltaSummary += ' [AppearanceEnums Regenerated]';
                    } catch (genError) {
                        logger.error({ err: genError }, 'Failed to auto-regenerate TypeScript appearance enums.');
                    }
                    break;
                case 2:  // dbrows (Archive 41 is within major 2)
                    event.deltaSummary = 'DBRow archive updated. Potential skill XP table changes.';
                    break;
                default:
                    event.deltaSummary = `Major ${majorIndex} updated (non-priority).`;
            }

            logger.info({ event }, 'Cache change processed.');

            // Notify subscribers
            if (this.onCacheChange) {
                this.onCacheChange(event);
            }

            // Notify registered invalidation listeners
            const majorListeners = this.listeners.get(majorIndex);
            if (majorListeners) {
                for (const listener of majorListeners) {
                    try {
                        const res = listener.onCacheInvalidated(majorIndex, event.deltaSummary);
                        if (res instanceof Promise) {
                            await res;
                        }
                    } catch (listenerErr) {
                        logger.error({ err: listenerErr }, 'Error executing listener onCacheInvalidated callback.');
                    }
                }
            }
        } catch (e) {
            logger.error({ err: e }, 'Error processing cache change.');
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Extract priority scripts from the cache and compare against baselines.
     * Returns a delta summary string.
     */
    private async extractPriorityScripts(cachePath: string): Promise<string> {
        if (!cachePath) return 'No cache path.';

        const deltas: string[] = [];

        try {
            // Dynamic import to avoid hard dependency on rsmv at module load time
            // The rsmv substrate lives externally (D:\rsmv) — only available at runtime
            const { GameCacheLoader } = await import('rsmv/cache/sqlite.js');
            const { cacheMajors } = await import('rsmv/constants.js');
            const loader = new GameCacheLoader(cachePath);

            for (const scriptId of PRIORITY_SCRIPTS) {
                try {
                    const buf = await loader.getFileById(cacheMajors.clientscript, scriptId);
                    const hash = this.simpleHash(buf);
                    const existing = this.baselines.get(scriptId);

                    if (!existing) {
                        deltas.push(`NEW: Script ${scriptId} (${buf.length} bytes)`);
                        this.baselines.set(scriptId, { scriptId, length: buf.length, hash, lastSeen: Date.now() });
                    } else if (existing.hash !== hash) {
                        deltas.push(`CHANGED: Script ${scriptId} (${existing.length}→${buf.length} bytes)`);
                        this.baselines.set(scriptId, { scriptId, length: buf.length, hash, lastSeen: Date.now() });
                    }
                    // else: unchanged, no delta
                } catch {
                    // Script doesn't exist in this cache version
                    if (this.baselines.has(scriptId)) {
                        deltas.push(`REMOVED: Script ${scriptId} no longer exists`);
                        this.baselines.delete(scriptId);
                    }
                }
            }

            this.saveBaselines();
        } catch (e) {
            logger.error({ err: e }, 'Failed to extract priority scripts.');
            return `Extraction failed: ${e}`;
        }

        if (deltas.length === 0) return 'No script changes detected.';

        // Special alert for 28556
        if (deltas.some(d => d.includes('28556'))) {
            logger.warn('⚠ SCRIPT 28556 STATUS CHANGE — Avatar model update trigger may have been modified or added!');
        }

        return deltas.join('; ');
    }

    /**
     * Autonomous raw extraction of Enums to bypass brittle opdecoder dependencies.
     * Uses better-sqlite3 directly to locate candidate enum archives.
     */
    private async extractPriorityEnums(cachePath: string): Promise<string> {
        if (!cachePath) return 'No cache path for enums.';
        const js5_17 = join(cachePath, 'js5-17.jcache');
        if (!existsSync(js5_17)) return 'js5-17.jcache not found.';

        try {
            const db = new Database(js5_17, { readonly: true });
            
            // Check count of enums
            const countRow = db.prepare('SELECT COUNT(*) as count FROM cache').get() as any;
            const count = countRow?.count ?? 0;

            const rows = db.prepare('SELECT key, LENGTH(data) as len FROM cache ORDER BY key').all() as any[];
            const archives = new Map<number, number[]>();

            for (const row of rows) {
                const archive = (row.key >> 16) & 0xFFFF;
                const group = row.key & 0xFFFF;
                if (!archives.has(archive)) archives.set(archive, []);
                archives.get(archive)!.push(group);
            }

            const candidates: number[] = [];
            archives.forEach((groups, archive) => {
                if (groups.length >= 20 && groups.length <= 40) {
                    candidates.push(archive);
                }
            });

            let driftSummary = `Enum archive updated. Raw SQLite read: ${count} rows.`;
            
            // Perform Enum Drift Detection
            const isLive = cachePath.toLowerCase().includes('runescape') && !cachePath.toLowerCase().includes('beta');
            if (isLive) {
                logger.info('Performing Enum Drift Detection between Live and Beta cache...');
                const betaPath = getrsmvBetaCachePath();
                if (betaPath) {
                    const betaJs5 = join(betaPath, 'js5-17.jcache');
                    if (existsSync(betaJs5)) {
                        const betaDb = new Database(betaJs5, { readonly: true });
                        const betaCountRow = betaDb.prepare('SELECT COUNT(*) as count FROM cache').get() as any;
                        const betaCount = betaCountRow?.count ?? 0;
                        if (betaCount !== count) {
                            driftSummary += ` DELTA DETECTED: Live has ${count} enums, Beta has ${betaCount}.`;
                            logger.warn({ liveCount: count, betaCount }, '⚠ ENUM DRIFT DETECTED: Live and Beta caches have different enum counts!');
                        } else {
                            driftSummary += ' (No drift in enum count)';
                        }
                        betaDb.close();
                    }
                }
            }

            if (candidates.length === 0) {
                return `${driftSummary} Need format validation.`;
            }

            return `${driftSummary} Found ${candidates.length} candidate archives with 20-40 groups: ${candidates.join(', ')}`;
        } catch (e) {
            logger.error({ err: e }, 'Failed to extract priority enums using SQLite.');
            return `Enum extraction failed: ${e}`;
        }
    }

    /**
     * Simple non-crypto hash for fast comparison (FNV-1a 32-bit).
     */
    private simpleHash(buf: Buffer): string {
        let hash = 0x811c9dc5;
        for (let i = 0; i < buf.length; i++) {
            hash ^= buf[i];
            hash = Math.imul(hash, 0x01000193);
        }
        return (hash >>> 0).toString(16).padStart(8, '0');
    }

    /**
     * Load baselines from disk.
     */
    private loadBaselines(): void {
        try {
            if (existsSync(this.baselinePath)) {
                const data = JSON.parse(readFileSync(this.baselinePath, 'utf8'));
                for (const entry of data) {
                    this.baselines.set(entry.scriptId, entry);
                }
                logger.info({ count: this.baselines.size }, 'Script baselines loaded.');
            }
        } catch (e) {
            logger.debug({ err: e }, 'No existing baselines found. Starting fresh.');
        }
    }

    /**
     * Persist baselines to disk.
     */
    private saveBaselines(): void {
        try {
            const dir = join(this.baselinePath, '..');
            if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
            const list: ScriptBaseline[] = [];
            this.baselines.forEach(b => list.push(b));
            writeFileSync(this.baselinePath, JSON.stringify(list, null, 2));
        } catch (e) {
            logger.debug({ err: e }, 'Failed to save baselines.');
        }
    }

    /**
     * Manual trigger: Force a full scan of all priority scripts.
     * Use when the watcher wasn't running during a cache update.
     */
    public async forceScan(cachePath?: string): Promise<string> {
        logger.info('Manual force scan initiated.');
        const targetPath = cachePath || this.betaCachePath || this.liveCachePath || '';
        return this.extractPriorityScripts(targetPath);
    }

    /**
     * Returns the current baseline status for all priority scripts.
     */
    public getBaselineStatus(): { scriptId: number; exists: boolean; length: number; hash: string }[] {
        return PRIORITY_SCRIPTS.map(id => {
            const baseline = this.baselines.get(id);
            return {
                scriptId: id,
                exists: !!baseline,
                length: baseline?.length ?? 0,
                hash: baseline?.hash ?? 'N/A'
            };
        });
    }
}
