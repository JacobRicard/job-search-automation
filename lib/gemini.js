'use strict';

const fs = require('fs');
const path = require('path');

const log = require('./logger')('gemini');
const {
  GEMINI_RATE_DELAY_MS,
  GEMINI_RETRY_BASE_DELAY_MS,
  GEMINI_429_DELAY_MS,
  GEMINI_MAX_RETRIES,
  GEMINI_MAX_OUTPUT_TOKENS,
} = require('../config/constants');

const MODEL = 'gemini-3.1-flash-lite';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const RATE_LIMIT_DIR = path.join(__dirname, '..', 'logs', 'gemini-rate-limit');
const RATE_LIMIT_STATE_PATH = path.join(RATE_LIMIT_DIR, 'state.json');
const RATE_LIMIT_LOCK_PATH = path.join(RATE_LIMIT_DIR, 'lock');
const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MS = 50;

let lastCallAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function trackApiCall() {
  try {
    const { getDb } = require('./db');
    const db = getDb();
    const today = new Date().toLocaleDateString('en-CA');
    db.prepare(`
      INSERT INTO api_usage (date, model, call_count) VALUES (?, ?, 1)
      ON CONFLICT(date, model) DO UPDATE SET call_count = call_count + 1
    `).run(today, MODEL);
  } catch (e) {
    // silently fail — tracking must never break scoring
  }
}

function readLastReservedAt(statePath) {
  try {
    const data = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return Number.isFinite(data.lastReservedAt) ? data.lastReservedAt : 0;
  } catch {
    return 0;
  }
}

function writeLastReservedAt(statePath, lastReservedAt) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify({ lastReservedAt }, null, 2));
}

function reserveGeminiRequestSlot({
  nowMs = Date.now(),
  delayMs = GEMINI_RATE_DELAY_MS,
  statePath = RATE_LIMIT_STATE_PATH,
} = {}) {
  const lastReservedAt = readLastReservedAt(statePath);
  const reservedAt = lastReservedAt > 0
    ? Math.max(nowMs, lastReservedAt + delayMs)
    : nowMs;
  writeLastReservedAt(statePath, reservedAt);
  return {
    reservedAt,
    waitMs: Math.max(0, reservedAt - nowMs),
  };
}

async function acquireRateLimitLock({
  lockPath = RATE_LIMIT_LOCK_PATH,
  staleMs = LOCK_STALE_MS,
  retryMs = LOCK_RETRY_MS,
} = {}) {
  const dir = path.dirname(lockPath);
  fs.mkdirSync(dir, { recursive: true });

  for (;;) {
    try {
      fs.mkdirSync(lockPath);
      return () => {
        try { fs.rmSync(lockPath, { recursive: true, force: true }); } catch {}
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;

      try {
        const stat = fs.statSync(lockPath);
        if (Date.now() - stat.mtimeMs > staleMs) {
          fs.rmSync(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch (statError) {
        if (statError.code !== 'ENOENT') throw statError;
      }

      await sleep(retryMs);
    }
  }
}

async function waitForGeminiRateLimit({
  delayMs = GEMINI_RATE_DELAY_MS,
  statePath = RATE_LIMIT_STATE_PATH,
  lockPath = RATE_LIMIT_LOCK_PATH,
} = {}) {
  let releaseLock;
  try {
    releaseLock = await acquireRateLimitLock({ lockPath });
    const { waitMs, reservedAt } = reserveGeminiRequestSlot({ delayMs, statePath });
    lastCallAt = reservedAt;
    releaseLock();
    releaseLock = null;
    if (waitMs > 0) await sleep(waitMs);
  } catch (error) {
    if (releaseLock) releaseLock();
    log.warn('Gemini shared rate limiter unavailable; falling back to process-local delay', { error: error.message });
    const wait = delayMs - (Date.now() - lastCallAt);
    if (wait > 0) await sleep(wait);
    lastCallAt = Date.now();
  }
}

async function callGemini(prompt, retries = GEMINI_MAX_RETRIES, maxTokens = GEMINI_MAX_OUTPUT_TOKENS) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY environment variable is not set.');

  const attempt = GEMINI_MAX_RETRIES - retries;

  await waitForGeminiRateLimit();

  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: maxTokens },
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    if ((res.status === 429 || res.status >= 500) && retries > 0) {
      const delay = res.status === 429
        ? GEMINI_429_DELAY_MS
        : GEMINI_RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
      log.warn('Rate limited, retrying', { status: res.status, delaySec: delay/1000, retriesLeft: retries });
      await sleep(delay);
      return callGemini(prompt, retries - 1, maxTokens);
    }
    throw new Error(data.error?.message || `Gemini error ${res.status}`);
  }
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
  trackApiCall();
  return text;
}

module.exports = {
  callGemini,
  MODEL,
  reserveGeminiRequestSlot,
  waitForGeminiRateLimit,
};
