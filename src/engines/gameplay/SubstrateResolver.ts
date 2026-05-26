import { RSMVController } from '../../vision/RSMVController.js';
import { SpatialVisionEngine } from '../SpatialVisionEngine.js';
import { CacheForensicsLimb } from '../../limbs/spatial/CacheForensicsLimb.js';
import { SubstrateState } from '../../core/models.js';

export interface CloudHealthSignal {
    status: 'ONLINE' | 'DEGRADED' | 'OFFLINE';
    effect: 'NONE' | 'ROUTING_BIAS_ONLY' | 'BLOCK_CLOUD_TASKS';
    lastError?: string;
}

/**
 * SubstrateResolver
 * Central authority for resolving POG2 Substrate Health.
 * "NodeTester observes. It never decides."
 */
export class SubstrateResolver {
    private static lastKnownStatus: SubstrateState = SubstrateState.ONLINE;
    private static lastCloudSignal: CloudHealthSignal = { status: 'ONLINE', effect: 'NONE' };

    /**
     * setStatus - Updated by PulseMonitor / NodeTester in background.
     */
    public static setStatus(status: SubstrateState): void {
        this.lastKnownStatus = status;
    }

    public static setCloudSignal(signal: CloudHealthSignal): void {
        this.lastCloudSignal = signal;
    }

    public static getCloudSignal(): CloudHealthSignal {
        return this.lastCloudSignal;
    }

    public static async resolve(): Promise<SubstrateState> {
        // Instant return of cached health state.
        // Logic execution remains O(1) during the CNS Pulse.
        return this.lastKnownStatus;
    }
}
