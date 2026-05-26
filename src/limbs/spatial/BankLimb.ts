import { createLogger } from '../../utils/logger.js';
import { Item, SovereignAvatar } from '../../core/models.js';

const logger = createLogger('BankLimb');

export class BankLimb {
    private static instance: BankLimb;

    private constructor() {}

    public static getInstance(): BankLimb {
        if (!BankLimb.instance) {
            BankLimb.instance = new BankLimb();
        }
        return BankLimb.instance;
    }

    /**
     * deposit - Transfers an item from inventory to bank ledger.
     */
    public deposit(avatar: SovereignAvatar, slot: number, amount: number = 1): boolean {
        const inventory = (avatar as any).inventory;
        const item = inventory[slot];

        if (!item) return false;

        // Implementation of pure ledger transfer
        // Note: In high-fidelity simulation, we check stackability, but here we assume items move whole.
        const transferAmount = Math.min(item.amount, amount);
        
        // Find in bank
        const bankIdx = avatar.bank.findIndex(i => i.id === item.id);
        if (bankIdx !== -1) {
            avatar.bank[bankIdx].amount += transferAmount;
        } else {
            avatar.bank.push({ ...item, amount: transferAmount });
        }

        // Reduce from inventory
        item.amount -= transferAmount;
        if (item.amount <= 0) {
            inventory[slot] = null;
        }

        logger.info(`BANK_DEPOSIT: Item ${item.id} (x${transferAmount}) moved to ledger.`);
        return true;
    }

    /**
     * withdraw - Transfers an item from bank ledger to inventory.
     */
    public withdraw(avatar: SovereignAvatar, itemId: number, amount: number = 1): boolean {
        const bankIdx = avatar.bank.findIndex(i => i.id === itemId);
        if (bankIdx === -1) return false;

        const item = avatar.bank[bankIdx];
        const withdrawAmount = Math.min(item.amount, amount);

        // Find empty slot
        const emptySlot = (avatar as any).firstEmptySlot();
        if (emptySlot === -1) {
            logger.warn('BANK_WITHDRAW_FAILED: Inventory full.');
            return false;
        }

        // Add to inventory
        (avatar as any).addItem({ ...item, amount: withdrawAmount });

        // Reduce from bank
        item.amount -= withdrawAmount;
        if (item.amount <= 0) {
            avatar.bank.splice(bankIdx, 1);
        }

        logger.info(`BANK_WITHDRAW: Item ${itemId} (x${withdrawAmount}) moved to inventory.`);
        return true;
    }
}
