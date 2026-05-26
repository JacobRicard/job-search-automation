/**
 * dashboard.js
 * Local web dashboard for job search review.
 * Usage: node dashboard.js
 * Then open http://localhost:3131 in your browser.
 */

'use strict';

const { loadDashboardEnv } = require('./lib/env');
loadDashboardEnv(__dirname);

const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const { getDb } = require('./lib/db');
const { DASHBOARD_PORT } = require('./config/constants');
const { publicDir } = require('./config/paths');
const log = require('./lib/logger')('dashboard');
const metrics = require('./lib/metrics');
const { startRejectionEmailPoller } = require('./lib/rejection-email-sync');
const { recordStatusSnapshot } = require('./lib/dashboard-insights');
const {
  handlePipeline,
  handleMarkOutreach,
  handleArchive,
  handleResume,
  handleGetCompanyNotes,
  handleSaveCompanyNotes,
  handleJobDescription,
  handleDashboardPage,
  handleHelpPage,
  handleMarketResearch,
  handleDismissSlugBanner,
  handleTrackerApi,
  handleInsightsApi,
  handleLocationPrefsApi,
} = require('./lib/dashboard-routes');

const PORT = DASHBOARD_PORT;
const db = getDb();

// ---------------------------------------------------------------------------
// Setup API helpers
// ---------------------------------------------------------------------------

const PROFILE_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, 'data');
const ENV_PATH = path.join(__dirname, '.env');

function updateEnvLine(key, value) {
  let content = '';
  try { content = fs.readFileSync(ENV_PATH, 'utf8'); } catch (e) {}
  const escaped = value.replace(/\\/g, '\\\\');
  const line = `${key}=${escaped}`;
  const regex = new RegExp(`^${key}=.*$`, 'm');
  content = regex.test(content)
    ? content.replace(regex, line)
    : content + (content.endsWith('\n') ? '' : '\n') + line + '\n';
  fs.writeFileSync(ENV_PATH, content, 'utf8');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); } catch (e) { resolve({}); }
    });
    req.on('error', reject);
  });
}

function buildContextMd({ titles, stack, salary, location }) {
  const titleLines = (titles || '').split('\n').map(t => t.trim()).filter(Boolean).map(t => `- ${t}`).join('\n') || '- (not specified)';
  const stackLines = (stack || '').split('\n').map(s => s.trim()).filter(Boolean).map(s => `- ${s}`).join('\n') || '- (not specified)';
  const salaryLine = salary ? `- Base floor: $${salary}` : '- (not specified)';
  const locationLine = location ? location : 'Open to remote';
  return `# Working Context\n\n## What I'm looking for\n\n${locationLine}\n\n## Target titles\n\n${titleLines}\n\n## Stack I'm most productive in\n\n${stackLines}\n\n## Compensation\n\n${salaryLine}\n`;
}

function buildCompaniesJs(searchTerms) {
  let existing = null;
  try { existing = require(path.join(PROFILE_DIR, 'companies.js')); } catch (e) {}
  const terms = (searchTerms || '').split('\n').map(t => t.trim()).filter(Boolean);
  const termsList = terms.length
    ? terms.map(t => `  '${t.replace(/'/g, "\\'")}'`).join(',\n')
    : "  'backend engineer'";
  const gh  = (existing?.GREENHOUSE_COMPANIES  || []).map(s => `  '${s}'`).join(',\n');
  const lv  = (existing?.LEVER_COMPANIES        || []).map(s => `  '${s}'`).join(',\n');
  const wk  = (existing?.WORKABLE_COMPANIES     || []).map(s => `  '${s}'`).join(',\n');
  const ash = (existing?.ASHBY_COMPANIES        || []).map(s => `  '${s}'`).join(',\n');
  const wd  = (existing?.WORKDAY_COMPANIES      || []).map(s => `  '${s}'`).join(',\n');
  const wf  = (existing?.WELLFOUND_ROLES        || []).map(s => `  '${s}'`).join(',\n');
  const rp  = (existing?.RIPPLING_COMPANIES     || []).map(s => `  '${s}'`).join(',\n');
  const maxAge = existing?.MAX_AGE_DAYS ?? 20;
  return `'use strict';\n\nconst MAX_AGE_DAYS = ${maxAge};\n\nconst SEARCH_TERMS = [\n${termsList},\n];\n\nconst GREENHOUSE_COMPANIES = [\n${gh}\n];\n\nconst LEVER_COMPANIES = [\n${lv}\n];\n\nconst WORKABLE_COMPANIES = [\n${wk}\n];\n\nconst ASHBY_COMPANIES = [\n${ash}\n];\n\nconst WORKDAY_COMPANIES = [\n${wd}\n];\n\nconst WELLFOUND_ROLES = [\n${wf}\n];\n\nconst RIPPLING_COMPANIES = [\n${rp}\n];\n\nmodule.exports = {\n  MAX_AGE_DAYS,\n  SEARCH_TERMS,\n  GREENHOUSE_COMPANIES,\n  LEVER_COMPANIES,\n  WORKABLE_COMPANIES,\n  ASHBY_COMPANIES,\n  WORKDAY_COMPANIES,\n  WELLFOUND_ROLES,\n  RIPPLING_COMPANIES,\n};\n`;
}

async function handleSetupStatus(req, res) {
  const resumePath = path.join(PROFILE_DIR, 'resume.md');
  const contextPath = path.join(PROFILE_DIR, 'context.md');
  const companiesPath = path.join(PROFILE_DIR, 'companies.js');
  const resumeContent = fs.existsSync(resumePath) ? fs.readFileSync(resumePath, 'utf8') : '';
  const contextContent = fs.existsSync(contextPath) ? fs.readFileSync(contextPath, 'utf8') : '';
  const companiesContent = fs.existsSync(companiesPath) ? fs.readFileSync(companiesPath, 'utf8') : '';
  const currentKey = process.env.GEMINI_API_KEY || '';
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ resumeContent, contextContent, companiesContent, hasKey: !!currentKey }));
}

async function handleSetupResume(req, res) {
  try {
    const { content } = await readBody(req);
    if (content && content.trim()) {
      fs.writeFileSync(path.join(PROFILE_DIR, 'resume.md'), content, 'utf8');
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: e.message }));
  }
}

async function handleSetupProfile(req, res) {
  try {
    const body = await readBody(req);
    const md = buildContextMd(body);
    fs.writeFileSync(path.join(PROFILE_DIR, 'context.md'), md, 'utf8');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: e.message }));
  }
}

async function handleSetupCompanies(req, res) {
  try {
    const { searchTerms } = await readBody(req);
    const js = buildCompaniesJs(searchTerms);
    fs.writeFileSync(path.join(PROFILE_DIR, 'companies.js'), js, 'utf8');
    // Invalidate require cache so next scrape picks up the new file
    delete require.cache[require.resolve(path.join(PROFILE_DIR, 'companies.js'))];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: e.message }));
  }
}

async function handleSetupApiKey(req, res) {
  try {
    const { key } = await readBody(req);
    if (key && key.trim()) {
      const trimmed = key.trim();
      updateEnvLine('GEMINI_API_KEY', trimmed);
      process.env.GEMINI_API_KEY = trimmed;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: e.message }));
  }
}

async function handleSetupTestKey(req, res) {
  try {
    const { key } = await readBody(req);
    if (!key || !key.trim()) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'No key provided' }));
      return;
    }
    const https = require('https');
    const model = 'gemini-2.0-flash-lite';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key.trim())}`;
    const postData = JSON.stringify({ contents: [{ parts: [{ text: 'hi' }] }] });
    const result = await new Promise((resolve) => {
      const reqOpts = new URL(url);
      const options = {
        hostname: reqOpts.hostname,
        path: reqOpts.pathname + reqOpts.search,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
      };
      const r = https.request(options, (apiRes) => {
        let body = '';
        apiRes.on('data', d => { body += d; });
        apiRes.on('end', () => resolve({ status: apiRes.statusCode, body }));
      });
      r.on('error', (e) => resolve({ status: 0, error: e.message }));
      r.setTimeout(8000, () => { r.destroy(); resolve({ status: 0, error: 'timeout' }); });
      r.write(postData);
      r.end();
    });
    if (result.status === 200 || result.status === 429) {
      // 429 = rate limited but key is valid
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } else if (result.status === 400 || result.status === 401 || result.status === 403) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Key rejected by Gemini (invalid or expired)' }));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: `Gemini returned ${result.status}` }));
    }
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: e.message }));
  }
}

// ---------------------------------------------------------------------------
// Static file serving
// ---------------------------------------------------------------------------

const MIME_TYPES = {
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.pdf': 'application/pdf',
};

function clientAcceptsGzip(req) {
  return /\bgzip\b/.test(req.headers['accept-encoding'] || '');
}

function staticCacheControl(url) {
  return url.searchParams.has('v')
    ? 'public, max-age=31536000, immutable'
    : 'no-cache';
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const routes = {
  'POST /pipeline':          handlePipeline,
  'POST /mark-outreach':     handleMarkOutreach,

  'POST /archive':           handleArchive,
  'GET /resume':             handleResume,
  'GET /company-notes':      handleGetCompanyNotes,
  'POST /company-notes':     handleSaveCompanyNotes,
  'GET /job-description':    handleJobDescription,
  'POST /market-research':   handleMarketResearch,
  'POST /dismiss-slug-banner': handleDismissSlugBanner,
  'GET /api/tracker':        handleTrackerApi,
  'GET /api/insights':       handleInsightsApi,
  'GET /api/location-prefs': handleLocationPrefsApi,
  'POST /api/location-prefs': handleLocationPrefsApi,
  'GET /api/setup/status':   handleSetupStatus,
  'POST /api/setup/resume':  handleSetupResume,
  'POST /api/setup/profile': handleSetupProfile,
  'POST /api/setup/companies': handleSetupCompanies,
  'POST /api/setup/api-key': handleSetupApiKey,
  'POST /api/setup/test-key': handleSetupTestKey,
  'GET /help':               handleHelpPage,
  'GET /':                   handleDashboardPage,
};

// Refresh gauge metrics from DB periodically
function refreshGauges() {
  try {
    const today = new Date().toLocaleDateString('en-CA');
    for (const row of db.prepare('SELECT platform, COUNT(*) as n FROM jobs WHERE date(created_at) = ? GROUP BY platform').all(today)) {
      metrics.jobsScraped.set({ platform: row.platform }, row.n);
    }
    for (const row of db.prepare("SELECT status, COUNT(*) as n FROM jobs GROUP BY status").all()) {
      metrics.jobsByStatus.set({ status: row.status }, row.n);
    }
    for (const row of db.prepare("SELECT COALESCE(stage, 'none') as stage, COUNT(*) as n FROM jobs WHERE status != 'archived' GROUP BY stage").all()) {
      metrics.jobsByStage.set({ stage: row.stage }, row.n);
    }
    recordStatusSnapshot(db);
  } catch (e) { /* metrics must never crash the server */ }
}
refreshGauges();
setInterval(refreshGauges, 60_000);

const server = http.createServer(async (req, res) => {
  const start = Date.now();
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'GET' && url.pathname === '/healthz') {
    try {
      db.prepare('SELECT 1').get();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  // Prometheus metrics endpoint
  if (req.method === 'GET' && url.pathname === '/metrics') {
    res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
    res.end(metrics.serialize());
    return;
  }

  // Serve static files from /public/
  if (req.method === 'GET' && url.pathname.startsWith('/public/')) {
    const filePath = path.join(publicDir, url.pathname.replace('/public/', ''));
    const ext = path.extname(filePath);
    const mime = MIME_TYPES[ext];
    if (mime && fs.existsSync(filePath)) {
      const shouldGzip = ['.css', '.js'].includes(ext) && clientAcceptsGzip(req);
      const headers = {
        'Content-Type': mime,
        'Cache-Control': staticCacheControl(url),
        'Vary': 'Accept-Encoding',
      };
      if (shouldGzip) headers['Content-Encoding'] = 'gzip';
      res.writeHead(200, headers);
      const stream = fs.createReadStream(filePath);
      stream.on('error', () => res.destroy());
      if (shouldGzip) {
        stream.pipe(zlib.createGzip()).pipe(res);
      } else {
        stream.pipe(res);
      }
      return;
    }
    res.writeHead(404); res.end('not found');
    return;
  }

  // API routes
  const handler = routes[`${req.method} ${url.pathname}`];
  if (handler) {
    await handler(req, res, db, url);
    const duration = (Date.now() - start) / 1000;
    metrics.httpRequestsTotal.inc({ method: req.method, path: url.pathname, status: res.statusCode });
    metrics.httpRequestDuration.observe({ method: req.method, path: url.pathname }, duration);
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

server.listen(PORT, '0.0.0.0', () => {
  log.info('Dashboard running', { url: `http://localhost:${PORT}` });
});

startRejectionEmailPoller(db);
