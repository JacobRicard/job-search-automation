'use strict';

// Delegates to data/companies.js, then merges in any
// Gemini-discovered companies from suggested-companies.json (if it exists).
const path = require('path');
const fs = require('fs');

const { loadSuggested } = require('../lib/suggested-companies');
const { baseDir } = require('./paths');

const profileCompanies = path.join(baseDir, 'companies.js');

if (!fs.existsSync(profileCompanies)) {
  throw new Error(`No companies.js found at ${profileCompanies}`);
}

const base = require(profileCompanies);
const suggested = loadSuggested(baseDir);

const addNew = (arr, extra) => extra.length ? [...new Set([...arr, ...extra])] : arr;

module.exports = {
  ...base,
  GREENHOUSE_COMPANIES: addNew(base.GREENHOUSE_COMPANIES || [], suggested.greenhouse),
  ASHBY_COMPANIES:      addNew(base.ASHBY_COMPANIES      || [], suggested.ashby),
  LEVER_COMPANIES:      addNew(base.LEVER_COMPANIES      || [], suggested.lever),
};
