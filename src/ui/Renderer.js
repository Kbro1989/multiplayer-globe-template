import * as readline from 'readline/promises';
import { PathNormalizer } from '../utils/PathNormalizer.js';
import { YaoState } from '../core/models.js';
import { SovereignDomain } from '../types/SovereignDomain.js';
/**
 * Renderer — POG2 Sovereign CLI UI output.
 * Humanized for conversational synergy.
 */
export class Renderer {
    rl;
    isSilent = false;
    listeners = [];
    constructor() { }
    setReadline(rl) {
        this.rl = rl;
    }
    setSilent(silent) {
        this.isSilent = silent;
    }
    onOutput(callback) {
        this.listeners.push(callback);
    }
    dispatch(message, type, data) {
        const normalized = data?.skipNormalization ? message : PathNormalizer.normalizeString(message);
        this.listeners.forEach(cb => cb({ message: normalized, type, data }));
    }
    showBanner() {
        console.log('\x1b[38;5;51m');
        console.log('  ██████╗  ██████╗  ██████╗     ██████╗ ██████╗ ██████╗ ███████╗██████╗ ');
        console.log('  ██╔══██╗██╔═══██╗██╔════╝     ██╔════╝██╔═██╗██╔══██╗██╔════╝██╔══██╗');
        console.log('  ██████╔╝██║   ██║██║  ███╗    ██║     ██║   ██║██║  ██║█████╗  ██████╔╝');
        console.log('  ██╔═══╝ ██║   ██║██║   ██║    ██║     ██║   ██║██║  ██║██╔══╝  ██╔══██╗');
        console.log('  ██║     ╚██████╔╝╚██████╔╝    ╚██████╗╚██████╔╝██████╔╝███████╗██║  ██║');
        console.log('  ╚═╝      ╚═════╝  ╚═════╝      ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝╚══╝  ╚═╝');
        console.log('\x1b[0m');
        console.log('        [ P O G 2 - S O V E R E I G N  E D I T I O N ]');
        console.log('               Your AI partner in creation.');
    }
    greet() {
        const hour = new Date().getHours();
        let greeting = 'Hello';
        if (hour < 12)
            greeting = 'Good morning';
        else if (hour < 18)
            greeting = 'Good afternoon';
        else
            greeting = 'Good evening';
        console.log(`\n\x1b[38;5;51m${greeting}! I'm Kimi. I'm ready to help you build something amazing today.\x1b[0m`);
    }
    info(message, data) {
        const normalized = data?.skipNormalization ? message : PathNormalizer.normalizeString(message);
        console.log(`\x1b[38;5;39m(i)\x1b[0m ${normalized}`);
        this.dispatch(message, 'info', data);
    }
    success(message, data) {
        const normalized = data?.skipNormalization ? message : PathNormalizer.normalizeString(message);
        console.log(`\x1b[38;5;46m✔\x1b[0m ${normalized}`);
        this.dispatch(message, 'success', data);
    }
    warn(message, data) {
        const normalized = data?.skipNormalization ? message : PathNormalizer.normalizeString(message);
        console.log(`\x1b[38;5;220m!\x1b[0m ${normalized}`);
        this.dispatch(message, 'warn', data);
    }
    error(message, data) {
        const normalized = data?.skipNormalization ? message : PathNormalizer.normalizeString(message);
        console.log(`\x1b[38;5;196m✘\x1b[0m ${normalized}`);
        this.dispatch(message, 'error', data);
    }
    json(data) {
        console.log(JSON.stringify(data, null, 2));
    }
    output(message, data) {
        const normalized = data?.skipNormalization ? message : PathNormalizer.normalizeString(message);
        console.log(`\x1b[38;5;250m${normalized}\x1b[0m`);
        if (data && Object.keys(data).length > 0) {
            console.log('\x1b[38;5;240m[Technical Details]\x1b[0m');
            this.json(data);
        }
    }
    gauge(label, value, max = 100) {
        const percent = Math.min(Math.max(value / max, 0), 1);
        const width = 20;
        const filled = Math.round(width * percent);
        const bar = '■'.repeat(filled) + '░'.repeat(width - filled);
        const colors = ['\x1b[38;5;46m', '\x1b[38;5;220m', '\x1b[38;5;196m'];
        const colorIdx = percent > 0.8 ? 2 : percent > 0.5 ? 1 : 0;
        console.log(`  ${label.padEnd(15)} ${colors[colorIdx]}${bar}\x1b[0m ${value}/${max}`);
    }
    heatmap(label, scores) {
        const blocks = [' ', '░', '▒', '▓', '█'];
        const line = scores.map(s => {
            const idx = Math.min(Math.floor(s * blocks.length), blocks.length - 1);
            return blocks[idx];
        }).join('');
        console.log(`\n  \x1b[38;5;51m[Analysis: ${label}]\x1b[0m`);
        console.log(`  [${line}]`);
    }
    status(data) {
        console.log('\x1b[38;5;51m\n  ─── [ System Health Overview ] ───\x1b[0m');
        this.json(data);
    }
    log(message) {
        console.log(message);
    }
    async confirm(message) {
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
        }
        finally {
            if (isTemp) {
                this.rl.close();
                this.rl = undefined;
            }
        }
    }
    async prompt(message) {
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
        }
        finally {
            if (isTemp) {
                this.rl.close();
                this.rl = undefined;
            }
        }
    }
    showYaoCard(state) {
        const cards = {
            [YaoState.YoungYang]: { symbol: '⚊', label: 'Balanced Energy', color: '\x1b[38;5;46m' },
            [YaoState.YoungYin]: { symbol: '⚋', label: 'Receptive State', color: '\x1b[38;5;39m' },
            [YaoState.OldYang]: { symbol: '◯', label: 'Active Change', color: '\x1b[38;5;196m' },
            [YaoState.OldYin]: { symbol: '✕', label: 'Gentle Transition', color: '\x1b[38;5;208m' },
            [YaoState.YoungMixed]: { symbol: '⚎', label: 'Emerging Potential', color: '\x1b[38;5;213m' },
            [YaoState.OldMixed]: { symbol: '⚏', label: 'Chaotic Flux', color: '\x1b[38;5;141m' },
        };
        const card = cards[state];
        if (!card)
            return;
        console.log(`\n  ${card.color}┌────────────────────┐\x1b[0m`);
        console.log(`  ${card.color}│      [ ${card.symbol} ]       │\x1b[0m`);
        console.log(`  ${card.color}│    ${card.label.padEnd(14)}    │\x1b[0m`);
        console.log(`  ${card.color}└────────────────────┘\x1b[0m`);
    }
    showHexagram(manager) {
        const lines = manager.getLines();
        const interpretation = manager.getInterpretation();
        const colors = {
            [YaoState.YoungYang]: '\x1b[38;5;46m', // Stable
            [YaoState.OldYang]: '\x1b[38;5;196m', // Active
            [YaoState.YoungYin]: '\x1b[38;5;39m', // Receptive
            [YaoState.OldYin]: '\x1b[38;5;208m', // Changing
            [YaoState.YoungMixed]: '\x1b[38;5;213m',
            [YaoState.OldMixed]: '\x1b[38;5;141m'
        };
        console.log('\x1b[38;5;51m\n  ─── [ Current Strategic Archetype ] ───\x1b[0m');
        for (let i = 5; i >= 0; i--) {
            const line = lines[i];
            const symbol = line.state === YaoState.YoungYang || line.state === YaoState.OldYang ? '━━━━━━━' : '━━━   ━━━';
            const mark = line.state === YaoState.OldYang ? '◯' : line.state === YaoState.OldYin ? '✕' : ' ';
            console.log(`  L${i + 1}: ${colors[line.state] ?? '\x1b[0m'}${symbol} ${mark} \x1b[0m`);
        }
        console.log(`  \x1b[38;5;51mArchetype: ${interpretation.name} \x1b[0m`);
        console.log(`  \x1b[38;5;250mPhilosophy: ${interpretation.description || ''} \x1b[0m`);
        console.log(`  \x1b[38;5;250mSuggested Action: ${interpretation.strategy} \x1b[0m`);
    }
    showPlan(plan) {
        console.log(`\x1b[38;5;51m\n  ─── [ My Thinking Process ] ───\x1b[0m`);
        console.log(`  What I want to achieve: ${plan.goal}`);
        console.log(`  How I'll do it (${plan.steps.length} steps):`);
        plan.steps.forEach((step, idx) => {
            console.log(`    ${idx + 1}. ${step}`);
        });
    }
    showDomainTransition(from, to) {
        const DOMAIN_COLORS = {
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
        const DOMAIN_ICONS = {
            [SovereignDomain.CODE]: '💻',
            [SovereignDomain.SYSTEM]: '⚙️',
            [SovereignDomain.VISION]: '👁️',
            [SovereignDomain.RESEARCH]: '🔍',
            [SovereignDomain.FORGE]: '🔥',
            [SovereignDomain.OBSERVE]: '📊',
            [SovereignDomain.SOCIAL]: '🎭',
            [SovereignDomain.MOTOR]: '🦾',
            [SovereignDomain.SENSORY]: '📡',
        };
        const color = DOMAIN_COLORS[to];
        const icon = DOMAIN_ICONS[to];
        console.log(`\n  ${color}┌───────────────────────────────────────┐\x1b[0m`);
        if (from) {
            console.log(`  ${color}│  ${icon} Switching from ${from} to ${to} │\x1b[0m`);
        }
        else {
            console.log(`  ${color}│  ${icon} Entering ${to} Domain │\x1b[0m`);
        }
        console.log(`  ${color}└───────────────────────────────────────┘\x1b[0m`);
    }
    showFallbackWarning(reason, targetModel, fallbackReason) {
        const yellow = '\x1b[38;5;220m';
        const bold = '\x1b[1m';
        console.log(`\n  ${yellow}${bold}┌──────────────────────────────────────────┐\x1b[0m`);
        console.log(`  ${yellow}${bold}│  ! Switching to my cloud brain...        │\x1b[0m`);
        console.log(`  ${yellow}${bold}├──────────────────────────────────────────┤\x1b[0m`);
        console.log(`  ${yellow}│  Why: ${fallbackReason.substring(0, 30).padEnd(30)} │\x1b[0m`);
        console.log(`  ${yellow}│  Using: ${targetModel.substring(0, 28).padEnd(28)} │\x1b[0m`);
        console.log(`  ${yellow}${bold}└──────────────────────────────────────────┘\x1b[0m`);
    }
    showDomainViolation(toolName, requiredDomain, activeDomain) {
        const red = '\x1b[38;5;196m';
        const bold = '\x1b[1m';
        console.log(`\n  ${red}${bold}┌──────────────────────────────────────────┐\x1b[0m`);
        console.log(`  ${red}${bold}│  I'm sorry, I can't do that here.        │\x1b[0m`);
        console.log(`  ${red}${bold}├──────────────────────────────────────────┤\x1b[0m`);
        console.log(`  ${red}│  The tool "${toolName}" is off-limits.    │\x1b[0m`);
        console.log(`  ${red}│  It belongs to the ${requiredDomain} domain.   │\x1b[0m`);
        console.log(`  ${red}│  I'm currently working in ${activeDomain}.      │\x1b[0m`);
        console.log(`  ${red}│                                          │\x1b[0m`);
        console.log(`  ${red}│  Please ask for a domain switch first.   │\x1b[0m`);
        console.log(`  ${red}${bold}└──────────────────────────────────────────┘\x1b[0m`);
    }
    renderNeurologicalAudit(results) {
        console.log('\x1b[38;5;51m\n  ─── [ System Nerve Center Audit ] ───\x1b[0m');
        const categories = [...new Set(results.map(r => r.category))];
        for (const cat of categories) {
            console.log(`\n  \x1b[38;5;250m${cat}\x1b[0m`);
            const catNodes = results.filter(r => r.category === cat);
            for (const node of catNodes) {
                let statusColor = '\x1b[38;5;46m';
                if (node.status === 'DEGRADED')
                    statusColor = '\x1b[38;5;220m';
                if (node.status === 'OFFLINE')
                    statusColor = '\x1b[38;5;196m';
                const icon = node.status === 'ONLINE' ? '✔' : node.status === 'DEGRADED' ? '⚠' : '✘';
                const yaoIcon = node.yaoState === 2 || node.yaoState === 0 ? '⚊' : '⚋';
                console.log(`    ${statusColor}${icon}\x1b[0m [${yaoIcon}] ${node.role.padEnd(18)} : ${statusColor}${node.status.padEnd(8)}\x1b[0m ${node.details || ''}`);
            }
        }
        const online = results.filter(r => r.status === 'ONLINE').length;
        const total = results.length;
        this.gauge('System Integrity', online, total);
        console.log('');
    }
    async healthCheck() {
        return {
            online: true,
            details: 'CLI Renderer: ONLINE (Interactive substrate nominal)'
        };
    }
}
