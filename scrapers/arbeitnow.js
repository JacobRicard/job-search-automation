'use strict';

const { stripHtml, safeFetch } = require('../lib/utils');
const { detectAts } = require('../lib/atsDetector');
const { matchesSearchTerms } = require('../lib/scraper-utils');
const { makeJobLead } = require('../lib/job-lead');

async function scrapeArbeitnow() {
  const jobs = [];
  // Free public API — remote international jobs, good for remote-anywhere roles
  const url = 'https://www.arbeitnow.com/api/job-board-api';
  const res = await safeFetch(url, {}, 'arbeitnow');
  if (!res) return jobs;

  let data;
  try { data = await res.json(); } catch { return jobs; }

  for (const job of data.data || []) {
    const title = job.title || '';
    if (!matchesSearchTerms(title)) continue;

    const jobUrl = job.url || '';
    const ats = detectAts(jobUrl);

    const rawLoc = Array.isArray(job.location)
      ? job.location.filter(Boolean).join(', ')
      : (job.location || '');
    const location = rawLoc || (job.remote ? 'Remote' : '');
    jobs.push(makeJobLead({
      title,
      company: job.company_name || '',
      directApplyUrl: jobUrl,
      atsPlatformName: ats ? ats.platform : 'Arbeitnow',
      scrapedTimestamp: new Date().toISOString(),
      description: stripHtml(job.description || ''),
      location,
    }));
  }

  return jobs;
}

module.exports = { scrapeArbeitnow };
