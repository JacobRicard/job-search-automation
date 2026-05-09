#!/usr/bin/env node
'use strict';

/**
 * Resolve pasted company names to Greenhouse board slugs with Gemini, verify
 * each candidate against the Greenhouse boards API, and optionally append
 * verified slugs to the active profile's suggested-companies.json.
 */

const fs = require('fs');
const path = require('path');

const { loadDashboardEnv } = require('../lib/env');

const repoRoot = path.resolve(__dirname, '..');
loadDashboardEnv(repoRoot);

const { GREENHOUSE_COMPANIES } = require('../config/companies');
const { callGemini } = require('../lib/gemini');
const { parseGeminiJsonArray } = require('../lib/ats-resolver');
const { loadSuggested, saveSuggested } = require('../lib/suggested-companies');
const createLogger = require('../lib/logger');
const logPaths = require('../lib/log-paths');

const BOARD_TIMEOUT = 10_000;
const DEFAULT_BATCH_SIZE = 40;
const DEFAULT_CONCURRENCY = 8;

const log = createLogger('resolve-greenhouse-slugs', { logFile: logPaths.daily('resolve-greenhouse-slugs') });

const profileDir = process.env.JOB_PROFILE_DIR
  ? path.resolve(repoRoot, process.env.JOB_PROFILE_DIR)
  : path.join(repoRoot, 'profiles', 'example');

function usage() {
  return `Usage:
  node scripts/resolve-greenhouse-slugs.js [--add] [--active-only] [--file=names.txt]

Reads company names from --file or stdin, one company per line.

Options:
  --add          Append verified slugs to active profile suggested-companies.json
  --active-only Only count Greenhouse boards with at least one posted job
  --file=PATH   Read names from a file instead of stdin
`;
}

function parseArgs(argv = process.argv.slice(2)) {
  const flags = {
    add: false,
    activeOnly: false,
    file: null,
    batchSize: DEFAULT_BATCH_SIZE,
    concurrency: DEFAULT_CONCURRENCY,
  };

  for (const arg of argv) {
    if (arg === '--add') flags.add = true;
    else if (arg === '--active-only') flags.activeOnly = true;
    else if (arg === '--help' || arg === '-h') flags.help = true;
    else if (arg.startsWith('--file=')) flags.file = arg.slice('--file='.length);
    else if (arg.startsWith('--batch-size=')) flags.batchSize = parsePositiveInteger(arg.slice('--batch-size='.length), DEFAULT_BATCH_SIZE);
    else if (arg.startsWith('--concurrency=')) flags.concurrency = parsePositiveInteger(arg.slice('--concurrency='.length), DEFAULT_CONCURRENCY);
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return flags;
}

function parsePositiveInteger(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function cleanInputLine(line) {
  return String(line || '')
    .replace(/^\s*[-*]\s+/, '')
    .replace(/^\s*\d+[.)]\s+/, '')
    .trim();
}

function parseCompanyNames(text) {
  const seen = new Set();
  const names = [];

  for (const line of String(text || '').split(/\r?\n/)) {
    const name = cleanInputLine(line);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }

  return names;
}

function normalizeSlug(value) {
  return String(value || '')
    .trim()
    .replace(/^https?:\/\/(?:boards|job-boards)\.greenhouse\.io\/(?:embed\/)?(?:job_board\?for=)?/i, '')
    .replace(/^https?:\/\/boards-api\.greenhouse\.io\/v1\/boards\//i, '')
    .split(/[/?#]/)[0]
    .toLowerCase();
}

function isPlausibleGreenhouseSlug(value) {
  return /^[a-z0-9][a-z0-9._-]{1,100}$/i.test(String(value || ''));
}

function slugBase(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/®/g, '')
    .replace(/\+/g, ' plus ')
    .replace(/[']/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(inc|incorporated|llc|llp|ltd|limited|co|corp|corporation|company)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function fallbackSlugVariants(name) {
  const raw = slugBase(name);
  const tokens = raw.split(/\s+/).filter(Boolean);
  const compact = tokens.join('');
  const hyphen = tokens.join('-');
  const variants = new Set([compact, hyphen]);

  if (tokens.length > 1 && tokens[tokens.length - 1] === 'us') {
    variants.add(tokens.slice(0, -1).join(''));
    variants.add(tokens.slice(0, -1).join('-'));
  }

  return [...variants].filter(isPlausibleGreenhouseSlug);
}

function extractCandidateSlugs(entry) {
  const raw = [];
  if (entry?.slug) raw.push(entry.slug);
  if (Array.isArray(entry?.slugs)) raw.push(...entry.slugs);
  if (Array.isArray(entry?.candidates)) raw.push(...entry.candidates.map((c) => c?.slug || c));

  const seen = new Set();
  const slugs = [];
  for (const item of raw) {
    const slug = normalizeSlug(item);
    if (!slug || !isPlausibleGreenhouseSlug(slug) || seen.has(slug)) continue;
    seen.add(slug);
    slugs.push(slug);
  }
  return slugs;
}

function buildPrompt(names, existingSlugs = new Set()) {
  const excludeList = [...existingSlugs].slice(0, 400).join(', ');
  return `You are resolving company names to public Greenhouse job board slugs.

Return strict JSON only, no markdown:
[{"name":"Exact input company name","slugs":["best-greenhouse-board-slug","alternate-slug"],"reason":"short reason or empty if unknown"}]

Input company names:
${names.map((name) => `- ${name}`).join('\n')}

Already tracked Greenhouse slugs, do not return these:
${excludeList}

Rules:
- Only return Greenhouse board tokens, the part in https://boards.greenhouse.io/<slug> or https://job-boards.greenhouse.io/<slug>.
- Include at most 3 slugs per input name, ordered best first.
- If you are unsure or the company probably does not use Greenhouse, return an empty slugs array for that company.
- Preserve each input name exactly in the "name" field.
- Return one object per input company.`;
}

function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

async function mapConcurrent(items, limit, fn) {
  const results = [];
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const current = idx++;
      results[current] = await fn(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function checkGreenhouse(slug) {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(BOARD_TIMEOUT),
    });
    const text = await res.text();
    if (!res.ok) {
      const result = (res.status === 404 || res.status === 422) ? 'broken'
        : (res.status === 403 || res.status === 429) ? 'blocked'
          : 'transient';
      return { slug, result, status: res.status, count: 0, url };
    }

    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      return { slug, result: 'transient', status: res.status, count: 0, url, note: 'invalid JSON' };
    }

    const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
    return { slug, result: jobs.length > 0 ? 'ok' : 'empty', status: res.status, count: jobs.length, url };
  } catch (err) {
    return { slug, result: 'transient', status: 0, count: 0, url, note: err.message };
  }
}

async function resolveNamesWithGemini(names, existingSlugs, batchSize = DEFAULT_BATCH_SIZE) {
  const resolved = [];

  for (const group of chunk(names, batchSize)) {
    const maxTokens = Math.max(2000, group.length * 100);
    log.info('Calling Gemini for Greenhouse slugs', { count: group.length, maxTokens });
    const raw = await callGemini(buildPrompt(group, existingSlugs), undefined, maxTokens);
    resolved.push(...parseGeminiJsonArray(raw));
  }

  return resolved;
}

function collectCandidates(names, geminiRows, existingSlugs = new Set()) {
  const byName = new Map(geminiRows.map((row) => [String(row?.name || '').trim().toLowerCase(), row]));
  const existing = new Set([...existingSlugs].map((slug) => String(slug).toLowerCase()));

  return names.map((name) => {
    const fromGemini = extractCandidateSlugs(byName.get(name.toLowerCase()));
    const allCandidates = [...new Set([...fromGemini, ...fallbackSlugVariants(name)])];
    return {
      name,
      candidates: allCandidates.filter((slug) => !existing.has(slug)),
      alreadyTracked: allCandidates.filter((slug) => existing.has(slug)),
    };
  });
}

async function verifyCandidates(candidateRows, { concurrency = DEFAULT_CONCURRENCY, activeOnly = false } = {}) {
  const tasks = [];
  for (const row of candidateRows) {
    for (const slug of row.candidates) tasks.push({ name: row.name, slug });
  }

  const checked = await mapConcurrent(tasks, concurrency, async (task) => ({
    ...task,
    ...(await checkGreenhouse(task.slug)),
  }));

  const firstVerifiedByName = new Map();
  const failuresByName = new Map();
  for (const result of checked) {
    const verified = activeOnly ? result.result === 'ok' : (result.result === 'ok' || result.result === 'empty');
    if (verified && !firstVerifiedByName.has(result.name)) {
      firstVerifiedByName.set(result.name, result);
    } else if (!verified) {
      if (!failuresByName.has(result.name)) failuresByName.set(result.name, []);
      failuresByName.get(result.name).push(result);
    }
  }

  return candidateRows.map((row) => ({
    name: row.name,
    verified: firstVerifiedByName.get(row.name) || null,
    failed: failuresByName.get(row.name) || [],
    candidates: row.candidates,
    alreadyTracked: row.alreadyTracked || [],
  }));
}

function appendVerifiedSlugs(suggested, rows) {
  const existing = new Set((suggested.greenhouse || []).map((slug) => String(slug).toLowerCase()));
  let added = 0;

  for (const row of rows) {
    const slug = row.verified?.slug;
    if (!slug || existing.has(slug)) continue;
    suggested.greenhouse.push(slug);
    existing.add(slug);
    added += 1;
  }

  if (added > 0) suggested.updatedAt = new Date().toISOString();
  return added;
}

function printSummary(rows, { added = 0, add = false } = {}) {
  const verified = rows.filter((row) => row.verified);
  const alreadyTracked = rows.filter((row) => !row.verified && row.alreadyTracked?.length);
  const unresolved = rows.filter((row) => !row.verified && !row.alreadyTracked?.length);

  console.log(`Verified Greenhouse boards: ${verified.length}`);
  for (const row of verified) {
    const status = row.verified.result === 'empty' ? 'valid, 0 jobs' : `${row.verified.count} jobs`;
    console.log(`  ${row.name} -> ${row.verified.slug} (${status})`);
  }

  if (alreadyTracked.length > 0) {
    console.log(`\nAlready tracked: ${alreadyTracked.length}`);
    for (const row of alreadyTracked) {
      console.log(`  ${row.name} (${row.alreadyTracked.join(', ')})`);
    }
  }

  if (unresolved.length > 0) {
    console.log(`\nUnresolved: ${unresolved.length}`);
    for (const row of unresolved) {
      const tried = row.candidates.length ? row.candidates.join(', ') : 'no candidate slugs';
      console.log(`  ${row.name} (${tried})`);
    }
  }

  console.log(add ? `\nAdded to suggested-companies.json: ${added}` : '\nDry run only; pass --add to write verified slugs.');
}

function readInput(flags) {
  if (flags.file) return fs.readFileSync(path.resolve(flags.file), 'utf8');
  return fs.readFileSync(0, 'utf8');
}

async function main() {
  const flags = parseArgs();
  if (flags.help) {
    console.log(usage());
    return;
  }
  if (!process.env.GEMINI_API_KEY) {
    log.warn('GEMINI_API_KEY not set - cannot resolve pasted companies');
    process.exit(0);
  }

  const names = parseCompanyNames(readInput(flags));
  if (names.length === 0) {
    console.error('No company names provided.');
    process.exit(1);
  }

  const suggested = loadSuggested(profileDir);
  const existingSlugs = new Set([
    ...(GREENHOUSE_COMPANIES || []),
    ...(suggested.greenhouse || []),
  ].map((slug) => String(slug).toLowerCase()));

  log.info('Resolving pasted Greenhouse companies', {
    count: names.length,
    existingGreenhouse: existingSlugs.size,
    profileDir,
    add: flags.add,
    activeOnly: flags.activeOnly,
  });

  const geminiRows = await resolveNamesWithGemini(names, existingSlugs, flags.batchSize);
  const candidateRows = collectCandidates(names, geminiRows, existingSlugs);
  const rows = await verifyCandidates(candidateRows, {
    concurrency: flags.concurrency,
    activeOnly: flags.activeOnly,
  });

  let added = 0;
  if (flags.add) {
    added = appendVerifiedSlugs(suggested, rows);
    saveSuggested(profileDir, suggested);
  }

  printSummary(rows, { added, add: flags.add });
}

if (require.main === module) {
  main().catch((err) => {
    log.error('Greenhouse slug resolution failed', { error: err.message, stack: err.stack });
    process.exit(1);
  });
}

module.exports = {
  buildPrompt,
  collectCandidates,
  fallbackSlugVariants,
  isPlausibleGreenhouseSlug,
  normalizeSlug,
  parseArgs,
  parseCompanyNames,
};
