import { createLogger } from '../../utils/logger.js';
import { Engine, Scene, Mesh, VertexData, StandardMaterial, Color3, ArcRotateCamera, Vector3, HemisphericLight, PointsCloudSystem, Color4 } from '@babylonjs/core';
import { AvatarStateLimb } from './AvatarStateLimb.js';

const logger = createLogger('AvatarRenderLimb');

export class AvatarRenderLimb {
    private engine: Engine | null = null;
    private scene: Scene | null = null;
    private pcs: PointsCloudSystem | null = null;
    private state: AvatarStateLimb;
    
    constructor(private canvas: HTMLCanvasElement) {
        this.state = AvatarStateLimb.getInstance();
    }
    
    async initialize(): Promise<void> {
        this.engine = new Engine(this.canvas, true);
        this.scene = new Scene(this.engine);
        this.scene.clearColor = new Color4(0.05, 0.05, 0.05, 1);
        
        // Camera: orbit around origin
        const camera = new ArcRotateCamera('camera', -Math.PI / 2, Math.PI / 2.5, 200, Vector3.Zero(), this.scene);
        camera.attachControl(this.canvas, true);
        camera.wheelPrecision = 10;
        
        // Lighting: PBR-ready
        new HemisphericLight('light', new Vector3(0, 1, 0), this.scene);
        
        logger.info('AvatarRenderLimb initialized');
    }
    
    async loadKitModel(modelId: number): Promise<void> {
        const meshData = await this.loadMeshJson(modelId);
        if (!meshData) {
            logger.error({ modelId }, 'Kit model not found');
            return;
        }
        
        // Use PointsCloudSystem since we only have raw position geometry from Beta Opcoder
        if (this.pcs) {
            this.pcs.dispose();
        }
        
        this.pcs = new PointsCloudSystem(`pcs_${modelId}`, 2, this.scene!);
        
        // Extract PBR skin color from AvatarStateLimb (e.g. Enum 1195 RGB)
        const skinRgb = 12104087; // Fallback to our default parsed RGB
        const color = this.unpackRgb(skinRgb);
        
        const positions = meshData.positions;
        const pointCount = positions.length / 3;
        
        this.pcs.addPoints(pointCount, (particle, i) => {
            particle.position = new Vector3(
                positions[i * 3],
                positions[i * 3 + 1],
                positions[i * 3 + 2]
            );
            particle.color = new Color4(color.r, color.g, color.b, 1);
        });
        
        await this.pcs.buildMeshAsync();
        
        // Auto-center camera on the point cloud bounds
        if (this.scene?.activeCamera && this.pcs.mesh) {
            (this.scene.activeCamera as ArcRotateCamera).target = this.pcs.mesh.getBoundingInfo().boundingBox.center;
        }
        
        logger.info({ modelId, vertices: pointCount }, 'Kit point-cloud topology rendered');
    }
    
    private unpackRgb(packed: number): Color3 {
        const r = ((packed >> 16) & 0xFF) / 255;
        const g = ((packed >> 8) & 0xFF) / 255;
        const b = (packed & 0xFF) / 255;
        return new Color3(r, g, b);
    }
    
    private async loadMeshJson(modelId: number): Promise<any | null> {
        try {
            // Check if running in browser vs Node
            if (typeof window !== 'undefined' && typeof fetch === 'function') {
                const res = await fetch(`/models/kit_${modelId}.json`);
                return await res.json();
            } else {
                const fs = await import('fs/promises');
                const path = `D:/sovereign/cache_pedagogy/models/kit_${modelId}.json`;
                const data = await fs.readFile(path, 'utf8');
                return JSON.parse(data);
            }
        } catch {
            return null;
        }
    }
    
    renderLoop(): void {
        this.engine?.runRenderLoop(() => {
            this.scene?.render();
        });
    }
    
    dispose(): void {
        this.scene?.dispose();
        this.engine?.dispose();
    }
}
