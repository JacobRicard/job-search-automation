'use strict';

const { stripHtml } = require('../lib/utils');
const { scrapeCompanies } = require('../lib/base-scraper');
const { ASHBY_COMPANIES } = require('../config/companies');
const { MAX_DESCRIPTION_LENGTH } = require('../config/constants');
const { makeJobLead } = require('../lib/job-lead');

async function scrapeAshby() {
  return scrapeCompanies({
    companies: ASHBY_COMPANIES,
    platform: 'ashby',
    buildUrl: (company) => `https://api.ashbyhq.com/posting-api/job-board/${company}?includeCompensation=true`,
    parseResponse: (data) => data.jobs || [],
    matchField: (job) => job.title,
    mapJob: (job, company) => {
      const baseDesc = job.descriptionPlain || stripHtml(job.descriptionHtml || '');
      const salarySummary = job.compensation?.scrapeableCompensationSalarySummary
        || job.compensation?.compensationTierSummary
        || '';
      const description = (salarySummary ? `Compensation: ${salarySummary}\n\n${baseDesc}` : baseDesc)
        .slice(0, MAX_DESCRIPTION_LENGTH);
      return makeJobLead({
        title: job.title,
        company: job.companyName || company,
        directApplyUrl: job.jobUrl,
        atsPlatformName: 'Ashby',
        scrapedTimestamp: new Date().toISOString(),
        description,
      });
    },
  });
}

module.exports = { scrapeAshby };
