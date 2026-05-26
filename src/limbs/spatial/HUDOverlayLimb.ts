import { createLogger } from '../../utils/logger.js';

const logger = createLogger('HUDOverlayLimb');

export interface RenderedComponent {
    id: number;
    interfaceId: number;
    x: number;
    y: number;
    width: number;
    height: number;
    visible: boolean;
    type: 'CONTAINER' | 'TEXT' | 'SPRITE' | 'MODEL' | 'FIGURE';
    style?: string; // Pre-computed CSS
    content?: {
        text?: string;
        color?: string;
        font?: string;
        spriteId?: number;
        modelId?: number;
    };
    scripts?: {
        onClick?: number;
        onHover?: number;
    };
}

export interface RenderedInterface {
    interfaceId: number;
    components: RenderedComponent[];
}

/**
 * HUDOverlayLimb
 * 
 * Responsible for rendering the RS3 interface components as an HTML overlay.
 * Uses CSS logic derived from renderrsinterface.ts to handle responsive positioning (AspectType).
 */
export class HUDOverlayLimb {
    private static instance: HUDOverlayLimb;
    private container: HTMLElement | null = null;
    private componentMap = new Map<string, HTMLElement>(); // key: `${interfaceId}:${componentId}`
    private targetSelector: string;

    constructor(targetSelector: string = '#sovereign-hud-overlay') {
        this.targetSelector = targetSelector;
    }

    public static getInstance(): HUDOverlayLimb {
        if (!HUDOverlayLimb.instance) {
            HUDOverlayLimb.instance = new HUDOverlayLimb();
        }
        return HUDOverlayLimb.instance;
    }

    initialize(): void {
        if (typeof document === 'undefined') {
            logger.warn('No document available in this context (Node.js?). HUDOverlayLimb requires a DOM to render.');
            return;
        }

        this.container = document.querySelector(this.targetSelector);
        if (!this.container) {
            this.container = document.createElement('div');
            this.container.id = this.targetSelector.replace('#', '');
            this.container.style.cssText = `
                position: fixed;
                top: 0; left: 0;
                width: 100vw; height: 100vh;
                pointer-events: none;
                z-index: 10000;
                overflow: hidden;
            `;
            document.body.appendChild(this.container);
        }
        logger.info('HUDOverlayLimb attached to DOM');
    }

    render(rendered: RenderedInterface): void {
        if (typeof document === 'undefined') return;
        if (!this.container) {
            this.initialize();
        }
        if (!this.container) return;

        this.clearInterface(rendered.interfaceId);

        for (const comp of rendered.components) {
            if (!comp.visible) continue;

            const el = this.createElement(comp);
            this.container.appendChild(el);
            this.componentMap.set(`${comp.interfaceId}:${comp.id}`, el);
        }

        logger.debug({ interfaceId: rendered.interfaceId, componentCount: rendered.components.length }, 'Rendered interface');
    }

    private createElement(comp: RenderedComponent): HTMLElement {
        const el = document.createElement('div');
        el.id = `if-${comp.interfaceId}-comp-${comp.id}`;
        el.className = 'rs-component';
        
        // Base styles
        el.style.position = 'absolute';
        el.style.pointerEvents = 'auto';
        el.style.boxSizing = 'border-box';

        // Apply pre-computed style if available
        if (comp.style) {
            el.style.cssText += comp.style;
        } else {
            // Fallback to absolute positioning
            el.style.left = `${comp.x}px`;
            el.style.top = `${comp.y}px`;
            el.style.width = `${comp.width}px`;
            el.style.height = `${comp.height}px`;
        }

        // Content injection
        if (comp.type === 'TEXT' && comp.content?.text) {
            el.textContent = comp.content.text;
            el.style.display = 'flex';
            el.style.color = comp.content.color || '#ffffff';
        }

        // Event binding
        if (comp.scripts?.onClick) {
            el.onclick = () => {
                logger.debug({ scriptId: comp.scripts!.onClick }, 'Component clicked');
                // TODO: Dispatch to InterfaceRuntimeLimb for CS2 execution
            };
        }

        return el;
    }

    clearInterface(interfaceId: number): void {
        for (const [key, el] of this.componentMap) {
            if (key.startsWith(`${interfaceId}:`)) {
                el.remove();
                this.componentMap.delete(key);
            }
        }
    }

    destroy(): void {
        this.container?.remove();
        this.componentMap.clear();
        this.container = null;
    }
}
