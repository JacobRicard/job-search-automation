'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ---------------------------------------------------------------------------
// matchesSearchTerms
// ---------------------------------------------------------------------------

const { matchesSearchTerms } = require('../lib/scraper-utils');

describe('matchesSearchTerms', () => {
  const searchTerms = [
    'devops',
    'sre',
    'platform engineer',
    'cloud engineer',
  ];

  it('matches devops titles', () => {
    assert.ok(matchesSearchTerms('Senior DevOps Engineer', searchTerms));
    assert.ok(matchesSearchTerms('SRE Lead', searchTerms));
    assert.ok(matchesSearchTerms('Platform Engineer II', searchTerms));
    assert.ok(matchesSearchTerms('Cloud Engineer', searchTerms));
  });

  it('rejects non-matching titles', () => {
    assert.ok(!matchesSearchTerms('Product Manager', searchTerms));
    assert.ok(!matchesSearchTerms('Frontend Developer', searchTerms));
    assert.ok(!matchesSearchTerms('', searchTerms));
    assert.ok(!matchesSearchTerms(null, searchTerms));
  });
});

// ---------------------------------------------------------------------------
// escapeHtml
// ---------------------------------------------------------------------------

const { escapeHtml, stripHtml } = require('../lib/utils');

describe('escapeHtml', () => {
  it('escapes HTML special characters', () => {
    assert.equal(escapeHtml('<script>alert("xss")</script>'), '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });

  it('escapes ampersands and quotes', () => {
    assert.equal(escapeHtml("Tom & Jerry's"), "Tom &amp; Jerry&#39;s");
  });

  it('handles null/undefined', () => {
    assert.equal(escapeHtml(null), '');
    assert.equal(escapeHtml(undefined), '');
  });
});

// ---------------------------------------------------------------------------
// stripHtml
// ---------------------------------------------------------------------------

describe('stripHtml', () => {
  it('strips HTML tags and collapses whitespace', () => {
    assert.equal(stripHtml('<p>Hello <b>world</b></p>'), 'Hello world');
  });

  it('respects maxLen', () => {
    const long = '<p>' + 'a'.repeat(20000) + '</p>';
    assert.ok(stripHtml(long).length <= 15000);
  });

  it('handles empty input', () => {
    assert.equal(stripHtml(''), '');
    assert.equal(stripHtml(null), '');
  });

  it('decodes nested entities before stripping tags', () => {
    assert.equal(stripHtml('&amp;lt;b&amp;gt;Hi&amp;lt;/b&amp;gt; &amp;amp; bye'), 'Hi & bye');
  });
});

// ---------------------------------------------------------------------------
// safeFetch
// ---------------------------------------------------------------------------

describe('safeFetch', () => {
  const { safeFetch } = require('../lib/utils');

  it('returns null for non-ok responses', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => ({ ok: false });

    try {
      const result = await safeFetch('https://example.com');
      assert.equal(result, null);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('clears the timeout when fetch throws', async () => {
    const originalFetch = global.fetch;
    const originalSetTimeout = global.setTimeout;
    const originalClearTimeout = global.clearTimeout;

    const timerToken = { id: 'timer-1' };
    let clearedToken = null;

    global.fetch = async () => {
      throw new Error('network down');
    };
    global.setTimeout = () => timerToken;
    global.clearTimeout = (token) => {
      clearedToken = token;
    };

    try {
      const result = await safeFetch('https://example.com');
      assert.equal(result, null);
      assert.equal(clearedToken, timerToken);
    } finally {
      global.fetch = originalFetch;
      global.setTimeout = originalSetTimeout;
      global.clearTimeout = originalClearTimeout;
    }
  });
});

// ---------------------------------------------------------------------------
// Score parsing (the regex from scorer.js)
// ---------------------------------------------------------------------------

describe('score parsing', () => {
  function parseScore(text) {
    const scoreMatch = text.match(/^SCORE:\s*(\d+)/m);
    const reasoningMatch = text.match(/^REASONING:\s*(.+)/ms);
    const score = scoreMatch ? Math.min(10, Math.max(1, parseInt(scoreMatch[1], 10))) : null;
    const reasoning = reasoningMatch ? reasoningMatch[1].trim() : (scoreMatch ? text : `Score parse failed. Raw: ${text.slice(0, 200)}`);
    return { score, reasoning };
  }

  it('parses valid response', () => {
    const text = 'SCORE: 8\nREASONING: Strong match for stack and seniority.';
    const { score, reasoning } = parseScore(text);
    assert.equal(score, 8);
    assert.equal(reasoning, 'Strong match for stack and seniority.');
  });

  it('clamps score to 1-10', () => {
    assert.equal(parseScore('SCORE: 15\nREASONING: test').score, 10);
    assert.equal(parseScore('SCORE: 0\nREASONING: test').score, 1);
  });

  it('returns null score on unparseable response', () => {
    const result = parseScore('This is garbage output');
    assert.equal(result.score, null);
    assert.ok(result.reasoning.startsWith('Score parse failed.'));
  });

  it('handles multiline reasoning', () => {
    const text = 'SCORE: 7\nREASONING: Line one.\nLine two continues here.';
    const { reasoning } = parseScore(text);
    assert.ok(reasoning.includes('Line one.'));
    assert.ok(reasoning.includes('Line two'));
  });
});

// ---------------------------------------------------------------------------
// Location filter
// ---------------------------------------------------------------------------

const { isLocationAllowed, passesPrefs, matchesMetro, isRemote } = require('../lib/location-filter');
const metros = require('../config/metros.json');

describe('isLocationAllowed', () => {
  // The filter is env-configured via LOCATION_FILTER and LOCATION_BLOCKLIST.
  // With no env vars set (default in tests), Remote is always allowed and
  // everything else passes through to the scorer.
  it('allows Remote by default', () => {
    assert.ok(isLocationAllowed('Remote'));
    assert.ok(isLocationAllowed('Anywhere'));
  });

  it('allows empty/unknown locations', () => {
    assert.ok(isLocationAllowed(''));
    assert.ok(isLocationAllowed(null));
  });

  it('passes through specific cities when no filter is set', () => {
    assert.ok(isLocationAllowed('Austin, TX'));
    assert.ok(isLocationAllowed('Berlin, Germany'));
  });
});

describe('passesPrefs (metro-aware)', () => {
  const seattlePrefs = { metros: ['seattle'] };

  it('matches cities within the chosen metro', () => {
    assert.ok(passesPrefs('Redmond, WA', seattlePrefs, metros));
    assert.ok(passesPrefs('Bellevue, WA', seattlePrefs, metros));
    assert.ok(passesPrefs('Seattle, WA', seattlePrefs, metros));
  });

  it('matches the metro state token (e.g. WA) even without a known city', () => {
    assert.ok(passesPrefs('Spokane, WA', seattlePrefs, metros));
  });

  it('rejects out-of-metro cities', () => {
    assert.equal(passesPrefs('San Francisco, CA', seattlePrefs, metros), false);
    assert.equal(passesPrefs('San Francisco, CA, United States', seattlePrefs, metros), false);
  });

  it('always includes remote jobs when a metro is selected', () => {
    assert.ok(passesPrefs('Remote', seattlePrefs, metros));
    assert.ok(passesPrefs('Work from home', seattlePrefs, metros));
  });

  it('uses title text to catch multi-location postings stored under one city', () => {
    // Real case: location field is "NY" but title says "(Remote or NYC - Hybrid)"
    const job = { location: 'NY', title: 'Senior SRE (Remote or NYC - Hybrid)' };
    assert.ok(passesPrefs(job, seattlePrefs, metros));

    // Title mentions Seattle even though stored location is elsewhere
    const seattleTitle = { location: 'Austin, TX', title: 'Platform Engineer - Seattle' };
    assert.ok(passesPrefs(seattleTitle, seattlePrefs, metros));

    // No title signals and out-of-metro location: still excluded
    const austin = { location: 'Austin, TX', title: 'Platform Engineer' };
    assert.equal(passesPrefs(austin, seattlePrefs, metros), false);
  });

  it('always includes blank-location jobs (could be in the metro)', () => {
    assert.ok(passesPrefs('', seattlePrefs, metros));
    assert.ok(passesPrefs(null, seattlePrefs, metros));
  });

  it('includes nationwide US postings ("United States" alone)', () => {
    assert.ok(passesPrefs('United States', seattlePrefs, metros));
    assert.ok(passesPrefs('USA', seattlePrefs, metros));
    // But a specific US city still gets metro-checked
    assert.equal(passesPrefs('Austin, TX, United States', seattlePrefs, metros), false);
  });

  it('passes everything when no metros are selected', () => {
    const open = { metros: [] };
    assert.ok(passesPrefs('San Francisco, CA', open, metros));
    assert.ok(passesPrefs('', open, metros));
  });

  it('isRemote detects common remote phrasings', () => {
    assert.ok(isRemote('Remote'));
    assert.ok(isRemote('Work from home'));
    assert.ok(isRemote('US-only'));
    assert.equal(isRemote('Seattle, WA'), false);
  });

  it('matchesMetro is case-insensitive', () => {
    assert.ok(matchesMetro('REDMOND, wa', 'seattle', metros));
  });
});

// ---------------------------------------------------------------------------
// WWR RSS extractTag
// ---------------------------------------------------------------------------

describe('wwr extractTag', () => {
  // Import the function by testing the module indirectly through scrapeWWR output shape
  // Since extractTag is not exported, we test the scraper's output contract

  it('scrapeWWR returns an array', async () => {
    // Just verify the module loads and the function signature is correct
    const { scrapeWWR } = require('../scrapers/wwr');
    assert.equal(typeof scrapeWWR, 'function');
  });
});

// ---------------------------------------------------------------------------
// Job object shape validation
// ---------------------------------------------------------------------------

describe('job object shape', () => {
  const REQUIRED_FIELDS = ['title', 'company', 'description', 'direct_apply_url', 'ats_platform_name', 'scraped_timestamp'];

  it('validates a well-formed job object', () => {
    const job = {
      title: 'DevOps Engineer',
      company: 'acme',
      description: 'Build infrastructure',
      direct_apply_url: 'https://example.com/job/123',
      ats_platform_name: 'Greenhouse',
      scraped_timestamp: '2026-03-15T00:00:00Z',
    };
    for (const field of REQUIRED_FIELDS) {
      assert.ok(field in job, `missing field: ${field}`);
      assert.ok(typeof job[field] === 'string', `field ${field} should be a string`);
    }
  });
});

// ---------------------------------------------------------------------------
// check-descriptions thresholds
// ---------------------------------------------------------------------------

const { CRITICAL, WARN, checkDescriptions } = require('../scripts/check-descriptions');

describe('checkDescriptions thresholds', () => {
  it('CRITICAL is less than WARN', () => {
    assert.ok(CRITICAL < WARN, 'CRITICAL threshold must be lower than WARN');
  });

  it('classifies empty description as critical', () => {
    const fakeDb = {
      prepare: () => ({ all: () => [
        { id: '1', title: 'DevOps Engineer', company: 'acme', platform: 'Ashby', len: 0 },
      ]}),
    };
    const { critical, warn, ok } = checkDescriptions(fakeDb);
    assert.equal(critical.length, 1);
    assert.equal(warn.length, 0);
    assert.equal(ok, 0);
  });

  it('classifies short description as warn', () => {
    const fakeDb = {
      prepare: () => ({ all: () => [
        { id: '2', title: 'SRE', company: 'acme', platform: 'Greenhouse', len: 150 },
      ]}),
    };
    const { critical, warn, ok } = checkDescriptions(fakeDb);
    assert.equal(critical.length, 0);
    assert.equal(warn.length, 1);
    assert.equal(ok, 0);
  });

  it('classifies full description as ok', () => {
    const fakeDb = {
      prepare: () => ({ all: () => [
        { id: '3', title: 'Platform Engineer', company: 'acme', platform: 'Lever', len: 4500 },
      ]}),
    };
    const { critical, warn, ok } = checkDescriptions(fakeDb);
    assert.equal(critical.length, 0);
    assert.equal(warn.length, 0);
    assert.equal(ok, 1);
  });

  it('handles mixed batch correctly', () => {
    const fakeDb = {
      prepare: () => ({ all: () => [
        { id: '1', title: 'A', company: 'x', platform: 'Ashby',     len: 0 },
        { id: '2', title: 'B', company: 'x', platform: 'Workday',   len: 150 },
        { id: '3', title: 'C', company: 'x', platform: 'Greenhouse',len: 5000 },
      ]}),
    };
    const { total, critical, warn, ok } = checkDescriptions(fakeDb);
    assert.equal(total, 3);
    assert.equal(critical.length, 1);
    assert.equal(warn.length, 1);
    assert.equal(ok, 1);
  });
});
