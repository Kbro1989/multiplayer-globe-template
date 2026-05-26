import { SpatialMetrics } from '../../types/spatial.js';
import * as fs from 'fs/promises';
import * as path from 'path';

export class SpatialMetricsRegistry {
  private static instance: SpatialMetricsRegistry;
  private metrics: Map<number, SpatialMetrics> = new Map();
  private readonly MODEL_UNITS_PER_TILE = 512;
  
  private constructor() {}
  
  public static getInstance(): SpatialMetricsRegistry {
    if (!SpatialMetricsRegistry.instance) {
      SpatialMetricsRegistry.instance = new SpatialMetricsRegistry();
    }
    return SpatialMetricsRegistry.instance;
  }
  
  async hydrateFromPedagogy(): Promise<void> {
    const dir = 'D:/sovereign/cache_pedagogy';
    try {
      const files = await fs.readdir(dir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        
        try {
          const filePath = path.join(dir, file);
          const content = await fs.readFile(filePath, 'utf8');
          const profile = JSON.parse(content);
          
          if (profile.id && profile.metrics && profile.metrics.dimensions) {
            // Extract numeric ID from "npc:0" or similar
            const idStr = profile.id.replace('npc:', '').replace('object:', '').replace('item:', '');
            const id = parseInt(idStr, 10);
            
            if (!isNaN(id)) {
              let type: 'npc' | 'item' | 'object' | 'player' = 'npc';
              if (profile.id.startsWith('object:')) type = 'object';
              if (profile.id.startsWith('item:')) type = 'item';
              if (profile.id.startsWith('player:')) type = 'player';
              
              this.metrics.set(id, this.convertProfile(profile, id, type, file));
            }
          }
        } catch (e) {
          // Skip malformed files
          continue;
        }
      }
      console.log(`SpatialMetricsRegistry hydrated: ${this.metrics.size} entities`);
    } catch (err) {
      console.error('Failed to read pedagogy directory:', err);
    }
  }
  
  private convertProfile(profile: any, entityId: number, entityType: 'npc' | 'item' | 'object' | 'player', filename: string): SpatialMetrics {
    const { x, y, z } = profile.metrics.dimensions;
    const maxHorizontal = Math.max(x, y);
    
    return {
      entityId,
      entityType,
      dimensions: { x, y, z },
      tileScale: {
        radius: (maxHorizontal / 2) / this.MODEL_UNITS_PER_TILE,
        height: z / this.MODEL_UNITS_PER_TILE,
        volume: (x * y * z) / Math.pow(this.MODEL_UNITS_PER_TILE, 3)
      },
      polyCount: profile.metrics.polyCount || 0,
      cacheRevision: profile.cacheRevision || 0,
      extractionTimestamp: Date.now(),
      sourceFile: filename
    };
  }
  
  getMetrics(entityId: number): SpatialMetrics | undefined {
    return this.metrics.get(entityId);
  }
}
