'use strict';

/**
 * Primary LLM client — calls the local Claude CLI with your subscription.
 * No API key required. Scorer and pipeline use this directly.
 */

const os = require('os');
const { spawnSync } = require('child_process');

const CLAUDE_BIN = process.env.CLAUDE_CODE_EXECPATH || 'claude';
const CLAUDE_FILTER_MODEL = process.env.CLAUDE_FILTER_MODEL || 'claude-haiku-4-5-20251001';
const CLAUDE_SCORE_MODEL = process.env.CLAUDE_SCORE_MODEL || 'claude-sonnet-4-6';

function invokeClaudeSync(prompt, { model = CLAUDE_SCORE_MODEL } = {}) {
  const result = spawnSync(
    CLAUDE_BIN,
    ['--print', '--model', model, prompt],
    {
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
      // Run from temp dir so the project's CLAUDE.md isn't loaded as system prompt
      cwd: os.tmpdir(),
      env: { ...process.env },
    }
  );

  if (result.error) throw result.error;
  if (result.status !== 0) {
    const err = (result.stderr || result.stdout || '').slice(0, 400);
    throw new Error(`Claude CLI exited ${result.status}: ${err}`);
  }
  return (result.stdout || '').trim();
}

async function callLLM(prompt, { model } = {}) {
  return invokeClaudeSync(prompt, { model: model || CLAUDE_SCORE_MODEL });
}

async function callLLMJson(prompt, { model } = {}) {
  const jsonPrompt = `${prompt}\n\nReturn ONLY valid JSON. No prose, no markdown code fences, no explanation.`;
  const text = invokeClaudeSync(jsonPrompt, { model: model || CLAUDE_SCORE_MODEL });
  // Strip accidental markdown fences
  const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  try {
    return JSON.parse(clean);
  } catch {
    throw new Error(`Claude CLI JSON parse failed. Raw: ${clean.slice(0, 300)}`);
  }
}

module.exports = {
  callLLM,
  callLLMJson,
  LLM_FILTER_MODEL: CLAUDE_FILTER_MODEL,
  LLM_SCORE_MODEL: CLAUDE_SCORE_MODEL,
};
