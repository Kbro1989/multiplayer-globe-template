import { Coord } from '../../core/models.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('PlaneTransitionRegistry');

export interface PlaneLink {
    from: Coord;
    to: Coord;
    objectId?: number;      // Source object (for display / interaction hooks)
    label?: string;         // "Climb-up", "Climb-down", "Ladder", etc.
    bidirectional?: boolean; // Default true — also registers the reverse link
}

/**
 * PlaneTransitionRegistry
 * Authoritative registry of all tile-to-tile plane transitions.
 *
 * Links are the RS "staircase/ladder" mechanism:
 *   - Plane 0 → Plane 1 (Climb-up)
 *   - Plane 1 → Plane 0 (Climb-down)
 *   - Arbitrary cross-plane teleports (dungeons, towers, underground passages)
 *
 * Used by DirectionalPathfinder.getNeighbors() — when standing on a registered
 * tile, the destination plane coord is offered as a valid neighbor with
 * direction 'up' or 'down'.
 */
export class PlaneTransitionRegistry {
    private static instance: PlaneTransitionRegistry;

    // Key format: `${plane}_${x}_${y}` → destination Coord
    private links = new Map<string, PlaneLink>();

    static getInstance(): PlaneTransitionRegistry {
        if (!this.instance) this.instance = new PlaneTransitionRegistry();
        return this.instance;
    }

    private tileKey(c: Coord): string {
        return `${c.plane}_${c.x}_${c.y}`;
    }

    /**
     * register — Adds a directional plane link.
     */
    public register(link: PlaneLink): void {
        this.links.set(this.tileKey(link.from), link);

        if (link.bidirectional !== false) {
            // Register reverse link automatically
            const reverse: PlaneLink = {
                from: link.to,
                to: link.from,
                objectId: link.objectId,
                label: link.label?.includes('up') ? link.label.replace('up', 'down')
                     : link.label?.includes('down') ? link.label.replace('down', 'up')
                     : link.label,
                bidirectional: false // Prevent infinite recursion
            };
            this.links.set(this.tileKey(link.to), reverse);
        }

        logger.debug({
            from: link.from,
            to: link.to,
            label: link.label
        }, '[PlaneRegistry] Link registered.');
    }

    /**
     * registerMany — Batch registration.
     */
    public registerMany(links: PlaneLink[]): void {
        links.forEach(l => this.register(l));
        logger.info({ count: links.length }, '[PlaneRegistry] Batch registration complete.');
    }

    /**
     * getLink — Returns the plane link from a given tile, or null if none.
     */
    public getLink(coord: Coord): PlaneLink | null {
        return this.links.get(this.tileKey(coord)) ?? null;
    }

    /**
     * hasLink — Quick check for neighbor expansion.
     */
    public hasLink(coord: Coord): boolean {
        return this.links.has(this.tileKey(coord));
    }

    /**
     * hydrateFromObjects — Scans entity list from synthesized JSON for Climb/Ascend/Descend actions.
     * Call this after SovereignWorldLoader loads a region.
     */
    public hydrateFromObjects(entities: Array<{
        type: string;
        id: number;
        x: number;
        y: number;
        plane: number;
        actions?: string[];
        metadata?: Record<string, any>;
    }>): number {
        const CLIMB_ACTIONS = ['climb-up', 'climb-down', 'climb', 'ascend', 'descend',
                               'go-up', 'go-down', 'ladder', 'steps', 'trapdoor'];

        let registered = 0;

        for (const entity of entities) {
            if (entity.type !== 'object') continue;

            const actions = entity.actions?.map(a => a?.toLowerCase()) ?? [];
            const hasClimb = actions.some(a => CLIMB_ACTIONS.some(ca => a?.includes(ca)));
            if (!hasClimb) continue;

            const from: Coord = { x: entity.x, y: entity.y, plane: entity.plane };

            const actionStr = actions.join(' ');
            const goingUp = actionStr.includes('up') || actionStr.includes('ascend') ||
                            actionStr.includes('go-up');
            const planeDelta = goingUp ? 1 : -1;
            const toPlane = entity.plane + planeDelta;

            // ── Sovereignty Bridge Table (from heatmap.html) ──────────────
            // Explicit cross-chunk teleports for deep-world infiltration
            let toX = entity.metadata?.destX ?? entity.x;
            let toY = entity.metadata?.destY ?? entity.y;
            let destPlane = toPlane;
            let label = goingUp ? 'climb-up' : 'climb-down';

            const name = (entity.metadata?.name || '').toLowerCase();
            let isSpecialJump = false;
            
            if (name === 'trapdoor' || name === 'stairs' || name === 'staircase') {
                // Hardcoded jump to Catacombs (cx: 83, cz: 37) based on heatmap.html
                toX = (83 * 64) + (entity.x % 64);
                toY = (37 * 64) + (entity.y % 64);
                destPlane = 0; // Usually B1 loads on plane 0 in separate chunk
                label = `Enter Catacombs (B1)`;
                isSpecialJump = true;
            } else if (name === 'ladder') {
                // generic plane offset
            }

            // Reject invalid bounds ONLY if it's not a special bridge warp
            if (!isSpecialJump && (destPlane < 0 || destPlane > 3)) {
                continue;
            }
    

            const to: Coord = { x: toX, y: toY, plane: destPlane };

            this.register({
                from,
                to,
                objectId: entity.id,
                label,
                bidirectional: true
            });
            registered++;
        }

        if (registered > 0) {
            logger.info({ registered }, '[PlaneRegistry] Hydrated from entity list.');
        }
        return registered;
    }

    /**
     * clear — Wipe registry (for testing / fresh region loads).
     */
    public clear(): void {
        this.links.clear();
    }

    public get size(): number {
        return this.links.size;
    }

    public healthCheck(): { online: boolean; details: string } {
        return {
            online: true,
            details: `PlaneTransitionRegistry: ${this.links.size} links active.`
        };
    }
}
