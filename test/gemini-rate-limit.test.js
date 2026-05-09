'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const constantsPath = require.resolve('../config/constants');

function loadConstantsWithEnv(value) {
  const original = process.env.GEMINI_RATE_DELAY_MS;
  if (value == null) delete process.env.GEMINI_RATE_DELAY_MS;
  else process.env.GEMINI_RATE_DELAY_MS = value;

  delete require.cache[constantsPath];
  const constants = require('../config/constants');

  if (original == null) delete process.env.GEMINI_RATE_DELAY_MS;
  else process.env.GEMINI_RATE_DELAY_MS = original;
  delete require.cache[constantsPath];

  return constants;
}

describe('Gemini rate limit configuration', () => {
  afterEach(() => {
    delete require.cache[constantsPath];
  });

  it('defaults to a conservative 5 second request gap', () => {
    const constants = loadConstantsWithEnv(null);

    assert.equal(constants.GEMINI_RATE_DELAY_MS, 5000);
  });

  it('accepts a positive env override', () => {
    const constants = loadConstantsWithEnv('4500');

    assert.equal(constants.GEMINI_RATE_DELAY_MS, 4500);
  });

  it('falls back for invalid env values', () => {
    assert.equal(loadConstantsWithEnv('0').GEMINI_RATE_DELAY_MS, 5000);
    assert.equal(loadConstantsWithEnv('-10').GEMINI_RATE_DELAY_MS, 5000);
    assert.equal(loadConstantsWithEnv('5000ms').GEMINI_RATE_DELAY_MS, 5000);
    assert.equal(loadConstantsWithEnv('not-a-number').GEMINI_RATE_DELAY_MS, 5000);
  });
});

describe('Gemini shared request slot reservations', () => {
  it('spaces sequential reservations by at least the configured delay', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-rate-limit-'));
    const statePath = path.join(tmpDir, 'state.json');
    const { reserveGeminiRequestSlot } = require('../lib/gemini');

    try {
      const first = reserveGeminiRequestSlot({ nowMs: 1_000, delayMs: 5_000, statePath });
      const second = reserveGeminiRequestSlot({ nowMs: 1_000, delayMs: 5_000, statePath });
      const third = reserveGeminiRequestSlot({ nowMs: 9_000, delayMs: 5_000, statePath });

      assert.equal(first.reservedAt, 1_000);
      assert.equal(first.waitMs, 0);
      assert.equal(second.reservedAt, 6_000);
      assert.equal(second.waitMs, 5_000);
      assert.equal(third.reservedAt, 11_000);
      assert.equal(third.waitMs, 2_000);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
