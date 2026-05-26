import { createLogger } from '../../utils/logger.js';

const logger = createLogger('SovereignCs2NativeRegistry');

export type CS2OpHandler = (interfaceId: number, componentId: number, ...args: any[]) => void | any;

export class SovereignCs2NativeRegistry {
    private static instance: SovereignCs2NativeRegistry;
    private handlers: Map<string, CS2OpHandler> = new Map();

    public constructor() {
        this.initializeScaffold();
    }

    public static getInstance(): SovereignCs2NativeRegistry {
        if (!SovereignCs2NativeRegistry.instance) {
            SovereignCs2NativeRegistry.instance = new SovereignCs2NativeRegistry();
        }
        return SovereignCs2NativeRegistry.instance;
    }

    private initializeScaffold() {
        // --- Structural Mutators ---
        this.register('IF_SETTEXT', (interfaceId: number, componentId: number, text: string) => {
            logger.info(`[IF_SETTEXT] Targeting ${interfaceId}:${componentId} -> "${text}"`);
        });

        this.register('IF_SETHIDE', (interfaceId: number, componentId: number, hidden: number) => {
            logger.info(`[IF_SETHIDE] Targeting ${interfaceId}:${componentId} -> ${hidden ? 'HIDDEN' : 'VISIBLE'}`);
        });

        this.register('IF_SETPOSITION', (interfaceId: number, componentId: number, x: number, y: number, modeX: number, modeY: number) => {
            logger.info(`[IF_SETPOSITION] Targeting ${interfaceId}:${componentId} -> (${x}, ${y}) Modes: ${modeX}, ${modeY}`);
        });

        this.register('IF_SETSIZE', (interfaceId: number, componentId: number, w: number, h: number, modeW: number, modeH: number) => {
            logger.info(`[IF_SETSIZE] Targeting ${interfaceId}:${componentId} -> ${w}x${h} Modes: ${modeW}, ${modeH}`);
        });

        // --- Behavioral Hooks ---
        this.register('CC_SETONCLICK', (interfaceId: number, componentId: number, scriptArgs: any[]) => {
            logger.info({ scriptArgs }, `[CC_SETONCLICK] Binding Script array to ${interfaceId}:${componentId}`);
        });

        // --- Common Stubs ---
        const commonOps = [
            'IF_SETSCROLLPOS', 'IF_SETCOLOUR', 'IF_SETFILL', 'IF_SETTRANS', 'IF_SETGRAPHIC', 'IF_SETMODEL',
            'CC_SETTEXT', 'CC_SETTEXTFONT', 'CC_SETTEXTALIGN', 'CC_SETTEXTSHADOW',
            'IF_SETTEXTFONT', 'IF_SETTEXTALIGN', 'IF_SETTEXTSHADOW', 'IF_SETNOCLICKTHROUGH'
        ];

        commonOps.forEach(op => {
            this.register(op, (iface: number, comp: number, ...args: any[]) => {
                logger.debug({ args }, `[${op}] Stub invoked on ${iface}:${comp}`);
            });
        });
    }

    public register(opcodeName: string, handler: CS2OpHandler) {
        this.handlers.set(opcodeName, handler);
    }

    public execute(opcodeName: string, interfaceId: number, componentId: number, ...args: any[]): any {
        const handler = this.handlers.get(opcodeName);
        if (handler) {
            return handler(interfaceId, componentId, ...args);
        } else {
            logger.warn({ args }, `[UNMAPPED OP] ${opcodeName} called on ${interfaceId}:${componentId}`);
        }
    }

    /**
     * Contextual proxy for the interpreter adapter.
     */
    public withContext(interfaceId: number, componentId: number): any {
        return new Proxy(this, {
            get: (target, prop: string) => {
                if (target.handlers.has(prop)) {
                    return (...args: any[]) => target.execute(prop, interfaceId, componentId, ...args);
                }
                return (target as any)[prop];
            }
        });
    }
}
