'use strict';

const path = require('path');
const Database = require('better-sqlite3');
const { logEvent } = require('../lib/db');
const logPaths = require('../lib/log-paths');
const log = require('../lib/logger')('auto-ghost', { logFile: logPaths.daily('auto-ghost') });
const { GHOSTED_AFTER_DAYS } = require('../config/constants');

const { dbPath: DB_PATH } = require('../config/paths');

function main({ dbPath = DB_PATH, database = null } = {}) {
  const db = database || new Database(dbPath);
  try {
    const stale = db.prepare(`
      SELECT id, company, title, stage
      FROM jobs
      WHERE status = 'applied'
        AND COALESCE(stage, 'applied') = 'applied'
        AND applied_at IS NOT NULL
        AND applied_at < datetime('now', '-' || ? || ' days')
    `).all(GHOSTED_AFTER_DAYS);

    if (!stale.length) {
      log.info('No stale applied jobs to ghost', { days: GHOSTED_AFTER_DAYS });
      return { ghosted: 0 };
    }

    db.transaction(() => {
      for (const job of stale) {
        db.prepare(`
          UPDATE jobs SET status='ghosted', stage='ghosted', updated_at=datetime('now') WHERE id=?
        `).run(job.id);
        logEvent(db, job.id, 'stage_change', job.stage || 'applied', 'ghosted');
        log.info('Auto-ghosted', { company: job.company, title: job.title });
      }
    })();

    log.info('Done', { ghosted: stale.length, days: GHOSTED_AFTER_DAYS });
    return { ghosted: stale.length };
  } finally {
    if (!database) db.close();
  }
}

if (require.main === module) {
  try {
    const { ghosted } = main();
    console.log(`[auto-ghost] Ghosted ${ghosted} stale applied job${ghosted === 1 ? '' : 's'} (>${GHOSTED_AFTER_DAYS} days with no response)`);
    process.exit(0);
  } catch (err) {
    log.error('auto-ghost error', { error: err.message });
    process.exit(1);
  }
}

module.exports = { main };
