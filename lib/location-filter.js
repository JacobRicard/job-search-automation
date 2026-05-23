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
 * Returns true if a job passes the given profile prefs.
 *   prefs.metros  — array of metro keys; empty means "no metro filter"
 *
 * Accepts either a location string or an object with { location, title }.
 * Multi-location postings often only store one city in the location field
 * (e.g. "NY") while the title says "Remote or NYC or Seattle", so we also
 * scan the title for remote / metro indicators.
 *
 * Inclusive by design — picking a metro should not hide:
 *   - Remote jobs (available anywhere)
 *   - Jobs with unknown/blank locations (could be in the metro)
 */
function passesPrefs(jobOrLocation, prefs, metrosConfig) {
  const isObject = jobOrLocation && typeof jobOrLocation === 'object';
  const location = String((isObject ? jobOrLocation.location : jobOrLocation) || '').trim();
  const title = String((isObject ? jobOrLocation.title : '') || '').trim();

  const metros = Array.isArray(prefs?.metros) ? prefs.metros : [];
  if (!metros.length) return true;

  if (!location) return prefs.includeUnknown !== false;

  // Title content matters because postings like "Senior SRE (Remote or NYC -
  // Hybrid)" stash the multi-location info there, not in the location field.
  const haystack = title ? `${location} | ${title}` : location;
  if (isRemote(haystack)) return true;

  // "United States" / "USA" alone (no comma-separated city) means the role
  // is open nationwide — could be the user's metro, so include it.
  if (looksNationwide(location)) return true;

  return metros.some((key) => matchesMetro(haystack, key, metrosConfig));
}

module.exports = { isLocationAllowed, isRemote, matchesMetro, passesPrefs };
