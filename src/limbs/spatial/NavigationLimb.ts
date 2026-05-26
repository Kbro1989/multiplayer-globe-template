import { Coord } from '../../core/models.js';
import { WorldGroundingLimb } from '../world_grounding/WorldGroundingLimb.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('NavigationLimb');

export interface NamedLocation {
    id: string;
    name: string;
    coord: Coord;
}

/**
 * NavigationLimb
 * 
 * Generalizes "Places" in the POG2 world. Resolves named locations
 * (e.g., "Lumbridge", "Barrows") into coordinates by querying the 
 * WorldGrounding manifest, rather than using side templates.
 */
export class NavigationLimb {
    private static instance: NavigationLimb;
    private landmarks: Map<string, NamedLocation> = new Map();

    private constructor() {
        this.initializeLandmarks();
    }

    public static getInstance(): NavigationLimb {
        if (!NavigationLimb.instance) {
            NavigationLimb.instance = new NavigationLimb();
        }
        return NavigationLimb.instance;
    }

    private initializeLandmarks() {
        // Load authoritative landmarks from the grounding manifest if they exist
        const grounding = WorldGroundingLimb.getInstance();
        const manifest = grounding.getManifest();

        for (const [id, entry] of Object.entries(manifest.entities)) {
            if (id.startsWith('place_') || (entry as any).type === 'LANDMARK') {
                const data = entry.grounded.data;
                const coord = entry.coord || data.coord || data.spatial;
                if (coord) {
                    this.landmarks.set(id.replace('place_', '').toLowerCase(), {
                        id,
                        name: data.name || id,
                        coord: { x: coord.x, y: coord.y, plane: coord.plane || 0 }
                    });
                }
            }
        }

        // Fallback: Legacy landmarks if manifest is empty (Recalibration Anchor)
        if (this.landmarks.size === 0) {
            logger.warn('Grounding manifest empty of places. Loading legacy navigation fallbacks.');
            const legacy = [
                { name: 'Lumbridge', x: 3221, y: 3218 },
                { name: 'Draynor', x: 3108, y: 3352 },
                { name: 'Falador', x: 2964, y: 3378 },
                { name: 'Varrock', x: 3212, y: 3422 },
                { name: 'Edgeville', x: 3093, y: 3491 },
                { name: 'Barrows', x: 3564, y: 3288 },
                { name: 'KBD', x: 2273, y: 4695 },
                { name: 'Prifddinas', x: 2200, y: 3400 }
            ];

            legacy.forEach(l => {
                this.landmarks.set(l.name.toLowerCase(), {
                    id: `place_${l.name.toLowerCase()}`,
                    name: l.name,
                    coord: { x: l.x, y: l.y, plane: 0 }
                });
            });
        }
    }

    public resolveLocation(name: string): NamedLocation | null {
        return this.landmarks.get(name.toLowerCase()) || null;
    }

    public getAllLocations(): NamedLocation[] {
        return Array.from(this.landmarks.values());
    }
}

