'use strict';

const fs = require('fs');
const path = require('path');
const { baseDir } = require('../config/paths');

const PREFS_FILENAME = 'location.json';
const METROS_PATH = path.join(__dirname, '..', 'config', 'metros.json');

const DEFAULT_PREFS = Object.freeze({
  metros: [],
  remote: true,
  includeUnknown: true,
});

let cachedMetros = null;
function loadMetros() {
  if (cachedMetros) return cachedMetros;
  try {
    cachedMetros = JSON.parse(fs.readFileSync(METROS_PATH, 'utf8'));
  } catch {
    cachedMetros = {};
  }
  return cachedMetros;
}

function prefsPath() {
  return path.join(baseDir, PREFS_FILENAME);
}

function normalizePrefs(raw, metros = loadMetros()) {
  const validKeys = new Set(Object.keys(metros));
  const metrosList = Array.isArray(raw?.metros)
    ? raw.metros.filter((k) => validKeys.has(k))
    : [];
  return {
    metros: metrosList,
    remote: raw?.remote !== false,
    includeUnknown: raw?.includeUnknown !== false,
  };
}

function loadPrefs() {
  try {
    const raw = JSON.parse(fs.readFileSync(prefsPath(), 'utf8'));
    return normalizePrefs(raw);
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function savePrefs(raw) {
  const prefs = normalizePrefs(raw);
  fs.writeFileSync(prefsPath(), JSON.stringify(prefs, null, 2) + '\n', 'utf8');
  return prefs;
}

module.exports = {
  DEFAULT_PREFS,
  loadMetros,
  loadPrefs,
  savePrefs,
  normalizePrefs,
  prefsPath,
};
