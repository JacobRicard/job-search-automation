'use strict';

const fs = require('fs');
const path = require('path');

const { updateEnvLine } = require('./setup-routes');
const { baseDir: profileDir } = require('../config/paths');

const ENV_PATH = path.join(__dirname, '..', '.env');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve({}); } });
    req.on('error', reject);
  });
}

function ok(res, data = { ok: true }) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function err(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: message }));
}

function readCompanies() {
  const filePath = path.join(profileDir, 'companies.js');
  try {
    try { delete require.cache[require.resolve(filePath)]; } catch {}
    return require(filePath);
  } catch { return {}; }
}

function slugsToLines(arr) {
  return (arr || []).filter((s) => typeof s === 'string').join('\n');
}

function linesToSlugs(text) {
  return (text || '').split('\n').map((s) => s.trim()).filter(Boolean);
}

function buildCompaniesJs({ searchTerms, greenhouse, lever, ashby, workable, wellfound, workday, rippling, maxAgeDays }) {
  const toSlugBlock = (arr) =>
    (arr || []).filter((s) => typeof s === 'string' && s.trim())
      .map((s) => `  '${s.replace(/'/g, "\\'")}'`).join(',\n');

  const workdayBlock = (arr) =>
    (arr || []).filter((e) => e && typeof e === 'object')
      .map((e) => `  ${JSON.stringify(e)}`).join(',\n');

  const termsBlock = (arr) =>
    (arr || []).filter(Boolean)
      .map((s) => `  '${String(s).replace(/'/g, "\\'")}'`).join(',\n');

  const maxAge = typeof maxAgeDays === 'number' && maxAgeDays > 0 ? maxAgeDays : 20;

  return `'use strict';

const MAX_AGE_DAYS = ${maxAge};

const SEARCH_TERMS = [
${termsBlock(searchTerms)}
];

const GREENHOUSE_COMPANIES = [
${toSlugBlock(greenhouse)}
];

const LEVER_COMPANIES = [
${toSlugBlock(lever)}
];

const WORKABLE_COMPANIES = [
${toSlugBlock(workable)}
];

const ASHBY_COMPANIES = [
${toSlugBlock(ashby)}
];

const WORKDAY_COMPANIES = [
${workdayBlock(workday)}
];

const WELLFOUND_ROLES = [
${toSlugBlock(wellfound)}
];

const RIPPLING_COMPANIES = [
${toSlugBlock(rippling)}
];

module.exports = {
  MAX_AGE_DAYS,
  SEARCH_TERMS,
  GREENHOUSE_COMPANIES,
  LEVER_COMPANIES,
  WORKABLE_COMPANIES,
  ASHBY_COMPANIES,
  WORKDAY_COMPANIES,
  WELLFOUND_ROLES,
  RIPPLING_COMPANIES,
};
`;
}

// ---------------------------------------------------------------------------
// ENV keys exposed to the settings UI
// ---------------------------------------------------------------------------

const ENV_KEYS = [
  'GROQ_API_KEY', 'GEMINI_API_KEY', 'SAPLING_API_KEY', 'HUGGINGFACE_API_KEY',
  'OLLAMA_HOST', 'OLLAMA_SCORE_MODEL', 'OLLAMA_FILTER_MODEL',
  'LOCATION_FILTER', 'LOCATION_BLOCKLIST', 'TITLE_BLOCKLIST', 'AUTO_ARCHIVE_THRESHOLD',
  'BUILTIN_SUBDOMAIN', 'TZ', 'GROQ_RATE_DELAY_MS', 'REFRESH_INTERVAL_MINUTES',
  'JOBSPY_ENABLED', 'JOBSPY_CONFIG_PATH',
  'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM',
  'DIGEST_TO', 'DIGEST_MIN_SCORE', 'DIGEST_MAX_JOBS', 'DIGEST_LOOKBACK_HOURS',
  'IMAP_PROVIDER', 'IMAP_EMAIL', 'IMAP_APP_PASSWORD', 'IMAP_HOST', 'IMAP_PORT',
  'GMAIL_EMAIL', 'GMAIL_APP_PASSWORD',
  'REJECTION_EMAIL_SYNC_DISABLED', 'REJECTION_EMAIL_POLL_INTERVAL_MS',
  'DASHBOARD_PORT',
];

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async function handleGetSettings(req, res) {
  try {
    const companies = readCompanies();

    const jobspyPath = path.join(profileDir, 'jobspy-config.json');
    let jobspy = {};
    try { jobspy = JSON.parse(fs.readFileSync(jobspyPath, 'utf8')); } catch {}

    const contextPath = path.join(profileDir, 'context.md');
    let context = '';
    try { context = fs.readFileSync(contextPath, 'utf8'); } catch {}

    const env = {};
    for (const key of ENV_KEYS) env[key] = process.env[key] || '';

    ok(res, { env, companies, jobspy, context });
  } catch (e) {
    err(res, 500, e.message);
  }
}

async function handleSaveEnv(req, res) {
  try {
    const body = await readBody(req);
    for (const [key, value] of Object.entries(body)) {
      if (typeof value !== 'string') continue;
      updateEnvLine(key, value, ENV_PATH);
      if (value.trim()) process.env[key] = value.trim();
      else delete process.env[key];
    }
    ok(res);
  } catch (e) {
    err(res, 500, e.message);
  }
}

async function handleSaveCompanies(req, res) {
  try {
    const body = await readBody(req);
    // Workday can come as a JSON string (textarea) or already-parsed array
    let workday = body.workday;
    if (typeof workday === 'string') {
      try { workday = JSON.parse(workday); } catch { workday = []; }
    }
    const js = buildCompaniesJs({
      searchTerms: linesToSlugs(body.searchTerms),
      greenhouse:  linesToSlugs(body.greenhouse),
      lever:       linesToSlugs(body.lever),
      ashby:       linesToSlugs(body.ashby),
      workable:    linesToSlugs(body.workable),
      wellfound:   linesToSlugs(body.wellfound),
      rippling:    linesToSlugs(body.rippling),
      workday:     Array.isArray(workday) ? workday : [],
      maxAgeDays:  parseInt(body.maxAgeDays, 10) || 20,
    });
    fs.writeFileSync(path.join(profileDir, 'companies.js'), js, 'utf8');
    try { delete require.cache[require.resolve(path.join(profileDir, 'companies.js'))]; } catch {}
    ok(res);
  } catch (e) {
    err(res, 500, e.message);
  }
}

async function handleSaveJobspy(req, res) {
  try {
    const body = await readBody(req);
    // Normalise search_term — split textarea lines into array
    if (typeof body.search_term === 'string') {
      body.search_term = linesToSlugs(body.search_term);
    }
    fs.writeFileSync(path.join(profileDir, 'jobspy-config.json'), JSON.stringify(body, null, 2), 'utf8');
    ok(res);
  } catch (e) {
    err(res, 500, e.message);
  }
}

async function handleSaveContext(req, res) {
  try {
    const { content } = await readBody(req);
    fs.writeFileSync(path.join(profileDir, 'context.md'), content || '', 'utf8');
    ok(res);
  } catch (e) {
    err(res, 500, e.message);
  }
}

module.exports = {
  handleGetSettings,
  handleSaveEnv,
  handleSaveCompanies,
  handleSaveJobspy,
  handleSaveContext,
  slugsToLines,
};
