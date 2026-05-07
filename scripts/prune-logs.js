#!/usr/bin/env node
'use strict';

/**
 * Delete daily log files under logs/<component>/YYYYMMDD.log older than
 * LOG_RETENTION_DAYS (default 30).
 *
 * Persistent files (logs/<component>/<component>.log) are skipped.
 *
 * Flags:
 *   --dry-run   List files that would be deleted, but do not delete.
 */

const fs = require('fs');
const path = require('path');

const log = require('../lib/logger')('prune-logs');

const ROOT = path.resolve(__dirname, '..', 'logs');
const RETENTION_DAYS = Number.parseInt(process.env.LOG_RETENTION_DAYS || '30', 10);
const DRY_RUN = process.argv.includes('--dry-run');

const DATED = /^(\d{8})\.log$/;

function isExpired(stamp, cutoffMs) {
  const y = Number(stamp.slice(0, 4));
  const m = Number(stamp.slice(4, 6)) - 1;
  const d = Number(stamp.slice(6, 8));
  const t = Date.UTC(y, m, d);
  return Number.isFinite(t) && t < cutoffMs;
}

function main() {
  if (!fs.existsSync(ROOT)) {
    log.info('No logs directory; skipping');
    return;
  }
  if (!Number.isFinite(RETENTION_DAYS) || RETENTION_DAYS <= 0) {
    log.warn('Invalid LOG_RETENTION_DAYS; skipping', { retentionDays: RETENTION_DAYS });
    return;
  }

  const cutoff = Date.now() - RETENTION_DAYS * 86_400_000;
  let scanned = 0;
  let deleted = 0;

  for (const component of fs.readdirSync(ROOT)) {
    const dir = path.join(ROOT, component);
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      const match = DATED.exec(name);
      if (!match) continue;
      scanned++;
      if (!isExpired(match[1], cutoff)) continue;
      const full = path.join(dir, name);
      if (DRY_RUN) {
        log.info('Would delete', { file: full });
      } else {
        try {
          fs.unlinkSync(full);
          deleted++;
        } catch (err) {
          log.warn('Delete failed', { file: full, error: err.message });
        }
      }
    }
  }

  log.info('Prune complete', { retentionDays: RETENTION_DAYS, scanned, deleted, dryRun: DRY_RUN });
}

if (require.main === module) main();
