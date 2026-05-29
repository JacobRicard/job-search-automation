'use strict';

const fs = require('fs');
const path = require('path');

const log = require('./logger')('groq');
const {
  GROQ_RATE_DELAY_MS,
  GROQ_RETRY_BASE_DELAY_MS,
  GROQ_429_DELAY_MS,
  GROQ_MAX_RETRIES,
  GROQ_MAX_OUTPUT_TOKENS,
} = require('../config/constants');

const GROQ_FILTER_MODEL = 'llama-3.1-8b-instant';
const GROQ_SCORE_MODEL = 'llama-3.3-70b-versatile';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

const RATE_LIMIT_DIR = path.join(__dirname, '..', 'logs', 'groq-rate-limit');
const RATE_LIMIT_STATE_PATH = path.join(RATE_LIMIT_DIR, 'state.json');
const RATE_LIMIT_LOCK_PATH = path.join(RATE_LIMIT_DIR, 'lock');
const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MS = 50;

let lastCallAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function trackApiCall(model) {
  try {
    const { getDb } = require('./db');
    const db = getDb();
    const today = new Date().toLocaleDateString('en-CA');
    db.prepare(`
      INSERT INTO api_usage (date, model, call_count) VALUES (?, ?, 1)
      ON CONFLICT(date, model) DO UPDATE SET call_count = call_count + 1
    `).run(today, model);
  } catch (e) {
    // tracking must never break scoring
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

function reserveGroqRequestSlot({
  nowMs = Date.now(),
  delayMs = GROQ_RATE_DELAY_MS,
  statePath = RATE_LIMIT_STATE_PATH,
} = {}) {
  const lastReservedAt = readLastReservedAt(statePath);
  const reservedAt = lastReservedAt > 0
    ? Math.max(nowMs, lastReservedAt + delayMs)
    : nowMs;
  writeLastReservedAt(statePath, reservedAt);
  return { reservedAt, waitMs: Math.max(0, reservedAt - nowMs) };
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

async function waitForGroqRateLimit({ delayMs = GROQ_RATE_DELAY_MS } = {}) {
  let releaseLock;
  try {
    releaseLock = await acquireRateLimitLock({ lockPath: RATE_LIMIT_LOCK_PATH });
    const { waitMs, reservedAt } = reserveGroqRequestSlot({ delayMs });
    lastCallAt = reservedAt;
    releaseLock();
    releaseLock = null;
    if (waitMs > 0) await sleep(waitMs);
  } catch (error) {
    if (releaseLock) releaseLock();
    log.warn('Groq shared rate limiter unavailable; falling back to process-local delay', { error: error.message });
    const wait = delayMs - (Date.now() - lastCallAt);
    if (wait > 0) await sleep(wait);
    lastCallAt = Date.now();
  }
}

async function _callGroqRaw(prompt, { model = GROQ_SCORE_MODEL, maxTokens = GROQ_MAX_OUTPUT_TOKENS, jsonMode = false, retries = GROQ_MAX_RETRIES } = {}) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY environment variable is not set.');

  const attempt = GROQ_MAX_RETRIES - retries;
  await waitForGroqRateLimit();

  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: maxTokens,
  };
  if (jsonMode) body.response_format = { type: 'json_object' };

  const res = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();

  if (!res.ok) {
    if ((res.status === 429 || res.status >= 500) && retries > 0) {
      const delay = res.status === 429
        ? GROQ_429_DELAY_MS
        : GROQ_RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
      log.warn('Groq rate limited, retrying', { status: res.status, delaySec: delay / 1000, retriesLeft: retries });
      await sleep(delay);
      return _callGroqRaw(prompt, { model, maxTokens, jsonMode, retries: retries - 1 });
    }
    const msg = data.error?.message || `Groq error ${res.status}`;
    throw new Error(msg);
  }

  const text = data.choices?.[0]?.message?.content?.trim() || '';
  trackApiCall(model);
  return text;
}

async function callGroq(prompt, { model = GROQ_SCORE_MODEL, maxTokens = GROQ_MAX_OUTPUT_TOKENS, retries = GROQ_MAX_RETRIES } = {}) {
  return _callGroqRaw(prompt, { model, maxTokens, jsonMode: false, retries });
}

async function callGroqJson(prompt, { model = GROQ_SCORE_MODEL, maxTokens = GROQ_MAX_OUTPUT_TOKENS, retries = GROQ_MAX_RETRIES } = {}) {
  const text = await _callGroqRaw(prompt, { model, maxTokens, jsonMode: true, retries });
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Groq JSON parse failed. Raw: ${text.slice(0, 200)}`);
  }
}

module.exports = {
  callGroq,
  callGroqJson,
  GROQ_FILTER_MODEL,
  GROQ_SCORE_MODEL,
};
