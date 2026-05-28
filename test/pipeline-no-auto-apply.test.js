'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const { applyBaseSchema, applyMigrations } = require('../lib/db/schema');
const { getScoringPlan, hasPrimaryDuplicate } = require('../pipeline');

function createDb() {
  const db = new Database(':memory:');
  applyBaseSchema(db);
  applyMigrations(db);
  return db;
}

describe('pipeline manual application boundary', () => {
  it('does not import or invoke unattended submission modules', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'pipeline.js'), 'utf8');
    assert.doesNotMatch(source, /submitOne|applyOne|runBatch/);
  });

  it('does not treat an archived alternate row as a primary duplicate', () => {
    const db = createDb();
    db.prepare(`
      INSERT INTO jobs (id, title, company, url, platform, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      'builtin-1',
      'Senior Site Reliability Engineer',
      'UJET',
      'https://remoteok.com/job',
      'RemoteOK',
      'archived'
    );

    assert.equal(hasPrimaryDuplicate(db, {
      title: 'Senior Site Reliability Engineer',
      company: 'UJET',
      platform: 'Greenhouse',
    }), false);

    db.prepare(`
      INSERT INTO jobs (id, title, company, url, platform, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      'greenhouse-1',
      'Senior Site Reliability Engineer',
      'UJET',
      'https://job-boards.greenhouse.io/ujet/jobs/1',
      'Greenhouse',
      'pending'
    );

    assert.equal(hasPrimaryDuplicate(db, {
      title: 'Senior Site Reliability Engineer',
      company: 'UJET',
      platform: 'Greenhouse',
    }), true);
  });

  it('does not treat the same primary ATS id as its own duplicate', () => {
    const db = createDb();
    db.prepare(`
      INSERT INTO jobs (id, title, company, url, platform, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      'ashby-1',
      'Software Engineer, DevOps/Infra',
      'Helion',
      'https://jobs.ashbyhq.com/helion/1',
      'Ashby',
      'archived'
    );

    assert.equal(hasPrimaryDuplicate(db, {
      id: 'ashby-1',
      title: 'Software Engineer, DevOps/Infra',
      company: 'Helion',
      platform: 'Ashby',
    }), false);
  });

  it('flags scoring spikes but never blocks (daily quota caps the batch)', () => {
    const candidates = Array.from({ length: 500 }, (_, index) => ({ id: `job-${index}` }));

    const plan = getScoringPlan(candidates, {});
    assert.equal(plan.skipForSpike, false);
    assert.equal(plan.spikeDetected, true);
    assert.equal(plan.threshold, 200);
    assert.equal(plan.jobs.length, 500);

    const smallBatch = getScoringPlan(Array.from({ length: 10 }, (_, i) => ({ id: `j-${i}` })), {});
    assert.equal(smallBatch.spikeDetected, false);
    assert.equal(smallBatch.jobs.length, 10);
  });
});
