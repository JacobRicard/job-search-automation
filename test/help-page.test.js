'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { renderHelpPage } = require('../lib/html/help-page');

describe('help page', () => {
  it('renders the Docker quickstart and free-tier guidance', () => {
    const html = renderHelpPage();

    assert.match(html, /Run It Locally/);
    assert.match(html, /docker compose up -d/);
    assert.match(html, /aistudio\.google\.com\/apikey/);
    assert.match(html, /Free Tier/);
    assert.doesNotMatch(html, /NPM Commands/);
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
  });
});
