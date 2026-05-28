'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const { dbDir, dbPath, legacyDbPath } = require('../config/paths');
const { applyBaseSchema, applyMigrations } = require('./db/schema');
const { jobLeadToInternal } = require('./job-lead');
const log = require('./logger')('db');

let _db = null;
const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'binary');

function sleepSyncMs(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { /* spin briefly; init only */ }
}

function hasSqliteHeader(filePath) {
  if (!fs.existsSync(filePath)) return false;
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size < SQLITE_HEADER.length) return false;
  const fd = fs.openSync(filePath, 'r');
  try {
    const header = Buffer.alloc(SQLITE_HEADER.length);
    fs.readSync(fd, header, 0, header.length, 0);
    return header.equals(SQLITE_HEADER);
  } finally {
    fs.closeSync(fd);
  }
}

function assertValidExistingDb(filePath) {
  if (!fs.existsSync(filePath)) return;
  if (hasSqliteHeader(filePath)) return;
  throw new Error(
    `SQLite DB at ${filePath} has an invalid file header. ` +
    'Restore a valid backup or recreate the Docker DB volume before starting.'
  );
}

function acquireStorageLock() {
  const lockPath = path.join(dbDir, '.db-storage.lock');
  const deadline = Date.now() + 15_000;
  while (true) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(fd, String(process.pid));
      return () => {
        try { fs.closeSync(fd); } catch (_) { /* best effort */ }
        try { fs.unlinkSync(lockPath); } catch (_) { /* best effort */ }
      };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try {
        const ageMs = Date.now() - fs.statSync(lockPath).mtimeMs;
        if (ageMs > 60_000) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch (_) {
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for DB storage lock at ${lockPath}`);
      }
      sleepSyncMs(250);
    }
  }
}

function copyIfExists(from, to) {
  if (fs.existsSync(from)) fs.copyFileSync(from, to);
}

function prepareDbStorage() {
  fs.mkdirSync(dbDir, { recursive: true });
  const release = acquireStorageLock();
  try {
    if (!fs.existsSync(dbPath) && dbPath !== legacyDbPath && fs.existsSync(legacyDbPath)) {
      if (hasSqliteHeader(legacyDbPath)) {
        copyIfExists(legacyDbPath, dbPath);
        copyIfExists(`${legacyDbPath}-wal`, `${dbPath}-wal`);
        copyIfExists(`${legacyDbPath}-shm`, `${dbPath}-shm`);
        log.info('Migrated legacy SQLite DB into DB storage volume', {
          from: legacyDbPath,
          to: dbPath,
        });
      } else {
        log.warn('Legacy SQLite DB has an invalid header; starting with fresh DB storage', {
          legacyPath: legacyDbPath,
          dbPath,
        });
      }
    }
    assertValidExistingDb(dbPath);
  } finally {
    release();
  }
}

function initDbConnection() {
  prepareDbStorage();
  const db = new Database(dbPath);
  // busy_timeout must be set BEFORE other operations so any contended write
  // (including BEGIN IMMEDIATE below) waits instead of erroring immediately.
  db.pragma('busy_timeout = 15000');
  // journal_mode persists in the DB file. Only attempt to change it when
  // not already WAL — switching modes needs an exclusive lock and races
  // poorly across concurrent process boots, but reading the current mode
  // is safe.
  const currentMode = db.pragma('journal_mode', { simple: true });
  if (currentMode !== 'wal') {
    db.pragma('journal_mode = WAL');
  }
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -8000');
  db.pragma('temp_store = MEMORY');

  // Serialize schema work across concurrent processes. Without this, two
  // processes both running CREATE TABLE / CREATE INDEX / ALTER TABLE on
  // the same DB produce transient "database disk image is malformed"
  // errors on cached pages, even though the file is structurally fine.
  db.exec('BEGIN IMMEDIATE');
  try {
    applyBaseSchema(db);
    applyMigrations(db);
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (_) { /* best effort */ }
    throw e;
  }
  return db;
}

function closeDb() {
  if (!_db) return;
  _db.close();
  _db = null;
}

function getDb() {
  if (_db) return _db;
  log.info('DB init', { path: dbPath });
  // Retry init on transient SQLITE_BUSY — happens when two processes
  // (dashboard + spawned pipeline + worker) race the very first connect
  // before busy_timeout takes effect. Bounded backoff: ~6 seconds total.
  const maxAttempts = 12;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      _db = initDbConnection();
      if (attempt > 1) log.info('DB init succeeded after retry', { attempt });
      return _db;
    } catch (e) {
      lastErr = e;
      const isBusy = e && (e.code === 'SQLITE_BUSY' || /database is locked/i.test(e.message || ''));
      if (!isBusy || attempt === maxAttempts) throw e;
      log.warn('DB init contended, retrying', { attempt, error: e.message });
      sleepSyncMs(250 + Math.random() * 250);
    }
  }
  throw lastErr;
}

function logEvent(db, jobId, eventType, fromValue, toValue) {
  db.prepare("INSERT INTO events (job_id, event_type, from_value, to_value) VALUES (?, ?, ?, ?)")
    .run(jobId, eventType, fromValue || null, toValue || null);
}

const NOW = Symbol('touchJob.NOW');

// Update a jobs row by id, automatically bumping updated_at to now.
// fields is { col: value }; values become bound parameters.
// To set a column to datetime('now'), pass touchJob.NOW as the value.
function touchJob(db, id, fields) {
  const cols = Object.keys(fields);
  const setParts = [];
  const params = [];
  for (const col of cols) {
    if (fields[col] === NOW) {
      setParts.push(`${col}=datetime('now')`);
    } else {
      setParts.push(`${col}=?`);
      params.push(fields[col]);
    }
  }
  setParts.push("updated_at=datetime('now')");
  const sql = `UPDATE jobs SET ${setParts.join(', ')} WHERE id=?`;
  return db.prepare(sql).run(...params, id);
}
touchJob.NOW = NOW;

// ---------------------------------------------------------------------------
// Named query functions
// ---------------------------------------------------------------------------

function getJobById(db, id) {
  return db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
}

function getExistingJobKeys(db) {
  return new Set(
    db.prepare("SELECT LOWER(TRIM(title)) || '|||' || LOWER(TRIM(company)) FROM jobs").pluck().all()
  );
}

function importedJobFields(j, existing = {}) {
  const job = j.direct_apply_url ? jobLeadToInternal(j) : j;
  const incoming = {
    title: job.title,
    company: job.company,
    url: job.url,
    platform: job.platform,
    location: job.location,
    posted_at: job.postedAt || job.posted_at,
    scraped_at: job.scrapedAt || job.scraped_at,
    description: job.description,
  };

  const next = {};
  for (const [column, value] of Object.entries(incoming)) {
    next[column] = blank(value) ? (existing[column] || '') : value;
  }
  return next;
}

function hasImportFieldChanges(existing, next) {
  return Object.keys(next).some((column) => (existing[column] || '') !== (next[column] || ''));
}

function canReopenForRescore(row) {
  return row.status === 'archived' && blank(row.applied_at) && blank(row.stage);
}

function importJob(db, j, options = {}) {
  const job = j.direct_apply_url ? jobLeadToInternal(j) : j;
  const existing = getJobById(db, job.id);
  if (existing) {
    const next = importedJobFields(job, existing);
    const changed = hasImportFieldChanges(existing, next);
    if (!changed) {
      return {
        inserted: false,
        refreshed: false,
        reopened: false,
      };
    }

    const reopenForRescore = options.reopenArchivedForRescore === true && canReopenForRescore(existing);
    db.prepare(`
      UPDATE jobs
      SET title = ?,
          company = ?,
          url = ?,
          platform = ?,
          location = ?,
          posted_at = ?,
          scraped_at = ?,
          description = ?,
          status = ?,
          score = ?,
          reasoning = ?,
          claude_score = ?,
          claude_reasoning = ?,
          score_attempts = ?,
          last_score_attempt_at = ?,
          score_error = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(
      next.title,
      next.company,
      next.url,
      next.platform,
      next.location,
      next.posted_at,
      next.scraped_at,
      next.description,
      reopenForRescore ? 'pending' : existing.status,
      reopenForRescore ? null : existing.score,
      reopenForRescore ? null : existing.reasoning,
      reopenForRescore ? null : existing.claude_score,
      reopenForRescore ? null : existing.claude_reasoning,
      reopenForRescore ? 0 : existing.score_attempts,
      reopenForRescore ? null : existing.last_score_attempt_at,
      reopenForRescore ? null : existing.score_error,
      job.id
    );
    return {
      inserted: false,
      refreshed: true,
      reopened: reopenForRescore,
    };
  }

  const result = db.prepare(
    `INSERT OR IGNORE INTO jobs (id, title, company, url, platform, location, posted_at, scraped_at, description, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    job.id,
    job.title,
    job.company,
    job.url,
    job.platform,
    job.location || '',
    job.postedAt || '',
    job.scrapedAt || '',
    job.description || '',
    'pending'
  );
  // Patch location on existing rows that were stored with an empty value
  if (job.location) {
    db.prepare(
      `UPDATE jobs SET location=? WHERE id=? AND (location='' OR location IS NULL)`
    ).run(job.location, job.id);
  }
  return {
    inserted: result.changes > 0,
    refreshed: false,
    reopened: false,
  };
}

function insertJob(db, j, options = {}) {
  return importJob(db, j, options).inserted;
}

const JOB_STATE_COLUMNS = [
  'score',
  'reasoning',
  'outreach',
  'status',
  'first_seen_at',
  'applied_at',
  'stage',
  'notes',
  'reached_out_at',
  'interview_notes',
  'apply_complexity',
  'rejected_from_stage',
  'rejected_at',
  'claude_score',
  'claude_reasoning',
  'rejection_reasoning',
  'score_attempts',
  'last_score_attempt_at',
  'score_error',
];

function blank(value) {
  return value == null || value === '';
}

function preferredStatus(currentStatus, alternateStatus) {
  const rank = {
    pending: 1,
    archived: 2,
    closed: 3,
    rejected: 4,
    responded: 5,
    applied: 6,
  };
  const current = currentStatus || 'pending';
  const alternate = alternateStatus || 'pending';
  if (alternate === 'archived' && current !== 'archived') return current;
  return (rank[alternate] || 1) > (rank[current] || 1) ? alternate : current;
}

function earliestDate(left, right) {
  if (blank(left)) return right || null;
  if (blank(right)) return left || null;
  return Date.parse(right) < Date.parse(left) ? right : left;
}

function buildCanonicalInsertRow(job, inherited = {}) {
  return {
    id: job.id,
    title: job.title || inherited.title || '',
    company: job.company || inherited.company || '',
    url: job.url || inherited.url || '',
    platform: job.platform || inherited.platform || '',
    location: job.location || inherited.location || '',
    posted_at: job.postedAt || job.posted_at || inherited.posted_at || inherited.postedAt || '',
    scraped_at: job.scrapedAt || job.scraped_at || inherited.scraped_at || '',
    description: job.description || inherited.description || '',
    status: inherited.status || 'pending',
    score: inherited.score ?? null,
    reasoning: inherited.reasoning || null,
    outreach: inherited.outreach || null,
    first_seen_at: inherited.first_seen_at || inherited.created_at || null,
    applied_at: inherited.applied_at || null,
    stage: inherited.stage || null,
    notes: inherited.notes || null,
    reached_out_at: inherited.reached_out_at || null,
    interview_notes: inherited.interview_notes || null,
    apply_complexity: inherited.apply_complexity || null,
    rejected_from_stage: inherited.rejected_from_stage || null,
    rejected_at: inherited.rejected_at || null,
    claude_score: inherited.claude_score ?? null,
    claude_reasoning: inherited.claude_reasoning || null,
    rejection_reasoning: inherited.rejection_reasoning || null,
    score_attempts: inherited.score_attempts ?? 0,
    last_score_attempt_at: inherited.last_score_attempt_at || null,
    score_error: inherited.score_error || null,
  };
}

function insertCanonicalJob(db, job, inherited = {}) {
  const row = buildCanonicalInsertRow(job, inherited);
  const columns = [
    'id', 'title', 'company', 'url', 'platform', 'location', 'posted_at', 'scraped_at', 'description',
    'status', ...JOB_STATE_COLUMNS.filter((column) => column !== 'status'),
  ];
  const placeholders = columns.map(() => '?').join(', ');
  const result = db.prepare(`
    INSERT OR IGNORE INTO jobs (${columns.join(', ')})
    VALUES (${placeholders})
  `).run(...columns.map((column) => row[column]));

  db.prepare(`
    UPDATE jobs
    SET title = COALESCE(NULLIF(title, ''), ?),
        company = COALESCE(NULLIF(company, ''), ?),
        url = COALESCE(NULLIF(url, ''), ?),
        platform = COALESCE(NULLIF(platform, ''), ?),
        location = COALESCE(NULLIF(location, ''), ?),
        posted_at = COALESCE(NULLIF(posted_at, ''), ?),
        scraped_at = COALESCE(NULLIF(scraped_at, ''), ?),
        description = COALESCE(NULLIF(description, ''), ?),
        updated_at = datetime('now')
    WHERE id = ?
  `).run(row.title, row.company, row.url, row.platform, row.location, row.posted_at, row.scraped_at, row.description, row.id);

  return result.changes > 0;
}

function mergeAlternateState(db, alternate, canonicalId) {
  const canonical = getJobById(db, canonicalId);
  if (!canonical) return;

  const next = {};
  for (const column of JOB_STATE_COLUMNS) {
    if (column === 'status') {
      next.status = preferredStatus(canonical.status, alternate.status);
    } else if (column === 'first_seen_at') {
      next.first_seen_at = earliestDate(canonical.first_seen_at || canonical.created_at, alternate.first_seen_at || alternate.created_at);
    } else if (blank(canonical[column]) && !blank(alternate[column])) {
      next[column] = alternate[column];
    } else {
      next[column] = canonical[column] ?? null;
    }
  }

  db.prepare(`
    UPDATE jobs
    SET score = ?,
        reasoning = ?,
        outreach = ?,
        status = ?,
        first_seen_at = ?,
        applied_at = ?,
        stage = ?,
        notes = ?,
        reached_out_at = ?,
        interview_notes = ?,
        apply_complexity = ?,
        rejected_from_stage = ?,
        rejected_at = ?,
        claude_score = ?,
        claude_reasoning = ?,
        rejection_reasoning = ?,
        score_attempts = ?,
        last_score_attempt_at = ?,
        score_error = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(
    next.score,
    next.reasoning,
    next.outreach,
    next.status,
    next.first_seen_at,
    next.applied_at,
    next.stage,
    next.notes,
    next.reached_out_at,
    next.interview_notes,
    next.apply_complexity,
    next.rejected_from_stage,
    next.rejected_at,
    next.claude_score,
    next.claude_reasoning,
    next.rejection_reasoning,
    next.score_attempts,
    next.last_score_attempt_at,
    next.score_error,
    canonicalId
  );
}

function rekeyDependentRows(db, alternateId, canonicalId) {
  db.prepare('UPDATE events SET job_id = ? WHERE job_id = ?').run(canonicalId, alternateId);
  db.prepare('UPDATE rejection_email_log SET matched_job_id = ? WHERE matched_job_id = ?').run(canonicalId, alternateId);

  return {};
}

function recordJobAlias(db, alternate, resolution, status, extraEvidence = {}) {
  const evidence = {
    ...(resolution.evidence || {}),
    ...extraEvidence,
  };
  db.prepare(`
    INSERT INTO job_aliases (
      alternate_job_id,
      canonical_job_id,
      original_platform,
      original_url,
      resolved_platform,
      resolved_url,
      status,
      confidence,
      evidence_json,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(alternate_job_id) DO UPDATE SET
      canonical_job_id = excluded.canonical_job_id,
      original_platform = excluded.original_platform,
      original_url = excluded.original_url,
      resolved_platform = excluded.resolved_platform,
      resolved_url = excluded.resolved_url,
      status = excluded.status,
      confidence = excluded.confidence,
      evidence_json = excluded.evidence_json,
      updated_at = datetime('now')
  `).run(
    alternate.id,
    resolution.job?.id || null,
    alternate.platform || null,
    alternate.url || null,
    resolution.platform || null,
    resolution.url || null,
    status,
    resolution.confidence || null,
    JSON.stringify(evidence)
  );
}

function archiveAlternateJob(db, alternateId) {
  db.prepare("UPDATE jobs SET status = 'archived', updated_at = datetime('now') WHERE id = ?").run(alternateId);
}

function canonicalizeAlternateJob(db, alternate, resolution) {
  if (!alternate?.id) throw new Error('canonicalizeAlternateJob requires an alternate row with id');

  if (resolution.status !== 'primary' || !resolution.job?.id) {
    recordJobAlias(db, alternate, resolution, resolution.status || 'unresolved');
    if (resolution.status === 'unsupported') {
      archiveAlternateJob(db, alternate.id);
      logEvent(db, alternate.id, 'ats_resolution', alternate.platform, 'unsupported');
      log.info('Job archived as unsupported', { alternateId: alternate.id, platform: alternate.platform });
    } else {
      log.debug('Job not canonicalized', { alternateId: alternate.id, status: resolution.status || 'unresolved' });
    }
    return { action: resolution.status || 'unresolved', canonicalId: null };
  }

  return db.transaction(() => {
    insertCanonicalJob(db, resolution.job, alternate);
    mergeAlternateState(db, alternate, resolution.job.id);
    const artifactMoves = rekeyDependentRows(db, alternate.id, resolution.job.id);
    recordJobAlias(db, alternate, resolution, 'primary', artifactMoves);
    archiveAlternateJob(db, alternate.id);
    logEvent(db, resolution.job.id, 'ats_resolution', alternate.platform, resolution.platform);
    log.info('Job canonicalized', {
      alternateId: alternate.id,
      canonicalId: resolution.job.id,
      from: alternate.platform,
      to: resolution.platform,
      movedPreps: artifactMoves.movedPreps,
      movedResumes: artifactMoves.movedResumes,
    });
    return { action: 'canonicalized', canonicalId: resolution.job.id, artifactMoves };
  })();
}

function getUnscoredJobs(db, { limit } = {}) {
  const rows = db.prepare(`
    SELECT *
    FROM jobs
    WHERE score IS NULL
      AND status = 'pending'
    ORDER BY
      CASE WHEN last_score_attempt_at IS NULL THEN 0 ELSE 1 END,
      last_score_attempt_at ASC,
      created_at ASC
  `).all();

  if (!Number.isInteger(limit) || limit <= 0) return rows;
  return rows.slice(0, limit);
}

function markJobScoreAttempt(db, id) {
  db.prepare(`
    UPDATE jobs
    SET score_attempts = COALESCE(score_attempts, 0) + 1,
        last_score_attempt_at = datetime('now'),
        score_error = NULL,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(id);
}

function markJobScoreFailure(db, id, error) {
  db.prepare(`
    UPDATE jobs
    SET score_error = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(error, id);
}

function updateJobScore(db, id, score, reasoning) {
  db.prepare(`
    UPDATE jobs
    SET score = ?,
        reasoning = ?,
        score_error = NULL,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(score, reasoning, id);
}

function getGlobalStats(db) {
  return {
    total: db.prepare("SELECT COUNT(*) as n FROM jobs WHERE status NOT IN ('archived','rejected','closed','ghosted')").get().n,
    notApplied: db.prepare("SELECT COUNT(*) as n FROM jobs WHERE status NOT IN ('applied','responded','archived','closed','rejected','ghosted') AND COALESCE(stage, '') NOT IN ('closed','rejected','ghosted')").get().n,
    applied: db.prepare("SELECT COUNT(*) as n FROM jobs WHERE status IN ('applied','responded') AND stage != 'closed'").get().n,
    interviewing: db.prepare("SELECT COUNT(*) as n FROM jobs WHERE stage IN ('phone_screen','interview','onsite','offer')").get().n,
    offers: db.prepare("SELECT COUNT(*) as n FROM jobs WHERE stage = 'offer'").get().n,
    rejected: db.prepare("SELECT COUNT(*) as n FROM jobs WHERE stage = 'rejected'").get().n,
    closed: db.prepare("SELECT COUNT(*) as n FROM jobs WHERE stage = 'closed'").get().n,
    archived: db.prepare("SELECT COUNT(*) as n FROM jobs WHERE status = 'archived'").get().n,
    ghosted: db.prepare("SELECT COUNT(*) as n FROM jobs WHERE stage = 'ghosted'").get().n,
  };
}

// Bucket an in-memory job array using the same predicates as getGlobalStats.
// Use this when stats need to reflect a JS-side filter (e.g. location prefs).
function computeStatsFromJobs(jobs) {
  const stats = {
    total: 0, notApplied: 0, applied: 0, interviewing: 0, offers: 0,
    rejected: 0, closed: 0, archived: 0, ghosted: 0,
  };
  const ACTIVE_STAGES = new Set(['phone_screen', 'interview', 'onsite', 'offer']);
  for (const j of jobs) {
    const status = j.status || '';
    const stage = j.stage || '';
    if (!['archived', 'rejected', 'closed', 'ghosted'].includes(status)) stats.total++;
    if (!['applied', 'responded', 'archived', 'closed', 'rejected', 'ghosted'].includes(status)
        && !['closed', 'rejected', 'ghosted'].includes(stage)) stats.notApplied++;
    if (['applied', 'responded'].includes(status) && stage !== 'closed') stats.applied++;
    if (ACTIVE_STAGES.has(stage)) stats.interviewing++;
    if (stage === 'offer') stats.offers++;
    if (stage === 'rejected') stats.rejected++;
    if (stage === 'closed') stats.closed++;
    if (status === 'archived') stats.archived++;
    if (stage === 'ghosted') stats.ghosted++;
  }
  return stats;
}

function getAppliedByCompany(db) {
  const result = {};
  for (const row of db.prepare("SELECT LOWER(TRIM(company)) as co, COUNT(*) as n FROM jobs WHERE status IN ('applied','responded') GROUP BY co").all()) {
    result[row.co] = row.n;
  }
  return result;
}

module.exports = {
  getDb,
  closeDb,
  hasSqliteHeader,
  assertValidExistingDb,
  prepareDbStorage,
  logEvent,
  touchJob,
  getJobById,
  getExistingJobKeys,
  importJob,
  insertJob,
  insertCanonicalJob,
  canonicalizeAlternateJob,
  recordJobAlias,
  getUnscoredJobs,
  markJobScoreAttempt,
  markJobScoreFailure,
  updateJobScore,
  getGlobalStats,
  computeStatsFromJobs,
  getAppliedByCompany,
};
