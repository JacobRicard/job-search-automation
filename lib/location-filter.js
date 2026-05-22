'use strict';

// Location filter. Two surfaces:
//   - Env-var filter via LOCATION_FILTER / LOCATION_BLOCKLIST (legacy).
//   - Per-profile prefs (metros + remote toggle) via passesPrefs().

const parseList = (value) => (value || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const ALLOW = parseList(process.env.LOCATION_FILTER);
const BLOCK = parseList(process.env.LOCATION_BLOCKLIST);

const REMOTE_RE = /\bremote\b|work from home|\bwfh\b|\banywhere\b|distributed|us[- ]only/i;

function isRemote(location) {
  return REMOTE_RE.test(String(location || ''));
}

function looksNationwide(loc) {
  if (!/united states|nationwide|\busa\b/i.test(loc)) return false;
  return !/,/.test(loc);
}

function matchesAny(loc, list) {
  const lower = loc.toLowerCase();
  return list.some((term) => lower.includes(term));
}

function isLocationAllowed(location) {
  const loc = (location || '').trim();
  if (!loc) return true;

  if (ALLOW.length && matchesAny(loc, ALLOW)) return true;
  if (REMOTE_RE.test(loc)) return true;
  if (looksNationwide(loc)) return true;
  if (/^(hybrid|in-office)$/i.test(loc)) return true;

  if (BLOCK.length && matchesAny(loc, BLOCK)) return false;

  if (!ALLOW.length) return true;

  return false;
}

// City match: substring lookup against the metro's city list.
function matchesCity(lowerLoc, cities) {
  return cities.some((city) => lowerLoc.includes(city));
}

// State match: only when the location has a `, XX` style token. This avoids
// "Walthamstow, UK" matching the MA state code "ma" via raw substring.
function matchesState(lowerLoc, states) {
  if (!states || !states.length) return false;
  for (const st of states) {
    const re = new RegExp(`(^|[,\\s])${st}([,\\s]|$)`, 'i');
    if (re.test(lowerLoc)) return true;
  }
  return false;
}

function matchesMetro(location, metroKey, metrosConfig) {
  const metro = metrosConfig?.[metroKey];
  if (!metro) return false;
  const lower = String(location || '').toLowerCase();
  if (!lower) return false;
  if (matchesCity(lower, metro.cities || [])) return true;
  if (matchesState(lower, metro.states || [])) return true;
  return false;
}

/**
 * Returns true if `location` passes the given profile prefs.
 *   prefs.metros          — array of metro keys; empty means "no metro filter"
 *   prefs.includeUnknown  — include jobs with blank/missing location
 *
 * Remote jobs are always included when a metro filter is active — picking a
 * city should never hide remote roles, since they're available anywhere.
 */
function passesPrefs(location, prefs, metrosConfig) {
  const loc = String(location || '').trim();
  if (!loc) return prefs?.includeUnknown !== false;

  if (isRemote(loc)) return true;

  const metros = Array.isArray(prefs?.metros) ? prefs.metros : [];
  if (!metros.length) return true;

  return metros.some((key) => matchesMetro(loc, key, metrosConfig));
}

module.exports = { isLocationAllowed, isRemote, matchesMetro, passesPrefs };
