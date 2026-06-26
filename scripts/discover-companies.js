#!/usr/bin/env node
'use strict';

/**
 * Uses Claude CLI to suggest companies based on the user's profile, verifies
 * each company has an active ATS board, then appends verified companies to
 * data/suggested-companies.json so they're scraped on the next run.
 */

const fs   = require('fs');
const path = require('path');

const { loadDashboardEnv } = require('../lib/env');

const repoRoot = path.resolve(__dirname, '..');
loadDashboardEnv(repoRoot);

const { SEARCH_TERMS, GREENHOUSE_COMPANIES, ASHBY_COMPANIES, LEVER_COMPANIES, WORKDAY_COMPANIES } = require('../config/companies');
const { callLLMJson }                  = require('../lib/claude-llm');
const { parseGeminiJsonArray }              = require('../lib/ats-resolver');
const { loadSuggested, saveSuggested, allSlugs } = require('../lib/suggested-companies');
const createLogger                     = require('../lib/logger');
const logPaths                         = require('../lib/log-paths');

const CONCURRENCY   = 5;
const BOARD_TIMEOUT = 10_000;
const DEFAULT_DISCOVER_TTL_HOURS = 6;
const DEFAULT_DISCOVER_CANDIDATE_COUNT = 50;
const MIN_DISCOVER_OUTPUT_TOKENS = 2000;
const BOOTSTRAP_THRESHOLD = 20;
const BOOTSTRAP_PASSES = 6;

const { baseDir: profileDir } = require('../config/paths');

const log = createLogger('discover-companies', { logFile: logPaths.daily('discover-companies') });

// ---------------------------------------------------------------------------
// Runtime configuration
// ---------------------------------------------------------------------------

function parseNonNegativeNumber(value, fallback) {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function parsePositiveInteger(value, fallback) {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function getDiscoveryConfig(env = process.env) {
  const ttlHours = parseNonNegativeNumber(env.DISCOVER_TTL_HOURS, DEFAULT_DISCOVER_TTL_HOURS);
  const candidateCount = parsePositiveInteger(env.DISCOVER_CANDIDATE_COUNT, DEFAULT_DISCOVER_CANDIDATE_COUNT);
  return {
    ttlHours,
    ttlMs: ttlHours * 60 * 60 * 1000,
    candidateCount,
  };
}

function getDiscoveryCacheState(updatedAt, ttlMs, nowMs = Date.now()) {
  const updatedMs = Date.parse(updatedAt || '');
  if (!updatedAt || Number.isNaN(updatedMs) || ttlMs <= 0) {
    return { fresh: false, ageHours: null, nextEligibleAt: null };
  }

  const ageMs = nowMs - updatedMs;
  return {
    fresh: ageMs < ttlMs,
    ageHours: Number((ageMs / 3_600_000).toFixed(1)),
    nextEligibleAt: new Date(updatedMs + ttlMs).toISOString(),
  };
}

function nextEligibleAt(updatedAt, ttlMs) {
  const updatedMs = Date.parse(updatedAt || '');
  if (!updatedAt || Number.isNaN(updatedMs) || ttlMs <= 0) return null;
  return new Date(updatedMs + ttlMs).toISOString();
}

function getDiscoveryMaxOutputTokens(candidateCount) {
  return Math.max(MIN_DISCOVER_OUTPUT_TOKENS, candidateCount * 90);
}

// ---------------------------------------------------------------------------
// Board existence check
// ---------------------------------------------------------------------------

async function boardExists(platform, slug) {
  const urls = {
    greenhouse: `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`,
    ashby:      `https://api.ashbyhq.com/posting-api/job-board/${slug}`,
    lever:      `https://api.lever.co/v0/postings/${slug}?mode=json`,
  };
  const url = urls[platform.toLowerCase()];
  if (!url) return false;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(BOARD_TIMEOUT),
    });
    // Board exists = slug is valid; active jobs are not required (they'll be scraped each refresh)
    return res.ok;
  } catch {
    return false;
  }
}

// Resolves a Workday subdomain to a full {sub, wd, board, label} entry by
// probing wd1..wd5 and parsing the board from the redirect URL.
async function resolveWorkdayBoard(sub, label) {
  for (let wd = 1; wd <= 5; wd++) {
    const url = `https://${sub}.wd${wd}.myworkdayjobs.com/`;
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        redirect: 'follow',
        signal: AbortSignal.timeout(BOARD_TIMEOUT),
      });
      if (!res.ok) continue;
      const finalUrl = res.url || '';
      const m = finalUrl.match(/\/[a-z]{2}-[A-Z]{2}\/([^/?#]+)/);
      if (m && m[1]) {
        return { sub, wd, board: m[1], label: label || sub };
      }
    } catch {
      // try next wd cluster
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Concurrency helper
// ---------------------------------------------------------------------------

async function mapConcurrent(items, limit, fn) {
  const results = [];
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ---------------------------------------------------------------------------
// Gemini prompt
// ---------------------------------------------------------------------------

function isTechProfile(contextSnippet) {
  if (!contextSnippet) return true;
  const m = contextSnippet.match(/##\s*Industry\s*\n+([^\n]+)/i);
  if (!m) return true;
  return m[1].trim().toLowerCase() === 'tech';
}

function buildPrompt(existingSlugs, contextSnippet, candidateCount = DEFAULT_DISCOVER_CANDIDATE_COUNT) {
  const excludeList = [...existingSlugs].slice(0, 300).join(', ');
  const contextSection = contextSnippet
    ? 'Job seeker context:\n' + contextSnippet + '\n\n'
    : '';
  const allowWorkday = !isTechProfile(contextSnippet);
  const platformsLabel = allowWorkday ? 'Greenhouse|Ashby|Lever|Workday' : 'Greenhouse|Ashby|Lever';
  const platformRule = allowWorkday
    ? '- Only use Greenhouse, Ashby, Lever, or Workday as the platform (these have public APIs)\n'
      + '- For Greenhouse/Ashby/Lever: "slug" is the company\'s ATS board token (e.g. "stripe", "cloudflare", "linear")\n'
      + '- For Workday: "slug" is the Workday tenant subdomain (e.g. "goldmansachs", "jpmc" — the part before .wdN.myworkdayjobs.com)\n'
      + '- Prefer Workday for large banks, asset managers, insurers, and Fortune 500 enterprises\n'
    : '- Only use Greenhouse, Ashby, or Lever as the platform (these have public APIs)\n'
      + '- "slug" is the company\'s ATS board token (e.g. "stripe", "cloudflare", "linear")\n';
  return 'You are helping a job seeker find companies that are actively hiring.\n\n'
    + contextSection
    + 'I already track these company board slugs (do NOT suggest any of them):\n'
    + excludeList + '\n\n'
    + 'Suggest ' + candidateCount + ' NEW companies likely to have open roles matching these search terms:\n'
    + SEARCH_TERMS.join(', ') + '\n\n'
    + 'Return strict JSON only — no markdown, no explanation:\n'
    + '[{"name":"Company Name","platform":"' + platformsLabel + '","slug":"board-slug","rationale":"1 sentence"}]\n\n'
    + 'Rules:\n'
    + platformRule
    + '- Focus on companies likely to have open roles matching the search terms above\n'
    + '- No consulting firms, staffing agencies, or companies that only hire through LinkedIn/Indeed\n'
    + '- Return exactly ' + candidateCount + ' candidates';
}

// ---------------------------------------------------------------------------
// Single discovery pass
// ---------------------------------------------------------------------------

async function runDiscoveryPass(suggested, staticSlugs, contextSnippet, candidateCount, t) {
  const suggestedSlugSet = allSlugs(suggested);
  const allTracked = new Set([...staticSlugs, ...suggestedSlugSet]);

  let candidates;
  try {
    const result = await callLLMJson(buildPrompt(allTracked, contextSnippet, candidateCount));
    const arr = Array.isArray(result) ? result : (Array.isArray(result?.candidates) ? result.candidates : []);
    candidates = arr.filter((c) => c && typeof c === 'object' && c.slug && c.platform);
  } catch (err) {
    log.error('Claude discovery call failed', { error: err.message });
    return 0;
  }
  log.info('Claude returned candidates', { count: candidates.length });

  const novel = candidates.filter((c) => !allTracked.has(c.slug.toLowerCase()));
  log.info('Novel candidates after dedup', { count: novel.length });

  if (novel.length === 0) {
    log.info('No new company candidates — nothing to verify');
    return 0;
  }

  const verifyResults = await mapConcurrent(novel, CONCURRENCY, async (c) => {
    const slug = c.slug.toLowerCase();
    const platform = c.platform.toLowerCase();
    if (platform === 'workday') {
      const entry = await resolveWorkdayBoard(slug, c.name);
      log.debug('Workday board check', { slug, resolved: !!entry, wd: entry?.wd, board: entry?.board });
      return { ...c, slug, platform, exists: !!entry, workdayEntry: entry };
    }
    const exists = await boardExists(platform, slug);
    log.debug('Board check', { slug, platform, exists });
    return { ...c, slug, platform, exists };
  });

  const verified = verifyResults.filter((c) => c.exists);
  const failed   = verifyResults.filter((c) => !c.exists);

  log.info('Board verification complete', { verified: verified.length, failed: failed.length, ms: t() });

  if (failed.length > 0) {
    log.debug('Boards not found', { slugs: failed.map((c) => c.platform + ':' + c.slug) });
  }

  const workdaySubs = new Set((suggested.workday || []).map(e => e && e.sub).filter(Boolean));
  for (const c of verified) {
    if (c.platform === 'greenhouse' && !suggested.greenhouse.includes(c.slug)) {
      suggested.greenhouse.push(c.slug);
      log.info('Added to Greenhouse list', { slug: c.slug, name: c.name, rationale: c.rationale });
    } else if (c.platform === 'ashby' && !suggested.ashby.includes(c.slug)) {
      suggested.ashby.push(c.slug);
      log.info('Added to Ashby list', { slug: c.slug, name: c.name, rationale: c.rationale });
    } else if (c.platform === 'lever' && !suggested.lever.includes(c.slug)) {
      suggested.lever.push(c.slug);
      log.info('Added to Lever list', { slug: c.slug, name: c.name, rationale: c.rationale });
    } else if (c.platform === 'workday' && c.workdayEntry && !workdaySubs.has(c.workdayEntry.sub)) {
      suggested.workday = suggested.workday || [];
      suggested.workday.push(c.workdayEntry);
      workdaySubs.add(c.workdayEntry.sub);
      log.info('Added to Workday list', { sub: c.workdayEntry.sub, wd: c.workdayEntry.wd, board: c.workdayEntry.board, name: c.name, rationale: c.rationale });
    }
  }

  return verified.length;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Claude CLI is always available in this environment; no API key check needed.

  const t = log.timer();
  const discoveryConfig = getDiscoveryConfig();

  const staticSlugs = new Set([
    ...GREENHOUSE_COMPANIES,
    ...ASHBY_COMPANIES,
    ...LEVER_COMPANIES,
    ...((WORKDAY_COMPANIES || []).map(e => e && e.sub).filter(Boolean)),
  ]);

  const suggested = loadSuggested(profileDir);
  const suggestedSlugSet = allSlugs(suggested);

  log.info('Loaded tracked companies', {
    static: staticSlugs.size,
    suggested: suggestedSlugSet.size,
    total: staticSlugs.size + suggestedSlugSet.size,
    ttlHours: discoveryConfig.ttlHours,
    candidateCount: discoveryConfig.candidateCount,
  });

  // Bootstrap mode: when the suggested list is nearly empty (fresh install),
  // run multiple passes to quickly seed companies from the user's profile.
  const isBootstrap = suggestedSlugSet.size < BOOTSTRAP_THRESHOLD;

  if (!isBootstrap) {
    // Normal mode: skip if discovery ran recently.
    const cacheState = getDiscoveryCacheState(suggested.updatedAt, discoveryConfig.ttlMs);
    if (cacheState.fresh) {
      log.info('Discovery cache fresh, skipping', {
        ageHours: cacheState.ageHours,
        ttlHours: discoveryConfig.ttlHours,
        nextEligibleAt: cacheState.nextEligibleAt,
      });
      process.exit(0);
    }
  }

  // Load context snippet from profile
  let contextSnippet = '';
  try {
    const contextPath = path.join(profileDir, 'context.md');
    contextSnippet = fs.readFileSync(contextPath, 'utf8').slice(0, 800).trim();
  } catch {
    log.debug('No context.md found in profile dir — continuing without it');
  }

  const passes = isBootstrap ? BOOTSTRAP_PASSES : 1;
  if (isBootstrap) {
    log.info('Bootstrap mode: running multiple discovery passes to seed initial company list', {
      passes,
      reason: 'only ' + suggestedSlugSet.size + ' companies found so far (threshold: ' + BOOTSTRAP_THRESHOLD + ')',
    });
  }

  let totalAdded = 0;
  for (let i = 0; i < passes; i++) {
    if (passes > 1) log.info('Discovery pass ' + (i + 1) + ' of ' + passes);
    const added = await runDiscoveryPass(suggested, staticSlugs, contextSnippet, discoveryConfig.candidateCount, t);
    totalAdded += added;
  }

  suggested.updatedAt = new Date().toISOString();
  saveSuggested(profileDir, suggested);

  log.info('Discovery complete', {
    added: totalAdded,
    totalSuggested: allSlugs(suggested).size,
    nextEligibleAt: nextEligibleAt(suggested.updatedAt, discoveryConfig.ttlMs),
    ms: t(),
  });
}

if (require.main === module) {
  main().catch((err) => {
    log.error('Unexpected error', { error: err.message, stack: err.stack });
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_DISCOVER_TTL_HOURS,
  DEFAULT_DISCOVER_CANDIDATE_COUNT,
  BOOTSTRAP_THRESHOLD,
  BOOTSTRAP_PASSES,
  buildPrompt,
  getDiscoveryConfig,
  getDiscoveryCacheState,
  getDiscoveryMaxOutputTokens,
  nextEligibleAt,
};
