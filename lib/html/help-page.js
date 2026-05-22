'use strict';

const { DASHBOARD_PORT, DAILY_TARGET, GEMINI_DAILY_LIMIT } = require('../../config/constants');
const { baseDir, dbPath, jobsJsonPath, publicDir } = require('../../config/paths');
const { escapeHtml } = require('../utils');

function renderCard({ eyebrow, title, body, bullets = [], code = '' }) {
  return `
    <article class="help-page-card">
      ${eyebrow ? `<div class="help-page-eyebrow">${escapeHtml(eyebrow)}</div>` : ''}
      <h3>${escapeHtml(title)}</h3>
      ${body ? `<p>${body}</p>` : ''}
      ${bullets.length ? `<ul>${bullets.map((item) => `<li>${item}</li>`).join('')}</ul>` : ''}
      ${code ? `<pre><code>${escapeHtml(code)}</code></pre>` : ''}
    </article>
  `;
}

function renderMiniTable(rows) {
  return `
    <div class="help-page-table">
      ${rows.map(([label, value]) => `
        <div class="help-page-table-row">
          <div class="help-page-table-label">${escapeHtml(label)}</div>
          <div class="help-page-table-value">${value}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderHelpPage() {
  const routeCode = [
    'GET  /                       dashboard',
    'GET  /help                   this page',
    'GET  /resume                 base resume PDF',
    'GET  /company-notes          company tags and notes JSON',
    'POST /company-notes          save company tags and notes',
    'GET  /job-description        job description JSON',
    'POST /pipeline               manual pipeline/stage update',
    'POST /mark-outreach          mark or clear outreach',
    'POST /archive                archive a job',
    'POST /market-research        run market research analysis',
    'GET  /api/tracker            over-time dashboard data',
    'GET  /api/insights           daily dashboard insight data',
    'GET  /healthz                health check',
    'GET  /metrics                Prometheus metrics',
    'GET  /public/*               static CSS and JS assets',
  ].join('\n');

  const tableCode = [
    'jobs                  listings and manual pipeline state',
    'events                audit trail for stage/status/outreach changes',
    'metadata              schema version and small key/value state',
    'company_notes         per-company notes and tags',
    'api_usage             Gemini daily usage counters',
    'rejection_email_log   Gmail rejection matching audit log',
    'job_aliases           alternate/canonical ATS row mappings',
    'status_snapshots      tracker chart snapshots',
    'ats_resolution_cache  cached ATS resolution outcomes',
  ].join('\n');

  const workflowCode = [
    '1. Review pending jobs in the dashboard.',
    '2. Open the ATS job URL yourself and apply manually.',
    '3. Change the dashboard dropdown to Applied only after you submitted it.',
    '4. Move later stages with the same dropdown as interviews/rejections happen.',
  ].join('\n');

  const setupCode = [
    '1. cp .env.example .env',
    '2. Add a free Gemini key from https://aistudio.google.com/apikey',
    '3. docker compose up -d',
    '4. Open http://localhost:' + DASHBOARD_PORT,
  ].join('\n');

  const pathRows = [
    ['Repo root', `<code>${escapeHtml(baseDir)}</code>`],
    ['Active jobs JSON', `<code>${escapeHtml(jobsJsonPath)}</code>`],
    ['SQLite DB', `<code>${escapeHtml(dbPath)}</code>`],
    ['Public assets', `<code>${escapeHtml(publicDir)}</code>`],
    ['Dashboard port', `<code>${DASHBOARD_PORT}</code>`],
    ['Daily target', `<code>${DAILY_TARGET}</code> manual applications`],
    ['Gemini budget', `<code>${GEMINI_DAILY_LIMIT}</code> calls/day`],
  ];

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Job Search Help</title>
<link rel="stylesheet" href="/public/dashboard.css?v=12">
</head>
<body class="help-page">
<main class="help-page-main">
  <section class="help-page-header">
    <a href="/" class="help-page-back">&larr; Dashboard</a>
    <div class="help-page-kicker">Reference</div>
    <h1>Job Search System</h1>
    <p>A private, local job search engine. It runs entirely on your machine via Docker, scrapes job boards, scores listings with Gemini against your resume, and gives you this dashboard to review and track applications. Application state is always manual: a job becomes applied only when you set it here after submitting it yourself.</p>
  </section>

  <section class="help-page-section">
    <div class="help-page-section-head">
      <div class="help-page-kicker">Setup</div>
      <h2>Run It Locally</h2>
    </div>
    <div class="help-page-grid help-page-grid-2">
      ${renderCard({
        eyebrow: 'Docker',
        title: 'Three-minute quickstart',
        body: 'The dashboard and the background worker both run in Docker. No Node, Python, or compilers needed on your host.',
        code: setupCode,
      })}
      ${renderCard({
        eyebrow: 'Free tier',
        title: 'Tuned for Gemini Free Tier',
        body: 'The default rate limit keeps Gemini calls under 500/day and 15 RPM, so you never hit the free-tier ceiling. No paid plan required.',
        bullets: [
          'Get a free key at <code>https://aistudio.google.com/apikey</code>',
          'Paste it into <code>.env</code> as <code>GEMINI_API_KEY=...</code>',
          'Adjust <code>GEMINI_RATE_DELAY_MS</code> only if you upgrade to a paid key',
        ],
      })}
    </div>
  </section>

  <section class="help-page-section">
    <div class="help-page-section-head">
      <div class="help-page-kicker">Workflow</div>
      <h2>Apply Tracking</h2>
    </div>
    <div class="help-page-grid help-page-grid-2">
      ${renderCard({
        eyebrow: 'Manual source of truth',
        title: 'How jobs become applied',
        body: 'The pipeline dropdown is the only application-state writer. Scraping, scoring, rejection sync, and market research do not mark jobs as applied.',
        code: workflowCode,
      })}
      ${renderCard({
        eyebrow: 'Dashboard views',
        title: 'Views and actions',
        bullets: [
          '<code>Pending</code>, <code>Applied</code>, <code>Interviewing</code>, <code>Rejected</code>, <code>Closed</code>, <code>Ghosted</code>, and <code>Archived</code> are derived from <code>jobs.status</code> and <code>jobs.stage</code>',
          '<code>Job actions</code> show reasoning, outreach, job description, and archive controls',
          '<code>Search is case-insensitive</code> and filters support minimum score plus level filtering',
          '<code>Escape</code> closes open dashboard modals',
        ],
      })}
    </div>
  </section>

  <section class="help-page-section">
    <div class="help-page-section-head">
      <div class="help-page-kicker">Runtime</div>
      <h2>APIs And Storage</h2>
    </div>
    <div class="help-page-grid help-page-grid-2">
      ${renderCard({ eyebrow: 'HTTP', title: 'Dashboard APIs', code: routeCode })}
      ${renderCard({ eyebrow: 'SQLite', title: 'Tables', code: tableCode })}
      ${renderCard({ eyebrow: 'Paths', title: 'Active Configuration', body: renderMiniTable(pathRows) })}
      ${renderCard({
        eyebrow: 'Diagnostics',
        title: 'Health checks',
        bullets: [
          '<code>GET /healthz</code> confirms the dashboard can query SQLite',
          '<code>GET /metrics</code> exposes dashboard and pipeline gauges',
          '<code>slug-health.json</code> and <code>jd-health.json</code> drive dashboard warning banners',
          '<code>docker compose logs -f</code> tails dashboard and worker output',
        ],
      })}
    </div>
  </section>
</main>
</body>
</html>`;
}

module.exports = { renderHelpPage };
