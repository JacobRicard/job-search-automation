'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  parseGreenhouseUrl,
  parseGreenhouseJob,
  defaultSlugify,
} = require('../lib/greenhouse-url');

describe('parseGreenhouseUrl', () => {
  it('parses standard board URLs', () => {
    const result = parseGreenhouseUrl('https://boards.greenhouse.io/acme/jobs/12345');
    assert.deepEqual(result, { boardToken: 'acme', jobId: '12345' });
  });

  it('parses job-boards.greenhouse.io URLs', () => {
    const result = parseGreenhouseUrl('https://job-boards.greenhouse.io/acme/jobs/12345');
    assert.deepEqual(result, { boardToken: 'acme', jobId: '12345' });
  });

  it('is case-insensitive on the host', () => {
    const result = parseGreenhouseUrl('https://Boards.Greenhouse.IO/Acme/jobs/12345');
    assert.deepEqual(result, { boardToken: 'Acme', jobId: '12345' });
  });

  it('parses custom-domain URLs with ?gh_jid=', () => {
    const result = parseGreenhouseUrl('https://jobs.elastic.co/some-role?gh_jid=999', 'Elastic');
    assert.deepEqual(result, { boardToken: 'elastic', jobId: '999' });
  });

  it('returns null for ?gh_jid= when fallback company is missing', () => {
    assert.equal(parseGreenhouseUrl('https://jobs.elastic.co/x?gh_jid=999', null), null);
    assert.equal(parseGreenhouseUrl('https://jobs.elastic.co/x?gh_jid=999', ''), null);
  });

  it('returns null for non-Greenhouse URLs', () => {
    assert.equal(parseGreenhouseUrl('https://jobs.lever.co/acme/abc', 'Acme'), null);
    assert.equal(parseGreenhouseUrl('https://example.com', 'Acme'), null);
  });

  it('returns null for null/undefined/empty url', () => {
    assert.equal(parseGreenhouseUrl(null), null);
    assert.equal(parseGreenhouseUrl(undefined), null);
    assert.equal(parseGreenhouseUrl(''), null);
  });

  it('uses a custom slugify when provided', () => {
    const slugify = (v) => String(v || '').toUpperCase().replace(/\s+/g, '-');
    const result = parseGreenhouseUrl('https://x.com?gh_jid=1', 'Acme Inc', { slugify });
    assert.deepEqual(result, { boardToken: 'ACME-INC', jobId: '1' });
  });

  it('strips spaces and punctuation in the default slugify', () => {
    const result = parseGreenhouseUrl('https://x.com?gh_jid=1', 'Acme, Inc.');
    assert.equal(result.boardToken, 'acmeinc');
  });
});

describe('parseGreenhouseJob', () => {
  it('delegates to parseGreenhouseUrl when URL is parseable', () => {
    const result = parseGreenhouseJob({
      url: 'https://boards.greenhouse.io/acme/jobs/12345',
      company: 'Acme',
    });
    assert.deepEqual(result, { boardToken: 'acme', jobId: '12345' });
  });

  it('falls back to job.id when URL is not parseable', () => {
    const result = parseGreenhouseJob({
      url: 'https://random.example.com/posting',
      id: 'greenhouse-789',
      company: 'Acme',
    });
    assert.deepEqual(result, { boardToken: 'acme', jobId: '789' });
  });

  it('returns null when no URL match and id has no greenhouse- prefix', () => {
    const result = parseGreenhouseJob({
      url: 'https://random.example.com/posting',
      id: 'lever-789',
      company: 'Acme',
    });
    assert.equal(result, null);
  });

  it('returns null when id is greenhouse- but company is empty', () => {
    const result = parseGreenhouseJob({
      url: 'https://random.example.com/posting',
      id: 'greenhouse-789',
      company: '',
    });
    assert.equal(result, null);
  });

  it('returns null for null/undefined job', () => {
    assert.equal(parseGreenhouseJob(null), null);
    assert.equal(parseGreenhouseJob(undefined), null);
  });
});

describe('defaultSlugify', () => {
  it('lowercases and strips non-alphanumeric', () => {
    assert.equal(defaultSlugify('Acme, Inc.'), 'acmeinc');
    assert.equal(defaultSlugify('Hello World'), 'helloworld');
    assert.equal(defaultSlugify('Foo-Bar_Baz'), 'foobarbaz');
  });

  it('returns empty string for null/undefined/empty', () => {
    assert.equal(defaultSlugify(null), '');
    assert.equal(defaultSlugify(undefined), '');
    assert.equal(defaultSlugify(''), '');
  });
});
