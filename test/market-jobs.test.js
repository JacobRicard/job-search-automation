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
const { renderMarketResearch } = require('../lib/html/market-research');

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

  it('renders market copy as live-current while keeping all-time applied separate', () => {
    const html = renderMarketResearch(
      null,
      1,
      [{ title: 'Platform Engineer', description: longDescription() }],
      3,
      319,
      {
        current: { jobs: [{ title: 'Platform Engineer', description: longDescription() }] },
        allTime: {
          jobCount: 2,
          jobs: [
            { title: 'Platform Engineer', description: longDescription() },
            { title: 'Senior Platform Engineer', description: longDescription('Requires 5+ years building Kubernetes platforms.') },
          ],
        },
      }
    );

    assert.match(html, /1 live open pipeline roles classified by seniority/);
    assert.match(html, /2 all-time seen roles classified by seniority/);
    assert.match(html, /Current Market/);
    assert.match(html, /All Time/);
    assert.match(html, /All-time applied count:[\s\S]*319/);
    assert.match(html, /Closed, rejected, ghosted, and archived jobs are excluded/);
    assert.match(html, /Includes closed, rejected, ghosted, and archived jobs/);
    assert.match(html, /live open JDs/);
  });

  it('treats cached market research as stale when the live sample changes', () => {
    const html = renderMarketResearch(
      { generatedAt: Date.now(), jobCount: 289, data: { sample_size: 289 } },
      38,
      [{ title: 'Platform Engineer', description: longDescription() }],
      3,
      319
    );

    assert.match(html, /live sample changed from 289 to 38 JDs/);
    assert.match(html, /Run Analysis/);
  });
});
