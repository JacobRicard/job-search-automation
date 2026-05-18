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
    assert.match(html, /npm run apply -- prep --job=&lt;id&gt;/);
    assert.match(html, /--skip-rejection-sync/);
  });

  it('documents dashboard views, actions, APIs, and diagnostics', () => {
    const html = renderHelpPage();

    for (const text of [
      'Dashboard views',
      'Job actions',
      'Search and filters',
      'Apply workflow',
      'APIs',
      'Diagnostics',
      'GET  /auto-apply-attempt',
      'GET  /auto-apply-artifact',
      'GET  /public/*',
      'GET /healthz',
      'GET /metrics',
      'Manual Apply Prep',
      'Search is case-insensitive',
      'Receipt details open through',
    ]) {
      assert.match(html, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  });
});
