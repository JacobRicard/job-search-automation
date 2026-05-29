#!/usr/bin/env node
'use strict';

const path = require('path');
const { loadDashboardEnv } = require('../lib/env');

loadDashboardEnv(path.join(__dirname, '..'));

const { getDb } = require('../lib/db');
const { sendEmailDigest } = require('../lib/email-digest');
const logPaths = require('../lib/log-paths');
const log = require('../lib/logger')('send-email-digest', { logFile: logPaths.daily('email-digest') });

async function main() {
  const db = getDb();
  const result = await sendEmailDigest(db);
  if (result.sent) {
    log.info('Digest complete', { count: result.count });
  } else {
    log.info('Digest skipped', result);
  }
}

main().then(() => process.exit(0)).catch((err) => {
  log.error('Fatal error', { error: err.message });
  process.exit(1);
});
