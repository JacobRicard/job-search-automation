'use strict';

const { getCommandGroups } = require('../npm-command-docs');
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

function renderCommandCatalog(groups) {
  return groups.map((group) => `
    <div class="help-page-command-group">
      <h4>${escapeHtml(group.title)}</h4>
      <p>${escapeHtml(group.description)}</p>
      <div class="help-page-command-list">
        ${group.commands.map((command) => `
          <div class="help-page-command-item">
            <code>${escapeHtml(command.command)}</code>
            <span>${escapeHtml(command.description)}</span>
            ${command.flags.length ? `<small>${escapeHtml(command.flags.join(' '))}</small>` : ''}
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
}

function renderHelpPage() {
  const commandGroups = getCommandGroups();
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
    <p>Scrape jobs, score them, review the queue, and track applications. Application state is manual-only: a job becomes applied only when you set it in the dashboard after submitting it yourself.</p>
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
      <div class="help-page-kicker">Commands</div>
      <h2>NPM Commands</h2>
    </div>
    <div class="help-page-card">
      <h3>Which Command To Run</h3>
      <div class="help-page-command-catalog">${renderCommandCatalog(commandGroups)}</div>
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
          '<code>npm test</code> runs the Node test suite before committing',
        ],
      })}
    </div>
  </section>
</main>
</body>
</html>`;
}

module.exports = { renderHelpPage };
