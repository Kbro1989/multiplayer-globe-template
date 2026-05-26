import path from 'path';
import { createRequire } from 'module';
import { createLogger } from '../../utils/logger.js';
import { SovereignCs2NativeRegistry } from './SovereignCs2NativeRegistry.js';
import { HUDForensicsLimb } from './HUDForensicsLimb.js';
import { HUDOverlayLimb } from './HUDOverlayLimb.js';

const require = createRequire(import.meta.url);
const logger = createLogger('InterfaceRuntimeLimb');

/**
 * Adapter that ducks-types the CS2Api from rsmv_inspector.
 * It translates interpreter object-method calls into registry opcodes.
 */
class CS2ApiAdapter {
    interfaceId: number;
    componentId: number;
    registry: SovereignCs2NativeRegistry;
    
    constructor(interfaceId: number, componentId: number, registry: SovereignCs2NativeRegistry) {
        this.interfaceId = interfaceId;
        this.componentId = componentId;
        this.registry = registry;
    }

    setText(text: string) { this.registry.execute('IF_SETTEXT', this.interfaceId, this.componentId, text); }
    setHide(hidden: number) { this.registry.execute('IF_SETHIDE', this.interfaceId, this.componentId, hidden); }
    setPosition(x: number, y: number, modeX: number, modeY: number) { this.registry.execute('IF_SETPOSITION', this.interfaceId, this.componentId, x, y, modeX, modeY); }
    setSize(w: number, h: number, modeW: number, modeH: number) { this.registry.execute('IF_SETSIZE', this.interfaceId, this.componentId, w, h, modeW, modeH); }
    setOp(index: number, text: string) { this.registry.execute('IF_SETOP', this.interfaceId, this.componentId, index, text); }
    setGraphic(sprite: number) { this.registry.execute('IF_SETGRAPHIC', this.interfaceId, this.componentId, sprite); }
    setHFlip(flip: boolean) { this.registry.execute('IF_SETHFLIP', this.interfaceId, this.componentId, flip); }
    setVFlip(flip: boolean) { this.registry.execute('IF_SETVFLIP', this.interfaceId, this.componentId, flip); }
    setTiling(tiling: number) { this.registry.execute('IF_SETTILING', this.interfaceId, this.componentId, tiling); }
    setRotation(rot: number) { this.registry.execute('IF_SETROTATION', this.interfaceId, this.componentId, rot); }
    setModel(id: number) { this.registry.execute('IF_SETMODEL', this.interfaceId, this.componentId, id); }
    setTrans(trans: number) { this.registry.execute('IF_SETTRANS', this.interfaceId, this.componentId, trans); }
    setFilled(filled: number) { this.registry.execute('IF_SETFILLED', this.interfaceId, this.componentId, filled); }
    setColor(col: number) { this.registry.execute('IF_SETCOLOUR', this.interfaceId, this.componentId, col); }
    setTextAlign(a: number, b: number, c: number) { this.registry.execute('IF_SETTEXTALIGN', this.interfaceId, this.componentId, a, b, c); }
    
    // Getters returning defaults (for now) to prevent interpreter crashes
    getText() { return ""; }
    getHide() { return 0; }
    getWidth() { return 0; }
    getHeight() { return 0; }
    getX() { return 0; }
    getY() { return 0; }
    getOp(index: number) { return ""; }
    getGraphic() { return -1; }
    getHFlip() { return false; }
    getVFlip() { return false; }
    getTiling() { return 0; }
    getRotation() { return 0; }
    getModel() { return -1; }
    getTrans() { return 0; }
    getFilled() { return 0; }
    getColor() { return 0; }

    createChild(ccid: number, type: number) { return new CS2ApiAdapter(this.interfaceId, ccid, this.registry); }
    findChild(ccid: number) { return new CS2ApiAdapter(this.interfaceId, ccid, this.registry); }
    getNextChildId() { return 0; }
    
    changed() { }
}

export interface RenderedComponent {
    id: number;
    interfaceId: number;
    x: number;
    y: number;
    width: number;
    height: number;
    visible: boolean;
    type: 'CONTAINER' | 'TEXT' | 'SPRITE' | 'MODEL' | 'FIGURE';
    content?: any;
    scripts?: {
        onClick?: number;
        onHover?: number;
    };
    cssPosition?: string;
    cssSize?: string;
}

export interface RenderedInterface {
    interfaceId: number;
    components: RenderedComponent[];
}

export type AgentEvent =
    | { type: 'SLOT_DISCOVERED'; interfaceId: number; componentId: number; slot: RenderedComponent }
    | { type: 'INTERFACE_READY'; interfaceId: number; rendered: RenderedInterface }
    | { type: 'CHILD_REF_FOUND'; parentInterface: number; childInterface: number; childComponent: number };

export type AgentEventHandler = (event: AgentEvent) => void;

export class InterfaceRuntimeLimb {
    private interpreter: any = null;
    private nativeRegistry: SovereignCs2NativeRegistry;
    private overlay: HUDOverlayLimb;
    private calli: any = null;
    private source: any = null;
    private agentListeners: AgentEventHandler[] = [];
    private bootstrappedInterfaces = new Set<number>();
    
    constructor() {
        this.nativeRegistry = SovereignCs2NativeRegistry.getInstance();
        this.overlay = new HUDOverlayLimb();
    }
    
    async initialize(): Promise<void> {
        this.overlay.initialize();
        logger.info('Initializing InterfaceRuntimeLimb...');
        let GameCacheLoader: any;
        let prepareClientScript: any;
        let ClientScriptInterpreter: any;

        try {
            const alt1 = require('alt1cache');
            GameCacheLoader = alt1.GameCacheLoader;
            prepareClientScript = alt1.prepareClientScript;
            ClientScriptInterpreter = alt1.ClientScriptInterpreter;
        } catch (e) {
            const inspectorPath = 'D:/rsmv_inspector';
            const sqlitePath = path.join(inspectorPath, 'src', 'cache', 'sqlite.ts');
            const indexTsPath = path.join(inspectorPath, 'src', 'clientscript', 'index.ts');
            const interpreterPath = path.join(inspectorPath, 'src', 'clientscript', 'interpreter.ts');
            
            ({ GameCacheLoader } = require(sqlitePath));
            ({ prepareClientScript } = require(indexTsPath));
            ({ ClientScriptInterpreter } = require(interpreterPath));
        }

        const { getrsmvCachePath } = require('../../utils/SovereignPathResolver.js');
        const cachePath = getrsmvCachePath();
        this.source = new GameCacheLoader(cachePath);
        
        // Wait for calibration to complete and load
        this.calli = await prepareClientScript(this.source);
        
        // We defer interpreter instantiation per-script because the interpreter is stateful,
        // but we cache the ClientScriptInterpreter constructor.
        this.interpreter = ClientScriptInterpreter;
        logger.info('InterfaceRuntimeLimb initialized successfully.');
    }
    
    /** Register an agent listener for the forensics feedback loop */
    onAgentEvent(handler: AgentEventHandler): void {
        this.agentListeners.push(handler);
    }

    private emit(event: AgentEvent): void {
        for (const handler of this.agentListeners) handler(event);
    }

    /**
     * Decode a packed component reference (RS3 format: high 16 bits = interfaceId, low 16 = componentId)
     * e.g. 120651776 = 0x7300100 → { interfaceId: 1840, componentId: 256 }
     */
    private decodePackedRef(packed: number): { interfaceId: number; componentId: number } | null {
        if (typeof packed !== 'number' || packed <= 0 || packed > 0x7FFFFFFF) return null;
        const interfaceId = (packed >>> 16) & 0xFFFF;
        const componentId = packed & 0xFFFF;
        // Valid RS3 interface range
        if (interfaceId < 1 || interfaceId > 3500) return null;
        return { interfaceId, componentId };
    }

    /**
     * Scan script args for packed component refs and recursively bootstrap those interfaces.
     * This is the forensics → agent feedback loop.
     */
    private async followComponentRefs(
        args: (number | string)[],
        parentInterfaceId: number
    ): Promise<void> {
        const childInterfaces = new Set<number>();

        for (const arg of args) {
            if (typeof arg !== 'number') continue;
            const ref = this.decodePackedRef(arg);
            if (!ref) continue;
            if (ref.interfaceId === parentInterfaceId) continue; // Skip self-refs

            this.emit({
                type: 'CHILD_REF_FOUND',
                parentInterface: parentInterfaceId,
                childInterface: ref.interfaceId,
                childComponent: ref.componentId
            });

            childInterfaces.add(ref.interfaceId);
        }

        // Recursively bootstrap each discovered child interface (once only)
        for (const childId of childInterfaces) {
            if (!this.bootstrappedInterfaces.has(childId)) {
                logger.info(`Following component ref: interface ${parentInterfaceId} → ${childId}`);
                try {
                    await this.bootstrapInterface(childId);
                } catch (e: any) {
                    logger.warn(`Failed to bootstrap child interface ${childId}: ${e.message}`);
                }
            }
        }
    }

    async bootstrapInterface(interfaceId: number): Promise<RenderedInterface> {
        if (this.bootstrappedInterfaces.has(interfaceId)) {
            logger.debug(`Interface ${interfaceId} already bootstrapped, skipping.`);
            return { interfaceId, components: [] };
        }
        this.bootstrappedInterfaces.add(interfaceId);

        // 1. Get deep-decoded components
        const hud = new HUDForensicsLimb();
        const forensics = await hud.getInterface(interfaceId);
        if (!forensics.ok) throw forensics.error;
        
        logger.info(`Bootstrapping interface ${interfaceId} with ${forensics.value.components.length} components.`);
        
        // 2. Execute load scripts + follow packed component refs (the feedback loop)
        for (const comp of forensics.value.components) {
            if (comp.scripts?.load && comp.scripts.load.length > 0) {
                const [scriptId, ...args] = comp.scripts.load;
                // Follow any packed child interface refs embedded in the script args
                await this.followComponentRefs(args as number[], interfaceId);
                await this.executeScript(scriptId as number, args, interfaceId, comp.componentId);
            }
        }
        
        // 3. Resolve layout
        const rendered = this.resolveLayout(forensics.value.components, interfaceId);
        
        // 4. Emit agent event: interface is ready for consumption
        this.emit({ type: 'INTERFACE_READY', interfaceId, rendered });

        // 5. Notify agent of each interactive slot discovered
        for (const slot of rendered.components) {
            if (slot.scripts?.onClick !== undefined) {
                this.emit({ type: 'SLOT_DISCOVERED', interfaceId, componentId: slot.id, slot });
            }
        }

        // 6. Hand off to HUD renderer
        this.overlay.render(rendered);
        
        return rendered;
    }
    
    private async executeScript(
        scriptId: number, 
        args: (number | string)[], 
        interfaceId: number, 
        componentId: number
    ): Promise<void> {
        if (!this.interpreter) throw new Error('Interpreter not initialized');
        
        logger.debug(`Executing script ${scriptId} on component ${interfaceId}:${componentId} with args: ${JSON.stringify(args)}`);

        // Create a mock UiRenderContext that provides the CS2ApiAdapter
        const uictx = {
            comps: {
                get: (compId: number) => {
                    return { api: new CS2ApiAdapter(interfaceId, compId, this.nativeRegistry) };
                }
            },
            touchedComps: new Set(),
            runOnloadScripts: true
        };

        // Instantiate interpreter with our mocked uictx
        const inter = new this.interpreter(this.calli, uictx);
        
        inter.reset();
        inter.pushlist(args);
        inter.activecompid = componentId;
        await inter.callscriptid(scriptId);
        await inter.runToEnd();
    }
    
    private resolveLayout(components: any[], interfaceId: number): RenderedInterface {
        // Option B: HTML overlay CSS resolution
        const rendered: RenderedComponent[] = components.map(comp => {
            let type: 'CONTAINER' | 'TEXT' | 'SPRITE' | 'MODEL' | 'FIGURE' = 'CONTAINER';
            const content: any = {};
            
            if (comp.type === 4) {
                type = 'TEXT';
                content.text = comp.textdata?.text || '';
                content.color = comp.textdata?.color ? '#' + (comp.textdata.color & 0xffffff).toString(16).padStart(6, '0') : '#ffffff';
                content.font = comp.textdata?.fontid?.toString();
            } else if (comp.type === 5) {
                type = 'SPRITE';
                content.spriteId = comp.spritedata?.spriteid;
            } else if (comp.type === 6) {
                type = 'MODEL';
                content.modelId = comp.modeldata?.modelid;
            } else if (comp.type === 3) {
                type = 'FIGURE';
                content.color = comp.figuredata?.color ? '#' + (comp.figuredata.color & 0xffffff).toString(16).padStart(6, '0') : '#000000';
            }

            return {
                id: comp.componentId,
                interfaceId,
                x: comp.baseposx,
                y: comp.baseposy,
                width: comp.basewidth,
                height: comp.baseheight,
                visible: !comp.hidden,
                type,
                content,
                scripts: {
                    onClick: comp.scripts?.op ? comp.scripts.op[0] : undefined,
                    onHover: comp.scripts?.mousehover ? comp.scripts.mousehover[0] : undefined
                },
                style: this.cssPosition(comp) + this.cssSize(comp)
            };
        });
        
        return { interfaceId, components: rendered };
    }
    
    private cssPosition(data: any) {
        let css = "";
        const defaulttranslate = "0px";
        let translatex = defaulttranslate;
        let translatey = defaulttranslate;

        if (data.aspectxtype == 0) { css += `left:${data.baseposx}px;`; }
        else if (data.aspectxtype == 1) { css += `left:50%;margin-left:${data.baseposx}px;`; translatex = "-50%"; }
        else if (data.aspectxtype == 2) { css += `right:${data.baseposx}px;`; }
        else if (data.aspectxtype == 3) { css += `left:${data.baseposx * 100 / (1 << 14)}%;`; }
        else if (data.aspectxtype == 4) { css += `left:${50 + data.baseposx * 100 / (1 << 14)}%;`; translatex = "-50%"; }
        else if (data.aspectxtype == 5) { css += `right:${data.baseposx * 100 / (1 << 14)}%;`; }

        if (data.aspectytype == 0) { css += `top:${data.baseposy}px;`; }
        else if (data.aspectytype == 1) { css += `top:50%;margin-top:${data.baseposy}px;`; translatey = "-50%"; }
        else if (data.aspectytype == 2) { css += `bottom:${data.baseposy}px;`; }
        else if (data.aspectytype == 3) { css += `top:${data.baseposy * 100 / (1 << 14)}%;`; }
        else if (data.aspectytype == 4) { css += `top:${50 + data.baseposy * 100 / (1 << 14)}%;`; translatey = "-50%"; }
        else if (data.aspectytype == 5) { css += `bottom:${data.baseposy * 100 / (1 << 14)}%;`; }

        if (translatex != defaulttranslate || translatey != defaulttranslate) {
            css += `translate:${translatex} ${translatey};`;
        }
        return css;
    }

    private cssSize(data: any) {
        let css = "";
        if (data.aspectwidthtype == 0) { css += `width:${data.basewidth}px;`; }
        else if (data.aspectwidthtype == 1) { css += `width:calc(100% - ${data.basewidth}px);`; }
        else if (data.aspectwidthtype == 2) { css += `width:${data.basewidth * 100 / (1 << 14)}%;`; }

        if (data.aspectheighttype == 0) { css += `height:${data.baseheight}px;`; }
        else if (data.aspectheighttype == 1) { css += `height:calc(100% - ${data.baseheight}px);`; }
        else if (data.aspectheighttype == 2) { css += `height:${data.baseheight * 100 / (1 << 14)}%;`; }

        return css;
    }
}
