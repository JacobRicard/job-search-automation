#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs');
const { spawnSync, spawn } = require('child_process');

const { loadDashboardEnv, loadEnvFile } = require('../lib/env');
const { formatBuffer, formatLine } = require('../lib/refresh-logger');
const { formatLocalTime, formatLocalTimestamp } = require('../lib/time-format');

function createRunId(prefix = 'refresh') {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `${prefix}-${stamp}-${Math.random().toString(16).slice(2, 8)}`;
}

function parseArgs(argv) {
  const flags = new Set(argv.filter((arg) => arg.startsWith('--')));
  return {
    skipDiscover: flags.has('--skip-discover'),
    skipDescriptions: flags.has('--skip-descriptions'),
    skipClosedCheck: flags.has('--skip-closed-check'),
    skipMarketResearch: flags.has('--skip-market-research'),
    skipRejectionSync: flags.has('--skip-rejection-sync'),
    skipSlugCheck: flags.has('--skip-slug-check'),
    skipDigest: flags.has('--skip-digest'),
    help: flags.has('--help') || flags.has('-h'),
  };
}

function loadActiveProfileEnv(repoRoot) {
  loadDashboardEnv(repoRoot);

  const { baseDir: profileDir, dbPath } = require('../config/paths');

  return {
    profileDir,
    dbPath,
  };
}

function elapsed(startMs) {
  const ms = Date.now() - startMs;
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${(s % 60).toFixed(0)}s`;
}

// When stdout is not a TTY (i.e. piped into logs/refresh/YYYYMMDD.log), capture child
// output and format it as readable text. When interactive, inherit so output
// streams live to the terminal.
const IS_LOG = !process.stdout.isTTY;

function runStep(repoRoot, label, args, { optional = false } = {}) {
  const start = Date.now();
  const runId = process.env.RUN_ID || '';
  const tag = runId ? `[refresh runId=${runId}]` : '[refresh]';
  console.log(`${formatLocalTime()}  ${tag}  ${label}...`);

  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    // stderr is where the structured JSON logger writes; stdout is where plain-
    // text scripts (check-descriptions, check-closed) write their summaries.
    stdio: IS_LOG ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    env: process.env,
  });

  if (IS_LOG) {
    // JSON structured logs (from lib/logger) come out on stderr; format those.
    // Plain-text output (check-* scripts) comes on stdout; pass through as-is.
    for (const line of formatBuffer(result.stderr)) console.log(line);
    for (const line of formatBuffer(result.stdout)) console.log(line);
  }

  if (result.status === 0) {
    console.log(`${formatLocalTime()}  ${tag}  ${label} done (${elapsed(start)})`);
    return;
  }
  if (optional) {
    console.warn(`${formatLocalTime()}  ${tag}  ${label} skipped, exit ${result.status || 1} (${elapsed(start)})`);
    return;
  }

  console.error(`${formatLocalTime()}  ${tag}  ${label} FAILED, exit ${result.status || 1} (${elapsed(start)})`);
  process.exit(result.status || 1);
}

// Streaming variant — line-buffers child stderr/stdout so JSON log lines are
// pretty-printed AS THEY ARRIVE rather than dumped in one batch when the child
// exits. Used for long-running steps (pipeline, retry-unscored) where the
// silent gap between start and finish is otherwise minutes long.
function runStepStreaming(repoRoot, label, args, { optional = false } = {}) {
  return new Promise((resolve) => {
    const start = Date.now();
    const runId = process.env.RUN_ID || '';
    const tag = runId ? `[refresh runId=${runId}]` : '[refresh]';
    console.log(`${formatLocalTime()}  ${tag}  ${label}...`);

    if (!IS_LOG) {
      // Interactive TTY — inherit and stream natively, same as runStep.
      const result = spawnSync(process.execPath, args, {
        cwd: repoRoot, stdio: 'inherit', env: process.env,
      });
      if (result.status === 0) {
        console.log(`${formatLocalTime()}  ${tag}  ${label} done (${elapsed(start)})`);
      } else if (optional) {
        console.warn(`${formatLocalTime()}  ${tag}  ${label} skipped, exit ${result.status || 1} (${elapsed(start)})`);
      } else {
        console.error(`${formatLocalTime()}  ${tag}  ${label} FAILED, exit ${result.status || 1} (${elapsed(start)})`);
        process.exit(result.status || 1);
      }
      return resolve();
    }

    const child = spawn(process.execPath, args, {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    const consumeStream = (stream) => {
      let buf = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => {
        buf += chunk;
        let nlIdx;
        while ((nlIdx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nlIdx);
          buf = buf.slice(nlIdx + 1);
          if (line.length) console.log(formatLine(line));
        }
      });
      stream.on('end', () => {
        if (buf.length) console.log(formatLine(buf));
      });
    };

    consumeStream(child.stderr);
    consumeStream(child.stdout);

    child.on('close', (code) => {
      if (code === 0) {
        console.log(`${formatLocalTime()}  ${tag}  ${label} done (${elapsed(start)})`);
      } else if (optional) {
        console.warn(`${formatLocalTime()}  ${tag}  ${label} skipped, exit ${code || 1} (${elapsed(start)})`);
      } else {
        console.error(`${formatLocalTime()}  ${tag}  ${label} FAILED, exit ${code || 1} (${elapsed(start)})`);
        process.exit(code || 1);
      }
      resolve();
    });
  });
}

// Write current pipeline phase to data/pipeline-status.json so the dashboard
// can show "Scraping..." vs "Scoring..." instead of a generic spinning indicator.
function writePhase(profileDir, phase, step, runId) {
  try {
    fs.writeFileSync(
      path.join(profileDir, 'pipeline-status.json'),
      JSON.stringify({ phase, step, runId, updatedAt: new Date().toISOString() })
    );
  } catch {}
}

function printUsage() {
  console.log(`Usage: node scripts/refresh.js [flags]

Runs the local MacBook refresh flow for the active profile:
  discover -> scrape -> pipeline -> retry unscored

Follow-up steps:
  check descriptions
  auto-ghost stale applied jobs
  check closed jobs
  refresh market research
  sync rejection emails
  validate ATS slugs
  update context files

Flags:
  --skip-discover        Skip Gemini company discovery
  --skip-descriptions    Skip suspicious JD checks
  --skip-closed-check    Skip closed-job verification
  --skip-market-research Skip market research refresh
  --skip-rejection-sync  Skip Gmail rejection email sync
  --skip-slug-check      Skip ATS slug validation
  --skip-digest          Skip email digest
`);
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    return;
  }

  // Load .env before the setup check so DATA_DIR is available
  loadDashboardEnv(repoRoot);

  const { checkSetup } = require('../lib/setup-check');
  if (!checkSetup(repoRoot)) {
    process.exit(1);
  }

  const runStart = Date.now();
  const active = loadActiveProfileEnv(repoRoot);

  const runId = process.env.RUN_ID || createRunId('refresh');
  process.env.RUN_ID = runId;

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`${formatLocalTimestamp(new Date(), { milliseconds: false })}  [refresh runId=${runId}]  RUN START`);
  console.log(`  profile  ${active.profileDir}`);
  console.log(`  db       ${active.dbPath}`);
  console.log('─'.repeat(60));

  if (!args.skipDiscover) {
    writePhase(active.profileDir, 'discovering', 'Discovering companies', runId);
    runStep(repoRoot, 'Discovering new companies', ['scripts/discover-companies.js'], { optional: true });
  }

  // Kick off background scoring of already-unscored jobs BEFORE the scrape starts.
  // This way the ~12min scrape window isn't wasted — Ollama scores in parallel.
  // SQLite WAL mode serialises concurrent writes safely.
  const bgScorer = spawn(process.execPath, ['scripts/retry-unscored.js', '--limit=200'], {
    cwd: repoRoot,
    stdio: 'ignore',
    env: process.env,
  });
  bgScorer.on('exit', (code) => {
    const tag = runId ? `[refresh runId=${runId}]` : '[refresh]';
    if (code === 0) console.log(`${formatLocalTime()}  ${tag}  Background scoring finished`);
  });

  writePhase(active.profileDir, 'scraping', 'Scraping jobs', runId);
  runStep(repoRoot, 'Scraping jobs', ['scraper.js']);

  writePhase(active.profileDir, 'scoring', 'Running pipeline', runId);
  await runStepStreaming(repoRoot, 'Running pipeline', ['pipeline.js']);
  await runStepStreaming(repoRoot, 'Retrying unscored jobs', ['scripts/retry-unscored.js', '--limit=25'], { optional: true });

  writePhase(active.profileDir, 'cleanup', 'Post-processing', runId);

  if (!args.skipDescriptions) {
    runStep(repoRoot, 'Checking description quality', ['scripts/check-descriptions.js'], { optional: true });
  }

  runStep(repoRoot, 'Auto-ghosting stale applied jobs', ['scripts/auto-ghost.js'], { optional: true });

  if (!args.skipClosedCheck) {
    runStep(repoRoot, 'Checking for closed jobs', ['scripts/check-closed.js'], { optional: true });
  }

  if (!args.skipMarketResearch) {
    runStep(repoRoot, 'Refreshing market research', ['scripts/run-market-research.js'], { optional: true });
  }

  if (!args.skipRejectionSync) {
    runStep(repoRoot, 'Syncing rejection emails', ['scripts/sync-rejection-emails.js'], { optional: true });
  }

  if (!args.skipSlugCheck) {
    runStep(repoRoot, 'Validating ATS slugs', ['scripts/validate-slugs.js', '--broken-only'], { optional: true });
  }

  runStep(repoRoot, 'Updating context files', ['scripts/update-context.js']);

  if (!args.skipDigest) {
    writePhase(active.profileDir, 'sending-digest', 'Sending email digest', runId);
    runStep(repoRoot, 'Sending email digest', ['scripts/send-email-digest.js'], { optional: true });
  }

  writePhase(active.profileDir, 'idle', 'Idle', runId);

  // Best-effort log retention sweep at end of every run.
  spawnSync(process.execPath, ['scripts/prune-logs.js'], {
    cwd: repoRoot,
    stdio: IS_LOG ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    env: process.env,
  });

  console.log('─'.repeat(60));
  console.log(`${formatLocalTimestamp(new Date(), { milliseconds: false })}  [refresh runId=${runId}]  RUN COMPLETE (${elapsed(runStart)})`);
  console.log('─'.repeat(60));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`${formatLocalTime()}  [refresh]  Fatal error: ${err.message}`);
    process.exit(1);
  });
}

module.exports = {
  loadActiveProfileEnv,
  parseArgs,
};
