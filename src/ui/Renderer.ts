import * as readline from 'readline/promises';
import { PathNormalizer } from '../utils/PathNormalizer.js';
import chalk from 'chalk';
import { SovereignAvatar, YaoState, EmotionalState, type SovereignRecord, type OraclePlan } from '../core/models.js';
import type { HexagramManager } from '../routing/HexagramManager.js';
import { SovereignDomain } from '../types/SovereignDomain.js';
import type { NodeHealth } from '../monitor/NodeTester.js';
import { RealityDomain } from '../core/RealityGate.js';

/**
 * Renderer â€” POG2 Sovereign CLI UI output.
 * Humanized for conversational synergy.
 */
export class Renderer {
    private rl?: readline.Interface;
    private isSilent = false;
    private listeners: ((payload: { message: string, type: string, data?: any, domain?: RealityDomain }) => void)[] = [];

    constructor() { }

    public setReadline(rl: readline.Interface): void {
        this.rl = rl;
    }

    public setSilent(silent: boolean): void {
        this.isSilent = silent;
    }

    public onOutput(callback: (payload: { message: string, type: string, data?: any, domain?: RealityDomain }) => void): void {
        this.listeners.push(callback);
    }

    private dispatch(message: string, type: string, data?: any, domain: RealityDomain = RealityDomain.POG2): void {
        const normalized = data?.skipNormalization ? message : PathNormalizer.normalizeString(message);
        this.listeners.forEach(cb => cb({ message: normalized, type, data, domain }));
    }

    public showBanner(): void {
        console.log('\x1b[38;5;51m');
        console.log('  â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•—  â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•—  â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•—     â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•— â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•— â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•— â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•—â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•— ');
        console.log('  â–ˆâ–ˆâ•”â•â•â–ˆâ–ˆâ•—â–ˆâ–ˆâ•”â•â•â•â–ˆâ–ˆâ•—â–ˆâ–ˆâ•”â•â•â•â•â•     â–ˆâ–ˆâ•”â•â•â•â•â•â–ˆâ–ˆâ•”â•â–ˆâ–ˆâ•—â–ˆâ–ˆâ•”â•â•â–ˆâ–ˆâ•—â–ˆâ–ˆâ•”â•â•â•â•â•â–ˆâ–ˆâ•”â•â•â–ˆâ–ˆâ•—');
        console.log('  â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•”â•â–ˆâ–ˆâ•‘   â–ˆâ–ˆâ•‘â–ˆâ–ˆâ•‘  â–ˆâ–ˆâ–ˆâ•—    â–ˆâ–ˆâ•‘     â–ˆâ–ˆâ•‘   â–ˆâ–ˆâ•‘â–ˆâ–ˆâ•‘  â–ˆâ–ˆâ•‘â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•—  â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•”â•');
        console.log('  â–ˆâ–ˆâ•”â•â•â•â• â–ˆâ–ˆâ•‘   â–ˆâ–ˆâ•‘â–ˆâ–ˆâ•‘   â–ˆâ–ˆâ•‘    â–ˆâ–ˆâ•‘     â–ˆâ–ˆâ•‘   â–ˆâ–ˆâ•‘â–ˆâ–ˆâ•‘  â–ˆâ–ˆâ•‘â–ˆâ–ˆâ•”â•â•â•  â–ˆâ–ˆâ•”â•â•â–ˆâ–ˆâ•—');
        console.log('  â–ˆâ–ˆâ•‘     â•šâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•”â•â•šâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•”â•    â•šâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•—â•šâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•”â•â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•”â•â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•—â–ˆâ–ˆâ•‘  â–ˆâ–ˆâ•‘');
        console.log('  â•šâ•â•      â•šâ•â•â•â•â•â•  â•šâ•â•â•â•â•â•      â•šâ•â•â•â•â•â• â•šâ•â•â•â•â•â• â•šâ•â•â•â•â•â• â•šâ•â•â•â•â•â•â•â•šâ•â•â•  â•šâ•â•');
        console.log('\x1b[0m');
        console.log('        [ P O G 2 - S O V E R E I G N  E D I T I O N ]');
        console.log('               Your AI partner in creation.');
    }

    public greet(): void {
        const hour = new Date().getHours();
        let greeting = 'Hello';
        if (hour < 12) greeting = 'Good morning';
        else if (hour < 18) greeting = 'Good afternoon';
        else greeting = 'Good evening';

        console.log(`\n\x1b[38;5;51m${greeting}! I'm Kimi. I'm ready to help you build something amazing today.\x1b[0m`);
    }

    public info(message: string, data?: any): void {
        const normalized = data?.skipNormalization ? message : PathNormalizer.normalizeString(message);
        console.log(`\x1b[38;5;39m(i)\x1b[0m ${normalized}`);
        this.dispatch(message, 'info', data);
    }

    public success(message: string, data?: any): void {
        const normalized = data?.skipNormalization ? message : PathNormalizer.normalizeString(message);
        console.log(`\x1b[38;5;46mâœ”\x1b[0m ${normalized}`);
        this.dispatch(message, 'success', data);
    }

    public warn(message: string, data?: any): void {
        const normalized = data?.skipNormalization ? message : PathNormalizer.normalizeString(message);
        console.log(`\x1b[38;5;220m!\x1b[0m ${normalized}`);
        this.dispatch(message, 'warn', data);
    }

    public error(message: string, data?: any): void {
        const normalized = data?.skipNormalization ? message : PathNormalizer.normalizeString(message);
        console.log(`\x1b[38;5;196mâœ˜\x1b[0m ${normalized}`);
        this.dispatch(message, 'error', data);
    }

    public json(data: unknown): void {
        console.log(JSON.stringify(data, null, 2));
    }

    public output(message: string, data?: any): void {
        const normalized = data?.skipNormalization ? message : PathNormalizer.normalizeString(message);
        console.log(`\x1b[38;5;250m${normalized}\x1b[0m`);
        if (data && Object.keys(data).length > 0) {
            console.log('\x1b[38;5;240m[Technical Details]\x1b[0m');
            this.json(data);
        }
    }

    public gauge(label: string, value: number, max: number = 100): void {
        const percent = Math.min(Math.max(value / max, 0), 1);
        const width = 20;
        const filled = Math.round(width * percent);
        const bar = 'â– '.repeat(filled) + 'â–‘'.repeat(width - filled);
        const colors = ['\x1b[38;5;46m', '\x1b[38;5;220m', '\x1b[38;5;196m'];
        const colorIdx = percent > 0.8 ? 2 : percent > 0.5 ? 1 : 0;
        console.log(`  ${label.padEnd(15)} ${colors[colorIdx]}${bar}\x1b[0m ${value}/${max}`);
    }

    public heatmap(label: string, scores: number[]): void {
        const blocks = [' ', 'â–‘', 'â–’', 'â–“', 'â–ˆ'];
        const line = scores.map(s => {
            const idx = Math.min(Math.floor(s * blocks.length), blocks.length - 1);
            return blocks[idx];
        }).join('');
        console.log(`\n  \x1b[38;5;51m[Analysis: ${label}]\x1b[0m`);
        console.log(`  [${line}]`);
    }

    public status(data: unknown): void {
        console.log('\x1b[38;5;51m\n  â”€â”€â”€ [ System Health Overview ] â”€â”€â”€\x1b[0m');
        this.json(data);
    }

    public log(message: string): void {
        console.log(message);
    }

    public async confirm(message: string): Promise<boolean> {
        let isTemp = false;
        if (!this.rl) {
            this.rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout
            });
            isTemp = true;
        }

        try {
            const answer = await this.rl.question(`\x1b[38;5;220m[Wait!]\x1b[0m ${message} Should I proceed? (y/n): `);
            return answer.toLowerCase() === 'y';
        } finally {
            if (isTemp) {
                this.rl.close();
                this.rl = undefined;
            }
        }
    }

    public async prompt(message: string): Promise<string> {
        let isTemp = false;
        if (!this.rl) {
            this.rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout
            });
            isTemp = true;
        }

        try {
            return await this.rl.question(message);
        } finally {
            if (isTemp) {
                this.rl.close();
                this.rl = undefined;
            }
        }
    }

    public showYaoCard(state: YaoState): void {
        const cards: Record<YaoState, { symbol: string, label: string, color: string }> = {
            [YaoState.YoungYang]: { symbol: 'âšŠ', label: 'Balanced Energy', color: '\x1b[38;5;46m' },
            [YaoState.YoungYin]: { symbol: 'âš‹', label: 'Receptive State', color: '\x1b[38;5;39m' },
            [YaoState.OldYang]: { symbol: 'â—¯', label: 'Active Change', color: '\x1b[38;5;196m' },
            [YaoState.OldYin]: { symbol: 'âœ•', label: 'Gentle Transition', color: '\x1b[38;5;208m' },
            [YaoState.YoungMixed]: { symbol: 'âšŽ', label: 'Emerging Potential', color: '\x1b[38;5;213m' },
            [YaoState.OldMixed]: { symbol: 'âš', label: 'Chaotic Flux', color: '\x1b[38;5;141m' },
            [YaoState.SovereignAvatar]: { symbol: 'â™™', label: 'Spatial Avatar', color: '\x1b[38;5;220m' },
            [YaoState.SovereignEngine]: { symbol: 'âš™', label: 'Master Engine', color: '\x1b[38;5;123m' },
        };

        const card = cards[state];
        if (!card) return;
        console.log(`\n  ${card.color}â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”\x1b[0m`);
        console.log(`  ${card.color}â”‚      [ ${card.symbol} ]       â”‚\x1b[0m`);
        console.log(`  ${card.color}â”‚    ${card.label.padEnd(14)}    â”‚\x1b[0m`);
        console.log(`  ${card.color}â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜\x1b[0m`);
    }

    public showHexagram(manager: HexagramManager): void {
        const lines = manager.getLines();
        const interpretation = manager.getInterpretation();
        const colors: Record<YaoState, string> = {
            [YaoState.YoungYang]: '\x1b[38;5;46m',   // Stable
            [YaoState.OldYang]: '\x1b[38;5;196m',     // Active
            [YaoState.YoungYin]: '\x1b[38;5;39m',      // Receptive
            [YaoState.OldYin]: '\x1b[38;5;208m',       // Changing
            [YaoState.YoungMixed]: '\x1b[38;5;213m',
            [YaoState.OldMixed]: '\x1b[38;5;141m',
            [YaoState.SovereignAvatar]: '\x1b[38;5;220m',
            [YaoState.SovereignEngine]: '\x1b[38;5;123m'
        };

        console.log('\x1b[38;5;51m\n  â”€â”€â”€ [ Current Strategic Archetype ] â”€â”€â”€\x1b[0m');
        for (let i = 5; i >= 0; i--) {
            const line = lines[i]!;
            const symbol = line.state === YaoState.YoungYang || line.state === YaoState.OldYang ? 'â”â”â”â”â”â”â”' : 'â”â”â”   â”â”â”';
            const mark = line.state === YaoState.OldYang ? 'â—¯' : line.state === YaoState.OldYin ? 'âœ•' : ' ';
            console.log(`  L${i + 1}: ${colors[line.state as YaoState] ?? '\x1b[0m'}${symbol} ${mark} \x1b[0m`);
        }
        console.log(`  \x1b[38;5;51mArchetype: ${interpretation.name} \x1b[0m`);
        console.log(`  \x1b[38;5;250mPhilosophy: ${interpretation.description || ''} \x1b[0m`);
        console.log(`  \x1b[38;5;250mSuggested Action: ${interpretation.strategy} \x1b[0m`);
    }

    public showPlan(plan: OraclePlan): void {
        console.log(`\x1b[38;5;51m\n  â”€â”€â”€ [ My Thinking Process ] â”€â”€â”€\x1b[0m`);
        console.log(`  What I want to achieve: ${plan.goal}`);
        console.log(`  How I'll do it (${plan.steps.length} steps):`);
        plan.steps.forEach((step, idx) => {
            console.log(`    ${idx + 1}. ${step}`);
        });
    }

    public showDomainTransition(from: SovereignDomain | null, to: SovereignDomain): void {
        const DOMAIN_COLORS: Record<SovereignDomain, string> = {
            [SovereignDomain.CODE]: '\x1b[38;5;46m',
            [SovereignDomain.SYSTEM]: '\x1b[38;5;208m',
            [SovereignDomain.VISION]: '\x1b[38;5;39m',
            [SovereignDomain.RESEARCH]: '\x1b[38;5;141m',
            [SovereignDomain.FORGE]: '\x1b[38;5;196m',
            [SovereignDomain.OBSERVE]: '\x1b[38;5;250m',
            [SovereignDomain.SOCIAL]: '\x1b[38;5;51m',
            [SovereignDomain.MOTOR]: '\x1b[38;5;213m',
            [SovereignDomain.SENSORY]: '\x1b[38;5;226m',
        };

        const DOMAIN_ICONS: Record<SovereignDomain, string> = {
            [SovereignDomain.CODE]: 'ðŸ’»',
            [SovereignDomain.SYSTEM]: 'âš™ï¸',
            [SovereignDomain.VISION]: 'ðŸ‘ï¸',
            [SovereignDomain.RESEARCH]: 'ðŸ”',
            [SovereignDomain.FORGE]: 'ðŸ”¥',
            [SovereignDomain.OBSERVE]: 'ðŸ“Š',
            [SovereignDomain.SOCIAL]: 'ðŸŽ­',
            [SovereignDomain.MOTOR]: 'ðŸ¦¾',
            [SovereignDomain.SENSORY]: 'ðŸ“¡',
        };

        const color = DOMAIN_COLORS[to];
        const icon = DOMAIN_ICONS[to];

        console.log(`\n  ${color}â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”\x1b[0m`);
        if (from) {
            console.log(`  ${color}â”‚  ${icon} Switching from ${from} to ${to} â”‚\x1b[0m`);
        } else {
            console.log(`  ${color}â”‚  ${icon} Entering ${to} Domain â”‚\x1b[0m`);
        }
        console.log(`  ${color}â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜\x1b[0m`);
    }

    public showFallbackWarning(reason: string, targetModel: string, fallbackReason: string): void {
        const yellow = '\x1b[38;5;220m';
        const bold = '\x1b[1m';

        console.log(`\n  ${yellow}${bold}â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”\x1b[0m`);
        console.log(`  ${yellow}${bold}â”‚  ! Switching to my cloud brain...        â”‚\x1b[0m`);
        console.log(`  ${yellow}${bold}â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤\x1b[0m`);
        console.log(`  ${yellow}â”‚  Why: ${fallbackReason.substring(0, 30).padEnd(30)} â”‚\x1b[0m`);
        console.log(`  ${yellow}â”‚  Using: ${targetModel.substring(0, 28).padEnd(28)} â”‚\x1b[0m`);
        console.log(`  ${yellow}${bold}â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜\x1b[0m`);
    }

    public showDomainViolation(toolName: string, requiredDomain: SovereignDomain, activeDomain: SovereignDomain): void {
        const red = '\x1b[38;5;196m';
        const bold = '\x1b[1m';

        console.log(`\n  ${red}${bold}â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”\x1b[0m`);
        console.log(`  ${red}${bold}â”‚  I'm sorry, I can't do that here.        â”‚\x1b[0m`);
        console.log(`  ${red}${bold}â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤\x1b[0m`);
        console.log(`  ${red}â”‚  The tool "${toolName}" is off-limits.    â”‚\x1b[0m`);
        console.log(`  ${red}â”‚  It belongs to the ${requiredDomain} domain.   â”‚\x1b[0m`);
        console.log(`  ${red}â”‚  I'm currently working in ${activeDomain}.      â”‚\x1b[0m`);
        console.log(`  ${red}â”‚                                          â”‚\x1b[0m`);
        console.log(`  ${red}â”‚  Please ask for a domain switch first.   â”‚\x1b[0m`);
        console.log(`  ${red}${bold}â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜\x1b[0m`);
    }

    public renderNeurologicalAudit(results: NodeHealth[]): void {
        console.log('\x1b[38;5;51m\n  â”€â”€â”€ [ System Nerve Center Audit ] â”€â”€â”€\x1b[0m');

        const categories = [...new Set(results.map(r => r.category))];

        for (const cat of categories) {
            console.log(`\n  \x1b[38;5;250m${cat}\x1b[0m`);
            const catNodes = results.filter(r => r.category === cat);

            for (const node of catNodes) {
                let statusColor = '\x1b[38;5;46m';
                if (node.status === 'DEGRADED') statusColor = '\x1b[38;5;220m';
                if (node.status === 'OFFLINE') statusColor = '\x1b[38;5;196m';

                const icon = node.status === 'ONLINE' ? 'âœ”' : node.status === 'DEGRADED' ? 'âš ' : 'âœ˜';
                const yaoIcon = node.yaoState === 2 || node.yaoState === 0 ? 'âšŠ' : 'âš‹';

                console.log(`    ${statusColor}${icon}\x1b[0m [${yaoIcon}] ${node.role.padEnd(18)} : ${statusColor}${node.status.padEnd(8)}\x1b[0m ${node.details || ''}`);
            }
        }

        const online = results.filter(r => r.status === 'ONLINE').length;
        const total = results.length;
        this.gauge('System Integrity', online, total);
        console.log('');
    }

    public renderPedagogySync(stats: { 
        totalMapsquares: number, 
        linkedNpcs: number, 
        totalNpcs: number,
        zoneCoverage: number,
        questLinks: number
    }): void {
        console.log('\x1b[38;5;51m\n  â”€â”€â”€ [ Sovereign 10/10 Global Truth Audit ] â”€â”€â”€\x1b[0m');
        console.log(`  Mapsquares Synthesized : \x1b[38;5;46m${stats.totalMapsquares}\x1b[0m`);
        console.log(`  Quest Grounding Links  : \x1b[38;5;220m${stats.questLinks}\x1b[0m`);
        
        this.gauge('NPC Semantic Match ', stats.linkedNpcs, stats.totalNpcs);
        this.gauge('Spatial Zone Cover ', Math.round(stats.zoneCoverage * 100), 100);
        
        console.log(`\n  \x1b[38;5;123mStatus: Substrate Synchronized. Ready for high-fidelity simulation.\x1b[0m\n`);
    }

    public drawRadar(grid: string, clear: boolean = false): void {
        if (clear) {
            // ANSI escape to clear screen and reset cursor
            process.stdout.write('\x1b[2J\x1b[0;0H');
        }
        console.log(grid);
    }

    public async healthCheck(): Promise<{ online: boolean; details: string }> {
        return { online: true, details: 'Renderer is synchronized with the CLI substrate.' };
    }
}






