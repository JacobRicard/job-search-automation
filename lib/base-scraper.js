'use strict';

const { sleep, safeFetch } = require('./utils');
const { matchesSearchTerms } = require('./scraper-utils');
const { SCRAPER_DELAY_MS } = require('../config/constants');
const log = require('./logger')('scraper');

const COMPANY_CONCURRENCY = 15;
const FETCH_RETRIES = 2;       // retry transient/blocked company fetches before giving up
const RETRY_BACKOFF_MS = 750;

/**
 * Generic loop for company-based scrapers.
 *
 * @param {object} opts
 * @param {string[]} opts.companies     - List of company slugs to scrape
 * @param {string}   opts.platform      - Platform label for logging (e.g. 'greenhouse')
 * @param {number}   [opts.delay]       - ms between batch requests (default: SCRAPER_DELAY_MS)
 * @param {function} opts.buildUrl      - (company) => URL string
 * @param {function} opts.parseResponse - (json, company) => array of raw items
 * @param {function} opts.matchField    - (item) => string to test against search terms
 * @param {function} opts.mapJob        - (item, company) => job object
 */
async function scrapeCompanies({ companies, platform, delay = SCRAPER_DELAY_MS, buildUrl, parseResponse, matchField, mapJob }) {
  const plog = log.child({ label: platform });
  const jobs = [];
  let fetchFailures = 0; // companies whose fetch never returned usable data
  let raw = 0;           // items returned by the API, before the search-term filter

  async function fetchCompany(company) {
    const url = buildUrl(company);
    let res = null;
    for (let attempt = 0; attempt <= FETCH_RETRIES; attempt++) {
      res = await safeFetch(url, {}, `${platform}/${company}`);
      if (res) break;
      if (attempt < FETCH_RETRIES) await sleep(RETRY_BACKOFF_MS * (attempt + 1));
    }
    if (!res) { fetchFailures++; return []; }
    let data;
    try { data = await res.json(); } catch { fetchFailures++; return []; }
    const items = parseResponse(data, company) || [];
    raw += items.length;
    return items
      .filter(item => matchesSearchTerms(matchField(item)))
      .map(item => mapJob(item, company));
  }

  for (let i = 0; i < companies.length; i += COMPANY_CONCURRENCY) {
    const batch = companies.slice(i, i + COMPANY_CONCURRENCY);
    const results = await Promise.allSettled(batch.map(fetchCompany));
    for (const r of results) {
      if (r.status === 'fulfilled') jobs.push(...r.value);
    }
    if (i + COMPANY_CONCURRENCY < companies.length) await sleep(delay);
  }

  // Make a silent zero-jobs scrape diagnosable: distinguish "fetches blocked",
  // "boards empty", and "nothing matched the search terms".
  const stats = { companies: companies.length, fetchFailures, raw, matched: jobs.length };
  if (companies.length === 0) {
    plog.info('No companies configured', stats);
  } else if (fetchFailures >= Math.ceil(companies.length / 2)) {
    plog.warn('Scrape mostly failed — company fetches blocked or timing out', stats);
  } else if (jobs.length === 0) {
    plog.warn('Scrape produced no matching jobs', stats);
  } else {
    plog.info('Scrape stats', stats);
  }

  return jobs;
}

module.exports = { scrapeCompanies };
