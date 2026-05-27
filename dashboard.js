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
const { createSetupHandlers } = require('./lib/setup-routes');

const PORT = DASHBOARD_PORT;
const db = getDb();

const PROFILE_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, 'data');
const ENV_PATH = path.join(__dirname, '.env');

const {
  handleSetupStatus,
  handleSetupResume,
  handleSetupProfile,
  handleSetupCompanies,
  handleSetupApiKey,
  handleSetupTestKey,
} = createSetupHandlers({ profileDir: PROFILE_DIR, envPath: ENV_PATH });

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
