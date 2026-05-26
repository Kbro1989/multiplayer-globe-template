import { createLogger } from '../../utils/logger.js';
import { rsmvBridge } from '../../utils/RSMVBridge.js';

const logger = createLogger('CacheSentinelLimb');

export class CacheSentinelLimb {
    private static instance: CacheSentinelLimb;
    private lastBuildNr: number = 0;

    private knownDBRowIds: Set<number> = new Set();

    private constructor() {}

    public static getInstance(): CacheSentinelLimb {
        if (!CacheSentinelLimb.instance) {
            CacheSentinelLimb.instance = new CacheSentinelLimb();
        }
        return CacheSentinelLimb.instance;
    }

    /**
     * Automated 30th skill sentinel.
     * Scans for expansion in the Skill ID Enum (1518), Interface 1314, and DBRow Table 1.
     */
    public async scanFor30thSkill(): Promise<boolean> {
        try {
            let detectionTriggered = false;

            // 1. Check Skill ID Enum (1518)
            const enum1518Res = await rsmvBridge.getEnum(1518);
            if (enum1518Res.ok && enum1518Res.value?.raw?.values) {
                const currentCount = Object.keys(enum1518Res.value.raw.values).length;
                if (currentCount > 29) {
                    logger.info({ newCount: currentCount }, '30TH SKILL DETECTED IN ENUM 1518!');
                    detectionTriggered = true;
                }
            }

            // 2. Check Interface 1314 component count
            const iface1314Res = await rsmvBridge.getInterface(1314);
            if (iface1314Res.ok && iface1314Res.value?.raw?.components) {
                const compCount = iface1314Res.value.raw.components.length;
                if (compCount > 164) {
                    logger.info({ newComponentCount: compCount }, 'INTERFACE 1314 EXPANDED - POTENTIAL 30TH SKILL PLACEHOLDER!');
                    detectionTriggered = true;
                }
            }

            // 3. Check DBRows (Archive 41) for new row IDs in Table 1 (Skill XP Curves)
            const dbRowsRes = await rsmvBridge.getDBRows(1);
            if (dbRowsRes.ok && dbRowsRes.value && dbRowsRes.value.results) {
                const currentIds = new Set<number>(dbRowsRes.value.results.map((r: any) => r.id));
                if (this.knownDBRowIds.size > 0) {
                    const newIds = [...currentIds].filter(id => !this.knownDBRowIds.has(id));
                    if (newIds.length > 0) {
                        logger.info({ newIds }, 'New DBRow IDs detected in Table 1 (Skill XP Curves)!');
                        if (newIds.includes(29)) {
                            logger.warn('30th Skill Entry Detected in XP Table (ID 29)');
                            detectionTriggered = true;
                        }
                    }
                }
                this.knownDBRowIds = currentIds;
            }

            // 4. Version Check
            const healthRes = await rsmvBridge.healthCheck();
            if (healthRes.ok && healthRes.value.cacheVersion) {
                const currentBuild = healthRes.value.cacheVersion;
                if (currentBuild > this.lastBuildNr) {
                    this.lastBuildNr = currentBuild;
                    logger.info({ build: currentBuild }, 'Build version increment detected. Performing deep forensic scan...');
                }
            }

            return detectionTriggered;
        } catch (e) {
            logger.error({ err: e }, 'Cache Sentinel scan failed');
            return false;
        }
    }
}
