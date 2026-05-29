/**
 * scraper.js
 * Thin orchestrator — runs all platform scrapers in parallel and writes jobs.json.
 *
 * Usage (standalone):  node scraper.js
 * Usage (module):      const { scrapeAll } = require('./scraper');
 */

'use strict';

const fs = require('fs');
const { loadDashboardEnv } = require('./lib/env');

loadDashboardEnv(__dirname);

const { jobsJsonPath } = require('./config/paths');
const logPaths = require('./lib/log-paths');
const log = require('./lib/logger')('scraper', { logFile: logPaths.daily('scraper') });
const { validateJobs } = require('./lib/validate');
const { deriveJobId, validateWithPydantic } = require('./lib/job-lead');
const { scraperRunsTotal } = require('./lib/metrics');
const { scrapeGreenhouse } = require('./scrapers/greenhouse');
const { scrapeLever }      = require('./scrapers/lever');
const { scrapeWorkable }   = require('./scrapers/workable');
const { scrapeWellfound }  = require('./scrapers/wellfound');
const { scrapeRemoteOK }   = require('./scrapers/remoteok');
const { scrapeJobicy }     = require('./scrapers/jobicy');
const { scrapeArbeitnow }  = require('./scrapers/arbeitnow');
const { scrapeWWR }        = require('./scrapers/wwr');
const { scrapeAshby }      = require('./scrapers/ashby');
const { scrapeWorkday }    = require('./scrapers/workday');
const { scrapeBuiltin }    = require('./scrapers/builtin');
const { scrapeRippling }   = require('./scrapers/rippling');
const { scrapeJobSpy }     = require('./scrapers/jobspy');

const { MAX_AGE_DAYS }      = require('./config/companies');
const { isPrimaryPlatform } = require('./lib/ats-resolver');

const MS_PER_DAY = 86_400_000;

function isRecent(dateVal) {
  if (!dateVal) return false;
  const ts = typeof dateVal === 'number' ? dateVal : Date.parse(dateVal);
  if (isNaN(ts)) return false;
  return Date.now() - ts <= MAX_AGE_DAYS * MS_PER_DAY;
}

const SCRAPER_TIMEOUT_MS = 5 * 60 * 1000; // 5 min hard cap per scraper

function timed(label, fn) {
  const platformLog = log.child({ label });
  const start = Date.now();
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`timeout after ${SCRAPER_TIMEOUT_MS / 1000}s`)), SCRAPER_TIMEOUT_MS)
  );
  return Promise.race([fn(), timeout]).then(
    (v) => {
      scraperRunsTotal.inc({ platform: label, outcome: 'success' });
      platformLog.info('Scraper done', { ms: Date.now() - start });
      return v;
    },
    (e) => {
      const ms = Date.now() - start;
      scraperRunsTotal.inc({ platform: label, outcome: 'failure' });
      platformLog.warn('Scraper timed out or failed', { ms, error: e.message });
      process.stdout.write(JSON.stringify({ level: 'error', platform: label, error: e.message, ms }) + '\n');
      return [];
    }
  );
}

async function scrapeAll() {
  log.info('Starting scrape across all platforms');

  const [greenhouse, lever, workable, wellfound, remoteok, jobicy, arbeitnow, wwr, ashby, workday, builtin, rippling, jobspy] = await Promise.allSettled([
    timed('greenhouse', scrapeGreenhouse),
    timed('lever', scrapeLever),
    timed('workable', scrapeWorkable),
    timed('wellfound', scrapeWellfound),
    timed('remoteok', scrapeRemoteOK),
    timed('jobicy', scrapeJobicy),
    timed('arbeitnow', scrapeArbeitnow),
    timed('wwr', scrapeWWR),
    timed('ashby', scrapeAshby),
    timed('workday', scrapeWorkday),
    timed('builtin', scrapeBuiltin),
    timed('rippling', scrapeRippling),
    timed('jobspy', () => Promise.resolve(scrapeJobSpy())),
  ]);

  const results = [
    ['greenhouse', greenhouse], ['lever', lever], ['workable', workable],
    ['wellfound', wellfound], ['remoteok', remoteok], ['jobicy', jobicy],
    ['arbeitnow', arbeitnow], ['wwr', wwr], ['ashby', ashby], ['workday', workday],
    ['builtin', builtin], ['rippling', rippling], ['jobspy', jobspy],
  ];

  const allJobs = results.flatMap(([label, r]) =>
    r.status === 'fulfilled' ? validateJobs(r.value, label) : []
  );

  // Deduplicate by derived internal id within this batch (DB-level dedup happens in pipeline.js)
  const seen = new Set();
  const uniqueById = allJobs.filter((j) => {
    if (!j.direct_apply_url) return false;
    const key = deriveJobId(j);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Cross-source dedup by title+company: prefer primary-ATS sources over aggregators.
  // Sort so primary ATS (greenhouse/lever/ashby/workday) come first, then dedup by title+company.
  uniqueById.sort((a, b) => {
    const aPrimary = isPrimaryPlatform(a.ats_platform_name) ? 0 : 1;
    const bPrimary = isPrimaryPlatform(b.ats_platform_name) ? 0 : 1;
    return aPrimary - bPrimary;
  });
  const seenTitleCompany = new Set();
  const unique = uniqueById.filter((j) => {
    const tcKey = `${(j.title || '').toLowerCase().trim()}|||${(j.company || '').toLowerCase().trim()}`;
    if (seenTitleCompany.has(tcKey)) return false;
    seenTitleCompany.add(tcKey);
    return true;
  });

  // Age filter: keep if new to DB (not in knownIds) OR recently scraped.
  // A caller may write existing job IDs to /tmp/known_job_ids.json before scraping.
  let knownIds = new Set();
  try {
    knownIds = new Set(JSON.parse(fs.readFileSync('/tmp/known_job_ids.json', 'utf8')));
  } catch {}
  const ageFiltered = unique.filter((j) => !knownIds.has(deriveJobId(j)) || isRecent(j.scraped_timestamp || ''));
  const validated = validateWithPydantic(ageFiltered);

  log.info('Scrape complete', {
    beforeFilter: unique.length,
    afterFilter: validated.length,
  });

  // Write strict JobLead records to jobs.json — ATS resolution happens in pipeline.js
  fs.writeFileSync(jobsJsonPath, JSON.stringify(validated, null, 2));

  return validated;
}

// Run standalone
if (require.main === module) {
  scrapeAll()
    .then((jobs) => { log.info('Scraped jobs written to jobs.json', { count: jobs.length }); process.exit(0); })
    .catch((err) => {
      log.error('Fatal error', { error: err.message });
      process.exit(1);
    });
}

module.exports = { scrapeAll, isRecent };
