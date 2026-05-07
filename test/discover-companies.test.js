'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_DISCOVER_TTL_HOURS,
  DEFAULT_DISCOVER_CANDIDATE_COUNT,
  buildPrompt,
  getDiscoveryConfig,
  getDiscoveryCacheState,
  getDiscoveryMaxOutputTokens,
  nextEligibleAt,
} = require('../scripts/discover-companies');

describe('company discovery configuration', () => {
  it('uses aggressive defaults', () => {
    const config = getDiscoveryConfig({});

    assert.equal(config.ttlHours, DEFAULT_DISCOVER_TTL_HOURS);
    assert.equal(config.ttlHours, 6);
    assert.equal(config.ttlMs, 6 * 60 * 60 * 1000);
    assert.equal(config.candidateCount, DEFAULT_DISCOVER_CANDIDATE_COUNT);
    assert.equal(config.candidateCount, 50);
  });

  it('allows env overrides', () => {
    const config = getDiscoveryConfig({
      DISCOVER_TTL_HOURS: '2.5',
      DISCOVER_CANDIDATE_COUNT: '12',
    });

    assert.equal(config.ttlHours, 2.5);
    assert.equal(config.ttlMs, 2.5 * 60 * 60 * 1000);
    assert.equal(config.candidateCount, 12);
  });

  it('allows zero TTL to force discovery every refresh', () => {
    const config = getDiscoveryConfig({
      DISCOVER_TTL_HOURS: '0',
      DISCOVER_CANDIDATE_COUNT: '0',
    });

    assert.equal(config.ttlHours, 0);
    assert.equal(config.ttlMs, 0);
    assert.equal(config.candidateCount, DEFAULT_DISCOVER_CANDIDATE_COUNT);
  });

  it('falls back for invalid env values', () => {
    const config = getDiscoveryConfig({
      DISCOVER_TTL_HOURS: '-1',
      DISCOVER_CANDIDATE_COUNT: 'not-a-number',
    });

    assert.equal(config.ttlHours, DEFAULT_DISCOVER_TTL_HOURS);
    assert.equal(config.candidateCount, DEFAULT_DISCOVER_CANDIDATE_COUNT);
  });

  it('sizes Gemini output tokens for larger candidate batches', () => {
    assert.equal(getDiscoveryMaxOutputTokens(10), 2000);
    assert.equal(getDiscoveryMaxOutputTokens(50), 4500);
  });
});

describe('company discovery cache state', () => {
  it('reports fresh cache and next eligible time', () => {
    const updatedAt = '2026-05-07T12:00:00.000Z';
    const ttlMs = 6 * 60 * 60 * 1000;
    const nowMs = Date.parse('2026-05-07T17:00:00.000Z');

    const state = getDiscoveryCacheState(updatedAt, ttlMs, nowMs);

    assert.equal(state.fresh, true);
    assert.equal(state.ageHours, 5);
    assert.equal(state.nextEligibleAt, '2026-05-07T18:00:00.000Z');
  });

  it('reports expired cache at the TTL boundary', () => {
    const updatedAt = '2026-05-07T12:00:00.000Z';
    const ttlMs = 6 * 60 * 60 * 1000;
    const nowMs = Date.parse('2026-05-07T18:00:00.000Z');

    const state = getDiscoveryCacheState(updatedAt, ttlMs, nowMs);

    assert.equal(state.fresh, false);
    assert.equal(state.ageHours, 6);
    assert.equal(state.nextEligibleAt, '2026-05-07T18:00:00.000Z');
  });

  it('disables cache freshness when TTL is zero', () => {
    const updatedAt = '2026-05-07T12:00:00.000Z';

    const state = getDiscoveryCacheState(updatedAt, 0, Date.parse('2026-05-07T12:01:00.000Z'));

    assert.equal(state.fresh, false);
    assert.equal(state.nextEligibleAt, null);
  });

  it('formats next eligible time', () => {
    assert.equal(
      nextEligibleAt('2026-05-07T12:00:00.000Z', 6 * 60 * 60 * 1000),
      '2026-05-07T18:00:00.000Z',
    );
  });
});

describe('company discovery prompt', () => {
  it('uses the configured candidate count', () => {
    const prompt = buildPrompt(new Set(['stripe']), 'profile context', 75);

    assert.match(prompt, /Suggest 75 NEW companies/);
    assert.match(prompt, /Return exactly 75 candidates/);
    assert.match(prompt, /stripe/);
    assert.match(prompt, /profile context/);
  });
});
