'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { loadEnvFile } = require('../lib/env');

describe('env loader', () => {
  it('fills empty environment variables from the env file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-test-'));
    const filePath = path.join(dir, '.env');
    fs.writeFileSync(filePath, 'GEMINI_API_KEY=test-key\nDASHBOARD_PORT=3131\n');

    const prevKey = process.env.GEMINI_API_KEY;
    const prevPort = process.env.DASHBOARD_PORT;
    process.env.GEMINI_API_KEY = '';
    process.env.DASHBOARD_PORT = '';

    try {
      assert.equal(loadEnvFile(filePath), true);
      assert.equal(process.env.GEMINI_API_KEY, 'test-key');
      assert.equal(process.env.DASHBOARD_PORT, '3131');
    } finally {
      if (prevKey == null) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = prevKey;
      if (prevPort == null) delete process.env.DASHBOARD_PORT;
      else process.env.DASHBOARD_PORT = prevPort;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
