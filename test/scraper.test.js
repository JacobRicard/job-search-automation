'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { isRecent } = require('../scraper');
const { MAX_AGE_DAYS } = require('../config/companies');

const MS_PER_DAY = 86_400_000;

describe('isRecent', () => {
  it('returns false for null/empty/undefined', () => {
    assert.equal(isRecent(null), false);
    assert.equal(isRecent(undefined), false);
    assert.equal(isRecent(''), false);
  });

  it('returns false for unparseable strings', () => {
    assert.equal(isRecent('yesterday'), false);
    assert.equal(isRecent('not a date'), false);
  });

  it('accepts ISO date strings within MAX_AGE_DAYS', () => {
    const recent = new Date(Date.now() - 1 * MS_PER_DAY).toISOString();
    assert.equal(isRecent(recent), true);
  });

  it('rejects ISO date strings older than MAX_AGE_DAYS', () => {
    const old = new Date(Date.now() - (MAX_AGE_DAYS + 5) * MS_PER_DAY).toISOString();
    assert.equal(isRecent(old), false);
  });

  it('accepts numeric timestamps', () => {
    assert.equal(isRecent(Date.now() - 1000), true);
    assert.equal(isRecent(Date.now() - (MAX_AGE_DAYS + 1) * MS_PER_DAY), false);
  });

  it('treats today (now) as recent', () => {
    assert.equal(isRecent(new Date().toISOString()), true);
  });
});
