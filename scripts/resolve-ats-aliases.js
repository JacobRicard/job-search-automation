#!/usr/bin/env node
'use strict';

const path = require('path');

const { loadDashboardEnv } = require('../lib/env');

loadDashboardEnv(path.join(__dirname, '..'));

const {
  canonicalizeAlternateJob,
  getDb,
} = require('../lib/db');
const {
  isPrimaryPlatform,
  resolveAlternateJob,
} = require('../lib/ats-resolver');
const { mapConcurrent } = require('../lib/concurrency');

const ATS_CONCURRENCY = parseInt(process.env.ATS_CONCURRENCY, 10) || 5;

function parseArgs(argv) {
  return {
    apply: argv.includes('--apply'),
    onlyPending: argv.includes('--only-pending'),
    json: argv.includes('--json'),
  };
}

function formatEvidence(evidence = {}) {
  if (evidence.method) return evidence.method;
  if (evidence.unsupportedPlatform) return evidence.unsupportedPlatform;
  return evidence.reason || '';
}

function printReport(rows, { json }) {
  if (json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  const counts = rows.reduce((acc, row) => {
    acc[row.action] = (acc[row.action] || 0) + 1;
    return acc;
  }, {});
  console.log('ATS alias resolution report');
  console.table(counts);
  console.table(rows.map((row) => ({
    action: row.action,
    id: row.id,
    title: row.title,
    company: row.company,
    from: row.platform,
    to: row.resolvedPlatform || '',
    evidence: row.evidence,
  })));
}

function selectAlternateJobs(db, { onlyPending }) {
  const where = onlyPending
    ? "WHERE status = 'pending'"
    : 'WHERE 1 = 1';
  return db.prepare(`
    SELECT *
    FROM jobs
    ${where}
      AND LOWER(COALESCE(platform, '')) NOT IN ('ashby', 'greenhouse', 'lever', 'workday')
    ORDER BY
      CASE status WHEN 'pending' THEN 0 WHEN 'applied' THEN 1 ELSE 2 END,
      platform,
      company,
      title
  `).all();
}

function normalizedJobKey(job) {
  return `${String(job.company || '').trim().toLowerCase()}|||${String(job.title || '').trim().toLowerCase()}`;
}

function preferJob(left, right) {
  if (!left) return right;
  if (!right) return left;
  const leftPrimary = isPrimaryPlatform(left.platform);
  const rightPrimary = isPrimaryPlatform(right.platform);
  if (leftPrimary !== rightPrimary) return leftPrimary ? left : right;
  const leftHasDescription = String(left.description || '').length;
  const rightHasDescription = String(right.description || '').length;
  return rightHasDescription > leftHasDescription ? right : left;
}

function dedupeNormalizedJobs(jobs, report) {
  const byId = new Map();
  for (const job of jobs) {
    if (!job.id) continue;
    const winner = preferJob(byId.get(job.id), job);
    if (winner !== byId.get(job.id)) byId.set(job.id, winner);
  }

  const byKey = new Map();
  for (const job of byId.values()) {
    const key = normalizedJobKey(job);
    if (!key || key === '|||') continue;
    const existing = byKey.get(key);
    const winner = preferJob(existing, job);
    if (existing && winner !== existing) {
      report.push({
        id: existing.id,
        action: 'skipped-duplicate',
        platform: existing.platform,
        resolvedPlatform: winner.platform,
        title: existing.title,
        company: existing.company,
        evidence: 'preferred-primary-or-richer-row',
      });
    } else if (existing) {
      report.push({
        id: job.id,
        action: 'skipped-duplicate',
        platform: job.platform,
        resolvedPlatform: existing.platform,
        title: job.title,
        company: job.company,
        evidence: 'preferred-primary-or-richer-row',
      });
    }
    byKey.set(key, winner);
  }

  return [...byKey.values()];
}

// Resolve one job to { normalizedJob, reportEntry }. Each resolution is
// independent network I/O, so callers run these through a bounded worker pool.
async function resolveOne(job, options) {
  if (isPrimaryPlatform(job.platform)) {
    return { normalizedJob: job, reportEntry: null };
  }

  const resolution = await resolveAlternateJob(job, options);
  const base = {
    id: job.id,
    platform: job.platform,
    title: job.title,
    company: job.company,
    evidence: formatEvidence(resolution.evidence),
  };

  if (resolution.status === 'primary' && resolution.job) {
    return {
      normalizedJob: resolution.job,
      reportEntry: { ...base, action: 'canonicalized', resolvedPlatform: resolution.platform },
    };
  }
  if (resolution.status === 'unsupported') {
    return {
      normalizedJob: null,
      reportEntry: { ...base, action: 'skipped-unsupported', resolvedPlatform: '' },
    };
  }
  return {
    normalizedJob: job,
    reportEntry: { ...base, action: 'unresolved', resolvedPlatform: '' },
  };
}

async function normalizeScrapedJobs(jobs, options = {}) {
  const concurrency = options.concurrency || ATS_CONCURRENCY;
  const results = await mapConcurrent(jobs, concurrency, (job) => resolveOne(job, options));

  // Reassemble in input order so output is deterministic regardless of which
  // resolution finished first.
  const normalized = [];
  const report = [];
  for (const { normalizedJob, reportEntry } of results) {
    if (normalizedJob) normalized.push(normalizedJob);
    if (reportEntry) report.push(reportEntry);
  }

  const deduped = dedupeNormalizedJobs(normalized, report);
  if (options.log && report.length) options.log.info('Resolved alternate ATS jobs', { report });
  return { jobs: deduped, report };
}

async function resolveExistingJobs({ apply, onlyPending, json }) {
  const db = getDb();
  const rows = selectAlternateJobs(db, { onlyPending });
  const report = [];

  for (const row of rows) {
    const resolution = await resolveAlternateJob(row, { useGemini: true });
    let action = resolution.status;

    if (apply) {
      const result = canonicalizeAlternateJob(db, row, resolution);
      action = result.action;
    } else if (resolution.status === 'primary' && resolution.job) {
      action = 'would-canonicalize';
    } else if (resolution.status === 'unsupported') {
      action = 'would-archive-unsupported';
    }

    report.push({
      id: row.id,
      title: row.title,
      company: row.company,
      platform: row.platform,
      status: row.status,
      score: row.score,
      url: row.url,
      action,
      resolvedPlatform: resolution.platform || '',
      resolvedUrl: resolution.url || '',
      canonicalId: resolution.job?.id || '',
      confidence: resolution.confidence || 0,
      evidence: formatEvidence(resolution.evidence),
    });
  }

  printReport(report, { json });
  return report;
}

if (require.main === module) {
  const options = parseArgs(process.argv.slice(2));
  resolveExistingJobs(options).catch((err) => {
    console.error(err.stack || err.message);
    process.exit(1);
  });
}

module.exports = {
  normalizeScrapedJobs,
  resolveExistingJobs,
  selectAlternateJobs,
};
