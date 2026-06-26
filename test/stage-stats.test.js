'use strict';

const Database = require('better-sqlite3');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { applyBaseSchema, applyMigrations } = require('../lib/db/schema');
const {
  getHistoricalStageStats,
  getHistoricalAdvancedCountsByScore,
} = require('../lib/stage-stats');

function createDb() {
  const db = new Database(':memory:');
  applyBaseSchema(db);
  applyMigrations(db);
  return db;
}

function insertJob(db, job) {
  db.prepare(`
    INSERT INTO jobs (
      id, title, company, url, platform, status, applied_at, stage,
      rejected_from_stage, score
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    job.id,
    job.title || `Role ${job.id}`,
    job.company || 'Acme',
    job.url || `https://example.com/${job.id}`,
    job.platform || 'Lever',
    job.status || 'applied',
    Object.hasOwn(job, 'applied_at') ? job.applied_at : '2026-04-01T00:00:00Z',
    job.stage || null,
    job.rejected_from_stage || null,
    job.score ?? null
  );
}

function insertStageEvent(db, jobId, toValue, createdAt = '2026-04-02T00:00:00Z') {
  db.prepare(`
    INSERT INTO events (job_id, event_type, from_value, to_value, created_at)
    VALUES (?, 'stage_change', NULL, ?, ?)
  `).run(jobId, toValue, createdAt);
}

describe('historical stage stats', () => {
  it('counts distinct explicit historical stage reach across events and job fallbacks', () => {
    const db = createDb();
    insertJob(db, { id: 'phone-rejected', stage: 'rejected', rejected_from_stage: 'phone_screen', score: 7 });
    insertJob(db, { id: 'interview-only', stage: 'rejected', rejected_from_stage: 'applied', score: 8 });
    insertJob(db, { id: 'current-onsite', stage: 'onsite', score: 9 });
    insertJob(db, { id: 'current-offer', stage: 'offer', score: 9 });
    insertJob(db, { id: 'legacy-interview-rejected', stage: 'rejected', rejected_from_stage: 'interview', score: 6 });
    insertJob(db, { id: 'current-phone', stage: 'phone_screen', score: 7 });

    insertStageEvent(db, 'phone-rejected', 'phone_screen');
    insertStageEvent(db, 'phone-rejected', 'phone_screen', '2026-04-03T00:00:00Z');
    insertStageEvent(db, 'interview-only', 'interview');
    insertStageEvent(db, 'current-offer', 'interview');

    const stats = getHistoricalStageStats(db);

    assert.equal(stats.phoneScreens, 2);
    assert.equal(stats.interviews, 4);
    assert.equal(stats.onsites, 2);
    assert.equal(stats.offers, 1);
    assert.deepEqual(stats.funnel, {
      phone_screen: 2,
      interview: 4,
      onsite: 2,
      offer: 1,
    });
  });

  it('builds score calibration advanced counts from historical reach', () => {
    const db = createDb();
    insertJob(db, { id: 'phone-rejected', stage: 'rejected', rejected_from_stage: 'phone_screen', score: 7 });
    insertJob(db, { id: 'current-phone', stage: 'phone_screen', score: 7 });
    insertJob(db, { id: 'interview-only', stage: 'rejected', rejected_from_stage: 'applied', score: 8 });
    insertJob(db, { id: 'current-onsite', stage: 'onsite', score: 9 });
    insertJob(db, { id: 'not-advanced', stage: 'applied', score: 9 });

    insertStageEvent(db, 'interview-only', 'interview');

    const advancedByScore = getHistoricalAdvancedCountsByScore(db);

    assert.equal(advancedByScore.get(7), 2);
    assert.equal(advancedByScore.get(8), 1);
    assert.equal(advancedByScore.get(9), 1);
  });
});
