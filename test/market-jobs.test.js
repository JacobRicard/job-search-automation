'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { applyBaseSchema, applyMigrations } = require('../lib/db/schema');
const {
  getLiveMarketResearchJobs,
  getAllTimeMarketResearchJobs,
  countLiveMarketResearchJobs,
  countAllTimeMarketResearchJobs,
  getLiveMarketSeniorityJobs,
  getAllTimeMarketSeniorityJobs,
  countAllTimeAppliedJobs,
} = require('../lib/market-jobs');

function createDb() {
  const db = new Database(':memory:');
  applyBaseSchema(db);
  applyMigrations(db);
  return db;
}

function longDescription(text = 'Requires 3+ years building Kubernetes platforms.') {
  return `${text} ${'Infrastructure automation and observability. '.repeat(4)}`;
}

function insertJob(db, job) {
  db.prepare(`
    INSERT INTO jobs (
      id, title, company, url, platform, description, score, status, stage, applied_at, created_at
    ) VALUES (
      @id, @title, @company, @url, @platform, @description, @score, @status, @stage, @applied_at, @created_at
    )
  `).run({
    title: 'Platform Engineer',
    company: job.company || job.id,
    url: `https://example.com/${job.id}`,
    platform: 'Greenhouse',
    description: longDescription(),
    score: 8,
    status: 'pending',
    stage: null,
    applied_at: null,
    created_at: '2026-04-01T00:00:00Z',
    ...job,
  });
}

describe('market job selection', () => {
  it('uses live open pipeline jobs for market research and seniority data', () => {
    const db = createDb();
    insertJob(db, { id: 'pending-live' });
    insertJob(db, { id: 'applied-live', status: 'applied', stage: 'applied', applied_at: '2026-04-02T00:00:00Z' });
    insertJob(db, { id: 'interview-live', status: 'applied', stage: 'interview', applied_at: '2026-04-03T00:00:00Z' });
    insertJob(db, { id: 'closed', status: 'closed', stage: 'closed', applied_at: '2026-04-04T00:00:00Z' });
    insertJob(db, { id: 'rejected', status: 'rejected', stage: 'rejected', applied_at: '2026-04-05T00:00:00Z' });
    insertJob(db, { id: 'ghosted', status: 'ghosted', stage: 'ghosted', applied_at: '2026-04-06T00:00:00Z' });
    insertJob(db, { id: 'archived', status: 'archived', stage: null, applied_at: '2026-04-07T00:00:00Z' });
    insertJob(db, { id: 'pending-rejected-stage', status: 'pending', stage: 'rejected' });

    assert.deepEqual(
      getLiveMarketResearchJobs(db).map((job) => job.company).sort(),
      ['applied-live', 'interview-live', 'pending-live']
    );
    assert.equal(countLiveMarketResearchJobs(db), 3);
    assert.equal(getLiveMarketSeniorityJobs(db).length, 3);
    assert.equal(countAllTimeAppliedJobs(db), 6);
  });

  it('keeps terminal jobs in the all-time market view', () => {
    const db = createDb();
    insertJob(db, { id: 'pending-live' });
    insertJob(db, { id: 'closed', status: 'closed', stage: 'closed' });
    insertJob(db, { id: 'rejected', status: 'rejected', stage: 'rejected' });
    insertJob(db, { id: 'ghosted', status: 'ghosted', stage: 'ghosted' });
    insertJob(db, { id: 'archived', status: 'archived', stage: null });

    assert.equal(getLiveMarketSeniorityJobs(db).length, 1);
    assert.equal(getAllTimeMarketSeniorityJobs(db).length, 5);
    assert.equal(getAllTimeMarketResearchJobs(db).length, 5);
    assert.equal(countAllTimeMarketResearchJobs(db), 5);
  });
});
