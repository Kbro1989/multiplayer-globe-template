import type { Coord } from '../../core/models.js';
import { SpatialSovereigntyLimb } from './SpatialSovereigntyLimb.js';
import { SpaceRegistry, SpaceMetadata } from '../../core/SpaceRegistry.js';
import { createLogger } from '../../utils/logger.js';
import * as fs from 'fs';
import * as path from 'path';
import { resolveSpatialAnchor, resolveLogicFragment } from '../../utils/SovereignPathResolver.js';
import { RegistryB } from '../../core/RegistryB.js';
import { VibeMapper } from '../../routing/VibeMapper.js';

const logger = createLogger('FragmentOrchestrator');

/**
 * FragmentOrchestrator - Phase 34 Mastery: Logistical Sovereign Purity.
 * 
 * Responsibilities:
 * 1. Monitor avatar position relative to mapsquare (fragment) boundaries.
 * 2. Proactively load neighboring logic fragments from the D: drive "Atlas".
 * 3. Bridges the "C3 Gap" by ensuring mechanical rules are injected per-fragment.
 */
export class FragmentOrchestrator {
    private spatial: SpatialSovereigntyLimb;
    private registry: SpaceRegistry;
    private loadedRegions: Set<string> = new Set();
    
    // Hysteresis: Only check for new regions when moving significant distance
    private lastCheckCoord: Coord | null = null;
    private readonly checkThreshold = 8; // tiles

    constructor(spatial: SpatialSovereigntyLimb) {
        this.spatial = spatial;
        this.registry = SpaceRegistry.getInstance();
    }

    /**
     * update - Heartbeat for regional loading.
     */
    public async update(avatar: Coord): Promise<void> {
        if (this.shouldSkipCheck(avatar)) return;

        const centerX = avatar.x >> 6;
        const centerY = avatar.y >> 6;

        const loadPromises: Promise<any>[] = [];

        // Scan 5x5 grid (radius 2) for missing logic fragments
        for (let mx = centerX - 2; mx <= centerX + 2; mx++) {
            for (let my = centerY - 2; my <= centerY + 2; my++) {
                const anchor = `m_${mx}_${my}`;
                
                if (!this.loadedRegions.has(anchor)) {
                    loadPromises.push(this.attemptRegionalLoad(anchor, mx, my));
                }
            }
        }

        if (loadPromises.length > 0) {
            logger.info({ count: loadPromises.length }, 'Triggering proactive regional logic loads.');
            await Promise.all(loadPromises);
        }

        // 4. Update Neurological Vibe based on current anchor
        const currentAnchor = `m_${centerX}_${centerY}`;
        const registry = RegistryB.getInstance();
        const logic = registry.getFragmentLogic(currentAnchor);
        if (logic) {
            VibeMapper.getInstance().updateVibe(logic);
        }

        this.lastCheckCoord = { ...avatar };
    }

    /**
     * attemptRegionalLoad - Locates and ingests a logic fragment from the C3 Bridge.
     */
    private async attemptRegionalLoad(anchor: string, mx: number, my: number): Promise<void> {
        // Priority 1: Sovereign Path Authority resolution (D:\sovereign\atlas\spatial\)
        const logicPath = resolveLogicFragment(anchor);
        
        const originLabel = logicPath?.includes('D:\\sovereign') ? '[D-SOVEREIGN]' : '[C-LOCAL]';
        if (logicPath) {
            logger.info(`${originLabel} Fragment resolved: ${logicPath}`);
        } else {
            logger.warn({ anchor }, 'No logic fragment found in Sovereign Atlas (D:). Using blank stub.');
        }

        let success = { ok: false };
        if (logicPath) {
            success = await this.spatial.loadLogic(anchor);
        } else {
            // Coordinate fallback: Even if no JSON exists, RegistryB will seed a baseline stub
            // if it stays within the mapped coordinate range.
            success = await this.spatial.loadLogic(anchor);
        }

        if (success.ok) {
            logger.info({ anchor }, 'Proactive Space Logic applied.');
        } else {
            // RegistryB logic will handle the C3 Gap even if loadLogic "fails" to find a file.
            logger.debug({ anchor }, 'Registering baseline logic for unmapped region.');
        }

        this.loadedRegions.add(anchor);
    }


    private shouldSkipCheck(avatar: Coord): boolean {
        if (!this.lastCheckCoord) return false;
        const dist = Math.abs(avatar.x - this.lastCheckCoord.x) + Math.abs(avatar.y - this.lastCheckCoord.y);
        return dist < this.checkThreshold;
    }

    public getLoadedCount(): number {
        return this.loadedRegions.size;
    }
}
