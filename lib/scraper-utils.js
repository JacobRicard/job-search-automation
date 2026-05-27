'use strict';

const { SEARCH_TERMS } = require('../config/companies');

/**
 * Returns true if the text matches any of the configured search terms.
 * Used by all scrapers to filter job titles.
 */
function matchesSearchTerms(text, searchTerms = SEARCH_TERMS) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return searchTerms.some((t) => lower.includes(t));
}

module.exports = { matchesSearchTerms };
