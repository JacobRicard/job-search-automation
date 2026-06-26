'use strict';

function assertSqlIdentifier(value, kind = 'identifier') {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Invalid SQL ${kind}: ${value}`);
  }
}

function getColumnNames(db, tableName) {
  assertSqlIdentifier(tableName, 'table name');
  return new Set(db.pragma(`table_info(${tableName})`).map((column) => column.name));
}

function addMissingColumns(db, tableName, columns) {
  assertSqlIdentifier(tableName, 'table name');

  const existingColumns = getColumnNames(db, tableName);
  for (const [columnName, definition] of Object.entries(columns)) {
    assertSqlIdentifier(columnName, 'column name');
    if (existingColumns.has(columnName)) continue;

    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    existingColumns.add(columnName);
  }
}

function dropTableIfExists(db, tableName) {
  assertSqlIdentifier(tableName, 'table name');
  db.exec(`DROP TABLE IF EXISTS ${tableName}`);
}

function dropColumnIfExists(db, tableName, columnName) {
  assertSqlIdentifier(tableName, 'table name');
  assertSqlIdentifier(columnName, 'column name');
  const existingColumns = getColumnNames(db, tableName);
  if (!existingColumns.has(columnName)) return;
  db.exec(`ALTER TABLE ${tableName} DROP COLUMN ${columnName}`);
}

function backfillLegacyEvents(db) {
  const insertIfMissing = db.prepare(`
    INSERT INTO events (job_id, event_type, from_value, to_value, created_at)
    SELECT ?, ?, ?, ?, ?
    WHERE NOT EXISTS (
      SELECT 1
      FROM events
      WHERE job_id = ?
        AND event_type = ?
        AND COALESCE(from_value, '') = COALESCE(?, '')
        AND COALESCE(to_value, '') = COALESCE(?, '')
        AND created_at = ?
    )
  `);

  const writeEvent = (jobId, eventType, fromValue, toValue, createdAt) => {
    insertIfMissing.run(
      jobId,
      eventType,
      fromValue || null,
      toValue || null,
      createdAt,
      jobId,
      eventType,
      fromValue || null,
      toValue || null,
      createdAt
    );
  };

  const appliedRows = db.prepare('SELECT id, applied_at FROM jobs WHERE applied_at IS NOT NULL').all();
  for (const row of appliedRows) {
    writeEvent(row.id, 'stage_change', null, 'applied', row.applied_at);
  }

  const rejectedRows = db.prepare('SELECT id, rejected_from_stage, rejected_at FROM jobs WHERE rejected_at IS NOT NULL').all();
  for (const row of rejectedRows) {
    writeEvent(row.id, 'stage_change', row.rejected_from_stage, 'rejected', row.rejected_at);
  }

  const outreachRows = db.prepare('SELECT id, reached_out_at FROM jobs WHERE reached_out_at IS NOT NULL').all();
  for (const row of outreachRows) {
    writeEvent(row.id, 'outreach', null, 'reached_out', row.reached_out_at);
  }
}

const BASE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS jobs (
    id              TEXT PRIMARY KEY,
    title           TEXT,
    company         TEXT,
    url             TEXT,
    platform        TEXT,
    location        TEXT,
    posted_at       TEXT,
    scraped_at      TEXT,
    description     TEXT,
    score           INTEGER,
    reasoning       TEXT,
    outreach        TEXT,
    status          TEXT DEFAULT 'pending',
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now')),
    first_seen_at   TEXT DEFAULT (datetime('now')),
    applied_at      TEXT,
    stage           TEXT,
    notes           TEXT,
    reached_out_at  TEXT,
    interview_notes TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
  CREATE INDEX IF NOT EXISTS idx_jobs_score  ON jobs(score);
  CREATE TABLE IF NOT EXISTS metadata (
    key        TEXT PRIMARY KEY,
    value      TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  );
`;

function applyBaseSchema(db) {
  db.exec(BASE_SCHEMA_SQL);
}

const MIGRATIONS = [
  // v1: add first_seen_at, applied_at, stage, notes
  (db) => addMissingColumns(db, 'jobs', {
    first_seen_at: 'TEXT',
    applied_at: 'TEXT',
    stage: 'TEXT',
    notes: 'TEXT',
  }),
  // v2: add reached_out_at
  (db) => addMissingColumns(db, 'jobs', {
    reached_out_at: 'TEXT',
  }),
  // v3: backfill first_seen_at from created_at
  (db) => {
    db.exec("UPDATE jobs SET first_seen_at = created_at WHERE first_seen_at IS NULL");
  },
  // v4: add interview_notes column
  (db) => addMissingColumns(db, 'jobs', {
    interview_notes: 'TEXT',
  }),
  // v5: add apply_complexity column (simple, complex, or NULL)
  (db) => addMissingColumns(db, 'jobs', {
    apply_complexity: 'TEXT',
  }),
  // v6: add rejection tracking columns
  (db) => addMissingColumns(db, 'jobs', {
    rejected_from_stage: 'TEXT',
    rejected_at: 'TEXT',
  }),
  // v7: add api_usage table for tracking Gemini daily call counts
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS api_usage (
        date       TEXT NOT NULL,
        model      TEXT NOT NULL,
        call_count INTEGER DEFAULT 0,
        PRIMARY KEY (date, model)
      )
    `);
  },
  // v8: add company_notes table for per-company tags and freeform notes
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS company_notes (
        company    TEXT PRIMARY KEY,
        tags       TEXT,
        notes      TEXT,
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
  },
  // v9: add events table for audit trail of all pipeline/status changes
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id     TEXT NOT NULL,
        event_type TEXT NOT NULL,
        from_value TEXT,
        to_value   TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (job_id) REFERENCES jobs(id)
      );
      CREATE INDEX IF NOT EXISTS idx_events_job ON events(job_id);
      CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
      CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
    `);

    backfillLegacyEvents(db);
  },
  // v10: add claude rescore columns for scoring comparison
  (db) => addMissingColumns(db, 'jobs', {
    claude_score: 'INTEGER',
    claude_reasoning: 'TEXT',
  }),
  // v11: add indexes on heavily queried columns missing from initial schema
  (db) => {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_jobs_stage       ON jobs(stage);
      CREATE INDEX IF NOT EXISTS idx_jobs_applied_at  ON jobs(applied_at);
      CREATE INDEX IF NOT EXISTS idx_jobs_created_at  ON jobs(created_at);
      CREATE INDEX IF NOT EXISTS idx_jobs_rejected_at ON jobs(rejected_at);
    `);
  },
  // v12: add rejection_reasoning column for prospective rejection analysis on apply
  (db) => addMissingColumns(db, 'jobs', {
    rejection_reasoning: 'TEXT',
  }),
  // v13-v17: retired application automation migrations.
  () => {},
  () => {},
  () => {},
  () => {},
  () => {},
  // v18: track scoring retries so transient Gemini failures can be retried automatically
  (db) => addMissingColumns(db, 'jobs', {
    score_attempts: 'INTEGER DEFAULT 0',
    last_score_attempt_at: 'TEXT',
    score_error: 'TEXT',
  }),
  // v19: audit log for rejection email ingestion
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS rejection_email_log (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        mailbox          TEXT NOT NULL,
        uid_validity     TEXT,
        uid              INTEGER NOT NULL,
        message_id       TEXT,
        received_at      TEXT,
        from_address     TEXT,
        subject          TEXT,
        company_hint     TEXT,
        title_hint       TEXT,
        matched_job_id   TEXT,
        match_confidence TEXT,
        match_status     TEXT NOT NULL,
        reason           TEXT,
        created_at       TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (matched_job_id) REFERENCES jobs(id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_rejection_email_mailbox_uid
        ON rejection_email_log(mailbox, uid_validity, uid);
      CREATE INDEX IF NOT EXISTS idx_rejection_email_status
        ON rejection_email_log(match_status);
      CREATE INDEX IF NOT EXISTS idx_rejection_email_job
        ON rejection_email_log(matched_job_id);
    `);
  },
  // v20-v22: retired generated artifact migrations.
  () => {},
  () => {},
  () => {},
  // v23: track alternate/aggregator rows resolved to canonical primary ATS rows
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS job_aliases (
        alternate_job_id     TEXT PRIMARY KEY,
        canonical_job_id     TEXT,
        original_platform    TEXT,
        original_url         TEXT,
        resolved_platform    TEXT,
        resolved_url         TEXT,
        status               TEXT NOT NULL,
        confidence           REAL,
        evidence_json        TEXT,
        created_at           TEXT DEFAULT (datetime('now')),
        updated_at           TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (alternate_job_id) REFERENCES jobs(id),
        FOREIGN KEY (canonical_job_id) REFERENCES jobs(id)
      );
      CREATE INDEX IF NOT EXISTS idx_job_aliases_canonical ON job_aliases(canonical_job_id);
      CREATE INDEX IF NOT EXISTS idx_job_aliases_status ON job_aliases(status);
    `);
  },
  // v24: periodic pipeline status snapshots for the over-time tracker chart
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS status_snapshots (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        recorded_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        pending      INTEGER NOT NULL DEFAULT 0,
        applied      INTEGER NOT NULL DEFAULT 0,
        interviewing INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_status_snapshots_recorded_at
        ON status_snapshots(recorded_at);
    `);
  },
  // v25: cache ATS resolution outcomes so unsupported/unresolved alternate jobs
  // (never inserted into jobs table) don't trigger repeated Gemini calls each run
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ats_resolution_cache (
        job_id     TEXT PRIMARY KEY,
        outcome    TEXT NOT NULL,
        cached_at  TEXT DEFAULT (datetime('now'))
      );
    `);
  },
  // v26: remove retired application automation storage.
  (db) => {
    dropTableIfExists(db, 'auto_apply_log');
    dropTableIfExists(db, 'auto_apply_runs');
    dropTableIfExists(db, 'application_preps');
    dropTableIfExists(db, 'tailored_resumes');
    dropColumnIfExists(db, 'jobs', 'auto_applied_at');
    dropColumnIfExists(db, 'jobs', 'auto_apply_status');
    dropColumnIfExists(db, 'jobs', 'auto_apply_error');
  },
  // v27: store strict JobLead scrape timestamps separately from source posted_at.
  (db) => addMissingColumns(db, 'jobs', {
    scraped_at: 'TEXT',
  }),
  // v28: resume pipeline — track which jobs user wants tailored resumes for
  (db) => addMissingColumns(db, 'jobs', {
    resume_requested: 'INTEGER DEFAULT 0',
  }),
];

function ensureCurrentSchema(db) {
  addMissingColumns(db, 'jobs', {
    first_seen_at: 'TEXT',
    applied_at: 'TEXT',
    stage: 'TEXT',
    notes: 'TEXT',
    reached_out_at: 'TEXT',
    interview_notes: 'TEXT',
    apply_complexity: 'TEXT',
    rejected_from_stage: 'TEXT',
    rejected_at: 'TEXT',
    claude_score: 'INTEGER',
    claude_reasoning: 'TEXT',
    rejection_reasoning: 'TEXT',
    score_attempts: 'INTEGER DEFAULT 0',
    last_score_attempt_at: 'TEXT',
    score_error: 'TEXT',
    scraped_at: 'TEXT',
    resume_requested: 'INTEGER DEFAULT 0',
  });

  db.exec(`
    CREATE TABLE IF NOT EXISTS api_usage (
      date       TEXT NOT NULL,
      model      TEXT NOT NULL,
      call_count INTEGER DEFAULT 0,
      PRIMARY KEY (date, model)
    );

    CREATE TABLE IF NOT EXISTS company_notes (
      company    TEXT PRIMARY KEY,
      tags       TEXT,
      notes      TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id     TEXT NOT NULL,
      event_type TEXT NOT NULL,
      from_value TEXT,
      to_value   TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (job_id) REFERENCES jobs(id)
    );
    CREATE INDEX IF NOT EXISTS idx_events_job ON events(job_id);
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
    CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);

    CREATE INDEX IF NOT EXISTS idx_jobs_stage       ON jobs(stage);
    CREATE INDEX IF NOT EXISTS idx_jobs_applied_at  ON jobs(applied_at);
    CREATE INDEX IF NOT EXISTS idx_jobs_created_at  ON jobs(created_at);
    CREATE INDEX IF NOT EXISTS idx_jobs_rejected_at ON jobs(rejected_at);

    CREATE TABLE IF NOT EXISTS rejection_email_log (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      mailbox          TEXT NOT NULL,
      uid_validity     TEXT,
      uid              INTEGER NOT NULL,
      message_id       TEXT,
      received_at      TEXT,
      from_address     TEXT,
      subject          TEXT,
      company_hint     TEXT,
      title_hint       TEXT,
      matched_job_id   TEXT,
      match_confidence TEXT,
      match_status     TEXT NOT NULL,
      reason           TEXT,
      created_at       TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (matched_job_id) REFERENCES jobs(id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_rejection_email_mailbox_uid
      ON rejection_email_log(mailbox, uid_validity, uid);
    CREATE INDEX IF NOT EXISTS idx_rejection_email_status
      ON rejection_email_log(match_status);
    CREATE INDEX IF NOT EXISTS idx_rejection_email_job
      ON rejection_email_log(matched_job_id);

    CREATE TABLE IF NOT EXISTS job_aliases (
      alternate_job_id     TEXT PRIMARY KEY,
      canonical_job_id     TEXT,
      original_platform    TEXT,
      original_url         TEXT,
      resolved_platform    TEXT,
      resolved_url         TEXT,
      status               TEXT NOT NULL,
      confidence           REAL,
      evidence_json        TEXT,
      created_at           TEXT DEFAULT (datetime('now')),
      updated_at           TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (alternate_job_id) REFERENCES jobs(id),
      FOREIGN KEY (canonical_job_id) REFERENCES jobs(id)
    );
    CREATE INDEX IF NOT EXISTS idx_job_aliases_canonical ON job_aliases(canonical_job_id);
    CREATE INDEX IF NOT EXISTS idx_job_aliases_status ON job_aliases(status);

    CREATE TABLE IF NOT EXISTS status_snapshots (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      recorded_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      pending      INTEGER NOT NULL DEFAULT 0,
      applied      INTEGER NOT NULL DEFAULT 0,
      interviewing INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_status_snapshots_recorded_at
      ON status_snapshots(recorded_at);

    CREATE TABLE IF NOT EXISTS ats_resolution_cache (
      job_id     TEXT PRIMARY KEY,
      outcome    TEXT NOT NULL,
      cached_at  TEXT DEFAULT (datetime('now'))
    );
  `);

  addMissingColumns(db, 'rejection_email_log', {
    uid_validity: 'TEXT',
    message_id: 'TEXT',
    received_at: 'TEXT',
    from_address: 'TEXT',
    company_hint: 'TEXT',
    title_hint: 'TEXT',
    matched_job_id: 'TEXT',
    match_confidence: 'TEXT',
    reason: 'TEXT',
  });
}

function applyMigrations(db) {
  const log = require('../logger')('db');
  const versionRow = db.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get();
  const currentVersion = versionRow ? parseInt(versionRow.value, 10) : 0;

  const toRun = MIGRATIONS.length - currentVersion;
  if (toRun > 0) {
    log.info('Running migrations', { from: currentVersion, to: MIGRATIONS.length, count: toRun });
  }

  for (let index = currentVersion; index < MIGRATIONS.length; index += 1) {
    MIGRATIONS[index](db);
  }

  ensureCurrentSchema(db);

  if (MIGRATIONS.length !== currentVersion) {
    db.prepare("INSERT OR REPLACE INTO metadata (key, value, updated_at) VALUES ('schema_version', ?, datetime('now'))")
      .run(String(MIGRATIONS.length));
    log.info('Migrations complete', { version: MIGRATIONS.length });
  }
}

module.exports = {
  MIGRATIONS,
  addMissingColumns,
  applyBaseSchema,
  applyMigrations,
  backfillLegacyEvents,
  dropColumnIfExists,
  dropTableIfExists,
  ensureCurrentSchema,
  getColumnNames,
};
