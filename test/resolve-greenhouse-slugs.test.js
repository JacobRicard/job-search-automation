'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildPrompt,
  collectCandidates,
  fallbackSlugVariants,
  isPlausibleGreenhouseSlug,
  normalizeSlug,
  parseArgs,
  parseCompanyNames,
} = require('../scripts/resolve-greenhouse-slugs');

describe('Greenhouse slug resolver input handling', () => {
  it('parses one company per line and removes bullets', () => {
    assert.deepEqual(parseCompanyNames(`
- Dataiku
2. Stable Kernel
Ground Logistics
Dataiku
`), ['Dataiku', 'Stable Kernel', 'Ground Logistics']);
  });

  it('normalizes Greenhouse URLs to board tokens', () => {
    assert.equal(normalizeSlug('https://boards.greenhouse.io/dataiku/jobs/123'), 'dataiku');
    assert.equal(normalizeSlug('https://job-boards.greenhouse.io/embed/job_board?for=rocketlab'), 'rocketlab');
    assert.equal(normalizeSlug('https://boards-api.greenhouse.io/v1/boards/xai/jobs'), 'xai');
  });

  it('rejects implausible slugs', () => {
    assert.equal(isPlausibleGreenhouseSlug('dataiku'), true);
    assert.equal(isPlausibleGreenhouseSlug('joe-and-the-juice'), true);
    assert.equal(isPlausibleGreenhouseSlug(''), false);
    assert.equal(isPlausibleGreenhouseSlug('../dataiku'), false);
  });

  it('parses CLI flags', () => {
    assert.deepEqual(parseArgs(['--add', '--active-only', '--file=names.txt', '--batch-size=12', '--concurrency=3']), {
      add: true,
      activeOnly: true,
      file: 'names.txt',
      batchSize: 12,
      concurrency: 3,
    });
  });
});

describe('Greenhouse slug resolver prompt and candidates', () => {
  it('builds a prompt for exact pasted company names', () => {
    const prompt = buildPrompt(['Dataiku', 'Joe & the Juice / Denmark'], new Set(['stripe']));

    assert.match(prompt, /Dataiku/);
    assert.match(prompt, /Joe & the Juice \/ Denmark/);
    assert.match(prompt, /strict JSON only/);
    assert.match(prompt, /stripe/);
  });

  it('creates fallback variants from company names', () => {
    assert.deepEqual(fallbackSlugVariants('Albert & Mackenzie, LLP'), [
      'albertandmackenzie',
      'albert-and-mackenzie',
    ]);
  });

  it('combines Gemini candidates with fallbacks and excludes tracked slugs', () => {
    const rows = collectCandidates(
      ['Dataiku', 'Amplitude'],
      [{ name: 'Dataiku', slugs: ['https://boards.greenhouse.io/dataiku/jobs/1'] }],
      new Set(['amplitude']),
    );

    assert.deepEqual(rows[0], {
      name: 'Dataiku',
      candidates: ['dataiku'],
      alreadyTracked: [],
    });
    assert.deepEqual(rows[1], {
      name: 'Amplitude',
      candidates: [],
      alreadyTracked: ['amplitude'],
    });
  });
});
