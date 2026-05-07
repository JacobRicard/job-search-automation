#!/usr/bin/env node
'use strict';

/**
 * Uses Gemini to suggest new tech companies in the DevOps/SRE space, verifies
 * each company has an active ATS board, then appends verified companies to
 * profiles/<active>/suggested-companies.json so they're scraped on the next run.
 */

const fs   = require('fs');
const path = require('path');

const { loadDashboardEnv } = require('../lib/env');

const repoRoot = path.resolve(__dirname, '..');
loadDashboardEnv(repoRoot);

const { SEARCH_TERMS, GREENHOUSE_COMPANIES, ASHBY_COMPANIES, LEVER_COMPANIES } = require('../config/companies');
const { callGemini }                   = require('../lib/gemini');
const { parseGeminiJsonArray }              = require('../lib/ats-resolver');
const { loadSuggested, saveSuggested, allSlugs } = require('../lib/suggested-companies');
const createLogger                     = require('../lib/logger');
const logPaths                         = require('../lib/log-paths');

const CONCURRENCY   = 5;
const BOARD_TIMEOUT = 10_000;
const DEFAULT_DISCOVER_TTL_HOURS = 6;
const DEFAULT_DISCOVER_CANDIDATE_COUNT = 50;
const MIN_DISCOVER_OUTPUT_TOKENS = 2000;

const profileDir = process.env.JOB_PROFILE_DIR
  ? path.resolve(repoRoot, process.env.JOB_PROFILE_DIR)
  : path.join(repoRoot, 'profiles', 'example');

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
    if (!res.ok) return false;
    const data = await res.json();
    const jobs = data?.jobs ?? (Array.isArray(data) ? data : []);
    return jobs.length > 0;
  } catch {
    return false;
  }
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

function buildPrompt(existingSlugs, contextSnippet, candidateCount = DEFAULT_DISCOVER_CANDIDATE_COUNT) {
  const excludeList = [...existingSlugs].slice(0, 300).join(', ');
  return `You are helping find tech companies that hire DevOps/SRE/Platform/Infrastructure engineers.

Job seeker context:
${contextSnippet}

I already track these company board slugs (do NOT suggest any of them):
${excludeList}

Suggest ${candidateCount} NEW companies that are likely to be hiring engineers with these keywords:
${SEARCH_TERMS.join(', ')}

Return strict JSON only — no markdown, no explanation:
[{"name":"Company Name","platform":"Greenhouse|Ashby|Lever","slug":"board-slug","rationale":"1 sentence"}]

Rules:
- Only use Greenhouse, Ashby, or Lever as the platform (these have public APIs)
- "slug" is the company's ATS board token (e.g. "stripe", "cloudflare", "hashicorp")
- Focus on: YC-backed, Series B+, cloud-native infra, fintech, AI infra, dev tooling, security
- No consulting firms, staffing agencies, or companies that only hire through LinkedIn/Indeed
- Return exactly ${candidateCount} candidates`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!process.env.GEMINI_API_KEY) {
    log.warn('GEMINI_API_KEY not set — skipping company discovery');
    process.exit(0);
  }

  const t = log.timer();
  const discoveryConfig = getDiscoveryConfig();

  // Build full set of already-tracked slugs
  const staticSlugs = new Set([
    ...GREENHOUSE_COMPANIES,
    ...ASHBY_COMPANIES,
    ...LEVER_COMPANIES,
  ]);

  const suggested = loadSuggested(profileDir);
  const suggestedSlugSet = allSlugs(suggested);
  const allTracked = new Set([...staticSlugs, ...suggestedSlugSet]);

  log.info('Loaded tracked companies', {
    static: staticSlugs.size,
    suggested: suggestedSlugSet.size,
    total: allTracked.size,
    ttlHours: discoveryConfig.ttlHours,
    candidateCount: discoveryConfig.candidateCount,
  });

  // Skip if discovery ran recently. DISCOVER_TTL_HOURS=0 forces every refresh to try.
  const cacheState = getDiscoveryCacheState(suggested.updatedAt, discoveryConfig.ttlMs);
  if (cacheState.fresh) {
    log.info('Discovery cache fresh, skipping', {
      ageHours: cacheState.ageHours,
      ttlHours: discoveryConfig.ttlHours,
      nextEligibleAt: cacheState.nextEligibleAt,
    });
    process.exit(0);
  }

  // Load context snippet from profile
  let contextSnippet = '';
  try {
    const contextPath = path.join(profileDir, 'context.md');
    contextSnippet = fs.readFileSync(contextPath, 'utf8').slice(0, 800).trim();
  } catch {
    log.debug('No context.md found in profile dir — continuing without it');
  }

  const maxOutputTokens = getDiscoveryMaxOutputTokens(discoveryConfig.candidateCount);
  log.info('Calling Gemini for company suggestions', {
    candidateCount: discoveryConfig.candidateCount,
    maxOutputTokens,
  });
  let raw;
  try {
    raw = await callGemini(buildPrompt(allTracked, contextSnippet, discoveryConfig.candidateCount), undefined, maxOutputTokens);
  } catch (err) {
    log.error('Gemini call failed', { error: err.message });
    process.exit(0);
  }

  const candidates = parseGeminiJsonArray(raw).filter(
    (c) => c && typeof c === 'object' && c.slug && c.platform,
  );
  log.info('Gemini returned candidates', { count: candidates.length });

  // Filter already-tracked slugs
  const novel = candidates.filter((c) => !allTracked.has(c.slug.toLowerCase()));
  log.info('Novel candidates after dedup', { count: novel.length });

  if (novel.length === 0) {
    suggested.updatedAt = new Date().toISOString();
    saveSuggested(profileDir, suggested);
    log.info('No new company candidates — nothing to verify', {
      nextEligibleAt: nextEligibleAt(suggested.updatedAt, discoveryConfig.ttlMs),
      totalSuggested: allSlugs(suggested).size,
    });
    process.exit(0);
  }

  // Verify boards in parallel
  const verifyResults = await mapConcurrent(novel, CONCURRENCY, async (c) => {
    const slug = c.slug.toLowerCase();
    const platform = c.platform.toLowerCase();
    const exists = await boardExists(platform, slug);
    log.debug('Board check', { slug, platform, exists });
    return { ...c, slug, platform, exists };
  });

  const verified = verifyResults.filter((c) => c.exists);
  const failed   = verifyResults.filter((c) => !c.exists);

  log.info('Board verification complete', {
    verified: verified.length,
    failed: failed.length,
    ms: t(),
  });

  if (failed.length > 0) {
    log.debug('Boards not found', { slugs: failed.map((c) => `${c.platform}:${c.slug}`) });
  }

  if (verified.length === 0) {
    suggested.updatedAt = new Date().toISOString();
    saveSuggested(profileDir, suggested);
    log.info('No verified boards — suggested-companies.json unchanged', {
      nextEligibleAt: nextEligibleAt(suggested.updatedAt, discoveryConfig.ttlMs),
      totalSuggested: allSlugs(suggested).size,
    });
    process.exit(0);
  }

  // Append to suggested-companies.json
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
    }
  }

  suggested.updatedAt = new Date().toISOString();
  saveSuggested(profileDir, suggested);

  log.info('Discovery complete', {
    added: verified.length,
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
  buildPrompt,
  getDiscoveryConfig,
  getDiscoveryCacheState,
  getDiscoveryMaxOutputTokens,
  nextEligibleAt,
};
