'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { applyBaseSchema, applyMigrations } = require('../lib/db/schema');
const { canonicalizeAlternateJob, importJob, insertJob } = require('../lib/db');

function createDb() {
  const db = new Database(':memory:');
  applyBaseSchema(db);
  applyMigrations(db);
  return db;
}

describe('ATS alias DB merge', () => {
  it('refreshes a changed archived primary ATS row without reopening it by default', () => {
    const db = createDb();
    db.prepare(`
      INSERT INTO jobs (
        id, title, company, url, platform, location, posted_at, description,
        status, score, reasoning, score_attempts
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'ashby-6b2ee1c2-509e-4433-9a60-3f79d7dfcd42',
      'Software Engineer, DevOps/Infra',
      'helion',
      'https://jobs.ashbyhq.com/helion/6b2ee1c2-509e-4433-9a60-3f79d7dfcd42',
      'Ashby',
      'Everett, WA',
      '2026-03-04T19:39:12.644+00:00',
      'Old stale description',
      'archived',
      4,
      'Too little DevOps signal',
      2
    );

    const result = importJob(db, {
      id: 'ashby-6b2ee1c2-509e-4433-9a60-3f79d7dfcd42',
      title: 'Software Engineer, DevOps/Infra',
      company: 'helion',
      url: 'https://jobs.ashbyhq.com/helion/6b2ee1c2-509e-4433-9a60-3f79d7dfcd42',
      platform: 'Ashby',
      location: 'Everett, WA',
      postedAt: '2026-03-19T00:09:11.671+00:00',
      description: 'Compensation: $185K - $240K\n\nFresh DevOps and infrastructure description',
    });

    assert.deepEqual(result, {
      inserted: false,
      refreshed: true,
      reopened: false,
    });
    const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get('ashby-6b2ee1c2-509e-4433-9a60-3f79d7dfcd42');
    assert.equal(row.description, 'Compensation: $185K - $240K\n\nFresh DevOps and infrastructure description');
    assert.equal(row.location, 'Everett, WA');
    assert.equal(row.url, 'https://jobs.ashbyhq.com/helion/6b2ee1c2-509e-4433-9a60-3f79d7dfcd42');
    assert.equal(row.posted_at, '2026-03-19T00:09:11.671+00:00');
    assert.equal(row.status, 'archived');
    assert.equal(row.score, 4);
    assert.equal(row.reasoning, 'Too little DevOps signal');
    assert.equal(row.score_attempts, 2);
  });

  it('reopens a changed archived primary ATS row only when explicitly requested', () => {
    const db = createDb();
    db.prepare(`
      INSERT INTO jobs (
        id, title, company, url, platform, location, posted_at, description,
        status, score, reasoning, score_attempts
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'ashby-6b2ee1c2-509e-4433-9a60-3f79d7dfcd42',
      'Software Engineer, DevOps/Infra',
      'helion',
      'https://jobs.ashbyhq.com/helion/6b2ee1c2-509e-4433-9a60-3f79d7dfcd42',
      'Ashby',
      'Everett, WA',
      '2026-03-04T19:39:12.644+00:00',
      'Old stale description',
      'archived',
      4,
      'Too little DevOps signal',
      2
    );

    const result = importJob(db, {
      id: 'ashby-6b2ee1c2-509e-4433-9a60-3f79d7dfcd42',
      title: 'Software Engineer, DevOps/Infra',
      company: 'helion',
      url: 'https://jobs.ashbyhq.com/helion/6b2ee1c2-509e-4433-9a60-3f79d7dfcd42',
      platform: 'Ashby',
      location: 'Everett, WA',
      postedAt: '2026-03-19T00:09:11.671+00:00',
      description: 'Compensation: $185K - $240K\n\nFresh DevOps and infrastructure description',
    }, { reopenArchivedForRescore: true });

    assert.deepEqual(result, {
      inserted: false,
      refreshed: true,
      reopened: true,
    });
    const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get('ashby-6b2ee1c2-509e-4433-9a60-3f79d7dfcd42');
    assert.equal(row.status, 'pending');
    assert.equal(row.score, null);
    assert.equal(row.reasoning, null);
    assert.equal(row.score_attempts, 0);
  });

  it('refreshes primary ATS content without reopening application history rows', () => {
    const db = createDb();
    const insertExisting = db.prepare(`
      INSERT INTO jobs (
        id, title, company, url, platform, location, posted_at, description,
        status, score, applied_at, stage
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const row of [
      ['ashby-applied', 'applied', '2026-04-01T12:00:00Z', 'applied'],
      ['ashby-responded', 'responded', '2026-04-02T12:00:00Z', 'phone_screen'],
      ['ashby-closed', 'closed', null, 'closed'],
    ]) {
      insertExisting.run(
        row[0],
        'Platform Engineer',
        'Acme',
        `https://jobs.ashbyhq.com/acme/${row[0]}`,
        'Ashby',
        'Old Location',
        '2026-03-01T00:00:00Z',
        'Old description',
        row[1],
        8,
        row[2],
        row[3]
      );
    }

    for (const id of ['ashby-applied', 'ashby-responded', 'ashby-closed']) {
      insertJob(db, {
        id,
        title: 'Platform Engineer',
        company: 'Acme',
        url: `https://jobs.ashbyhq.com/acme/${id}`,
        platform: 'Ashby',
        location: 'New Location',
        postedAt: '2026-04-01T00:00:00Z',
        description: 'Fresh description',
      });
    }

    const rows = db.prepare('SELECT id, status, score, applied_at, stage, location, posted_at, description FROM jobs ORDER BY id').all();
    assert.deepEqual(rows, [
      {
        id: 'ashby-applied',
        status: 'applied',
        score: 8,
        applied_at: '2026-04-01T12:00:00Z',
        stage: 'applied',
        location: 'New Location',
        posted_at: '2026-04-01T00:00:00Z',
        description: 'Fresh description',
      },
      {
        id: 'ashby-closed',
        status: 'closed',
        score: 8,
        applied_at: null,
        stage: 'closed',
        location: 'New Location',
        posted_at: '2026-04-01T00:00:00Z',
        description: 'Fresh description',
      },
      {
        id: 'ashby-responded',
        status: 'responded',
        score: 8,
        applied_at: '2026-04-02T12:00:00Z',
        stage: 'phone_screen',
        location: 'New Location',
        posted_at: '2026-04-01T00:00:00Z',
        description: 'Fresh description',
      },
    ]);
  });

  it('moves applied alternate state and dependent rows to the canonical job', () => {
    const db = createDb();
    db.prepare(`
      INSERT INTO jobs (
        id, title, company, url, platform, location, posted_at, description,
        status, score, reasoning, applied_at, stage, notes
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'builtin-1',
      'Senior Site Reliability Engineer',
      'UJET',
      'https://remoteok.com/job',
      'RemoteOK',
      'Remote',
      '2026-04-18',
      'Aggregator description',
      'applied',
      8,
      'Strong fit',
      '2026-04-20T12:00:00Z',
      'applied',
      'Submitted manually'
    );
    db.prepare("INSERT INTO events (job_id, event_type, from_value, to_value) VALUES (?, ?, ?, ?)")
      .run('builtin-1', 'stage_change', null, 'applied');

    const result = canonicalizeAlternateJob(db, db.prepare('SELECT * FROM jobs WHERE id = ?').get('builtin-1'), {
      status: 'primary',
      platform: 'Greenhouse',
      url: 'https://job-boards.greenhouse.io/ujet/jobs/4677625005',
      confidence: 0.95,
      evidence: { method: 'test' },
      job: {
        id: 'greenhouse-4677625005',
        platform: 'Greenhouse',
        title: 'Senior Site Reliability Engineer',
        company: 'ujet',
        url: 'https://job-boards.greenhouse.io/ujet/jobs/4677625005',
        postedAt: '2026-04-18T00:01:00Z',
        description: 'Primary ATS description',
        location: 'Remote',
      },
    });

    assert.equal(result.action, 'canonicalized');

    const canonical = db.prepare('SELECT * FROM jobs WHERE id = ?').get('greenhouse-4677625005');
    assert.equal(canonical.status, 'applied');
    assert.equal(canonical.stage, 'applied');
    assert.equal(canonical.score, 8);
    assert.equal(canonical.notes, 'Submitted manually');
    assert.equal(canonical.platform, 'Greenhouse');

    const alternate = db.prepare('SELECT status FROM jobs WHERE id = ?').get('builtin-1');
    assert.equal(alternate.status, 'archived');

    assert.equal(
      db.prepare('SELECT COUNT(*) AS n FROM events WHERE job_id = ?').get('greenhouse-4677625005').n,
      2
    );
    const alias = db.prepare('SELECT * FROM job_aliases WHERE alternate_job_id = ?').get('builtin-1');
    assert.equal(alias.canonical_job_id, 'greenhouse-4677625005');
    assert.equal(alias.status, 'primary');
  });

  it('does not let an archived alternate downgrade an existing active canonical job', () => {
    const db = createDb();
    db.prepare(`
      INSERT INTO jobs (id, title, company, url, platform, status, score)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'greenhouse-1',
      'Platform Engineer',
      'Acme',
      'https://job-boards.greenhouse.io/acme/jobs/1',
      'Greenhouse',
      'pending',
      9
    );
    db.prepare(`
      INSERT INTO jobs (id, title, company, url, platform, status, score)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'builtin-1',
      'Platform Engineer',
      'Acme',
      'https://builtin.com/job/platform-engineer/1',
      'Built In',
      'archived',
      4
    );

    canonicalizeAlternateJob(db, db.prepare('SELECT * FROM jobs WHERE id = ?').get('builtin-1'), {
      status: 'primary',
      platform: 'Greenhouse',
      url: 'https://job-boards.greenhouse.io/acme/jobs/1',
      confidence: 0.95,
      evidence: { method: 'test' },
      job: {
        id: 'greenhouse-1',
        platform: 'Greenhouse',
        title: 'Platform Engineer',
        company: 'Acme',
        url: 'https://job-boards.greenhouse.io/acme/jobs/1',
        description: 'Primary description',
      },
    });

    const canonical = db.prepare('SELECT status, score FROM jobs WHERE id = ?').get('greenhouse-1');
    assert.equal(canonical.status, 'pending');
    assert.equal(canonical.score, 9);
  });

});
