'use strict';

const { DASHBOARD_PORT, DAILY_TARGET, GROQ_DAILY_LIMIT, SCORE_STRONG, SCORE_GOOD, SCORE_MID, SCORE_BORDERLINE, GHOSTED_AFTER_DAYS } = require('../../config/constants');
const { baseDir, dbPath, jobsJsonPath, publicDir } = require('../../config/paths');
const { escapeHtml } = require('../utils');

function pill(label) {
  return `<code class="help-inline-code">${escapeHtml(label)}</code>`;
}

function renderCard({ eyebrow, title, body = '', bullets = [], code = '', wide = false }) {
  return `
    <article class="help-page-card${wide ? ' help-page-card--wide' : ''}">
      ${eyebrow ? `<div class="help-page-eyebrow">${escapeHtml(eyebrow)}</div>` : ''}
      <h3>${escapeHtml(title)}</h3>
      ${body ? `<div class="help-page-card-body">${body}</div>` : ''}
      ${bullets.length ? `<ul>${bullets.map((item) => `<li>${item}</li>`).join('')}</ul>` : ''}
      ${code ? `<pre><code>${escapeHtml(code)}</code></pre>` : ''}
    </article>
  `;
}

function renderSection(id, kicker, heading, gridCols, cards) {
  return `
    <section class="help-page-section" id="${id}">
      <div class="help-page-section-head">
        <div class="help-page-kicker">${escapeHtml(kicker)}</div>
        <h2>${escapeHtml(heading)}</h2>
      </div>
      <div class="help-page-grid help-page-grid-${gridCols}">
        ${cards.join('')}
      </div>
    </section>
  `;
}

function renderKeyValueTable(rows) {
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
  const setupCode = [
    'cp .env.example .env',
    '# Add GROQ_API_KEY to .env  (free key at console.groq.com)',
    'docker compose up -d',
    `open http://localhost:${DASHBOARD_PORT}`,
  ].join('\n');

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
    'api_usage             LLM daily usage counters (Groq + Gemini)',
    'rejection_email_log   rejection email matching audit log (Gmail/Outlook)',
    'job_aliases           alternate/canonical ATS row mappings',
    'status_snapshots      tracker chart snapshots',
    'ats_resolution_cache  cached ATS resolution outcomes',
  ].join('\n');

  const pathRows = [
    ['Repo root', `<code>${escapeHtml(baseDir)}</code>`],
    ['Active jobs JSON', `<code>${escapeHtml(jobsJsonPath)}</code>`],
    ['SQLite DB', `<code>${escapeHtml(dbPath)}</code>`],
    ['Public assets', `<code>${escapeHtml(publicDir)}</code>`],
    ['Dashboard port', `<code>${DASHBOARD_PORT}</code>`],
    ['Daily target', `<code>${DAILY_TARGET}</code> manual applications`],
    ['Groq budget', `<code>${GROQ_DAILY_LIMIT}</code> calls/day (free tier)`],
    ['Auto-ghost after', `<code>${GHOSTED_AFTER_DAYS}</code> days with no response`],
  ];

  const toc = [
    ['#setup', 'Setup'],
    ['#workflow', 'Workflow'],
    ['#pipeline', 'Pipeline'],
    ['#scoring', 'Scoring'],
    ['#sources', 'Sources'],
    ['#runtime', 'Runtime'],
    ['#config', 'Config'],
    ['#diagnostics', 'Diagnostics'],
  ];

  const setupSection = renderSection('setup', 'Setup', 'Run It Locally', 2, [
    renderCard({
      eyebrow: 'Docker',
      title: 'Three-minute quickstart',
      body: 'The dashboard and the background worker both run in Docker. No Node, Python, or compilers needed on your host.',
      code: setupCode,
    }),
    renderCard({
      eyebrow: 'Free tier',
      title: 'Powered by Groq (free)',
      body: `Jobs are scored using Groq's free API. The default rate limit keeps well under the free-tier ceiling. No paid plan required.`,
      bullets: [
        `Get a free key at ${pill('console.groq.com')} — no credit card needed`,
        `Paste into ${pill('.env')} as ${pill('GROQ_API_KEY=gsk_...')}`,
        `${pill('GROQ_RATE_DELAY_MS')} controls delay between scoring calls (default: 500 ms)`,
        `Set ${pill('DASHBOARD_PORT')} to change the port from ${DASHBOARD_PORT}`,
        `${pill('GEMINI_API_KEY')} is optional — only needed for market research and company discovery`,
      ],
    }),
  ]);

  const workflowSection = renderSection('workflow', 'Workflow', 'Apply Tracking', 2, [
    renderCard({
      eyebrow: 'Manual source of truth',
      title: 'How jobs become applied',
      body: 'The pipeline dropdown is the only application-state writer. Scraping, scoring, rejection sync, and market research do not mark jobs as applied.',
      bullets: [
        'Review pending jobs in the dashboard',
        'Open the job URL and apply on the company ATS',
        `Change the dropdown to ${pill('Applied')} only after you submit`,
        `Advance through ${pill('Interviewing')} as rounds progress`,
        `Mark ${pill('Rejected')} or ${pill('Ghosted')} when the cycle ends`,
      ],
    }),
    renderCard({
      eyebrow: 'Dashboard views',
      title: 'Views and filters',
      bullets: [
        `${pill('Pending')}, ${pill('Applied')}, ${pill('Interviewing')}, ${pill('Rejected')}, ${pill('Closed')}, ${pill('Ghosted')}, ${pill('Archived')} are tab views derived from status and stage`,
        `Minimum score filter hides jobs below a threshold (${SCORE_BORDERLINE}–${SCORE_STRONG})`,
        'Location filter shows Remote, Metro area, or Nationwide',
        'Search is case-insensitive and matches title and company',
        `${pill('Esc')} closes any open panel or modal`,
        'Job actions panel shows reasoning, outreach controls, job description, and archive',
      ],
    }),
  ]);

  const pipelineSection = renderSection('pipeline', 'Pipeline', 'Stage Reference', 3, [
    renderCard({
      eyebrow: 'Status',
      title: 'Job statuses',
      bullets: [
        `${pill('active')} — job is visible in dashboard, not yet acted on`,
        `${pill('archived')} — manually removed from view, not deleted`,
        `${pill('closed')} — ATS URL went dead; auto-detected by health check`,
      ],
    }),
    renderCard({
      eyebrow: 'Stage',
      title: 'Application stages',
      bullets: [
        `${pill('pending')} — scraped, not yet applied`,
        `${pill('applied')} — you submitted; waiting on response`,
        `${pill('interviewing')} — active round in progress`,
        `${pill('rejected')} — explicit rejection (manual or email-matched)`,
        `${pill('ghosted')} — applied, no response after ${GHOSTED_AFTER_DAYS} days`,
        `${pill('offer')} — offer received`,
      ],
    }),
    renderCard({
      eyebrow: 'Auto-transitions',
      title: 'What runs automatically',
      bullets: [
        `Jobs applied ${GHOSTED_AFTER_DAYS}+ days ago with no response are auto-ghosted nightly`,
        `Rejection email sync matches subjects against applied jobs — supports Gmail and Outlook (set ${pill('IMAP_PROVIDER=outlook')} for Outlook)`,
        'ATS slug health checks flag dead URLs as closed',
        'Job description fetches cache the raw JD for offline reference',
      ],
    }),
  ]);

  const scoringSection = renderSection('scoring', 'Scoring', 'How Jobs Are Ranked', 2, [
    renderCard({
      eyebrow: 'Two-step Groq scoring',
      title: 'Score thresholds',
      body: `Each job is scored 1–10 via a two-step Groq pipeline against your resume and preferences. A fast coarse filter (${pill('llama-3.1-8b-instant')}) eliminates clearly irrelevant roles first; qualifying jobs are then fully scored by ${pill('llama-3.3-70b-versatile')} with JSON-structured output.`,
      bullets: [
        `${pill(String(SCORE_STRONG))}+ — Strong match (green)`,
        `${pill(String(SCORE_GOOD))} — Good match (blue)`,
        `${pill(String(SCORE_MID))} — Moderate match (yellow)`,
        `${pill(String(SCORE_BORDERLINE))} — Borderline (orange)`,
        `Below ${pill(String(SCORE_BORDERLINE))} — filtered out by default`,
        'Jobs that fail the coarse filter are auto-archived with score 1',
      ],
    }),
    renderCard({
      eyebrow: 'Inputs',
      title: 'What the scorer sees',
      bullets: [
        'Your resume and context (from the profile directory)',
        'Job title, company, location, and full description',
        'Your stated preferences and dealbreakers (from context.md)',
        'Coarse filter reads context.md to gate irrelevant roles before full scoring',
        'Reasoning is stored and shown in the job detail panel',
        'Re-scoring is not automatic; delete a job to re-scrape it',
      ],
    }),
  ]);

  const sources = [
    ['Greenhouse', 'greenhouse.js', 'Scrapes company boards directly'],
    ['Lever', 'lever.js', 'Scrapes company boards directly'],
    ['Ashby', 'ashby.js', 'Scrapes company boards directly'],
    ['Workday', 'workday.js', 'Scrapes company boards directly'],
    ['Rippling', 'rippling.js', 'Scrapes company boards directly'],
    ['Workable', 'workable.js', 'Scrapes company boards directly'],
    ['Wellfound', 'wellfound.js', 'Startup-focused board'],
    ['Built In', 'builtin.js', 'Tech job board with RSS'],
    ['Arbeitnow', 'arbeitnow.js', 'Remote-first job board'],
    ['Remote OK', 'remoteok.js', 'Remote-only board'],
    ['Jobicy', 'jobicy.js', 'Remote job board'],
    ['We Work Remotely', 'wwr.js', 'Remote job board'],
  ];

  const sourcesSection = renderSection('sources', 'Sources', 'Job Board Scrapers', 2, [
    renderCard({
      eyebrow: 'ATS scrapers',
      title: 'Direct company boards',
      body: 'Six ATS platforms are scraped by iterating companies you configure in <code>data/companies.js</code>. Add companies to the appropriate list and they will be scraped on the next run.',
      bullets: [
        `${pill('Greenhouse')} — large company ATS (via boards.greenhouse.io)`,
        `${pill('Lever')} — startup ATS (via jobs.lever.co)`,
        `${pill('Ashby')} — modern ATS (via jobs.ashbyhq.com)`,
        `${pill('Workday')} — enterprise ATS (via myworkdayjobs.com)`,
        `${pill('Rippling')} — HR platform jobs`,
        `${pill('Workable')} — SMB ATS`,
      ],
    }),
    renderCard({
      eyebrow: 'Board scrapers',
      title: 'Aggregator sources',
      body: 'Job boards are scraped on a keyword basis. Configure target titles and search terms in your profile config.',
      bullets: [
        `${pill('Wellfound')} — startup ecosystem, requires login token`,
        `${pill('Built In')} — tech-focused, RSS-based`,
        `${pill('Arbeitnow')} — remote and EU-friendly roles`,
        `${pill('Remote OK')} — remote-only roles`,
        `${pill('Jobicy')} — remote job board`,
        `${pill('We Work Remotely')} — remote-only board`,
      ],
    }),
    renderCard({
      eyebrow: 'JobSpy (optional)',
      title: 'Indeed, LinkedIn, Glassdoor, ZipRecruiter',
      wide: true,
      body: `JobSpy scrapes public job postings from the four largest aggregators. Enable with ${pill('JOBSPY_ENABLED=true')} in ${pill('.env')}. Requires ${pill('pip install python-jobspy')}.`,
      bullets: [
        `Configure search terms, sites, and result count in ${pill('data/jobspy-config.json')}`,
        `${pill('search_term')} accepts a string or an array of strings — one scrape call per term`,
        `${pill('LOCATION_FILTER')} drives multi-location scraping: one call per search_term × location`,
        'Results are deduplicated by URL and merged with ATS scraper output before scoring',
        `Set ${pill('request_delay_ms')} (default 3000) to pace LinkedIn requests and avoid blocks`,
      ],
    }),
  ]);

  const runtimeSection = renderSection('runtime', 'Runtime', 'APIs and Storage', 2, [
    renderCard({ eyebrow: 'HTTP', title: 'Dashboard APIs', code: routeCode }),
    renderCard({ eyebrow: 'SQLite', title: 'Database tables', code: tableCode }),
  ]);

  const configSection = renderSection('config', 'Config', 'Active Configuration', 1, [
    renderCard({
      eyebrow: 'Paths',
      title: 'Runtime paths',
      body: renderKeyValueTable(pathRows),
    }),
  ]);

  const diagnosticsSection = renderSection('diagnostics', 'Diagnostics', 'Health and Observability', 2, [
    renderCard({
      eyebrow: 'Endpoints',
      title: 'Health checks',
      bullets: [
        `${pill('GET /healthz')} confirms the dashboard can query SQLite`,
        `${pill('GET /metrics')} exposes dashboard and pipeline gauges (Prometheus format)`,
        `${pill('docker compose logs -f')} tails dashboard and worker output in real time`,
      ],
    }),
    renderCard({
      eyebrow: 'Warning banners',
      title: 'Dashboard health files',
      bullets: [
        `${pill('slug-health.json')} tracks which ATS URLs return 404 — drives the "dead links" banner`,
        `${pill('jd-health.json')} tracks job description fetch failures`,
        `${pill('market-research-cache.json')} caches company research results locally`,
        'Delete any cache file to force a fresh fetch on the next run',
      ],
    }),
  ]);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Job Search — Reference</title>
<link rel="stylesheet" href="/public/dashboard.css?v=12">
</head>
<body class="help-page">

<header class="help-page-header">
  <div class="help-page-header-inner">
    <div class="help-page-header-copy">
      <a href="/" class="help-page-back">&larr; Dashboard</a>
      <div class="help-page-kicker">Reference</div>
      <h1>Job Search System</h1>
      <p>A private, local job search engine. Runs entirely on your machine via Docker. Scrapes 12+ job boards (plus optional JobSpy for Indeed/LinkedIn/Glassdoor/ZipRecruiter), scores listings against your resume using a two-step Groq pipeline, and gives you this dashboard to review and track applications. Application state is always manual: a job becomes applied only when you set it here after submitting it yourself.</p>
    </div>
  </div>
</header>

<nav class="help-page-toc" aria-label="Sections">
  ${toc.map(([href, label]) => `<a class="help-page-toc-link" href="${href}">${escapeHtml(label)}</a>`).join('\n  ')}
</nav>

<div class="help-page-shell">
  ${setupSection}
  ${workflowSection}
  ${pipelineSection}
  ${scoringSection}
  ${sourcesSection}
  ${runtimeSection}
  ${configSection}
  ${diagnosticsSection}
</div>

</body>
</html>`;
}

module.exports = { renderHelpPage };
