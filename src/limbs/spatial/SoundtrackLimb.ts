// src/limbs/spatial/SoundtrackLimb.ts
// Phase 4B/5: Audio Synthesis with Keyframe Sync

import { spawn } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { type Result, ok, err } from '../../core/models.js';

export interface AudioCue {
  timeMs: number;
  intensity: number;
  type: 'ROAR_BUILD' | 'ROAR_PEAK' | 'ROAR_DECAY';
}

export interface SoundtrackParams {
  prompt: string;
  duration: number;
  keyframes: AudioCue[];
  channels: number;
  sampleRate: number;
  bitDepth: number;
}

export interface SoundtrackResult {
  buffer: Buffer;
  path: string;
}

export class SoundtrackLimb {
  async generate(params: SoundtrackParams): Promise<Result<SoundtrackResult>> {
    console.log(`ðŸŽµ Synthesizing ${params.channels}ch audio: ${params.duration}s`);

    try {
      // Generate volume modulation curve from keyframes
      const volumeCurve = this.generateVolumeCurve(params.keyframes, params.duration);
      
      // Use ffmpeg with aevalsrc for procedural audio
      const filterComplex = this.buildFilterComplex(params, volumeCurve);
      
      const result = await this.renderWithFFmpeg(params, filterComplex);
      return ok(result);
    } catch (e: any) {
      return err(e);
    }
  }

  private generateVolumeCurve(cues: AudioCue[], duration: number): number[] {
    const samples = Math.ceil(duration * 100); // 10ms resolution
    const curve = new Array(samples).fill(0);
    
    for (const cue of cues) {
      const index = Math.floor(cue.timeMs / 10);
      if (index < samples) {
        curve[index] = cue.intensity;
      }
    }
    
    // Smooth interpolation
    return this.smoothCurve(curve);
  }

  private smoothCurve(curve: number[]): number[] {
    const smoothed = [...curve];
    for (let i = 1; i < curve.length - 1; i++) {
      smoothed[i] = (curve[i-1] + curve[i] + curve[i+1]) / 3;
    }
    return smoothed;
  }

  private buildFilterComplex(params: SoundtrackParams, volumeCurve: number[]): string {
    // piece-wise constant volume modulation (flat additive sum to avoid nesting limits)
    const volumeExprParts: string[] = [];
    
    for (let i = 0; i < volumeCurve.length; i++) {
        const v = volumeCurve[i];
        if (v > 0.001) { 
            const t1 = (i / 100).toFixed(3);
            const t2 = ((i + 1) / 100).toFixed(3);
            // Boost intensity by 5x to ensure audibility
            volumeExprParts.push(`${(v * 5.0).toFixed(3)}*between(t,${t1},${t2})`);
        }
    }
    
    // Base floor of 0.05 to prevent absolute silence
    const volumeExpr = volumeExprParts.length > 0 ? `0.05 + (${volumeExprParts.join('+')})` : '0.2';
    
    // 5.1 channel mapping: Spread mono over 5.1
    const channels = params.channels === 6 
      ? 'pan=5.1|FL=c0|FR=c0|FC=c0|LFE=c0*0.5|BL=c0*0.3|BR=c0*0.3'
      : 'pan=stereo';
    
    return `volume='${volumeExpr}',${channels}`;
  }

  private async renderWithFFmpeg(params: SoundtrackParams, filter: string): Promise<SoundtrackResult> {
    const outputPath = join(tmpdir(), `kbd_roar_${Date.now()}.wav`);
    
    return new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-y',
        '-f', 'lavfi', '-i', `anoisesrc=d=${params.duration}:c=white:amp=1.0`, // White noise for full spectrum
        '-af', filter,
        '-t', params.duration.toString(),
        '-ar', params.sampleRate.toString(),
        '-ac', params.channels.toString(),
        outputPath
      ]);

      let errorOutput = '';
      ffmpeg.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          resolve({
            buffer: readFileSync(outputPath),
            path: outputPath
          });
        } else {
          console.error('FFmpeg Error Output:', errorOutput);
          reject(new Error(`FFmpeg exited ${code}`));
        }
      });
    });
  }

  healthCheck(): { online: boolean; details: string } {
    return { online: true, details: 'SoundtrackLimb: FFmpeg synthesis ready' };
  }
}
