'use strict';

const { escapeHtml } = require('../utils');

const SECTIONS = [
  ['#api-keys',    'API Keys'],
  ['#companies',   'Scraper Targets'],
  ['#jobspy',      'JobSpy'],
  ['#pipeline',    'Pipeline'],
  ['#profile',     'Profile'],
  ['#email',       'Email Digest'],
  ['#rejections',  'Rejection Sync'],
];

function field(id, label, opts = {}) {
  const {
    type = 'text', placeholder = '', hint = '', value = '',
    rows, options, checked,
  } = opts;

  let input;
  if (type === 'textarea') {
    input = `<textarea id="${id}" name="${id}" rows="${rows || 4}" placeholder="${escapeHtml(placeholder)}" style="width:100%;font-family:var(--font-mono,monospace);font-size:12px">${escapeHtml(value)}</textarea>`;
  } else if (type === 'checkbox') {
    input = `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none">
      <input type="checkbox" id="${id}" name="${id}"${checked ? ' checked' : ''} style="width:16px;height:16px;cursor:pointer">
      <span style="font-size:13px;color:var(--text-primary)">${escapeHtml(label)}</span>
    </label>`;
    return `<div class="sfield" style="grid-column:1/-1">${input}${hint ? `<p class="sfhint">${hint}</p>` : ''}</div>`;
  } else if (type === 'select') {
    const opts2 = (options || []).map(([v, l]) =>
      `<option value="${escapeHtml(v)}"${value === v ? ' selected' : ''}>${escapeHtml(l)}</option>`
    ).join('');
    input = `<select id="${id}" name="${id}" style="width:100%">${opts2}</select>`;
  } else {
    input = `<input type="${type}" id="${id}" name="${id}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" autocomplete="off" style="width:100%">`;
  }

  return `<div class="sfield">
  <label for="${id}" class="sflabel">${escapeHtml(label)}</label>
  ${input}
  ${hint ? `<p class="sfhint">${hint}</p>` : ''}
</div>`;
}

function section(id, title, description, cols, body, saveId) {
  return `<section class="ssection" id="${id}">
  <div class="ssection-head">
    <h2>${escapeHtml(title)}</h2>
    ${description ? `<p class="ssdesc">${description}</p>` : ''}
  </div>
  <div class="sgrid sgrid-${cols}">${body}</div>
  <div class="ssave-row">
    <button class="btn sbtn" id="${saveId}-btn" onclick="save('${saveId}')">Save ${escapeHtml(title)}</button>
    <span class="sstatus" id="${saveId}-status"></span>
  </div>
</section>`;
}

function renderSettingsPage() {
  const toc = SECTIONS.map(([href, label]) =>
    `<a class="help-page-toc-link" href="${href}">${escapeHtml(label)}</a>`
  ).join('\n  ');

  const apiKeysSection = section('api-keys', 'API Keys',
    'Writes to .env. Restart the dashboard after changing keys for them to take effect in background workers.',
    2,
    field('s-groq-key',        'Groq API Key',              { type: 'password', placeholder: 'gsk_...',   hint: 'Used for scoring when Ollama is not configured. Free key at console.groq.com' }) +
    field('s-ollama-host',     'Ollama Host',               { placeholder: 'http://localhost:11434',       hint: 'Local LLM endpoint — replaces Groq for scoring with no quota. From Docker use http://host.docker.internal:11434' }) +
    field('s-ollama-score-model', 'Ollama Score Model',     { placeholder: 'mistral-small3.1',             hint: 'Model for full 1-10 scoring. Run: ollama pull mistral-small3.1' }) +
    field('s-ollama-filter-model', 'Ollama Filter Model',   { placeholder: 'mistral-small3.1',             hint: 'Model for fast PASS/FAIL coarse filter. Can be same as score model.' }) +
    field('s-gemini-key',      'Gemini API Key',            { type: 'password', placeholder: 'AIza...',   hint: 'Optional — only needed for market research and company discovery' }) +
    field('s-sapling-key',     'Sapling API Key',           { type: 'password', hint: 'Optional — AI voice detection in voice-check pipeline' }) +
    field('s-hf-key',          'HuggingFace API Key',       { type: 'password', hint: 'Optional — second AI detector alongside Sapling' }),
    'env-keys'
  );

  const companiesSection = section('companies', 'Scraper Targets',
    'Writes to data/companies.js. One slug per line. Leave a platform empty to skip it.',
    2,
    field('s-search-terms', 'Search Terms', { type: 'textarea', rows: 4, placeholder: 'financial analyst\nfintech analyst\ninvestment banking analyst', hint: 'Used to filter jobs from board scrapers (RemoteOK, WWR, etc.)' }) +
    field('s-max-age',      'Max Job Age (days)', { placeholder: '20', hint: 'Jobs older than this are filtered out' }) +
    field('s-greenhouse',   'Greenhouse Companies', { type: 'textarea', rows: 5, placeholder: 'stripe\ngoldmansachs\njpmorgan', hint: 'Slug from boards.greenhouse.io/SLUG' }) +
    field('s-lever',        'Lever Companies',      { type: 'textarea', rows: 5, placeholder: 'ramp\nmercury\ncarta', hint: 'Slug from jobs.lever.co/SLUG' }) +
    field('s-ashby',        'Ashby Companies',      { type: 'textarea', rows: 5, placeholder: 'brex\nplaid', hint: 'Slug from jobs.ashbyhq.com/SLUG' }) +
    field('s-workable',     'Workable Companies',   { type: 'textarea', rows: 3, placeholder: 'acmecorp', hint: 'Slug from apply.workable.com/SLUG' }) +
    field('s-rippling',     'Rippling Companies',   { type: 'textarea', rows: 3, placeholder: 'example-co', hint: 'Slug from app.rippling.com/job-board/SLUG' }) +
    field('s-wellfound',    'Wellfound Roles',       { type: 'textarea', rows: 3, placeholder: 'software-engineer', hint: 'Role search terms for Wellfound' }) +
    `<div class="sfield" style="grid-column:1/-1">
      <label class="sflabel" for="s-workday">Workday Companies <span style="color:var(--text-muted);font-weight:400">(JSON array)</span></label>
      <textarea id="s-workday" rows="6" placeholder='[{"sub":"ms","wd":5,"board":"External","label":"Morgan Stanley"}]' style="width:100%;font-family:var(--font-mono,monospace);font-size:12px"></textarea>
      <p class="sfhint">JSON array of {sub, wd, board, label} objects. From URL: https://SUB.wdWD.myworkdayjobs.com/BOARD — e.g. ms.wd5.myworkdayjobs.com/External → sub:"ms", wd:5, board:"External".</p>
    </div>`,
    'companies'
  );

  const jobspySection = section('jobspy', 'JobSpy',
    'Writes to data/jobspy-config.json and JOBSPY_ENABLED to .env. Scrapes Indeed, LinkedIn, Glassdoor, and ZipRecruiter.',
    2,
    field('s-jobspy-enabled', 'Enable JobSpy scraping', { type: 'checkbox', hint: 'Requires: pip install python-jobspy' }) +
    field('s-jobspy-terms',   'Search Terms',  { type: 'textarea', rows: 3, placeholder: 'financial analyst\nfintech analyst', hint: 'One per line. Each term runs as a separate scrape call.' }) +
    field('s-jobspy-sites',   'Sites to scrape', { type: 'textarea', rows: 2, placeholder: 'indeed\nlinkedin\nglassdoor\nzip_recruiter', hint: 'One per line. Options: indeed, linkedin, glassdoor, zip_recruiter' }) +
    field('s-jobspy-results', 'Results per term', { placeholder: '20' }) +
    field('s-jobspy-hours',   'Max age (hours)',   { placeholder: '72' }) +
    field('s-jobspy-delay',   'Delay between calls (ms)', { placeholder: '3000', hint: 'Increase to 5000+ to avoid LinkedIn blocks' }) +
    field('s-jobspy-type',    'Job type', { type: 'select', options: [['fulltime','Full-time'],['parttime','Part-time'],['internship','Internship'],['contract','Contract'],['','Any']] }) +
    field('s-jobspy-remote',  'Remote only', { type: 'checkbox', hint: 'Filter for remote positions only' }) +
    field('s-jobspy-lidescs', 'Fetch full LinkedIn descriptions', { type: 'checkbox', hint: 'Slower and more likely to hit LinkedIn rate limits' }),
    'jobspy'
  );

  const pipelineSection = section('pipeline', 'Pipeline',
    'Writes to .env. Controls scraping behaviour, location filtering, and scheduling.',
    2,
    field('s-location-filter',    'Location Filter',         { placeholder: 'Chicago, New York, Remote', hint: 'Comma-separated. Also drives JobSpy per-location scraping. Empty = allow all.' }) +
    field('s-location-blocklist', 'Location Blocklist',      { placeholder: 'Austin, Dallas', hint: 'Comma-separated cities to always drop.' }) +
    field('s-title-blocklist',    'Title Blocklist',         { type: 'textarea', rows: 3, placeholder: 'Senior\nDirector\nVP\nManager', hint: 'One keyword per line. Jobs whose title contains any of these are rejected by the AI coarse filter before scoring.' }) +
    field('s-builtin-sub',        'Built In Subdomain',      { placeholder: 'www', hint: 'e.g. chicago, nyc, seattle. Default www = nationwide.' }) +
    field('s-archive-threshold',  'Auto-Archive Threshold',  { placeholder: '4', hint: 'Jobs scoring at or below this are archived automatically.' }) +
    field('s-groq-delay',         'Groq Rate Delay (ms)',    { placeholder: '500', hint: 'Delay between scoring calls. Raise if you see 429s.' }) +
    field('s-refresh-interval',   'Refresh Interval (min)',  { placeholder: '30', hint: 'Docker worker only — how often the full pipeline runs.' }) +
    field('s-tz',                 'Timezone',                { placeholder: 'America/Chicago', hint: 'Used for log timestamps and date calculations.' }) +
    field('s-dashboard-port',     'Dashboard Port',          { placeholder: '3131' }),
    'pipeline'
  );

  const profileSection = section('profile', 'Profile',
    'Writes to data/context.md. This is what the Groq coarse filter and scorer read to understand your goals, preferences, and dealbreakers. Edit freely — it is plain Markdown.',
    1,
    field('s-context', 'context.md', { type: 'textarea', rows: 20, hint: 'Full content of your context.md. The scorer and coarse filter read this on every run.' }),
    'profile'
  );

  const emailSection = section('email', 'Email Digest',
    'Writes to .env. Sends a ranked HTML email of new high-scoring jobs. Compatible with Gmail, Outlook, SendGrid, and any SMTP provider.',
    2,
    field('s-smtp-host',    'SMTP Host',         { placeholder: 'smtp.gmail.com' }) +
    field('s-smtp-port',    'SMTP Port',         { placeholder: '587' }) +
    field('s-smtp-user',    'SMTP Username',     { placeholder: 'you@gmail.com' }) +
    field('s-smtp-pass',    'SMTP Password',     { type: 'password', hint: 'App password recommended. Never your main account password.' }) +
    field('s-smtp-from',    'From Address',      { placeholder: 'you@gmail.com', hint: 'Defaults to SMTP username if blank.' }) +
    field('s-digest-to',    'Digest Recipient',  { placeholder: 'you@gmail.com', hint: 'Where to send the daily digest.' }) +
    field('s-digest-score',     'Min Score',       { placeholder: '6', hint: 'Only jobs at or above this score are included (1–10).' }) +
    field('s-digest-max',       'Max Jobs',        { placeholder: '25' }) +
    field('s-digest-send-time', 'Send Time (24h)', { placeholder: '08:00', hint: 'Send once daily at this time (e.g. 08:00). Uses your Timezone setting. Leave blank to send after every pipeline run.' }) +
    field('s-smtp-secure',  'Use SSL (port 465)', { type: 'checkbox', hint: 'Enable for SSL connections. Leave unchecked for STARTTLS (port 587).' }),
    'email'
  );

  const rejectionsSection = section('rejections', 'Rejection Sync',
    'Writes to .env. Watches your inbox and automatically marks matching jobs as rejected.',
    2,
    field('s-imap-provider', 'Provider', { type: 'select', options: [['gmail','Gmail'],['outlook','Outlook / Microsoft 365']], hint: 'Outlook uses outlook.office365.com:993' }) +
    field('s-imap-email',    'Email Address',  { placeholder: 'you@gmail.com', hint: 'Sets IMAP_EMAIL (overrides GMAIL_EMAIL).' }) +
    field('s-imap-pass',     'App Password',   { type: 'password', hint: 'Gmail: myaccount.google.com/apppasswords  |  Outlook: account.microsoft.com/security' }) +
    field('s-imap-host',     'IMAP Host Override', { placeholder: 'imap.gmail.com', hint: 'Leave blank to use the provider default.' }) +
    field('s-reject-disabled', 'Disable rejection sync', { type: 'checkbox', hint: 'Stops the background IMAP poller. Run sync-rejections manually instead.' }) +
    field('s-reject-interval', 'Poll Interval (ms)', { placeholder: '300000', hint: 'How often to check for new rejection emails. Default 300000 (5 min).' }),
    'rejections'
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Settings — Job Search</title>
<link rel="stylesheet" href="/public/dashboard.css?v=13">
<style>
  .ssection { margin-bottom: 40px; }
  .ssection-head { margin-bottom: 20px; }
  .ssection-head h2 { font-size: 18px; font-weight: 600; color: var(--text-primary); margin: 0 0 6px; }
  .ssdesc { font-size: 13px; color: var(--text-muted); margin: 0; line-height: 1.5; }
  .sgrid { display: grid; gap: 16px; }
  .sgrid-1 { grid-template-columns: 1fr; }
  .sgrid-2 { grid-template-columns: 1fr 1fr; }
  @media (max-width: 640px) { .sgrid-2 { grid-template-columns: 1fr; } }
  .sfield { display: flex; flex-direction: column; gap: 4px; }
  .sflabel { font-size: 12px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
  .sfhint { font-size: 11px; color: var(--text-muted); margin: 2px 0 0; line-height: 1.4; }
  .ssave-row { display: flex; align-items: center; gap: 12px; margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--border); }
  .sbtn { background: var(--accent); color: white; padding: 8px 18px; font-size: 13px; }
  .sbtn:disabled { opacity: 0.5; cursor: not-allowed; }
  .sstatus { font-size: 12px; }
  .settings-shell { max-width: 900px; margin: 0 auto; padding: 0 24px 60px; }
  .settings-divider { border: none; border-top: 1px solid var(--border); margin: 40px 0; }
</style>
</head>
<body class="help-page">

<header class="help-page-header">
  <div class="help-page-header-inner">
    <div class="help-page-header-copy">
      <a href="/" class="help-page-back">&larr; Dashboard</a>
      <div class="help-page-kicker">Configuration</div>
      <h1>Settings</h1>
      <p>All values are saved to the appropriate files. Changes to .env take effect on the next pipeline run; the dashboard reads them live for most settings.</p>
    </div>
  </div>
</header>

<nav class="help-page-toc" aria-label="Sections">
  ${toc}
</nav>

<div class="settings-shell">
  ${apiKeysSection}
  <hr class="settings-divider">
  ${companiesSection}
  <hr class="settings-divider">
  ${jobspySection}
  <hr class="settings-divider">
  ${pipelineSection}
  <hr class="settings-divider">
  ${profileSection}
  <hr class="settings-divider">
  ${emailSection}
  <hr class="settings-divider">
  ${rejectionsSection}
</div>

<script>
(function () {
  // ---- helpers ----
  function gv(id) { var e = document.getElementById(id); return e ? (e.type === 'checkbox' ? e.checked : e.value) : ''; }
  function sv(id, val) {
    var e = document.getElementById(id); if (!e) return;
    if (e.type === 'checkbox') e.checked = val === true || val === 'true';
    else e.value = (val == null ? '' : String(val));
  }

  // ---- load ----
  fetch('/api/settings')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      var env = d.env || {};
      var co  = d.companies || {};
      var jp  = d.jobspy || {};

      // API Keys
      sv('s-groq-key', env.GROQ_API_KEY);
      sv('s-ollama-host', env.OLLAMA_HOST);
      sv('s-ollama-score-model', env.OLLAMA_SCORE_MODEL || 'mistral-small3.1');
      sv('s-ollama-filter-model', env.OLLAMA_FILTER_MODEL || 'mistral-small3.1');
      sv('s-gemini-key', env.GEMINI_API_KEY);
      sv('s-sapling-key', env.SAPLING_API_KEY);
      sv('s-hf-key', env.HUGGINGFACE_API_KEY);

      // Companies
      sv('s-search-terms', (co.SEARCH_TERMS || []).join('\\n'));
      sv('s-max-age',      co.MAX_AGE_DAYS || 20);
      sv('s-greenhouse',   (co.GREENHOUSE_COMPANIES || []).join('\\n'));
      sv('s-lever',        (co.LEVER_COMPANIES || []).join('\\n'));
      sv('s-ashby',        (co.ASHBY_COMPANIES || []).join('\\n'));
      sv('s-workable',     (co.WORKABLE_COMPANIES || []).join('\\n'));
      sv('s-rippling',     (co.RIPPLING_COMPANIES || []).join('\\n'));
      sv('s-wellfound',    (co.WELLFOUND_ROLES || []).join('\\n'));
      sv('s-workday',      JSON.stringify(co.WORKDAY_COMPANIES || [], null, 2));

      // JobSpy
      sv('s-jobspy-enabled', env.JOBSPY_ENABLED === 'true');
      var terms = jp.search_term;
      sv('s-jobspy-terms', Array.isArray(terms) ? terms.join('\\n') : (terms || ''));
      sv('s-jobspy-sites', Array.isArray(jp.site_name) ? jp.site_name.join('\\n') : (jp.site_name || 'indeed\\nlinkedin\\nglassdoor\\nzip_recruiter'));
      sv('s-jobspy-results', jp.results_wanted || 20);
      sv('s-jobspy-hours',   jp.hours_old || 72);
      sv('s-jobspy-delay',   jp.request_delay_ms || 3000);
      sv('s-jobspy-type',    jp.job_type || '');
      sv('s-jobspy-remote',  jp.is_remote === true);
      sv('s-jobspy-lidescs', jp.linkedin_fetch_description === true);

      // Pipeline
      sv('s-location-filter',    env.LOCATION_FILTER);
      sv('s-location-blocklist', env.LOCATION_BLOCKLIST);
      sv('s-title-blocklist',    (env.TITLE_BLOCKLIST || '').split(',').map(function(s){return s.trim();}).filter(Boolean).join('\\n'));
      sv('s-builtin-sub',        env.BUILTIN_SUBDOMAIN || 'www');
      sv('s-archive-threshold',  env.AUTO_ARCHIVE_THRESHOLD || '4');
      sv('s-groq-delay',         env.GROQ_RATE_DELAY_MS || '500');
      sv('s-refresh-interval',   env.REFRESH_INTERVAL_MINUTES || '30');
      sv('s-tz',                 env.TZ);
      sv('s-dashboard-port',     env.DASHBOARD_PORT || '3131');

      // Profile
      sv('s-context', d.context || '');

      // Email
      sv('s-smtp-host',    env.SMTP_HOST);
      sv('s-smtp-port',    env.SMTP_PORT || '587');
      sv('s-smtp-user',    env.SMTP_USER);
      sv('s-smtp-pass',    env.SMTP_PASS);
      sv('s-smtp-from',    env.SMTP_FROM);
      sv('s-digest-to',    env.DIGEST_TO);
      sv('s-digest-score',     env.DIGEST_MIN_SCORE || '6');
      sv('s-digest-max',       env.DIGEST_MAX_JOBS || '25');
      sv('s-digest-send-time', env.DIGEST_SEND_TIME || '');
      sv('s-smtp-secure',  env.SMTP_SECURE === 'true');

      // Rejections
      sv('s-imap-provider',  env.IMAP_PROVIDER || 'gmail');
      sv('s-imap-email',     env.IMAP_EMAIL || env.GMAIL_EMAIL);
      sv('s-imap-pass',      env.IMAP_APP_PASSWORD || env.GMAIL_APP_PASSWORD);
      sv('s-imap-host',      env.IMAP_HOST);
      sv('s-reject-disabled', env.REJECTION_EMAIL_SYNC_DISABLED === 'true');
      sv('s-reject-interval', env.REJECTION_EMAIL_POLL_INTERVAL_MS);
    })
    .catch(function(e) { console.error('settings load failed', e); });

  // ---- save ----
  window.save = function(sectionId) {
    var btn = document.getElementById(sectionId + '-btn');
    var status = document.getElementById(sectionId + '-status');
    if (btn) btn.disabled = true;
    if (status) { status.textContent = 'Saving…'; status.style.color = 'var(--text-muted)'; }

    var payload, endpoint;

    if (sectionId === 'env-keys') {
      endpoint = '/api/settings/env';
      payload = {
        GROQ_API_KEY:        gv('s-groq-key'),
        OLLAMA_HOST:         gv('s-ollama-host'),
        OLLAMA_SCORE_MODEL:  gv('s-ollama-score-model'),
        OLLAMA_FILTER_MODEL: gv('s-ollama-filter-model'),
        GEMINI_API_KEY:      gv('s-gemini-key'),
        SAPLING_API_KEY:     gv('s-sapling-key'),
        HUGGINGFACE_API_KEY: gv('s-hf-key'),
      };
    } else if (sectionId === 'companies') {
      endpoint = '/api/settings/companies';
      payload = {
        searchTerms: gv('s-search-terms'),
        greenhouse:  gv('s-greenhouse'),
        lever:       gv('s-lever'),
        ashby:       gv('s-ashby'),
        workable:    gv('s-workable'),
        rippling:    gv('s-rippling'),
        wellfound:   gv('s-wellfound'),
        workday:     gv('s-workday'),
        maxAgeDays:  parseInt(gv('s-max-age'), 10) || 20,
      };
    } else if (sectionId === 'jobspy') {
      endpoint = '/api/settings/env';
      var jpPayload = {
        search_term:                gv('s-jobspy-terms'),
        site_name:                  gv('s-jobspy-sites').split('\\n').map(function(s){return s.trim();}).filter(Boolean),
        results_wanted:             parseInt(gv('s-jobspy-results'), 10) || 20,
        hours_old:                  parseInt(gv('s-jobspy-hours'), 10) || 72,
        request_delay_ms:           parseInt(gv('s-jobspy-delay'), 10) || 3000,
        is_remote:                  gv('s-jobspy-remote'),
        linkedin_fetch_description: gv('s-jobspy-lidescs'),
      };
      var jobType = gv('s-jobspy-type');
      if (jobType) jpPayload.job_type = jobType;
      // Save JOBSPY_ENABLED to .env, config to jobspy-config.json
      var envEnabled = gv('s-jobspy-enabled') ? 'true' : 'false';
      Promise.all([
        fetch('/api/settings/env', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ JOBSPY_ENABLED: envEnabled }) }),
        fetch('/api/settings/jobspy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(jpPayload) }),
      ])
        .then(function(results) { return Promise.all(results.map(function(r) { return r.json(); })); })
        .then(function(datas) {
          var allOk = datas.every(function(d) { return d.ok; });
          if (btn) btn.disabled = false;
          if (status) { status.textContent = allOk ? 'Saved.' : ('Error: ' + (datas.find(function(d){return !d.ok;})||{}).error); status.style.color = allOk ? 'var(--green)' : 'var(--red)'; setTimeout(function(){ if(status) status.textContent=''; }, 3000); }
        })
        .catch(function(e) { if (btn) btn.disabled = false; if (status) { status.textContent = 'Save failed: ' + e.message; status.style.color = 'var(--red)'; } });
      return;
    } else if (sectionId === 'pipeline') {
      endpoint = '/api/settings/env';
      payload = {
        LOCATION_FILTER:          gv('s-location-filter'),
        LOCATION_BLOCKLIST:       gv('s-location-blocklist'),
        TITLE_BLOCKLIST:          gv('s-title-blocklist').split('\\n').map(function(s){return s.trim();}).filter(Boolean).join(','),
        BUILTIN_SUBDOMAIN:        gv('s-builtin-sub'),
        AUTO_ARCHIVE_THRESHOLD:   gv('s-archive-threshold'),
        GROQ_RATE_DELAY_MS:       gv('s-groq-delay'),
        REFRESH_INTERVAL_MINUTES: gv('s-refresh-interval'),
        TZ:                       gv('s-tz'),
        DASHBOARD_PORT:           gv('s-dashboard-port'),
      };
    } else if (sectionId === 'profile') {
      endpoint = '/api/settings/context';
      payload = { content: gv('s-context') };
    } else if (sectionId === 'email') {
      endpoint = '/api/settings/env';
      payload = {
        SMTP_HOST:       gv('s-smtp-host'),
        SMTP_PORT:       gv('s-smtp-port'),
        SMTP_USER:       gv('s-smtp-user'),
        SMTP_PASS:       gv('s-smtp-pass'),
        SMTP_FROM:       gv('s-smtp-from'),
        SMTP_SECURE:     gv('s-smtp-secure') ? 'true' : 'false',
        DIGEST_TO:        gv('s-digest-to'),
        DIGEST_MIN_SCORE: gv('s-digest-score'),
        DIGEST_MAX_JOBS:  gv('s-digest-max'),
        DIGEST_SEND_TIME: gv('s-digest-send-time'),
      };
    } else if (sectionId === 'rejections') {
      endpoint = '/api/settings/env';
      var provider = gv('s-imap-provider');
      payload = {
        IMAP_PROVIDER:                  provider,
        IMAP_EMAIL:                     gv('s-imap-email'),
        IMAP_APP_PASSWORD:              gv('s-imap-pass'),
        IMAP_HOST:                      gv('s-imap-host'),
        REJECTION_EMAIL_SYNC_DISABLED:  gv('s-reject-disabled') ? 'true' : '',
        REJECTION_EMAIL_POLL_INTERVAL_MS: gv('s-reject-interval'),
      };
      // Mirror to provider-specific vars for backward compat
      if (provider === 'gmail') {
        payload.GMAIL_EMAIL        = gv('s-imap-email');
        payload.GMAIL_APP_PASSWORD = gv('s-imap-pass');
      }
    } else {
      if (btn) btn.disabled = false;
      return;
    }

    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (btn) btn.disabled = false;
        if (status) {
          status.textContent = data.ok ? 'Saved.' : ('Error: ' + (data.error || 'unknown'));
          status.style.color = data.ok ? 'var(--green)' : 'var(--red)';
          setTimeout(function() { if (status) status.textContent = ''; }, 3000);
        }
      })
      .catch(function(e) {
        if (btn) btn.disabled = false;
        if (status) { status.textContent = 'Save failed: ' + e.message; status.style.color = 'var(--red)'; }
      });
  };
})();
</script>
</body>
</html>`;
}

module.exports = { renderSettingsPage };
