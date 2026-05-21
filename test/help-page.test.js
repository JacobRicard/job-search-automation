'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { renderHelpPage } = require('../lib/html/help-page');

describe('help page', () => {
  it('renders the npm command reference from the shared catalog', () => {
    const html = renderHelpPage();

    assert.match(html, /NPM Commands/);
    assert.match(html, /Which Command To Run/);
    assert.match(html, /npm run daily/);
    assert.match(html, /npm run refresh/);
    assert.match(html, /npm run resume/);
    assert.match(html, /--skip-rejection-sync/);
    assert.doesNotMatch(html, /npm run apply/);
  });

  it('documents dashboard views, actions, APIs, and diagnostics', () => {
    const html = renderHelpPage();

    for (const text of [
      'Dashboard views',
      'Job actions',
      'Search is case-insensitive',
      'Apply Tracking',
      'APIs',
      'Diagnostics',
      'GET  /public/*',
      'GET /healthz',
      'GET /metrics',
      'pipeline dropdown is the only application-state writer',
    ]) {
      assert.match(html, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    assert.doesNotMatch(html, /auto-apply/);
    assert.doesNotMatch(html, /Manual Apply Prep/);
    assert.doesNotMatch(html, /Apply Receipts/);
  });
});
