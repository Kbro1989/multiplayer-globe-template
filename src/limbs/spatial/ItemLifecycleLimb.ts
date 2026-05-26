import { createLogger } from '../../utils/logger.js';
import { Item, SovereignAvatar, EquipmentSlot, Result, ok, err, SkillId } from '../../core/models.js';
import { CacheForensicsLimb } from './CacheForensicsLimb.js';

const logger = createLogger('ItemLifecycleLimb');

export class ItemLifecycleLimb {
    private static instance: ItemLifecycleLimb;

    private constructor() {}

    public static getInstance(): ItemLifecycleLimb {
        if (!ItemLifecycleLimb.instance) {
            ItemLifecycleLimb.instance = new ItemLifecycleLimb();
        }
        return ItemLifecycleLimb.instance;
    }

    /**
     * wear - Attaches an item from inventory to its designated equipment slot.
     */
    public wear(avatar: SovereignAvatar, slot: number): Result<boolean> {
        const item = avatar.inventory[slot];
        if (!item) return err(new Error('No item in slot.'));

        // Retrieve authentic, cache-backed equipment slot from the forensic registry
        const rawSlot = CacheForensicsLimb.getInstance().findItemSlot(item.id);
        let targetSlot: EquipmentSlot = item.metadata?.equipSlot || EquipmentSlot.WEAPON;
        if (rawSlot) {
            const slotMap: Record<string, EquipmentSlot> = {
                helm: EquipmentSlot.HEAD,
                face: EquipmentSlot.HEAD,
                beard: EquipmentSlot.HEAD,
                cape: EquipmentSlot.CAPE,
                necklace: EquipmentSlot.NECK,
                weapon: EquipmentSlot.WEAPON,
                body: EquipmentSlot.BODY,
                arms: EquipmentSlot.BODY,
                offhand: EquipmentSlot.SHIELD,
                legs: EquipmentSlot.LEGS,
                gloves: EquipmentSlot.HANDS,
                boots: EquipmentSlot.FEET,
                ring: EquipmentSlot.RING,
                ammo: EquipmentSlot.AMMO,
                aura: EquipmentSlot.AURA
            };
            if (slotMap[rawSlot]) {
                targetSlot = slotMap[rawSlot];
            }
        }

        // Unequip current item first if exists
        const current = avatar.equipment[targetSlot];
        if (current) {
            this.unequip(avatar, targetSlot);
        }

        // Equipment Swap
        avatar.equipment[targetSlot] = item;
        avatar.inventory[slot] = null;

        logger.info(`EQUIP: ${item.id} worn in ${targetSlot}.`);
        return ok(true);
    }

    /**
     * unequip - Returns an item from equipment slot to inventory.
     */
    public unequip(avatar: SovereignAvatar, slot: string): Result<boolean> {
        const item = avatar.equipment[slot];
        if (!item) return err(new Error('Slot is empty.'));

        const invSlot = avatar.firstEmptySlot?.() ?? -1;
        if (invSlot === -1) return err(new Error('Inventory full.'));

        avatar.inventory[invSlot] = item;
        avatar.equipment[slot] = null;

        logger.info(`UNEQUIP: ${item.id} returned to inventory.`);
        return ok(true);
    }

    /**
     * canTeleport - Validates requirements for coordinate jumps.
     */
    public canTeleport(avatar: SovereignAvatar, type: 'VARROCK' | 'LUMBRIDGE' | 'FALADOR'): Result<boolean> {
        const magicSkill = avatar.skills[SkillId.MAGIC];
        const inv = avatar.inventory;

        // Basic authentic requirements
        const reqs: Record<string, { level: number; runes: { id: number; count: number }[] }> = {
            'VARROCK': { 
                level: 25, 
                runes: [
                    { id: 563, count: 1 }, // Law Rune
                    { id: 554, count: 1 }, // Fire Rune
                    { id: 556, count: 3 }  // Air Rune
                ]
            },
            'LUMBRIDGE': {
                level: 31,
                runes: [
                    { id: 563, count: 1 }, // Law Rune
                    { id: 557, count: 1 }, // Earth Rune
                    { id: 556, count: 3 }  // Air Rune
                ]
            }
        };

        const config = reqs[type];
        if (!config) return err(new Error('Unknown teleport type.'));

        // Level check
        if ((magicSkill?.level || 1) < config.level) {
            return err(new Error(`Requires level ${config.level} Magic.`));
        }

        // Rune check
        for (const req of config.runes) {
            const has = inv.filter(i => i?.id === req.id).reduce((sum, i) => sum + (i?.amount || 0), 0);
            if (has < req.count) {
                return err(new Error(`Missing runes for ${type} teleport.`));
            }
        }

        return ok(true);
    }
}
