'use strict';

const crypto = require('crypto');
const path = require('path');
const { spawnSync } = require('child_process');

const CONTRACT_FIELDS = [
  'title',
  'company',
  'description',
  'direct_apply_url',
  'ats_platform_name',
  'scraped_timestamp',
  'location',
  'posted_at',
];

function makeJobLead({
  title,
  company,
  description,
  directApplyUrl,
  atsPlatformName,
  scrapedTimestamp = new Date().toISOString(),
  location = '',
  postedAt = '',
}) {
  return {
    title: String(title || '').trim(),
    company: String(company || '').trim(),
    description: String(description || '').trim(),
    direct_apply_url: String(directApplyUrl || '').trim(),
    ats_platform_name: String(atsPlatformName || '').trim(),
    scraped_timestamp: scrapedTimestamp,
    location: String(location || '').trim(),
    posted_at: String(postedAt || '').trim(),
  };
}

function slug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'job';
}

function normalizeUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    url.hash = '';
    return url.toString();
  } catch {
    return String(value || '').trim();
  }
}

function deriveJobId(leadOrJob) {
  const url = normalizeUrl(leadOrJob.direct_apply_url || leadOrJob.url || '');
  const platform = leadOrJob.ats_platform_name || leadOrJob.platform || 'job';
  const platformSlug = slug(platform);

  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const parts = parsed.pathname.split('/').filter(Boolean);

    if (host.includes('greenhouse.io')) {
      const jobIndex = parts.findIndex((part) => part === 'jobs');
      const id = jobIndex >= 0 ? parts[jobIndex + 1] : '';
      if (id) return `greenhouse-${id}`;
    }

    if (host === 'jobs.ashbyhq.com' && parts[1]) {
      return `ashby-${parts[1]}`;
    }

    if (host === 'jobs.lever.co' && parts[1]) {
      return `lever-${parts[1]}`;
    }

    if (host.includes('myworkdayjobs.com')) {
      const id = parts[parts.length - 1];
      if (id) return `workday-${slug(host)}-${slug(id)}`;
    }
  } catch {}

  const hash = crypto.createHash('sha256').update(`${platformSlug}|${url}`).digest('hex').slice(0, 16);
  return `${platformSlug}-${hash}`;
}

function jobLeadToInternal(lead) {
  return {
    id: deriveJobId(lead),
    title: lead.title,
    company: lead.company,
    url: lead.direct_apply_url,
    platform: lead.ats_platform_name,
    postedAt: lead.posted_at || '',
    scrapedAt: lead.scraped_timestamp,
    description: lead.description,
    location: lead.location || '',
  };
}

function validateWithPydantic(leads) {
  const script = path.join(__dirname, '..', 'contracts', 'job_lead.py');
  const result = spawnSync('python3', [script], {
    input: JSON.stringify(leads),
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });

  if (result.error) {
    throw new Error(`Pydantic JobLead validation failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(
      detail ||
      'Pydantic JobLead validation failed. Install Python dependencies with: python3 -m pip install -r requirements.txt'
    );
  }

  return JSON.parse(result.stdout || '[]');
}

module.exports = {
  CONTRACT_FIELDS,
  makeJobLead,
  deriveJobId,
  jobLeadToInternal,
  validateWithPydantic,
};
