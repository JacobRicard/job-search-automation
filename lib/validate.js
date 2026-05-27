'use strict';

const log = require('./logger')('validate');
const { CONTRACT_FIELDS } = require('./job-lead');

const REQUIRED_FIELDS = CONTRACT_FIELDS.filter((f) => f !== 'location' && f !== 'posted_at');

function validateJob(job) {
  if (!job || typeof job !== 'object') return null;
  const keys = Object.keys(job);
  if (keys.some((field) => !CONTRACT_FIELDS.includes(field))) return null;
  for (const field of REQUIRED_FIELDS) {
    if (typeof job[field] !== 'string' || !job[field].trim()) return null;
  }
  if (job.location != null && typeof job.location !== 'string') return null;
  if (job.posted_at != null && typeof job.posted_at !== 'string') return null;
  try {
    const url = new URL(job.direct_apply_url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  } catch {
    return null;
  }
  if (Number.isNaN(Date.parse(job.scraped_timestamp))) return null;

  return {
    title: job.title.trim(),
    company: job.company.trim(),
    description: job.description.trim(),
    direct_apply_url: job.direct_apply_url.trim(),
    ats_platform_name: job.ats_platform_name.trim(),
    scraped_timestamp: job.scraped_timestamp,
    location: (job.location || '').trim(),
    posted_at: (job.posted_at || '').trim(),
  };
}

function validateJobs(jobs, label) {
  const valid = jobs.map(validateJob).filter(Boolean);
  const dropped = jobs.length - valid.length;
  if (dropped > 0) {
    log.warn('Dropped malformed jobs', { source: label, count: dropped });
  }
  return valid;
}

module.exports = { validateJob, validateJobs };
