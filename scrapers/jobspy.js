'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const log = require('../lib/logger')('scraper').child({ label: 'jobspy' });

const SCRIPT = path.join(__dirname, 'jobspy_scraper.py');

function scrapeJobSpy() {
  if (String(process.env.JOBSPY_ENABLED || '').toLowerCase() !== 'true') {
    return [];
  }

  const env = { ...process.env };
  if (process.env.JOBSPY_CONFIG_PATH) {
    env.JOBSPY_CONFIG_PATH = process.env.JOBSPY_CONFIG_PATH;
  }

  const result = spawnSync('python3', [SCRIPT], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    env,
  });

  if (result.error) {
    log.warn('JobSpy: python3 not available or script failed to start', { error: result.error.message });
    return [];
  }

  if (result.stderr) {
    const lines = result.stderr.trim().split('\n').filter(Boolean);
    for (const line of lines) log.warn('JobSpy stderr', { line });
  }

  if (result.status !== 0) {
    log.warn('JobSpy: non-zero exit', { status: result.status });
    return [];
  }

  let jobs;
  try {
    jobs = JSON.parse(result.stdout || '[]');
  } catch (e) {
    log.warn('JobSpy: failed to parse output', { error: e.message });
    return [];
  }

  if (!Array.isArray(jobs)) return [];

  log.info('JobSpy scrape complete', { count: jobs.length });
  return jobs;
}

module.exports = { scrapeJobSpy };
