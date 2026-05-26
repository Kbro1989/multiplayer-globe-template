/**
 * HUDRegistry.ts
 * 
 * Maps game engine Interface IDs to their functional layers and forensic JSON definitions.
 * This registry powers the POG2 autonomous agent's dynamic UI state management.
 */

export enum HUDLayer {
    CORE_GAMEPLAY = 'CORE_GAMEPLAY',     // Login, Play, Primary Stats
    PERIPHERAL = 'PERIPHERAL',           // Inventory, Map, Chatbox, Action Bar
    ADMINISTRATIVE = 'ADMINISTRATIVE'   // Settings, Debug, Diagnostic
}

export interface HUDDefinition {
    id: number;
    name: string;
    layer: HUDLayer;
    forensicPath: string;
}

export const HUD_REGISTRY: HUDDefinition[] = [
    {
        id: 1430,
        name: "Action Bar",
        layer: HUDLayer.PERIPHERAL,
        forensicPath: '/interfaces/interface_1430_standard.json'
    },
    {
        id: 1496,
        name: "Inventory & Bank Hub",
        layer: HUDLayer.PERIPHERAL,
        forensicPath: '/interfaces/interface_1496_standard.json'
    },
    {
        id: 137,
        name: "Chatbox Hub",
        layer: HUDLayer.PERIPHERAL,
        forensicPath: '/interfaces/interface_137_standard.json'
    },
    {
        id: 1922,
        name: "Teleport & Navigation",
        layer: HUDLayer.PERIPHERAL,
        forensicPath: '/interfaces/interface_1922_standard.json'
    },
    {
        id: 12,
        name: "Bank Interface",
        layer: HUDLayer.PERIPHERAL,
        forensicPath: '/interfaces/interface_12_standard.json'
    },
    {
        id: 300,
        name: "Shop Interface",
        layer: HUDLayer.PERIPHERAL,
        forensicPath: '/interfaces/interface_300_standard.json'
    }
];

export function getHUDForInterface(id: number): HUDDefinition | undefined {
    return HUD_REGISTRY.find(h => h.id === id);
}
