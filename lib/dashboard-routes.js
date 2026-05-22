'use strict';

const fs = require('fs');
const path = require('path');
const { scoreRejectionLikelihood, callGemini } = require('../scorer');
const { renderDashboard } = require('./dashboard-html');
const { GEMINI_DAILY_LIMIT, DAILY_TARGET } = require('../config/constants');
const { parseCompanyTags, serializeCompanyTags } = require('./company-tags');
const { FILTER_DEFS, postedTimestamp } = require('./html/helpers');
const { logEvent, touchJob, getGlobalStats, computeStatsFromJobs, getAppliedByCompany } = require('./db');
const { toLocalDateString, getScraperHealth, getTodayActivityCounts, getDailyManualApplyCounts, buildDailyDigest, getTrackerData } = require('./dashboard-insights');
const { isAccessible, computeApplicantYoe } = require('./seniority');
const { renderHelpPage } = require('./html/help-page');
const { jsonOk, jsonError, route, postRoute } = require('./routes/_helpers');
const { parseDashboardSearchOptions, applyDashboardSearch } = require('./dashboard-search');
const { loadMetros, loadPrefs, savePrefs } = require('./location-prefs');
const { passesPrefs } = require('./location-filter');
const { readJsonFile } = require('./utils');
const { parseGeminiJson } = require('./json-utils');
const { getHistoricalStageStats, getHistoricalAdvancedCountsByScore } = require('./stage-stats');
const {
  getLiveMarketResearchJobs,
  countLiveMarketResearchJobs,
  countAllTimeMarketResearchJobs,
  getLiveMarketSeniorityJobs,
  getAllTimeMarketSeniorityJobs,
  countAllTimeAppliedJobs,
} = require('./market-jobs');

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

const handlePipeline = postRoute(async ({ id, value }, res, db) => {
  const VALID_PIPELINE = ['', 'applied', 'phone_screen', 'interview', 'onsite', 'offer', 'closed', 'rejected', 'ghosted'];
  if (!VALID_PIPELINE.includes(value)) { jsonError(res, 400, 'bad pipeline value'); return; }
  const current = db.prepare("SELECT stage, status FROM jobs WHERE id=?").get(id);
  const fromStage = current?.stage || null;

  db.transaction(() => {
    if (!value) {
      touchJob(db, id, { status: 'pending', stage: null });
      logEvent(db, id, 'stage_change', fromStage, null);
    } else if (value === 'closed') {
      db.prepare(`
        UPDATE jobs SET
          status='closed',
          stage='closed',
          updated_at=datetime('now')
        WHERE id=?
      `).run(id);
      logEvent(db, id, 'stage_change', fromStage, 'closed');
    } else if (value === 'rejected') {
      db.prepare(`
        UPDATE jobs SET
          status='rejected',
          stage='rejected',
          rejected_from_stage=?,
          rejected_at=datetime('now'),
          updated_at=datetime('now')
        WHERE id=?
      `).run(fromStage, id);
      logEvent(db, id, 'stage_change', fromStage, 'rejected');
    } else if (value === 'ghosted') {
      db.prepare(`
        UPDATE jobs SET
          status='ghosted',
          stage='ghosted',
          updated_at=datetime('now')
        WHERE id=?
      `).run(id);
      logEvent(db, id, 'stage_change', fromStage, 'ghosted');
    } else {
      db.prepare(`
        UPDATE jobs SET
          status='applied',
          stage=?,
          applied_at=COALESCE(applied_at, datetime('now')),
          updated_at=datetime('now')
        WHERE id=?
      `).run(value, id);
      logEvent(db, id, 'stage_change', fromStage, value);
    }
  })();

  if (value === 'applied' || value === 'rejected') {
    const job = db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
    scoreRejectionLikelihood(job)
      .then(text => {
        touchJob(db, id, { rejection_reasoning: text });
      })
      .catch(() => {}); // non-critical, silent on failure
  }

  jsonOk(res, { ok: true });
});

const handleMarkOutreach = postRoute(async ({ id, clear }, res, db) => {
  if (clear) {
    touchJob(db, id, { reached_out_at: null });
    logEvent(db, id, 'outreach', 'reached_out', null);
    jsonOk(res, { ok: true, reached_out_at: null });
  } else {
    touchJob(db, id, { reached_out_at: touchJob.NOW });
    logEvent(db, id, 'outreach', null, 'reached_out');
    const row = db.prepare("SELECT reached_out_at FROM jobs WHERE id=?").get(id);
    if (!row) { jsonError(res, 404, 'job not found'); return; }
    jsonOk(res, { ok: true, reached_out_at: row.reached_out_at });
  }
});


const handleArchive = postRoute(async ({ id }, res, db) => {
  db.transaction(() => {
    touchJob(db, id, { status: 'archived' });
    logEvent(db, id, 'status_change', null, 'archived');
  })();
  jsonOk(res, { ok: true });
});

const handleJobDescription = route((req, res, db, url) => {
  const id = url.searchParams.get('id');
  if (!id) { jsonError(res, 400, 'id required'); return; }
  const job = db.prepare('SELECT title, company, url, description FROM jobs WHERE id = ?').get(id);
  if (!job) { jsonError(res, 404, 'not found'); return; }
  jsonOk(res, job);
});

const handleGetCompanyNotes = route((req, res, db, url) => {
  const company = (url.searchParams.get('company') || '').toLowerCase().trim();
  if (!company) { jsonOk(res, { tags: '', notes: '' }); return; }
  let row = null;
  try { row = db.prepare("SELECT tags, notes FROM company_notes WHERE company = ?").get(company); } catch (e) { /* table may not exist */ }
  jsonOk(row ? { ...row, tags: serializeCompanyTags(row.tags) } : { tags: '', notes: '' });
});

const handleSaveCompanyNotes = postRoute(async ({ company, tags, notes }, res, db) => {
  const key = (company || '').toLowerCase().trim();
  if (!key) { jsonError(res, 400, 'company required'); return; }
  const normalizedTags = serializeCompanyTags(tags);
  db.prepare(`
    INSERT INTO company_notes (company, tags, notes, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(company) DO UPDATE SET tags=excluded.tags, notes=excluded.notes, updated_at=datetime('now')
  `).run(key, normalizedTags, notes || '');
  jsonOk(res, { ok: true });
});

function handleResume(req, res, db, url) {
  const profileDir = process.env.JOB_PROFILE_DIR || path.join(__dirname, '..', 'profiles', 'example');
  const variant = url && url.searchParams.get('variant');
  const fileMap = {
    ai:     'resume-ai.pdf',
    devops: 'resume-devops.pdf',
  };
  const fileName = fileMap[variant] || 'resume.pdf';
  const resumePath = path.join(profileDir, fileName);
  if (fs.existsSync(resumePath)) {
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${fileName}"`,
    });
    fs.createReadStream(resumePath).pipe(res);
    return;
  }
  res.writeHead(404); res.end(`Resume PDF not found: ${fileName}. Run: node generate-resume.js`);
}

// ---------------------------------------------------------------------------
// Dashboard data fetchers
// ---------------------------------------------------------------------------

// Pre-built ORDER BY clauses — no user input enters SQL strings
const ORDER_BY = {
  'date-applied':  'applied_at DESC, created_at DESC',
  'date-posted':   'posted_at DESC, created_at DESC',
  'date-rejected': 'COALESCE(rejected_at, updated_at) DESC',
  'score-applied': 'score DESC, applied_at DESC, created_at DESC',
  'score-posted':  'score DESC, posted_at DESC, created_at DESC',
  'score-rejected': 'score DESC, COALESCE(rejected_at, updated_at) DESC',
};
const JOBS_PAGE_SIZE = 25;

function fetchFilteredJobs(db, filter, sort, level) {
  const sortMode = sort === 'date' ? 'date' : 'score';
  const dateKey = filter === 'rejected' ? 'rejected' : 'posted';
  const scoreKey = filter === 'applied' ? 'applied' : dateKey;
  const orderKey = sortMode === 'date' ? dateKey : scoreKey;
  const orderBy = ORDER_BY[`${sortMode}-${orderKey}`];

  const filterQueries = {
    'all':          () => db.prepare(`SELECT * FROM jobs WHERE status NOT IN ('archived','rejected','closed','ghosted') ORDER BY ${orderBy}`).all(),
    'not-applied':  () => db.prepare(`SELECT * FROM jobs WHERE status NOT IN ('applied','responded','archived','closed','ghosted') AND COALESCE(stage, '') NOT IN ('closed', 'rejected', 'ghosted') ORDER BY ${orderBy}`).all(),
    'applied':      () => db.prepare(`SELECT * FROM jobs WHERE status IN ('applied','responded') AND COALESCE(stage,'applied') NOT IN ('closed','rejected','ghosted') ORDER BY ${orderBy}`).all(),
    'interviewing': () => db.prepare(`SELECT * FROM jobs WHERE stage IN ('phone_screen','interview','onsite','offer') ORDER BY ${orderBy}`).all(),
    'rejected':     () => db.prepare(`SELECT * FROM jobs WHERE stage = 'rejected' ORDER BY ${orderBy}`).all(),
    'closed':       () => db.prepare(`SELECT * FROM jobs WHERE stage = 'closed' ORDER BY updated_at DESC`).all(),
    'ghosted':      () => db.prepare(`SELECT * FROM jobs WHERE stage = 'ghosted' ORDER BY updated_at DESC`).all(),
    'analytics':    () => [],
    'activity-log': () => [],
    'archived':     () => db.prepare(`SELECT * FROM jobs WHERE status = 'archived' ORDER BY ${orderBy}`).all(),
  };

  let jobs = (filterQueries[filter] || filterQueries['all'])();
  if (level === '1') jobs = jobs.filter(j => isAccessible(j.title, j.description));
  // Re-sort by JS timestamp when date sort is active — SQL ORDER BY posted_at
  // fails for text values like "Posted Yesterday" vs ISO dates.
  if (sortMode === 'date' && orderKey === 'posted') {
    jobs.sort((a, b) => postedTimestamp(b.posted_at) - postedTimestamp(a.posted_at));
  }
  return jobs;
}

function paginateJobs(jobs, requestedPage) {
  const totalItems = jobs.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / JOBS_PAGE_SIZE));
  const page = Math.min(Math.max(requestedPage, 1), totalPages);
  const startIndex = (page - 1) * JOBS_PAGE_SIZE;
  const endIndex = Math.min(startIndex + JOBS_PAGE_SIZE, totalItems);

  return {
    jobs: jobs.slice(startIndex, endIndex),
    pagination: {
      page,
      pageSize: JOBS_PAGE_SIZE,
      totalItems,
      totalPages,
      startItem: totalItems ? startIndex + 1 : 0,
      endItem: endIndex,
    },
  };
}

function fetchDashboardContext(db, overrideStats) {
  const appliedByCompany = getAppliedByCompany(db);

  const globalStats = overrideStats || getGlobalStats(db);
  const todayStr = toLocalDateString();
  const dailyDigest = buildDailyDigest(db, todayStr);

  const dailyCounts = getDailyManualApplyCounts(db).map(row => ({ ...row, target: DAILY_TARGET }));
  Object.assign(globalStats, getTodayActivityCounts(db, todayStr));
  globalStats.dailyTarget = DAILY_TARGET;

  const usageRow = db.prepare("SELECT COALESCE(SUM(call_count), 0) as used FROM api_usage WHERE date = ?").get(todayStr);
  const apiUsage = { used: usageRow ? usageRow.used : 0, limit: GEMINI_DAILY_LIMIT };

  const scraperHealth = getScraperHealth(db, todayStr);

  const companyTags = {};
  try {
    for (const row of db.prepare("SELECT company, tags FROM company_notes WHERE tags IS NOT NULL AND tags != ''").all()) {
      companyTags[row.company.toLowerCase().trim()] = parseCompanyTags(row.tags);
    }
  } catch (e) { /* company_notes table may not exist yet */ }

  return { appliedByCompany, dailyDigest, globalStats, dailyCounts, apiUsage, scraperHealth, companyTags };
}

function fetchAnalyticsData(db) {
  const historicalStages = getHistoricalStageStats(db);
  const allTimeStats = {
    applied:      db.prepare("SELECT COUNT(*) n FROM jobs WHERE applied_at IS NOT NULL").get().n,
    rejected:     db.prepare("SELECT COUNT(*) n FROM jobs WHERE stage='rejected'").get().n,
    phoneScreens: historicalStages.phoneScreens,
    interviewing: historicalStages.interviews,
    offers:       historicalStages.offers,
    pending:      db.prepare("SELECT COUNT(*) n FROM jobs WHERE status NOT IN ('applied','responded','archived','closed','rejected','ghosted') AND COALESCE(stage, '') NOT IN ('closed','rejected','ghosted')").get().n,
  };

  const funnel = { applied: allTimeStats.applied, ...historicalStages.funnel };
  const advancedByScore = getHistoricalAdvancedCountsByScore(db);

  const scoreCalibration = db.prepare(`
    SELECT score,
      COUNT(*) as total,
      SUM(CASE WHEN status IN ('applied','responded') AND COALESCE(stage, '') NOT IN ('closed','rejected','ghosted') THEN 1 ELSE 0 END) as active,
      SUM(CASE WHEN stage = 'rejected' THEN 1 ELSE 0 END) as rejected
    FROM jobs WHERE score IS NOT NULL AND applied_at IS NOT NULL
    GROUP BY score ORDER BY score
  `).all().map(row => ({
    ...row,
    advanced: advancedByScore.get(row.score) || 0,
  }));

  const recentEvents = db.prepare(`
    SELECT e.event_type, e.from_value, e.to_value, e.created_at,
      j.company, j.title
    FROM events e JOIN jobs j ON e.job_id = j.id
    ORDER BY e.created_at DESC
  `).all();

  const rejectionInsights = db.prepare(`
    SELECT e.from_value as rejected_from,
      j.company, j.title, j.score, j.posted_at, j.applied_at,
      ROUND(julianday(e.created_at) - julianday(j.applied_at), 1) as days_to_reject,
      ROUND(julianday(j.applied_at) - julianday(j.posted_at), 1) as posting_age
    FROM events e JOIN jobs j ON e.job_id = j.id
    WHERE e.to_value = 'rejected'
    ORDER BY e.created_at DESC
  `).all();

  return {
    allTimeStats,
    funnel,
    scoreCalibration,
    recentEvents,
    rejectionInsights,
  };
}

// ---------------------------------------------------------------------------
// Market research
// ---------------------------------------------------------------------------

const MARKET_RESEARCH_PROFILE_DIR = process.env.JOB_PROFILE_DIR || path.join(__dirname, '..', 'profiles', 'example');
const MARKET_RESEARCH_CACHE_PATH = path.join(MARKET_RESEARCH_PROFILE_DIR, 'market-research-cache.json');
const RESUME_PATH_FOR_RESEARCH = path.join(MARKET_RESEARCH_PROFILE_DIR, 'resume-ai.md');

function loadMarketResearchCache() {
  return readJsonFile(MARKET_RESEARCH_CACHE_PATH);
}

const handleMarketResearch = route(async (req, res, db) => {
  if (req.method === 'GET') {
    // Redirect to dashboard page — handled by handleDashboardPage
    res.writeHead(302, { Location: '/?filter=market-research' });
    res.end();
    return;
  }

  // POST — run analysis
  const jobs = getLiveMarketResearchJobs(db);

  const resume = fs.existsSync(RESUME_PATH_FOR_RESEARCH)
    ? fs.readFileSync(RESUME_PATH_FOR_RESEARCH, 'utf8')
    : '';
  const jdBlock = jobs.map((j, i) =>
    `[JD ${i+1}] ${j.company} — ${j.title} (score:${j.score}, location:${j.location || 'not specified'})\n${(j.description || '').slice(0, 600)}`
  ).join('\n\n---\n\n');

  const prompt = `You are a job market analyst. Analyze these ${jobs.length} job descriptions for a DevOps/Infrastructure/Platform engineer role and compare them against the candidate's resume.

CANDIDATE RESUME:
${resume}

JOB DESCRIPTIONS (each prefixed with score 1-10, where 10 = best fit):
${jdBlock}

Return ONLY a valid JSON object (no markdown, no explanation, no code fences). Schema:
{
  "summary": "3-5 sentence strategic take on what the market is asking for vs what this candidate offers. Be specific and actionable.",
  "top_skills": [{"skill": "string", "count": number, "pct": number}],
  "gap_analysis": [{"skill": "string", "count": number, "pct": number, "note": "brief explanation"}],
  "resume_strengths": [{"skill": "string", "count": number}],
  "trending": ["string"],
  "location_breakdown": {"remote": number, "hybrid": number, "in_person": number, "not_specified": number, "top_cities": [{"city": "string", "count": number}]},
  "sample_size": ${jobs.length},
  "strategy_score": {
    "idp_pct": number,
    "ops_pct": number,
    "pivot_direction": "builder | operator | balanced",
    "pivot_note": "string"
  },
  "emerging_high_score": [
    {
      "term": "string",
      "job_count": number,
      "note": "string"
    }
  ]
}

Rules:
- top_skills: top 20 skills/technologies by frequency across all JDs, sorted by count desc. count = number of JDs mentioning it, pct = percentage of total JDs.
  IMPORTANT: Track "ECS/Fargate" as its own explicit skill. Count a JD toward "ECS/Fargate" only if it specifically mentions ECS, Fargate, ECS Fargate, or Amazon ECS. Generic AWS mentions (Lambda, S3, IAM, etc.) without ECS/Fargate do NOT count. A JD mentioning Fargate counts for BOTH "AWS" and "ECS/Fargate".
- gap_analysis: skills appearing in >= 15% of JDs that are NOT present or underrepresented on the resume. Max 10 items. Sorted by count desc.
- resume_strengths: skills from the resume that appear in >= 20% of JDs. Max 10 items. Sorted by count desc.
- trending: 5-8 emerging/newer terms or concepts appearing in JDs that signal where the market is heading in 2026. These should be things like new frameworks, methodologies, or terminology not yet mainstream.
- location_breakdown: categorize each JD's location field. "remote" = fully remote (includes "Remote", "Work from Home", "Anywhere"). "hybrid" = mix of remote and office days mentioned. "in_person" = on-site only, no remote option. "not_specified" = location field is blank, null, or ambiguous. top_cities: list the top 10 most common specific cities/metros mentioned across all JDs, each with a count of how many JDs mention that city/metro.
- strategy_score: For each JD, determine if it primarily emphasizes (a) building platforms/IDPs/internal tooling/developer experience (IDP/builder), or (b) managing/operating/reliability/incident response (Ops/operator). idp_pct = % of JDs skewing builder. ops_pct = % skewing operator. These should sum to ~100. pivot_direction: "builder" if idp_pct > 55, "operator" if ops_pct > 55, else "balanced". pivot_note = 1 sentence on what this ratio signals about the 2026 market direction.
- emerging_high_score: Look specifically at JDs with score >= 9. Find terms, concepts, or technologies that appear in those high-score JDs but are rare or absent in lower-scored JDs. These are signals of what employers most value in 2026. Up to 8 terms, sorted by job_count desc. term = the keyword/concept, job_count = how many score-9+ JDs contain it, note = 1 sentence on why it signals value.
- All counts and pcts must be real numbers based on actual analysis of the JDs provided.`;

  const raw = await callGemini(prompt, 3, 5000);

  const data = parseGeminiJson(raw);

  const cache = { generatedAt: Date.now(), jobCount: jobs.length, data };
  fs.writeFileSync(MARKET_RESEARCH_CACHE_PATH, JSON.stringify(cache, null, 2));

  res.writeHead(302, { Location: '/?filter=market-research' });
  res.end();
});

// ---------------------------------------------------------------------------
// Dashboard page handler
// ---------------------------------------------------------------------------

function loadSlugHealth() {
  const p = path.join(__dirname, '..', 'slug-health.json');
  const data = readJsonFile(p);
  if (!data) return null;
  const dp = path.join(__dirname, '..', 'slug-health-dismissed.json');
  const dismissed = readJsonFile(dp);
  if (dismissed && dismissed.ts === data.timestamp) data._dismissed = true;
  return data;
}

const handleDismissSlugBanner = postRoute(async (_body, res) => {
  try {
    const p = path.join(__dirname, '..', 'slug-health.json');
    const data = readJsonFile(p, {});
    const dp = path.join(__dirname, '..', 'slug-health-dismissed.json');
    fs.writeFileSync(dp, JSON.stringify({ ts: data.timestamp }));
    jsonOk(res, { ok: true });
  } catch (e) { jsonError(res, 500, e.message); }
});

function loadJdHealth() {
  return readJsonFile(path.join(__dirname, '..', 'jd-health.json'));
}

function computeMyLevelCount(db, filter, sort, level, searchOptions, baseJobs, allJobs, isPaginatedListView) {
  const baseJobsForLevel = level === '1'
    ? baseJobs
    : fetchFilteredJobs(db, filter, sort, null);
  const jobsForLevel = isPaginatedListView
    ? (level === '1' ? allJobs : applyDashboardSearch(baseJobsForLevel, searchOptions))
    : baseJobsForLevel;
  return jobsForLevel.filter(j => isAccessible(j.title, j.description)).length;
}

function loadMarketResearchPageData(db) {
  const currentJobs = getLiveMarketSeniorityJobs(db);
  const allTimeJobs = getAllTimeMarketSeniorityJobs(db);
  return {
    cache: loadMarketResearchCache(),
    jobCount: countLiveMarketResearchJobs(db),
    allJobs: currentJobs,
    current: {
      jobCount: countLiveMarketResearchJobs(db),
      jdCount: countLiveMarketResearchJobs(db),
      jobs: currentJobs,
    },
    allTime: {
      jobCount: allTimeJobs.length,
      jdCount: countAllTimeMarketResearchJobs(db),
      jobs: allTimeJobs,
    },
    appliedCount: countAllTimeAppliedJobs(db),
    applicantYoe: computeApplicantYoe(MARKET_RESEARCH_PROFILE_DIR),
  };
}

function handleDashboardPage(req, res, db, url) {
  const requestedFilter = url.searchParams.get('filter') || 'all';
  const rawFilter = requestedFilter;
  const allowedFilters = FILTER_DEFS.map(f => f.id);
  const filter = allowedFilters.includes(rawFilter) ? rawFilter : 'all';
  const rawSort = url.searchParams.get('sort');
  const requestedSort = rawSort === 'date' ? 'date' : 'score';
  const sort = filter === 'rejected' && !rawSort ? 'date' : requestedSort;
  const level = url.searchParams.get('level') === '1' ? '1' : null;
  const searchOptions = parseDashboardSearchOptions(url);
  const rawPage = Number.parseInt(url.searchParams.get('page') || '1', 10);
  const requestedPage = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const isPaginatedListView = !['analytics', 'activity-log', 'market-research'].includes(filter);

  const metros = loadMetros();
  const locationPrefs = loadPrefs();
  const locationActive = locationPrefs.metros.length > 0 || locationPrefs.includeUnknown === false;

  // When the location filter is active, recompute the header tab counts off
  // the filtered job universe so All/Pending/Applied/Interviewing/etc. scope
  // to the user's chosen metro. Also drop unscored jobs so counts match what
  // the list view actually shows (the list applies a min-score floor of 1).
  let overrideStats = null;
  if (locationActive) {
    const allRows = db.prepare("SELECT status, stage, location, title, score FROM jobs").all();
    const filteredRows = allRows.filter((j) =>
      Number(j.score ?? 0) >= 1 && passesPrefs(j, locationPrefs, metros)
    );
    overrideStats = computeStatsFromJobs(filteredRows);
  }

  const rawBase = fetchFilteredJobs(db, filter, sort, level);
  const baseJobs = isPaginatedListView && locationActive
    ? rawBase.filter((j) => passesPrefs(j, locationPrefs, metros))
    : rawBase;
  const locationHiddenCount = isPaginatedListView ? rawBase.length - baseJobs.length : 0;

  const allJobs = isPaginatedListView ? applyDashboardSearch(baseJobs, searchOptions) : baseJobs;
  const { jobs, pagination } = isPaginatedListView
    ? paginateJobs(allJobs, requestedPage)
    : { jobs: allJobs, pagination: null };
  const context = fetchDashboardContext(db, overrideStats);
  context.globalStats.myLevel = computeMyLevelCount(db, filter, sort, level, searchOptions, baseJobs, allJobs, isPaginatedListView);

  const analyticsData = ['analytics', 'activity-log'].includes(filter)
    ? fetchAnalyticsData(db)
    : null;
  const marketResearchData = filter === 'market-research' ? loadMarketResearchPageData(db) : null;

  const html = renderDashboard({
    jobs, pagination, filter, sort, level, searchOptions,
    ...context,
    analyticsData, marketResearchData,
    slugHealth: loadSlugHealth(), jdHealth: loadJdHealth(),
    locationPrefs, metros, locationHiddenCount,
  });
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html);
}

const handleLocationPrefsApi = route(async (req, res) => {
  if (req.method === 'GET') {
    jsonOk(res, { prefs: loadPrefs(), metros: loadMetros() });
    return;
  }
  if (req.method === 'POST') {
    const body = await require('./routes/_helpers').parseBody(req);
    const saved = savePrefs(body);
    jsonOk(res, { ok: true, prefs: saved });
    return;
  }
  jsonError(res, 405, 'method not allowed');
});

function handleHelpPage(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(renderHelpPage());
}

function handleTrackerApi(req, res, db) {
  const url = new URL(req.url, 'http://localhost');
  const period = ['7d', '30d', '90d', 'all'].includes(url.searchParams.get('period'))
    ? url.searchParams.get('period')
    : '30d';
  const rows = getTrackerData(db, period);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(rows));
}

const handleInsightsApi = route((req, res, db) => {
  const todayStr = toLocalDateString();
  const counts = getTodayActivityCounts(db, todayStr);
  const digest = buildDailyDigest(db, todayStr);
  const scraperHealth = getScraperHealth(db, todayStr);
  const dailyCounts = getDailyManualApplyCounts(db).map(row => ({ ...row, target: DAILY_TARGET }));
  jsonOk(res, { ...counts, dailyDigest: digest, scraperHealth, dailyCounts });
});

module.exports = {
  handlePipeline,
  handleMarkOutreach,
  handleArchive,
  handleResume,
  handleGetCompanyNotes,
  handleSaveCompanyNotes,
  handleJobDescription,
  handleDashboardPage,
  handleHelpPage,
  fetchFilteredJobs,
  handleMarketResearch,
  handleDismissSlugBanner,
  handleTrackerApi,
  handleInsightsApi,
  handleLocationPrefsApi,
  fetchAnalyticsData,
};
