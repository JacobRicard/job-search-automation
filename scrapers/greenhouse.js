'use strict';

const { stripHtml } = require('../lib/utils');
const { scrapeCompanies } = require('../lib/base-scraper');
const { GREENHOUSE_COMPANIES } = require('../config/companies');
const { makeJobLead } = require('../lib/job-lead');

async function scrapeGreenhouse() {
  return scrapeCompanies({
    companies: GREENHOUSE_COMPANIES,
    platform: 'greenhouse',
    buildUrl: (company) => `https://boards-api.greenhouse.io/v1/boards/${company}/jobs?content=true`,
    parseResponse: (data) => data.jobs || [],
    matchField: (job) => job.title,
    mapJob: (job, company) => makeJobLead({
      title: job.title,
      company: company,
      directApplyUrl: job.absolute_url,
      atsPlatformName: 'Greenhouse',
      scrapedTimestamp: new Date().toISOString(),
      description: stripHtml(job.content || ''),
    }),
  });
}

module.exports = { scrapeGreenhouse };
