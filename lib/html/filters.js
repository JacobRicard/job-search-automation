'use strict';

const { escapeHtml } = require('../utils');
const { buildDashboardHref } = require('./helpers');

function renderLocationDropdown(locationPrefs, metros) {
  if (!metros || !Object.keys(metros).length) return '';
  const prefs = locationPrefs || { metros: [], includeUnknown: true };
  const selectedMetros = new Set(prefs.metros || []);
  const active = selectedMetros.size > 0 || prefs.includeUnknown === false;

  const summaryText = (() => {
    if (!active) return 'All locations';
    const parts = [];
    if (selectedMetros.size) {
      const labels = [...selectedMetros].map((k) => metros[k]?.label || k);
      parts.push(labels.length === 1 ? labels[0] : `${labels.length} metros`);
    }
    if (prefs.includeUnknown === false) parts.push('no unknown');
    return parts.join(', ');
  })();

  const fullTitle = (() => {
    if (!active) return 'All locations — click to filter';
    const all = [];
    if (selectedMetros.size) {
      all.push('Metros: ' + [...selectedMetros].map((k) => metros[k]?.label || k).join(', '));
      all.push('Remote jobs are always included');
    }
    all.push(prefs.includeUnknown === false ? 'Unknown locations excluded' : 'Unknown locations included');
    return all.join('\n');
  })();

  const metroRows = Object.entries(metros).map(([key, m]) => {
    const checked = selectedMetros.has(key);
    return `<label class="loc-option${checked ? ' checked' : ''}">
      <input type="checkbox" data-metro="${escapeHtml(key)}"${checked ? ' checked' : ''} onchange="onLocationChange()">
      <span class="loc-option-check" aria-hidden="true"></span>
      <span class="loc-option-label">${escapeHtml(m.label || key)}</span>
    </label>`;
  }).join('');

  const unknownChecked = prefs.includeUnknown !== false;

  return `<div class="dd-wrap">
    <button class="loc-trigger${active ? ' active' : ''}" id="location-panel-btn" onclick="toggleLocationPanel()" title="${escapeHtml(fullTitle)}" aria-haspopup="true">
      <svg class="loc-trigger-icon" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
      <span class="loc-trigger-label">${escapeHtml(summaryText)}</span>
      <svg class="loc-trigger-chev" xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
    <div id="location-panel" class="filter-dropdown loc-dropdown" role="menu">
      <div class="loc-section-label">Metro area</div>
      <div class="loc-metros">${metroRows}</div>
      <div class="loc-divider"></div>
      <label class="loc-option${unknownChecked ? ' checked' : ''}">
        <input type="checkbox" id="loc-unknown"${unknownChecked ? ' checked' : ''} onchange="onLocationChange()">
        <span class="loc-option-check" aria-hidden="true"></span>
        <span class="loc-option-label">Include unknown locations</span>
      </label>
      <div class="loc-divider"></div>
      <div class="loc-footer">
        <button class="loc-clear-btn" type="button" onclick="clearLocationPrefs()">Clear filter</button>
      </div>
    </div>
  </div>`;
}

function renderFilters(filter, sort, globalStats, level, searchOptions = {}, extras = {}) {
  const levelActive = level === '1';
  const levelHref = buildDashboardHref(filter, sort, levelActive ? null : '1', searchOptions);
  const scoreHref = buildDashboardHref(filter, 'score', level, searchOptions);
  const dateHref = buildDashboardHref(filter, 'date', level, searchOptions);
  const q = typeof searchOptions.q === 'string' ? searchOptions.q.trim() : '';
  const rawMinScore = Number.parseInt(String(searchOptions.minScore ?? '1'), 10);
  const minScore = Number.isInteger(rawMinScore) ? Math.min(Math.max(rawMinScore, 1), 9) : 1;

  const myLevelCount = globalStats.myLevel || 0;
  const levelBadge = myLevelCount
    ? ` <span class="level-badge">${myLevelCount}</span>`
    : '';

  const secFilters = [
    { id: 'rejected', label: 'Rejected', key: 'rejected' },
    { id: 'ghosted',  label: 'Ghosted',  key: 'ghosted' },
    { id: 'closed',   label: 'Closed',   key: 'closed' },
    { id: 'archived', label: 'Archived', key: 'archived' },
  ].map(({ id, label, key }) => {
    const active = filter === id;
    const count = globalStats[key] || 0;
    const linkSort = id === 'rejected' ? 'date' : sort;
    return `<a href="${buildDashboardHref(id, linkSort, level, searchOptions)}" class="menu-item${active ? ' active' : ''}">${label}${count ? ` <span class="menu-count">${count}</span>` : ''}</a>`;
  }).join('');

  return `
<div class="header-sub">
  <div class="dd-wrap">
    <button class="icon-btn" id="nav-menu-btn" onclick="toggleNavMenu()" title="Navigation">
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
    </button>
    <div id="nav-menu" class="nav-dropdown">
      <a href="${buildDashboardHref('analytics', sort, null, searchOptions)}" class="menu-item${filter === 'analytics' ? ' active' : ''}">Stats</a>
      <a href="${buildDashboardHref('activity-log', sort, null, searchOptions)}" class="menu-item${filter === 'activity-log' ? ' active' : ''}">Event Log</a>
      <a href="${buildDashboardHref('market-research', sort, null, searchOptions)}" class="menu-item${filter === 'market-research' ? ' active' : ''}">Market Research</a>
      <a href="/help" class="menu-item">Help</a>
      <div class="menu-divider"></div>
      <a href="/resume" class="menu-item">Resume</a>
      <a href="/resume?variant=ai" class="menu-item">AI Resume</a>
      <a href="/resume?variant=devops" class="menu-item">DevOps Resume</a>
      <div class="menu-divider"></div>
      ${secFilters}
    </div>
  </div>
  <span class="filter-divider"></span>
  <div class="dd-wrap">
    <button class="icon-btn${levelActive ? ' active' : ''}" id="filter-panel-btn" onclick="toggleFilterPanel()" title="Filters">
      <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
    </button>
    <div id="filter-panel" class="filter-dropdown">
      <div class="filter-panel-row">
        <button class="filter-panel-btn${levelActive ? ' active' : ''}" onclick="location='${levelHref}'">My Level${levelBadge}</button>
      </div>
      <div class="filter-panel-row filter-panel-row-stack">
        <label class="filter-panel-label">Sort</label>
        <div class="filter-panel-group">
          <button class="filter-panel-btn${sort !== 'date' ? ' active' : ''}" onclick="location='${scoreHref}'">Score</button>
          <button class="filter-panel-btn${sort === 'date' ? ' active' : ''}" onclick="location='${dateHref}'">Date</button>
        </div>
      </div>
      <div class="filter-panel-row">
        <label class="filter-panel-label">Min Score</label>
        <input type="range" id="score-filter" min="1" max="9" value="${minScore}" oninput="applyFilters()">
        <span id="score-val" class="score-val">${minScore}</span>
      </div>
    </div>
  </div>
  ${renderLocationDropdown(extras.locationPrefs, extras.metros)}
  <input class="search-box" type="text" placeholder="Search\u2026" value="${escapeHtml(q)}" oninput="applyFilters()" />
</div>`;
}

module.exports = { renderFilters };
