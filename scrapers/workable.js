'use strict';

const { sleep } = require('../lib/utils');
const { WORKABLE_COMPANIES } = require('../config/companies');
const { matchesSearchTerms } = require('../lib/scraper-utils');
const { fetchWorkableAccountJobs } = require('../lib/workable');
const log = require('../lib/logger')('workable-scraper');

async function scrapeWorkable() {
  const jobs = [];

  for (const company of WORKABLE_COMPANIES) {
    const slugLog = log.child({ slug: company });
    const result = await fetchWorkableAccountJobs(company);
    slugLog.info('Workable slug checked', {
      result: result.result,
      count: result.count,
      attempts: result.attempts.map((attempt) => ({
        endpoint: attempt.endpoint,
        status: attempt.status,
        count: attempt.count,
      })),
    });

    for (const job of result.jobs || []) {
      if (!matchesSearchTerms(job.title)) continue;
      jobs.push(job);
    }

    await sleep(400);
  }

  return jobs;
}

module.exports = { scrapeWorkable };
