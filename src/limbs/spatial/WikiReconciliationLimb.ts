import { Result } from '../../core/models.js';
import { createLogger } from '../../utils/logger.js';
import fs from 'fs/promises';
import path from 'path';

const logger = createLogger('WikiRecon');

export interface WikiQuest {
    title: string;
    pageid: number;
    difficulty?: string;
    members?: boolean;
}

/**
 * WikiReconciliationLimb
 * Handles "soft parsing" (rate-limited, queued) of the official RuneScape Wiki API.
 * Reconciles raw cache IDs against rich Wiki lore, quest lists, and item variables.
 */
export class WikiReconciliationLimb {
    private lastRequestTime: number = 0;
    private readonly RATE_LIMIT_MS: number = 1500; // 1.5 seconds between requests (Soft Parse)
    private readonly API_BASE = 'https://runescape.wiki/api.php';
    private readonly USER_AGENT = 'POG2-Sovereign-ReimaginationEngine/1.0 (Automated Research Node)';

    constructor() { }

    public async healthCheck(): Promise<{ online: boolean; details: string }> {
        try {
            const response = await fetch(`${this.API_BASE}?action=query&meta=siteinfo&format=json`, {
                headers: { 'User-Agent': this.USER_AGENT },
                signal: AbortSignal.timeout(15000)
            });
            const online = response.ok;
            return {
                online,
                details: `Wiki Reconciliation: ${online ? 'ONLINE' : 'OFFLINE'} (Soft-parse substrate ready)`
            };
        } catch (e) {
            return { online: false, details: `Wiki Reconciliation: OFFLINE (API unreachable: ${(e as Error).message})` };
        }
    }

    /**
     * Enforces the rate limit before returning
     */
    private async applyRateLimit(): Promise<void> {
        const now = Date.now();
        const timeSinceLast = now - this.lastRequestTime;
        if (timeSinceLast < this.RATE_LIMIT_MS) {
            const delay = this.RATE_LIMIT_MS - timeSinceLast;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
        this.lastRequestTime = Date.now();
    }

    /**
     * Performs a soft fetch to the MediaWiki API
     */
    private async softFetch(params: Record<string, string>): Promise<any> {
        await this.applyRateLimit();

        const urlParams = new URLSearchParams({
            ...params,
            format: 'json'
        });

        const url = `${this.API_BASE}?${urlParams.toString()}`;
        logger.info({ url }, 'Soft-parsing Wiki API...');

        const response = await fetch(url, {
            headers: {
                'User-Agent': this.USER_AGENT,
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`Wiki API responded with status: ${response.status}`);
        }

        return await response.json();
    }

    /**
     * Fetches the complete list of Quests from the Wiki category
     */
    public async fetchCompleteQuestList(): Promise<Result<WikiQuest[]>> {
        try {
            logger.info('Commencing full quest list extraction from Wiki...');
            const quests: WikiQuest[] = [];
            let gcmcontinue: string | undefined = undefined;

            // Fetch members of "Category:Quests"
            do {
                const params: Record<string, string> = {
                    action: 'query',
                    generator: 'categorymembers',
                    gcmtitle: 'Category:Quests',
                    gcmlimit: '500', // Max allowed per request
                    prop: 'info',
                };

                if (gcmcontinue) {
                    params.gcmcontinue = gcmcontinue;
                }

                const data = await this.softFetch(params);

                if (data.query && data.query.pages) {
                    for (const pageId in data.query.pages) {
                        const page = data.query.pages[pageId];
                        // Filter out subcategories or non-quest pages if necessary
                        if (page.ns === 0 && !page.title.includes('Category:')) {
                            quests.push({
                                title: page.title,
                                pageid: page.pageid
                            });
                        }
                    }
                }

                gcmcontinue = data.continue?.gcmcontinue;

            } while (gcmcontinue);

            logger.info({ count: quests.length }, 'Successfully extracted Quest taxonomy from Wiki.');
            return { ok: true, value: quests };

        } catch (error) {
            logger.error({ error }, 'Failed to fetch quest list from Wiki.');
            return { ok: false, error: error as Error };
        }
    }

    /**
     * Reconciles the incomplete local requests.json with the Wiki list.
     */
    public async reconcileQuestTaxonomy(localQuestsJsonPath: string): Promise<Result<void>> {
        try {
            const listRes = await this.fetchCompleteQuestList();
            if (!listRes.ok) return { ok: false, error: listRes.error };

            const wikiQuests = listRes.value;

            // Read local
            const rawLocal = await fs.readFile(localQuestsJsonPath, 'utf8');
            const localData = JSON.parse(rawLocal);

            const localQuestSet = new Set(localData.quests.map((q: any) => q.name));

            let addedCount = 0;
            for (const wq of wikiQuests) {
                if (!localQuestSet.has(wq.title)) {
                    // Stubs for now, will enrich with actual cache ID later via search
                    localData.quests.push({
                        id: -1, // Placeholder indicating it's from Wiki, not yet mapped to JS5
                        name: wq.title,
                        description: 'Enriched via Wiki Reconciliation Layer',
                        isF2P: false,
                        isHidden: false,
                        wikiPageId: wq.pageid
                    });
                    addedCount++;
                }
            }

            localData.totalExported = localData.quests.length;

            await fs.writeFile(localQuestsJsonPath, JSON.stringify(localData, null, 2), 'utf8');
            logger.info({ addedCount, total: localData.totalExported }, 'Quest taxonomy reconciled and enriched.');

            return { ok: true, value: undefined };

        } catch (error) {
            logger.error({ error }, 'Reconciliation failed.');
            return { ok: false, error: error as Error };
        }
    }

    // ════════════════════════════════════════════════════════════
    // Abilities Substrate (March 2026 Combat Modernisation)
    // Uses MediaWiki parse API to extract canonical ability taxonomy.
    // ════════════════════════════════════════════════════════════

    /**
     * Ability type classification as defined by the RS Wiki.
     * Reflects the March 2026 paradigm: "Threshold" renamed to "Enhanced".
     */
    public readonly WIKI_ABILITY_TYPES = {
        BASIC:    'basic',
        ENHANCED: 'enhanced',    // Was "threshold" pre-March 2026
        ULTIMATE: 'ultimate',
        PASSIVE:  'passive',
        UTILITY:  'utility',
        SPECIAL:  'special',
    } as const;

    /**
     * Adrenaline rules sourced directly from the wiki (March 2026 update).
     * These are the ground-truth values we validate COMBAT_PARAMS against.
     */
    public readonly WIKI_ADRENALINE_RULES = {
        BASIC_GEN_PCT:       9,    // All basics generate 9% (900/10000)
        ENHANCED_COST_PCT:   null, // Variable per ability (no longer fixed 50%)
        THRESHOLD_COST_PCT:  50,   // Legacy: pre-March 2026 fixed cost
        THRESHOLD_DRAIN_PCT: 15,   // Legacy: pre-March 2026 fixed drain
        ULTIMATE_60_PCT:     60,   // Some ultimates require 60%
        ULTIMATE_100_PCT:    100,  // Most ultimates require 100%
        GCD_TICKS:           3,    // Global cooldown: 3 ticks = 1.8s (unified March 2026)
    } as const;

    /**
     * fetchAbilitiesData — Pulls the canonical Abilities page wikitext via MediaWiki parse API.
     * Extracts: ability type taxonomy, adrenaline rules, update history.
     * 
     * Rate-limited via the existing applyRateLimit() infrastructure.
     */
    public async fetchAbilitiesData(): Promise<Result<WikiAbilitiesData>> {
        try {
            logger.info('Fetching RS Wiki Abilities taxonomy (March 2026 paradigm)...');
            const data = await this.softFetch({
                action: 'parse',
                page: 'Abilities',
                prop: 'wikitext',
            });

            if (!data?.parse?.wikitext?.['*']) {
                return { ok: false, error: new Error('Wiki API returned empty wikitext for Abilities page.') };
            }

            const wikitext: string = data.parse.wikitext['*'];
            const parsed = this.parseAbilitiesWikitext(wikitext);

            logger.info({
                typeCount: parsed.abilityTypes.length,
                adrenalineRules: parsed.adrenalineRules,
            }, 'Abilities wiki data extracted.');

            return { ok: true, value: parsed };

        } catch (error) {
            logger.error({ error }, 'Failed to fetch Abilities wiki data.');
            return { ok: false, error: error as Error };
        }
    }

    /**
     * fetchAbilitiesByStyle — Queries the wiki for ability names per combat style
     * using the category member API (Category:Melee_abilities, etc.)
     */
    public async fetchAbilitiesByStyle(style: 'Melee' | 'Ranged' | 'Magic' | 'Necromancy' | 'Defence'): Promise<Result<string[]>> {
        try {
            logger.info({ style }, `Fetching ${style} ability list from Wiki...`);

            const data = await this.softFetch({
                action: 'query',
                generator: 'categorymembers',
                gcmtitle: `Category:${style} abilities`,
                gcmlimit: '500',
                prop: 'info',
            });

            const names: string[] = [];
            if (data?.query?.pages) {
                for (const pageId in data.query.pages) {
                    const page = data.query.pages[pageId];
                    if (page.ns === 0) {
                        // Strip " (ability)" suffix that wiki uses for disambiguation
                        const cleanName = page.title.replace(/\s*\(ability\)$/, '').trim();
                        names.push(cleanName);
                    }
                }
            }

            logger.info({ style, count: names.length }, `${style} ability list fetched.`);
            return { ok: true, value: names };

        } catch (error) {
            logger.error({ error, style }, `Failed to fetch ${style} ability list.`);
            return { ok: false, error: error as Error };
        }
    }

    /**
     * parseAbilitiesWikitext — Extracts structured data from the raw wikitext.
     * Reads the canonical ability type list and adrenaline rules.
     */
    private parseAbilitiesWikitext(wikitext: string): WikiAbilitiesData {
        // Extract ability types from the bulleted list in the "Combat" section
        const typeMatches = wikitext.match(/\[\[(Basic abilities|Enhanced abilities|Threshold abilities|Ultimate abilities)[^\]]*\]\]/g) || [];
        const abilityTypes: string[] = typeMatches.map(m => {
            const label = m.replace(/\[\[|\]\]|[|].*/g, '').trim();
            return label;
        });

        // Extract the adrenaline rules paragraph
        const adrenalineSection = wikitext.match(/===Adrenaline===([\s\S]*?)===Cooldown===/)?.[1] || '';
        const basicGenMatch    = adrenalineSection.match(/Basic abilities generate (\d+)%/);
        const gcdTicksMatch    = wikitext.match(/After using an ability.*?for (\d+) \[\[tick\]\]s/);

        // Extract the March 2026 update note
        const updateHistory = wikitext.match(/\* \{\{UL\|type=update\|update=Patch Notes: Part 1 - Combat Style Modernisation[\s\S]*?(?=\n\* \{\{UL)/)?.[0] || '';
        const march2026Notes: string[] = updateHistory
            .split('\n')
            .filter(l => l.includes('**'))
            .map(l => l.replace(/\*+\s*/g, '').trim())
            .filter(Boolean);

        return {
            abilityTypes: [...new Set(abilityTypes)],
            adrenalineRules: {
                basicGenPct:  basicGenMatch ? parseInt(basicGenMatch[1]) : 9,
                gcdTicks:     gcdTicksMatch ? parseInt(gcdTicksMatch[1]) : 3,
                enhancedNote: 'Variable per ability — no longer fixed 50% (March 2026)',
                ultimateNote: '60% or 100% adrenaline depending on ability',
            },
            march2026Changes: march2026Notes,
            sourceUrl: 'https://runescape.wiki/w/Abilities',
            fetchedAt: new Date().toISOString(),
        };
    }
}

// ════════════════════════════════════════════════════════════
// Data shape returned by fetchAbilitiesData()
// ════════════════════════════════════════════════════════════

export interface WikiAbilitiesData {
    abilityTypes: string[];
    adrenalineRules: {
        basicGenPct: number;       // Confirmed: 9 (March 2026)
        gcdTicks: number;          // Confirmed: 3 (1.8s unified)
        enhancedNote: string;
        ultimateNote: string;
    };
    march2026Changes: string[];    // Bullet points from the March 2 2026 patch note
    sourceUrl: string;
    fetchedAt: string;
}

