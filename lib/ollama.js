'use strict';

const log = require('./logger')('ollama');

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const OLLAMA_FILTER_MODEL = process.env.OLLAMA_FILTER_MODEL || 'mistral-small3.1';
const OLLAMA_SCORE_MODEL  = process.env.OLLAMA_SCORE_MODEL  || 'mistral-small3.1';
// Generous timeout: 22B model with partial CPU offload can take ~60s to generate 400 tokens
const OLLAMA_TIMEOUT_MS = parseInt(process.env.OLLAMA_TIMEOUT_MS, 10) || 180_000;

function trackApiCall(model) {
  try {
    const { getDb } = require('./db');
    const db = getDb();
    const today = new Date().toLocaleDateString('en-CA');
    db.prepare(`
      INSERT INTO api_usage (date, model, call_count) VALUES (?, ?, 1)
      ON CONFLICT(date, model) DO UPDATE SET call_count = call_count + 1
    `).run(today, 'ollama/' + model);
  } catch {}
}

async function _callRaw(prompt, { model = OLLAMA_SCORE_MODEL, jsonMode = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);

  try {
    const body = { model, prompt, stream: false };
    if (jsonMode) body.format = 'json';

    const res = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Ollama HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = await res.json();
    trackApiCall(model);
    return (data.response || '').trim();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`Ollama timeout after ${OLLAMA_TIMEOUT_MS / 1000}s`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function callOllama(prompt, { model = OLLAMA_SCORE_MODEL } = {}) {
  return _callRaw(prompt, { model, jsonMode: false });
}

async function callOllamaJson(prompt, { model = OLLAMA_SCORE_MODEL } = {}) {
  const text = await _callRaw(prompt, { model, jsonMode: true });
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Ollama JSON parse failed. Raw: ${text.slice(0, 200)}`);
  }
}

module.exports = { callOllama, callOllamaJson, OLLAMA_FILTER_MODEL, OLLAMA_SCORE_MODEL };
