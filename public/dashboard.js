'use strict';

const ICON_EYE   = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`;
const ICON_SEND  = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>`;
const ICON_CHECK = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;

let _currentJobId = null;

// ── Header popovers (nav menu, filter panel) ─────────────────────────
const PANEL_IDS = ['nav-menu', 'filter-panel'];

function togglePanel(id) {
  const panel = document.getElementById(id);
  if (!panel) return;
  const isOpen = panel.classList.toggle('open');
  document.getElementById(id + '-btn')?.classList.toggle('active', isOpen);
  if (isOpen) {
    PANEL_IDS.filter(p => p !== id).forEach(p => {
      document.getElementById(p)?.classList.remove('open');
      document.getElementById(p + '-btn')?.classList.remove('active');
    });
  }
}

function toggleNavMenu()     { togglePanel('nav-menu'); }
function toggleFilterPanel() { togglePanel('filter-panel'); }

function readLocationPrefs() {
  const sel = document.getElementById('loc-metro-select');
  const metros = sel && sel.value ? [sel.value] : [];
  const cb = document.getElementById('loc-include-unlisted');
  const includeUnknown = cb ? cb.checked : true;
  return { metros, includeUnknown };
}

function applyLocationPrefs() {
  const prefs = readLocationPrefs() || { metros: [] };
  fetch('/api/location-prefs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(prefs),
  }).then(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete('page');
    window.location.href = url.toString();
  });
}

// ── Job action menus ─────────────────────────────────────────────────
function toggleJobMenu(id, btn) {
  const menu = document.getElementById('jmenu-' + id);
  if (!menu) return;
  const wasOpen = menu.classList.contains('open');
  document.querySelectorAll('.job-actions-menu.open').forEach(m => {
    m.classList.remove('open');
    m.closest('.job-card')?.classList.remove('menu-active');
  });
  if (!wasOpen) {
    menu.classList.add('open');
    menu.closest('.job-card')?.classList.add('menu-active');
  }
}

function closeJobMenu(id) {
  const menu = document.getElementById('jmenu-' + id);
  if (!menu) return;
  menu.classList.remove('open');
  menu.closest('.job-card')?.classList.remove('menu-active');
}

function toggleInsights() {
  const drawer = document.getElementById('insight-drawer');
  const overlay = document.getElementById('insight-overlay');
  const btn = document.getElementById('insights-btn');
  if (!drawer) return;
  const isOpen = drawer.classList.toggle('open');
  if (overlay) overlay.classList.toggle('open', isOpen);
  if (btn) btn.classList.toggle('active', isOpen);
  if (isOpen) {
    if (!window._insightChart && typeof window.initDigestChart === 'function') window.initDigestChart();
    fetch('/api/insights').then(r => r.json()).then(data => {
      const items = drawer.querySelectorAll('.insight-stats .stat-item .stat-n');
      if (items[0] != null) items[0].textContent = data.todayRejected ?? 0;
      if (items[1] != null) items[1].textContent = data.todayClosed ?? 0;
      if (items[2] != null) items[2].textContent = data.todayApplied ?? 0;
      const digestEl = drawer.querySelector('.insight-text');
      if (digestEl && data.dailyDigest) digestEl.textContent = data.dailyDigest;
      if (window._insightChart && Array.isArray(data.dailyCounts)) {
        window._insightChart.data.labels = data.dailyCounts.map(function(d) { return d.label; });
        window._insightChart.data.datasets[0].data = data.dailyCounts.map(function(d) { return d.count; });
        window._insightChart.data.datasets[1].data = data.dailyCounts.map(function(d) { return d.target; });
        window._insightChart.update();
      }
    }).catch(() => {});
  }
}

document.addEventListener('click', e => {
  // Insight drawer
  const drawer = document.getElementById('insight-drawer');
  const overlay = document.getElementById('insight-overlay');
  const insightsBtn = document.getElementById('insights-btn');
  if (drawer && drawer.classList.contains('open')) {
    if (!drawer.contains(e.target) && insightsBtn && !insightsBtn.contains(e.target)) {
      drawer.classList.remove('open');
      if (overlay) overlay.classList.remove('open');
      if (insightsBtn) insightsBtn.classList.remove('active');
    }
  }

  // Header popovers
  PANEL_IDS.forEach(id => {
    const panel = document.getElementById(id);
    const btn = document.getElementById(id + '-btn');
    if (panel?.classList.contains('open') &&
        !panel.contains(e.target) && btn && !btn.contains(e.target)) {
      panel.classList.remove('open');
      btn.classList.remove('active');
    }
  });

  // Job action menus
  if (!e.target.closest('.job-col-actions')) {
    document.querySelectorAll('.job-actions-menu.open').forEach(m => {
      m.classList.remove('open');
      m.closest('.job-card')?.classList.remove('menu-active');
    });
  }
});

function showToast(msg, color) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.background = color || 'var(--green)';
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2000);
}


function toggleReasoning(id, btn) {
  const panel = document.getElementById('reasoning-' + id);
  const card = btn.closest('.job-card');
  if (!panel || !card) return;
  const isExpanded = card.classList.contains('expanded');
  if (isExpanded) {
    card.classList.remove('expanded');
    btn.innerHTML = ICON_EYE;
    btn.classList.remove('btn-cmd-why-on');
  } else {
    card.classList.add('expanded');
    btn.innerHTML = ICON_EYE;
    btn.classList.add('btn-cmd-why-on');
  }
}

const PIPELINE_COLORS = { '': '#475569', applied: '#3b82f6', phone_screen: '#a855f7', interview: '#d8b4fe', onsite: '#f59e0b', offer: '#22c55e', closed: '#64748b' };
const PIPELINE_LABELS = { '': '\u2014', applied: 'Applied', phone_screen: 'Phone Screen', interview: 'Interview', onsite: 'Onsite', offer: 'Offer', closed: 'Closed', rejected: 'Rejected' };

async function setPipeline(id, value, selectEl) {
  const res = await fetch('/pipeline', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, value }),
  });
  if (res.ok) {
    if (selectEl) selectEl.style.color = PIPELINE_COLORS[value] || '#475569';
    const label = PIPELINE_LABELS[value] || value;
    showToast(label || 'Cleared', PIPELINE_COLORS[value] || '#475569');

    const notesBtn = document.getElementById('notes-btn-' + id);
    if (notesBtn && !notesBtn.textContent.includes('View')) {
      notesBtn.style.display = ['phone_screen', 'interview'].includes(value) ? '' : 'none';
    }

    if (value === 'rejected') {
      const row = selectEl && selectEl.closest('.job-card');
      await fetch('/archive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
      if (row) {
        row.style.transition = 'opacity 0.3s';
        row.style.opacity = '0';
        setTimeout(() => row.remove(), 300);
      }
    }
  }
}

async function markOutreach(id, clear) {
  const res = await fetch('/mark-outreach', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, clear }),
  });
  const data = await res.json();
  const btn = document.getElementById('outreach-btn-' + id);
  if (!btn) return;
  if (data.reached_out_at) {
    const d = data.reached_out_at.slice(5, 10);
    btn.innerHTML = ICON_CHECK + `<span class="outreach-date">${d}</span> Reached`;
    btn.onclick = () => markOutreach(id, true);
    btn.title = 'Reached out ' + data.reached_out_at.slice(0, 10) + ' — click to clear';
  } else {
    btn.innerHTML = ICON_SEND + ' Reach out';
    btn.onclick = () => markOutreach(id, false);
    btn.title = 'Mark outreach';
  }
}


async function archiveJob(id, btn) {
  const row = btn.closest('.job-card');
  const res = await fetch('/archive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  if (res.ok) {
    row.style.transition = 'opacity 0.3s';
    row.style.opacity = '0';
    setTimeout(() => row.remove(), 300);
    showToast('Archived', '#475569');
  }
}

let _applyFiltersTimer = null;

function applyFilters() {
  const searchBox = document.querySelector('.search-box');
  const scoreInput = document.getElementById('score-filter');
  const scoreVal = document.getElementById('score-val');
  if (!searchBox || !scoreInput) return;

  const q = searchBox.value.trim();
  const rawMinScore = Number.parseInt(scoreInput.value, 10);
  const minScore = Number.isInteger(rawMinScore) ? Math.min(Math.max(rawMinScore, 1), 9) : 1;
  if (scoreVal) scoreVal.textContent = String(minScore);

  window.clearTimeout(_applyFiltersTimer);
  _applyFiltersTimer = window.setTimeout(() => {
    const params = new URLSearchParams(window.location.search);
    if (q) params.set('q', q);
    else params.delete('q');

    if (minScore > 1) params.set('minScore', String(minScore));
    else params.delete('minScore');

    params.delete('page');

    const nextUrl = `/?${params.toString()}`;
    const currentUrl = `${window.location.pathname}${window.location.search}`;
    if (nextUrl !== currentUrl) window.location.assign(nextUrl);
  }, 600);
}

// ---------------------------------------------------------------------------
// Company notes modal
// ---------------------------------------------------------------------------

let _currentCompany = null;

function openCompanyNotes(company) {
  _currentCompany = company;
  document.getElementById('company-notes-sub').textContent = company;
  document.getElementById('company-tags-input').value = '';
  document.getElementById('company-notes-input').value = '';
  document.getElementById('company-notes-modal').classList.add('open');
  fetch('/company-notes?company=' + encodeURIComponent(company))
    .then(r => r.json())
    .then(data => {
      document.getElementById('company-tags-input').value = data.tags || '';
      document.getElementById('company-notes-input').value = data.notes || '';
    })
    .catch(() => {});
}

function closeCompanyNotes() {
  document.getElementById('company-notes-modal').classList.remove('open');
  _currentCompany = null;
}

function saveCompanyNotes() {
  if (!_currentCompany) return;
  const tags = document.getElementById('company-tags-input').value;
  const notes = document.getElementById('company-notes-input').value;
  fetch('/company-notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ company: _currentCompany, tags, notes }),
  })
    .then(() => { showToast('Notes saved', '#22c55e'); closeCompanyNotes(); })
    .catch(() => showToast('Save failed', '#ef4444'));
}

document.getElementById('company-notes-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('company-notes-modal')) closeCompanyNotes();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeCompanyNotes();
    document.getElementById('jd-modal').style.display = 'none';
  }
});

// ---------------------------------------------------------------------------
// Job description modal
// ---------------------------------------------------------------------------

async function openJobDescription(id, title, company) {
  const modal = document.getElementById('jd-modal');
  const body = document.getElementById('jd-modal-body');
  document.getElementById('jd-modal-title').textContent = title;
  document.getElementById('jd-modal-sub').textContent = company;
  body.textContent = 'Loading…';
  modal.style.display = 'flex';
  try {
    const data = await fetch('/job-description?id=' + encodeURIComponent(id)).then(r => r.json());
    body.textContent = data.description || '(no description stored)';
  } catch (e) {
    body.textContent = 'Failed to load.';
  }
}

document.getElementById('jd-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('jd-modal')) document.getElementById('jd-modal').style.display = 'none';
});

// ---------------------------------------------------------------------------
// Onboarding wizard
// ---------------------------------------------------------------------------

var _wizardStep = 0;
var _wizardHasKey = false;

(function initWizard() {
  if (!window.__FIRST_RUN__) return;
  if (localStorage.getItem('jsa_setup_done')) return;

  fetch('/api/setup/status')
    .then(function(r) { return r.json(); })
    .then(function(data) { if (data && data.hasKey) _wizardHasKey = true; })
    .catch(function() {});

  var overlay = document.getElementById('onboarding-wizard');
  if (overlay) overlay.classList.add('open');
})();

function wizardGoTo(step) {
  var steps = document.querySelectorAll('.wizard-step');
  var dots = document.querySelectorAll('.wizard-dot');
  var totalSteps = steps.length;
  steps.forEach(function(el, i) {
    el.classList.toggle('active', i === step);
  });
  dots.forEach(function(el, i) {
    el.classList.toggle('active', i === step);
    el.classList.toggle('done', i < step);
  });
  _wizardStep = step;
  if (step === 2) { wizardUpdateResumeHint(); }
  // Kick off pipeline when reaching the Done step (last step)
  if (step === totalSteps - 1) {
    wizardKickoffPipeline();
  }
}

function wizardUpdateResumeHint() {
  var status = document.getElementById('wizard-resume-status');
  if (status) status.textContent = '';
}

// Load PDF.js on demand from CDN for client-side text extraction
function loadPdfJs(callback) {
  if (window.pdfjsLib) { callback(window.pdfjsLib); return; }
  var s = document.createElement('script');
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  s.onload = function() {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    callback(window.pdfjsLib);
  };
  s.onerror = function() { callback(null); };
  document.head.appendChild(s);
}

function wizardKickoffPipeline() {
  var icon = document.getElementById('wizard-pipeline-icon');
  var msg = document.getElementById('wizard-pipeline-msg');
  fetch('/api/setup/run-refresh', { method: 'POST' })
    .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })
    .then(function(result) {
      if (result.ok && result.data && result.data.ok) {
        if (icon) icon.textContent = '✅';
        if (msg) { msg.textContent = 'Job search is running (runId ' + result.data.runId + '). Check the Pending tab in a few minutes.'; msg.style.color = 'var(--text-primary)'; }
      } else {
        console.error('[wizard] kickoff failed:', result.data);
        if (icon) icon.textContent = '⚠️';
        if (msg) { msg.textContent = 'Could not start pipeline: ' + ((result.data && result.data.error) || 'unknown error'); msg.style.color = 'var(--red)'; }
      }
    })
    .catch(function(err) {
      console.error('[wizard] kickoff fetch failed:', err);
      if (icon) icon.textContent = '⚠️';
      if (msg) { msg.textContent = 'Could not start pipeline: ' + (err && err.message ? err.message : 'network error'); msg.style.color = 'var(--red)'; }
    });
}

function wizardNext() { wizardGoTo(_wizardStep + 1); }
function wizardBack() { wizardGoTo(_wizardStep - 1); }

function wizardTestKey() {
  var key = (document.getElementById('wizard-api-key') || {}).value || '';
  var status = document.getElementById('wizard-key-status');
  var btn = document.getElementById('wizard-test-btn');
  if (!key.trim()) {
    if (status) { status.textContent = 'Enter a key first.'; status.style.color = 'var(--red)'; }
    return;
  }
  if (status) { status.textContent = 'Testing...'; status.style.color = 'var(--text-muted)'; }
  if (btn) btn.disabled = true;
  fetch('/api/setup/test-key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: key.trim() }),
  })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (status) {
        status.textContent = data.ok ? 'Key is valid!' : (data.error || 'Key invalid.');
        status.style.color = data.ok ? 'var(--green)' : 'var(--red)';
      }
      if (btn) btn.disabled = false;
    })
    .catch(function() {
      if (status) { status.textContent = 'Test failed.'; status.style.color = 'var(--red)'; }
      if (btn) btn.disabled = false;
    });
}

function wizardSaveKey() {
  var key = (document.getElementById('wizard-api-key') || {}).value || '';
  if (!key.trim()) { wizardNext(); return; }
  var saveBtn = document.getElementById('wizard-key-save-btn');
  if (saveBtn) saveBtn.disabled = true;
  fetch('/api/setup/api-key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: key.trim() }),
  })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      _wizardHasKey = !!(data && data.ok);
      if (saveBtn) saveBtn.disabled = false;
      wizardNext();
    })
    .catch(function() {
      if (saveBtn) saveBtn.disabled = false;
      wizardNext();
    });
}

function wizardResumeFileChanged() {
  var input = document.getElementById('wizard-resume-file');
  var label = document.getElementById('wizard-resume-filename');
  var status = document.getElementById('wizard-resume-status');
  if (input && input.files && input.files[0]) {
    if (label) label.textContent = input.files[0].name;
    if (status) status.textContent = '';
  }
}

function wizardSaveResume() {
  var input = document.getElementById('wizard-resume-file');
  var status = document.getElementById('wizard-resume-status');
  var saveBtn = document.getElementById('wizard-resume-save-btn');
  var file = input && input.files && input.files[0];
  if (!file) { wizardNext(); return; }

  if (saveBtn) saveBtn.disabled = true;
  if (status) { status.textContent = 'Uploading...'; status.style.color = 'var(--text-muted)'; }

  var isPdf = file.name.toLowerCase().endsWith('.pdf');

  if (isPdf) {
    // Extract text from the PDF in the browser using PDF.js — no server-side key needed.
    if (status) { status.textContent = 'Extracting text from PDF...'; status.style.color = 'var(--text-muted)'; }
    loadPdfJs(function(pdfjs) {
      if (!pdfjs) {
        if (status) { status.textContent = 'Could not load PDF reader. Upload a .txt or .md file instead.'; status.style.color = 'var(--red)'; }
        if (saveBtn) saveBtn.disabled = false;
        return;
      }
      var reader = new FileReader();
      reader.onload = function(e) {
        pdfjs.getDocument({ data: new Uint8Array(e.target.result) }).promise
          .then(function(pdf) {
            var pagePromises = [];
            for (var p = 1; p <= pdf.numPages; p++) {
              pagePromises.push(
                pdf.getPage(p).then(function(page) {
                  return page.getTextContent().then(function(tc) {
                    return tc.items.map(function(it) { return it.str; }).join(' ');
                  });
                })
              );
            }
            return Promise.all(pagePromises);
          })
          .then(function(pages) {
            var text = pages.join('\n\n').trim();
            if (!text) {
              if (status) { status.textContent = 'No text found in this PDF. Upload a .txt or .md file instead.'; status.style.color = 'var(--red)'; }
              if (saveBtn) saveBtn.disabled = false;
              return;
            }
            fetch('/api/setup/resume', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ content: text }),
            })
              .then(function(r) { return r.json(); })
              .then(function(data) {
                if (saveBtn) saveBtn.disabled = false;
                if (!data.ok) {
                  if (status) { status.textContent = 'Upload failed: ' + (data.error || 'unknown'); status.style.color = 'var(--red)'; }
                  return;
                }
                wizardNext();
                wizardAutoFillTargets();
              })
              .catch(function(err) {
                if (status) { status.textContent = 'Upload failed: ' + (err && err.message ? err.message : 'network error'); status.style.color = 'var(--red)'; }
                if (saveBtn) saveBtn.disabled = false;
              });
          })
          .catch(function() {
            if (status) { status.textContent = 'Could not read this PDF. Try a .txt or .md file.'; status.style.color = 'var(--red)'; }
            if (saveBtn) saveBtn.disabled = false;
          });
      };
      reader.onerror = function() {
        if (status) { status.textContent = 'Could not read file.'; status.style.color = 'var(--red)'; }
        if (saveBtn) saveBtn.disabled = false;
      };
      reader.readAsArrayBuffer(file);
    });
    return;
  } else {
    var reader = new FileReader();
    reader.onload = function(e) {
      fetch('/api/setup/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: e.target.result }),
      })
        .catch(function() {})
        .finally(function() {
          if (saveBtn) saveBtn.disabled = false;
          wizardNext();
          wizardAutoFillTargets();
        });
    };
    reader.readAsText(file);
  }
}

function wizardValidateProfile() {
  var btn = document.getElementById('wizard-profile-save-btn');
  if (!btn) return;
  var titles = ((document.getElementById('wizard-titles') || {}).value || '').trim();
  btn.disabled = !titles;
}

function wizardAutoFillTargets() {
  var autofillStatus = document.getElementById('wizard-autofill-status');
  var saveBtn = document.getElementById('wizard-profile-save-btn');
  if (saveBtn) saveBtn.disabled = true;
  if (autofillStatus) { autofillStatus.textContent = 'Analyzing resume...'; autofillStatus.style.color = 'var(--text-muted)'; }
  var titlesEl = document.getElementById('wizard-titles');
  if (titlesEl && !titlesEl.__wizardListenerAttached) {
    titlesEl.addEventListener('input', wizardValidateProfile);
    titlesEl.__wizardListenerAttached = true;
  }
  fetch('/api/setup/extract-profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.ok && data.titles) {
        if (data.titles)  { var el = document.getElementById('wizard-titles');  if (el) el.value = data.titles; }
        if (data.salary)  { var el = document.getElementById('wizard-salary');  if (el) el.value = data.salary; }
        if (data.industry) { window.__wizardIndustry = data.industry; }
        if (autofillStatus) { autofillStatus.textContent = 'Auto-filled from your resume. Edit as needed.'; autofillStatus.style.color = 'var(--green)'; }
      } else {
        if (autofillStatus) { autofillStatus.textContent = 'Could not auto-fill. Enter at least one target title to continue.'; autofillStatus.style.color = 'var(--text-muted)'; }
      }
    })
    .catch(function() {
      if (autofillStatus) { autofillStatus.textContent = 'Auto-fill failed. Enter at least one target title to continue.'; autofillStatus.style.color = 'var(--text-muted)'; }
    })
    .finally(wizardValidateProfile);
}

function wizardSaveProfile() {
  var titles = (document.getElementById('wizard-titles') || {}).value || '';
  var salary = (document.getElementById('wizard-salary') || {}).value || '';
  var location = (document.getElementById('wizard-location') || {}).value || '';
  var industry = window.__wizardIndustry || '';
  fetch('/api/setup/profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ titles: titles, salary: salary, location: location, industry: industry }),
  })
    .catch(function() {})
    .finally(function() { wizardNext(); });
}

function wizardSaveCompanies() {
  var terms = (document.getElementById('wizard-terms') || {}).value || '';
  fetch('/api/setup/companies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ searchTerms: terms }),
  })
    .catch(function() {})
    .finally(function() { wizardNext(); });
}

function wizardDone() {
  localStorage.setItem('jsa_setup_done', '1');
  var overlay = document.getElementById('onboarding-wizard');
  if (overlay) overlay.classList.remove('open');
  showToast('Searching for jobs now. Check Pending in a few minutes.', '#22c55e');
}

// ---------------------------------------------------------------------------
// Scoring progress banner — keeps users informed while the background pipeline
// imports, scores, and classifies. Polls /api/scoring-progress every 7s, hides
// itself when there's nothing left to score, and triggers a single page reload
// once new scores have landed (so the empty list fills in).
// ---------------------------------------------------------------------------

(function () {
  var banner = document.getElementById('scoring-progress-banner');
  if (!banner) return;
  var msgEl = document.getElementById('scoring-progress-msg');
  var barEl = document.getElementById('scoring-progress-bar');
  var initialScored = null;
  var reloadedOnce = false;

  function formatEta(seconds) {
    function pad2(n) { return (n < 10 ? '0' : '') + n; }
    if (typeof seconds !== 'number' || !isFinite(seconds) || seconds <= 0) return '~00:01';
    var totalMinutes = Math.max(1, Math.ceil(seconds / 60));
    return '~' + pad2(Math.floor(totalMinutes / 60)) + ':' + pad2(totalMinutes % 60);
  }

  function updateApiCounter(used) {
    if (typeof used !== 'number') return;
    var usedEl = document.getElementById('api-indicator-used');
    if (!usedEl) return;
    if (parseInt(usedEl.textContent, 10) === used) return;
    usedEl.textContent = used;
    var wrap = document.getElementById('api-indicator');
    var limit = parseInt((wrap && wrap.dataset.limit) || '14400', 10);
    if (wrap && limit > 0) {
      wrap.style.color = used > limit * 0.8 ? '#ef4444' : '';
    }
  }

  function poll() {
    fetch('/api/scoring-progress')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || typeof d.unscored !== 'number') return;
        updateApiCounter(d.apiUsed);
        if (initialScored === null) initialScored = d.scored;
        // Genuinely done: some jobs scored, none left to score.
        if (d.scored > 0 && d.unscored === 0) {
          banner.style.display = 'none';
          if (!reloadedOnce && d.scored > initialScored) {
            reloadedOnce = true;
            location.reload();
          }
          return;
        }
        var pct = d.total > 0 ? Math.round((d.scored / d.total) * 100) : 0;
        var stateLabel;
        if (d.quotaExhausted) {
          stateLabel = 'Daily Groq quota reached. Scored ' + d.scored + ' of ' + d.total + ' jobs — set Ollama Host in Settings to score locally with no quota limits.';
        } else if (d.total === 0) {
          stateLabel = 'Setting up your first job search — discovering companies and scraping job boards in the background. First jobs usually appear within 2–3 minutes.';
        } else if (d.scored === 0 && !d.active) {
          stateLabel = d.total + ' jobs imported. Scoring is about to start…';
        } else if (d.scored === 0) {
          stateLabel = 'Scoring your first jobs against your resume… (ETA ' + formatEta(d.etaSeconds) + ')';
        } else {
          stateLabel = 'Scoring ' + d.scored + ' of ' + d.total + ' jobs against your resume — ETA ' + formatEta(d.etaSeconds) + '. Top matches appear at the top of the list as they score.';
        }
        banner.style.display = 'flex';
        msgEl.textContent = stateLabel;
        barEl.style.width = pct + '%';
        if (!reloadedOnce && d.scored >= 25 && initialScored < 25) {
          reloadedOnce = true;
          location.reload();
        }
      })
      .catch(function () { /* keep polling; transient failures are fine */ });
  }

  poll();
  setInterval(poll, 7000);
})();

// ---------------------------------------------------------------------------
// Score comparison pagination (analytics page)
// ---------------------------------------------------------------------------

(function () {
  var table = document.getElementById('comparison-table');
  if (!table) return;
  var PAGE_SIZE = 25, page = 0;
  var rows = table.querySelectorAll('tbody tr');
  var total = rows.length, pages = Math.ceil(total / PAGE_SIZE);
  function show() {
    rows.forEach(function (r, i) { r.style.display = (i >= page * PAGE_SIZE && i < (page + 1) * PAGE_SIZE) ? '' : 'none'; });
    document.getElementById('comparison-prev').disabled = page === 0;
    document.getElementById('comparison-next').disabled = page >= pages - 1;
    document.getElementById('comparison-page-info').textContent = 'Page ' + (page + 1) + ' of ' + pages + ' (' + total + ' total)';
  }
  window.pageComparison = function (d) { page = Math.max(0, Math.min(pages - 1, page + d)); show(); };
  show();
})();
