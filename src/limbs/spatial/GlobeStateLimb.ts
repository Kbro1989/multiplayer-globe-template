import { type Result, ok } from '../../core/models.js';
import { WebSocket } from 'ws';
import type { SovereignConfig } from '../../config/SovereignConfig.js';
import type { QuotaTracker, QuotaState } from '../../utils/QuotaTracker.js';
import { EventBus, SovereignEvent } from '../../events/EventBus.js';
import { createLogger } from "../../utils/logger.js";

const logger = createLogger('GlobeStateLimb');

export interface GlobeState {
    id: string;
    nodes: Record<string, any>;
    lastSync: number;
}

/**
 * GlobeStateLimb - Durable State Management via Multiplayer Globe Bridge.
 * 
 * Synchronizes the Sovereign Organism's neurological state with a 
 * globally accessible, durable substrate (PartyKit/Partyserver).
 */
export class GlobeStateLimb {
    private static instance?: GlobeStateLimb;

    public static getInstance(): GlobeStateLimb | undefined {
        return GlobeStateLimb.instance;
    }

    private ws: WebSocket | null = null;
    private state: GlobeState = {
        id: 'pog2-sovereign',
        nodes: {},
        lastSync: Date.now()
    };
    private endpoint: string = 'ws://127.0.0.1:8787/party/globe';
    private subscribers: Map<string, Array<(data: any) => void>> = new Map();
    private connectPromise: Promise<Result<boolean>> | null = null;

    private enabled: boolean = false;

    constructor(config?: SovereignConfig) {
        GlobeStateLimb.instance = this;
        if (config) {
            this.enabled = config.globeEnabled ?? false;
            if (config.globeEndpoint) {
                this.endpoint = config.globeEndpoint;
            }
        }

        // Ensure the endpoint includes the full room path if it doesn't already
        if (this.endpoint && !this.endpoint.includes('/parties/')) {
            const base = this.endpoint.endsWith('/') ? this.endpoint.slice(0, -1) : this.endpoint;
            this.endpoint = `${base}/parties/globe/pog2-sovereign`;
        }

        // Apply environment-level isolation override ONLY if a real remote wss:// endpoint is NOT specified
        const isLocalOverride = process.env.POG2_GLOBE_ISOLATION === 'true' || process.env.POG_USE_LOCAL === 'true';
        if (isLocalOverride) {
            this.endpoint = 'ws://127.0.0.1:8787/parties/globe/pog2-sovereign';
            logger.info({ endpoint: this.endpoint }, 'Sovereign local mode active: routing GlobeStateLimb to local wrangler dev server.');
        } else if (process.env.POG2_GLOBE_ISOLATION === 'true' && !this.endpoint.startsWith('wss://')) {
            this.endpoint = 'ws://127.0.0.1:8787/parties/globe/pog2-sovereign';
        }

        // Tap into the cognitive stream
        if (this.enabled) {
            EventBus.getInstance().subscribeAll(this.streamEventData.bind(this));
        }
    }

    public setEndpoint(url: string): void {
        this.endpoint = url;
    }

    /**
     * Directly stream an EventBus telemetry packet to the WebGL globe
     */
    private streamEventData(event: SovereignEvent): void {
        this.state.lastSync = Date.now();

        if (this.ws?.readyState === WebSocket.OPEN) {
            // Phase 19: Stream full envelope for visualization-critical events
            const isVisualEvent = event.type === 'entity_spawn' || 
                                 event.type === 'direct_perception' || 
                                 event.type === 'telemetry';

            const packet = {
                type: event.type, // Use the actual event type for the globe dispatcher
                id: event.id,
                eventType: event.type,
                source: event.source,
                traceId: event.traceId,
                timestamp: event.timestamp,
                payload: isVisualEvent ? event.payload : undefined,
                latency: event.payload?.latencyMs,
            };

            this.ws.send(JSON.stringify(packet), (err: any) => { 
                if (err) logger.debug({ err }, 'Failed to stream telemetry packet'); 
            });
        }
    }

    /**
     * Subscribe to state updates for a specific neurological node ID.
     */
    public onStateUpdate(nodeId: string, callback: (data: any) => void): void {
        if (!this.subscribers.has(nodeId)) {
            this.subscribers.set(nodeId, []);
        }
        this.subscribers.get(nodeId)!.push(callback);
    }

    /**
     * Connects to the Multiplayer Globe substrate.
     * Stores the connection promise so healthCheck() can await it.
     */
    public async connect(): Promise<Result<boolean>> {
        if (!this.enabled) {
            return ok(false);
        }

        this.connectPromise = new Promise((resolve) => {
            try {
                this.ws = new WebSocket(this.endpoint);

                let pingInterval: NodeJS.Timeout;

                this.ws.on('open', () => {
                    logger.info({ endpoint: this.endpoint }, 'Connected to Multiplayer Globe Substrate');
                    
                    // Phase 22: Keep-alive interval to prevent Cloudflare 100s idle timeout
                    pingInterval = setInterval(() => {
                        if (this.ws?.readyState === WebSocket.OPEN) {
                            this.ws.ping();
                            // Also send an application-level ping just in case
                            this.ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
                        }
                    }, 30000);

                    resolve(ok(true));
                });

                this.ws.on('close', () => {
                    if (pingInterval) clearInterval(pingInterval);
                    logger.warn('Globe connection closed. Attempting reconnect in 5 seconds...');
                    setTimeout(() => {
                        if (this.enabled) this.connect();
                    }, 5000);
                });

                this.ws.on('message', (data: string) => {
                    try {
                        const msg = JSON.parse(data);
                        if (msg.type === 'state-sync') {
                            this.state = msg.state;
                            logger.debug('State synchronized from Globe');

                            // Notify subscribers of the new state
                            for (const [nodeId, nodeData] of Object.entries(this.state.nodes)) {
                                const callbacks = this.subscribers.get(nodeId);
                                if (callbacks) {
                                    callbacks.forEach(cb => {
                                        try { cb(nodeData); } catch (e) { logger.error({ err: e }, 'Globe subscriber error'); }
                                    });
                                }
                            }
                        } else if (msg.type === 'human_intervention' || msg.type === 'volitional_request') {
                            logger.info({ payload: msg }, '🧠 Received volition/intervention from Globe, routing to SwitchboardLimb admin queue');
                            // Dynamically import to avoid circular dependencies if needed
                            import('../../monitor/SwitchboardLimb.js').then(({ SwitchboardLimb }) => {
                                SwitchboardLimb.getInstance().pushAdminCommand({
                                    type: msg.action || msg.intent || 'human_intervention',
                                    metadata: { ...msg, timestamp: Date.now() }
                                });
                            });
                        }
                    } catch (err) {
                        logger.warn({ err }, 'Failed to parse Globe message');
                    }
                });

                this.ws.on('error', (err: any) => {
                    logger.error({ err }, 'Globe connection error');
                    resolve({ ok: false, error: err });
                });

            } catch (err) {
                resolve({ ok: false, error: err as Error });
            }
        });
        return this.connectPromise;
    }

    /**
     * Push a node's state to the global substrate.
     */
    public async pushNodeState(nodeId: string, data: any): Promise<Result<boolean>> {
        // Enforce active visual state for POG2 telemetry nodes if properties are missing
        if (data && typeof data === 'object') {
            if (data.score === undefined) {
                if (nodeId === 'routing_event') {
                    const complexityScores: Record<string, number> = { low: 0.2, medium: 0.5, high: 0.8, extreme: 1.0 };
                    data.score = complexityScores[data.classifiedComplexity?.toLowerCase()] ?? 0.5;
                } else if (nodeId === 'thinking_event') {
                    data.score = data.curiosity !== undefined ? data.curiosity : 0.95;
                } else {
                    data.score = 1.00;
                }
            }
            if (data.status === undefined) {
                data.status = 'active';
            }
            if (data.lastActivity === undefined) {
                if (nodeId === 'routing_event' && data.chosenModel) {
                    data.lastActivity = `Route: ${data.chosenModel} (${data.classifiedComplexity || 'low'})`;
                } else if (nodeId === 'thinking_event' && data.reflection) {
                    data.lastActivity = data.reflection.length > 35 ? data.reflection.substring(0, 35) + '...' : data.reflection;
                } else if (nodeId === 'fprag_event') {
                    data.lastActivity = data.directive 
                        ? (data.directive.length > 30 ? `Directive: ${data.directive.substring(0, 30)}...` : `Directive: ${data.directive}`)
                        : (data.task?.length > 30 ? `Audit: ${data.task.substring(0, 30)}...` : `Audit: ${data.task || 'Active'}`);
                } else {
                    data.lastActivity = 'monitoring';
                }
            }
        }

        this.state.nodes[nodeId] = data;
        this.state.lastSync = Date.now();

        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'update-node',
                nodeId,
                data,
                timestamp: this.state.lastSync
            }));
            return ok(true);
        }

        return { ok: false, error: new Error('Globe substrate offline') };
    }

    /**
     * Push a batch of spatial perception entities to the global substrate.
     */
    public pushBatchPerception(entities: any[]): void {
        if (this.ws?.readyState === WebSocket.OPEN && entities.length > 0) {
            this.ws.send(JSON.stringify({
                type: 'batch_perception',
                payload: { entities }
            }));
        }
    }

    /**
     * Query state from the substrate.
     */
    public getNodeState(nodeId: string): any {
        return this.state.nodes[nodeId];
    }

    /**
     * Sovereign FinOps: Push quota state to durable substrate.
     */
    public async syncQuotaState(qt: QuotaTracker): Promise<void> {
        await this.pushNodeState('quota', qt.serialize());
    }

    /**
     * Sovereign FinOps: Load persisted quota state.
     */
    public loadQuotaState(): QuotaState | null {
        return this.getNodeState('quota') as QuotaState | null;
    }

    public async healthCheck(): Promise<{ online: boolean; details: string; retryable?: boolean }> {
        // If a connection is pending, wait briefly for it to resolve
        if (this.connectPromise && (!this.ws || this.ws.readyState !== WebSocket.OPEN)) {
            try {
                await Promise.race([
                    this.connectPromise,
                    new Promise(resolve => setTimeout(resolve, 3000))
                ]);
            } catch {
                // Connection failed â€” fall through to status check
            }
        }

        const isOnline = this.ws?.readyState === WebSocket.OPEN;
        const isConnecting = this.ws?.readyState === WebSocket.CONNECTING;

        return {
            online: isOnline,
            retryable: isConnecting,
            details: isOnline
                ? `Globe Substrate Active: ${Object.keys(this.state.nodes).length} nodes synced.`
                : (isConnecting ? 'Globe Substrate Offline: Waiting for connection.' : 'Globe Substrate Offline: Connection failed or closed.')
        };
    }
}
