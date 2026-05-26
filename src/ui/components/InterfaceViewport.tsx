import React, { useMemo } from 'react';

// Interfaces based on the decomposed JSON structure
export interface RSInterfaceComponent {
    componentId: number;
    type: "CONTAINER" | "FIGURE" | "SPRITE" | "TEXT" | "TYPE_10" | string;
    typeId: number;
    position: { x: number; y: number };
    dimensions: { w: number; h: number };
    parentId: number;
    hidden: boolean;
    spriteId?: number;
    text?: string;
    color?: number;
}

export interface RSInterfaceManifest {
    interfaceId: number;
    totalComponents: number;
    components: RSInterfaceComponent[];
    textLabels: string[];
}

interface InterfaceViewportProps {
    manifest: RSInterfaceManifest | null;
    width?: number | string;
    height?: number | string;
    scale?: number;
}

export function InterfaceViewport({ manifest, width = 800, height = 600, scale = 1 }: InterfaceViewportProps) {
    // Build a hierarchy tree
    const rootComponents = useMemo(() => {
        if (!manifest) return [];
        
        const componentMap = new Map<number, RSInterfaceComponent & { children: any[] }>();
        
        // Initialize map
        manifest.components.forEach(comp => {
            componentMap.set(comp.componentId, { ...comp, children: [] });
        });

        const roots: any[] = [];

        // Build tree
        componentMap.forEach(comp => {
            if (comp.parentId === 65535 || !componentMap.has(comp.parentId)) {
                roots.push(comp);
            } else {
                componentMap.get(comp.parentId)?.children.push(comp);
            }
        });

        return roots;
    }, [manifest]);

    if (!manifest) {
        return <div className="text-gray-400 p-4 border border-dashed border-gray-600">No interface loaded.</div>;
    }

    // Recursive render function
    const renderComponent = (comp: RSInterfaceComponent & { children: any[] }) => {
        // RS3 UI positioning is absolute relative to parent
        const style: React.CSSProperties = {
            position: 'absolute',
            left: `${comp.position.x}px`,
            top: `${comp.position.y}px`,
            width: comp.dimensions.w > 0 ? `${comp.dimensions.w}px` : 'auto',
            height: comp.dimensions.h > 0 ? `${comp.dimensions.h}px` : 'auto',
            // Make bounds visible for pedagogy
            border: comp.type === 'CONTAINER' && comp.dimensions.w > 0 ? '1px dashed rgba(255,255,255,0.2)' : 'none',
            display: comp.hidden ? 'none' : 'block',
            pointerEvents: 'none',
            color: '#fff',
            fontFamily: 'sans-serif',
            fontSize: '12px',
            textShadow: '1px 1px 0 #000',
            boxSizing: 'border-box'
        };

        let content: React.ReactNode = null;

        switch (comp.type) {
            case 'TEXT':
                content = <span>{comp.text}</span>;
                break;
            case 'SPRITE':
                // RSMV Standard: Resolve sprite ID to icon path
                const iconPath = `/icons/sprite_${comp.spriteId}.png`;
                content = (
                    <img 
                        src={iconPath} 
                        alt={`Sprite ${comp.spriteId}`} 
                        className="w-full h-full object-contain"
                        onError={(e) => {
                            (e.target as HTMLImageElement).src = '/icons/fallback.png';
                        }}
                    />
                );
                style.width = comp.dimensions.w > 0 ? style.width : '50px';
                style.height = comp.dimensions.h > 0 ? style.height : '50px';
                break;
            case 'FIGURE':
                style.backgroundColor = 'rgba(255, 0, 0, 0.2)';
                break;
        }

        return (
            <div key={comp.componentId} style={style} title={`[${comp.componentId}] ${comp.type}`}>
                {content}
                {comp.children.map(child => renderComponent(child))}
            </div>
        );
    };

    return (
        <div className="relative bg-gray-900 rounded shadow-2xl overflow-hidden" style={{ width, height }}>
            <div className="absolute top-2 left-2 z-50 text-xs text-yellow-400 font-mono bg-black/80 px-2 py-1 rounded">
                Interface ID: {manifest.interfaceId} ({manifest.components.length} components)
            </div>
            
            <div 
                className="absolute origin-top-left" 
                style={{ transform: `scale(${scale})`, width: '100%', height: '100%' }}
            >
                {rootComponents.map(comp => renderComponent(comp))}
            </div>
        </div>
    );
}
