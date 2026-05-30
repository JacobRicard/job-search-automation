'use strict';

const { sleep, safeFetch, stripHtml } = require('../lib/utils');
const { WORKDAY_COMPANIES, SEARCH_TERMS } = require('../config/companies');
const { makeJobLead } = require('../lib/job-lead');

// How many companies to query in parallel. Workday is tolerant of concurrent
// requests but we cap it to avoid hammering shared infra.
const WORKDAY_CONCURRENCY = 8;

async function scrapeCompany({ sub, wd, board, label }) {
  const jobs = [];
  const seen = new Set();
  const baseUrl = `https://${sub}.wd${wd}.myworkdayjobs.com`;
  const listUrl = `${baseUrl}/wday/cxs/${sub}/${board}/jobs`;

  // Run all search terms in parallel for this company
  const termResults = await Promise.allSettled(
    SEARCH_TERMS.map(term =>
      safeFetch(listUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 20, offset: 0, searchText: term }),
      }, `workday/${sub}/${term}`)
        .then(res => res ? res.json() : null)
        .catch(() => null)
    )
  );

  // Collect unique matching jobs across all terms
  const detailFetches = [];
  for (const r of termResults) {
    if (r.status !== 'fulfilled' || !r.value) continue;
    for (const job of r.value.jobPostings || []) {
      const jobId = `workday-${sub}-${job.externalPath?.split('/').pop() || job.title}`;
      if (seen.has(jobId)) continue;
      seen.add(jobId);
      const listLocation = job.locationsText || (Array.isArray(job.bulletFields) ? job.bulletFields[0] : '') || '';
      detailFetches.push({ job, jobId, listLocation });
    }
  }

  // Fetch descriptions in parallel
  const detailResults = await Promise.allSettled(
    detailFetches.map(({ job, jobId, listLocation }) => {
      if (!job.externalPath) return Promise.resolve({ job, jobId, description: '', location: listLocation });
      const detailUrl = `${baseUrl}/wday/cxs/${sub}/${board}${job.externalPath}`;
      return safeFetch(detailUrl, {}, `workday/${sub}/detail`)
        .then(res => res ? res.json() : null)
        .then(detail => {
          const info = detail?.jobPostingInfo || {};
          const extra = Array.isArray(info.additionalLocations) ? info.additionalLocations.filter(Boolean) : [];
          const location = [info.location, ...extra].filter(Boolean).join(' | ') || listLocation || '';
          return {
            job,
            description: stripHtml(info.jobDescription || ''),
            location,
          };
        })
        .catch(() => ({ job, description: '', location: listLocation || '' }));
    })
  );

  for (const r of detailResults) {
    if (r.status !== 'fulfilled') continue;
    const { job, description, location } = r.value;
    jobs.push(makeJobLead({
      title: job.title,
      company: label,
      directApplyUrl: `${baseUrl}/en-US/${board}${job.externalPath}`,
      atsPlatformName: 'Workday',
      scrapedTimestamp: new Date().toISOString(),
      description,
      location,
    }));
  }

  return jobs;
}

async function scrapeWorkday() {
  const allJobs = [];

  // Process companies in parallel batches
  for (let i = 0; i < WORKDAY_COMPANIES.length; i += WORKDAY_CONCURRENCY) {
    const batch = WORKDAY_COMPANIES.slice(i, i + WORKDAY_CONCURRENCY);
    const results = await Promise.allSettled(batch.map(scrapeCompany));
    for (const r of results) {
      if (r.status === 'fulfilled') allJobs.push(...r.value);
    }
    if (i + WORKDAY_CONCURRENCY < WORKDAY_COMPANIES.length) await sleep(300);
  }

  return allJobs;
}

module.exports = { scrapeWorkday };
