import * as fs from 'fs';
import * as path from 'path';

export interface ItemDefinition {
    id: number;
    name: string;
    semanticStats?: {
        req_attack?: number;
        req_ranged?: number;
        req_magic?: number;
        req_necromancy?: number;
        req_defence?: number;
        weapon_speed?: number;
        melee_strength_bonus?: number;
        accuracy_bonus?: number;
        armor_bonus?: number;
    };
    tradeable?: boolean;
    equipSlotId?: number;
}

const HARDCODED_TIERS: Record<number, number> = {
    1277: 1,     // Bronze sword
    31725: 90,   // Noxious scythe
};

export class ItemBook {
    private static instance: ItemBook;
    private items: Map<number, ItemDefinition> = new Map();

    private constructor() {
        this.loadItems();
        this.loadHudForensics();
    }

    public static getInstance(): ItemBook {
        if (!ItemBook.instance) {
            ItemBook.instance = new ItemBook();
        }
        return ItemBook.instance;
    }

    private loadItems() {
        try {
            // Adjust the path to where item_definitions_enriched.json is stored
            const atlasPath = 'D:\\sovereign\\atlas\\item\\item_definitions_enriched.json';
            
            // Only load if the file exists
            if (fs.existsSync(atlasPath)) {
                const rawBuffer = fs.readFileSync(atlasPath, 'utf8');
                const rawData = JSON.parse(rawBuffer);
                
                // Process only what we need to save memory
                for (const [idStr, item] of Object.entries<any>(rawData)) {
                    this.items.set(parseInt(idStr), {
                        id: item.id,
                        name: item.name,
                        semanticStats: item.semanticStats,
                        tradeable: item.tradeable,
                        equipSlotId: item.equipSlotId
                    });
                }
                console.log(`[ItemBook] Loaded ${this.items.size} items from taxonomy.`);
            } else {
                console.warn(`[ItemBook] Missing dictionary at ${atlasPath}. Falling back to hardcoded overrides.`);
            }
        } catch (e) {
            console.error(`[ItemBook] Failed to load taxonomy:`, e);
        }
    }

    private loadHudForensics() {
        try {
            const hudPath = 'D:\\sovereign\\cache_pedagogy\\atlas\\interfaces\\interface_1404_decomposed.json';
            if (fs.existsSync(hudPath)) {
                const rawBuffer = fs.readFileSync(hudPath, 'utf8');
                const parsed = JSON.parse(rawBuffer);
                console.log(`[ItemBook] HUD Forensics Bound: Interface ${parsed.interfaceId} (${parsed.totalComponents} components).`);
            }
        } catch (e) {
            console.error(`[ItemBook] Failed to bind HUD forensics:`, e);
        }
    }

    public get(id: number): ItemDefinition | undefined {
        return this.items.get(id);
    }

    public getWeaponScalar(itemId?: number): number {
        if (!itemId) return 100; // Unarmed

        const item = this.get(itemId);
        
        // Check overrides first in case cache is missing
        if (HARDCODED_TIERS[itemId]) {
            return Math.max(1, HARDCODED_TIERS[itemId]) * 9.6;
        }

        if (!item || !item.semanticStats) return 100;

        const req = item.semanticStats;
        const tier = Math.max(
            req.req_attack || 0,
            req.req_ranged || 0,
            req.req_magic || 0,
            req.req_necromancy || 0
        );

        return Math.max(1, tier) * 9.6;
    }
}
