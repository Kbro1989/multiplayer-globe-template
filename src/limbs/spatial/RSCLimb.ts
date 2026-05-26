import * as net from 'net';
import { spawn, ChildProcess } from 'child_process';
import { join } from 'path';
import { existsSync } from 'fs'; // Statically import existsSync
import { Result, type SovereignKnock, type ConcealmentState } from '../../core/models.js';
import { SovereignConfig } from '../../config/SovereignConfig.js';
import type { TernaryRouter } from '../../routing/TernaryRouter.js';
import { createLogger } from "../../utils/logger.js";

const logger = createLogger('RSCLimb'); // Declare logger with const

interface WorldState {
    player: { x: number; y: number; index: number };
    // NOTE: 'any' types for npcs, players, and objects are used to maintain existing functionality
    // without introducing new domain models. These should be refined with specific types
    // (e.g., Player, NPC, GameObject) if their structures become known.
    npcs: Map<number, any>;
    players: Map<number, any>;
    objects: any[];
}

/**
 * RSCLimb - Gameplay Interaction Substrate
 */
export class RSCLimb {
    private client: net.Socket | null = null;
    private serverProcess: ChildProcess | null = null;
    private state: WorldState = {
        player: { x: 0, y: 0, index: -1 },
        npcs: new Map(),
        players: new Map(),
        objects: []
    };
    private concealmentState: ConcealmentState = 'is'; // Concealed by default
    private router?: TernaryRouter;

    constructor(private readonly config: SovereignConfig) { }

    public setRouter(router: TernaryRouter): void { // Explicit return type
        this.router = router;
    }

    public async healthCheck(): Promise<{ online: boolean; details: string }> {
        const isProcessActive = this.serverProcess !== null;
        const details = `RSC Bridge: ${isProcessActive ? 'ACTIVE' : 'IDLE'}`;
        
        // Physical substrate check
        const serverDir = join(process.cwd(), 'openrsc-repo', 'server');
        const substrateExists = existsSync(serverDir); // Use statically imported existsSync
        
        if (!substrateExists) {
            return { online: false, details: `${details} (ERROR: Substrate 'openrsc-repo' missing)` };
        }

        return {
            online: true,
            details: isProcessActive
                ? `${details} (Server PID: ${this.serverProcess?.pid})`
                : `${details} (Substrate READY, "Sovereign Knock" required for activation)`
        };
    }

    public async connectWithKnock(knock: SovereignKnock): Promise<Result<void>> {
        if (!this.router) {
            const error = new Error('TernaryRouter not injected into RSCLimb');
            logger.error(error.message);
            return { ok: false, error: error };
        }

        // No TCP connection until knock validated
        logger.info('Received SovereignKnock on RSC Bridge. Validating...');
        const stateRes = await this.router.sovereignKnock(knock);

        if (!stateRes.ok) {
            logger.warn({ error: stateRes.error }, 'SovereignKnock REJECTED.');
            return { ok: false, error: stateRes.error };
        }

        this.concealmentState = stateRes.value;
        logger.info('SovereignKnock ACCEPTED. RSC Bridge exposed. Establishing connection...');

        return this.startServer();
    }

    public async startServer(): Promise<Result<void>> {
        if (this.serverProcess) {
            logger.info('RSC Server already running.');
            return { ok: true, value: undefined };
        }

        const serverDir = join(process.cwd(), 'openrsc-repo', 'server');
        if (!existsSync(serverDir)) {
            logger.warn('RSC Server substrate missing (openrsc-repo). Running in DEGRADED mode without live RSC backend.');
            return { ok: true, value: undefined }; // Gracefully degrade
        }

        const antPath = 'ant'; // Simplification for porting, assuming ant in PATH or config

        try {
            // For Windows, 'ant.bat' might be needed if 'ant' isn't directly executable.
            // Assuming 'ant' is configured correctly in the environment for now.
            this.serverProcess = spawn(antPath, ['runserver'], { cwd: serverDir, shell: true });
            
            this.serverProcess.on('error', (err: Error) => {
                logger.error({ err }, 'RSC Server process failed to start or encountered an error.');
                this.serverProcess = null; // Clear process reference on error
            });

            this.serverProcess.stdout?.on('data', (data) => {
                logger.debug(`RSC Server stdout: ${data.toString().trim()}`);
            });

            this.serverProcess.stderr?.on('data', (data) => {
                logger.error(`RSC Server stderr: ${data.toString().trim()}`);
            });

            this.serverProcess.on('close', (code) => {
                if (code !== 0) {
                    logger.warn(`RSC Server process exited with code ${code}`);
                } else {
                    logger.info('RSC Server process exited cleanly.');
                }
                this.serverProcess = null; // Clear process reference on close
            });

            logger.info('RSC Server process initiated.');
            return { ok: true, value: undefined };
        } catch (error: unknown) {
            if (error instanceof Error) {
                logger.error({ error }, `Failed to spawn RSC Server process: ${error.message}`);
                return { ok: false, error: error };
            }
            logger.error({ error }, 'An unknown error occurred while attempting to start RSC Server.');
            return { ok: false, error: new Error(`Unknown error starting RSC Server: ${String(error)}`) };
        }
    }

    public async login(username: string): Promise<Result<void>> {
        // Simplified login for porting. In a real scenario, this would involve
        // sending login packets via this.client after a successful connection.
        logger.info({ username }, 'AI Logging into RSC...');
        return { ok: true, value: undefined };
    }

    public async walk(x: number, y: number): Promise<Result<void>> {
        // In a real scenario, this would involve sending movement packets via this.client.
        logger.info({ x, y }, 'RSC Walk Command dispatched.');
        return { ok: true, value: undefined };
    }

    public async getPerception(): Promise<WorldState> {
        return this.state;
    }
}