'use strict';

const { COLORS } = require('./helpers');

function renderOnboardingWizard() {
  return `
<!-- Onboarding wizard -->
<div class="modal-overlay" id="onboarding-wizard">
  <div class="modal wizard-modal" style="max-width:580px;max-height:90vh;overflow-y:auto">
    <div class="wizard-progress" id="wizard-progress">
      <div class="wizard-dot active" id="wdot-0"></div>
      <div class="wizard-dot" id="wdot-1"></div>
      <div class="wizard-dot" id="wdot-2"></div>
      <div class="wizard-dot" id="wdot-3"></div>
      <div class="wizard-dot" id="wdot-4"></div>
    </div>

    <!-- Step 0: Welcome -->
    <div class="wizard-step active" id="wstep-0">
      <h2>Welcome to Job Search</h2>
      <p class="modal-sub">Your automated job pipeline. Here is what it does:</p>
      <ul class="wizard-list">
        <li>Scrapes 50+ company job boards every 30 minutes</li>
        <li>Scores each listing against your resume using AI</li>
        <li>Surfaces the best matches here for your review</li>
      </ul>
      <p class="wizard-note">Setup takes about 3 minutes. You will need a free Gemini API key to score jobs.</p>
      <div class="modal-actions" style="margin-top:24px">
        <button class="btn" style="background:${COLORS.accent};color:white;padding:10px 20px" onclick="wizardNext()">Set up my profile &rarr;</button>
      </div>
    </div>

    <!-- Step 1: API Key -->
    <div class="wizard-step" id="wstep-1">
      <h2>Gemini API Key</h2>
      <p class="modal-sub">The app uses Google Gemini to score jobs against your resume. The free tier is fully supported, no credit card required.</p>
      <label for="wizard-api-key">API Key</label>
      <div style="display:flex;gap:8px;margin-bottom:4px">
        <input id="wizard-api-key" type="password" placeholder="AIza..." autocomplete="off" style="margin-bottom:0;flex:1" />
        <button class="btn" style="background:var(--slate);color:var(--text-muted);white-space:nowrap" onclick="wizardTestKey()" id="wizard-test-btn">Test</button>
      </div>
      <div id="wizard-key-status" style="font-size:12px;color:var(--text-muted);min-height:18px;margin-bottom:14px"></div>
      <p class="wizard-note">Get a free key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener" style="color:${COLORS.accent}">aistudio.google.com/apikey</a>. Free tier: 500 jobs scored per day.</p>
      <div class="modal-actions" style="margin-top:24px">
        <button class="btn" style="background:var(--slate);color:var(--text-muted)" onclick="wizardBack()">Back</button>
        <button class="btn" style="background:transparent;color:var(--text-muted);border:1px solid var(--border)" onclick="wizardNext()">Skip for now</button>
        <button class="btn" style="background:${COLORS.accent};color:white" onclick="wizardSaveKey()" id="wizard-key-save-btn">Save &amp; Continue</button>
      </div>
    </div>

    <!-- Step 2: Resume -->
    <div class="wizard-step" id="wstep-2">
      <h2>Your Resume</h2>
      <p class="modal-sub">Paste your resume below. Plain text or markdown, either works. This is what gets scored against job listings.</p>
      <label for="wizard-resume">Resume</label>
      <textarea id="wizard-resume" rows="12" placeholder="Paste your resume here..."></textarea>
      <div class="modal-actions" style="margin-top:16px">
        <button class="btn" style="background:var(--slate);color:var(--text-muted)" onclick="wizardBack()">Back</button>
        <button class="btn" style="background:${COLORS.accent};color:white" onclick="wizardSaveResume()">Save &amp; Continue</button>
      </div>
    </div>

    <!-- Step 3: Job Targets -->
    <div class="wizard-step" id="wstep-3">
      <h2>Job Targets</h2>
      <p class="modal-sub">Tell the scorer what you are looking for. Jobs that match these criteria will rank higher.</p>
      <div class="wizard-field-group">
        <label for="wizard-titles">Target titles <span class="wizard-field-hint">(one per line)</span></label>
        <textarea id="wizard-titles" rows="3" placeholder="Senior Backend Engineer&#10;Platform Engineer&#10;SRE"></textarea>

        <label for="wizard-stack">Tech stack <span class="wizard-field-hint">(one per line)</span></label>
        <textarea id="wizard-stack" rows="3" placeholder="Go&#10;Kubernetes&#10;Postgres&#10;AWS"></textarea>

        <label for="wizard-salary">Base salary floor <span class="wizard-field-hint">(numbers only, optional)</span></label>
        <input id="wizard-salary" type="number" placeholder="180000" min="0" />

        <label for="wizard-location">Location preference <span class="wizard-field-hint">(optional)</span></label>
        <input id="wizard-location" type="text" placeholder="Remote or Austin, TX" style="margin-bottom:0" />
      </div>
      <div class="modal-actions" style="margin-top:20px">
        <button class="btn" style="background:var(--slate);color:var(--text-muted)" onclick="wizardBack()">Back</button>
        <button class="btn" style="background:${COLORS.accent};color:white" onclick="wizardSaveProfile()">Save &amp; Continue</button>
      </div>
    </div>

    <!-- Step 4: Search Terms -->
    <div class="wizard-step" id="wstep-4">
      <h2>Search Terms</h2>
      <p class="modal-sub">These keywords filter jobs scraped from company boards. Add terms that match the roles you want.</p>
      <label for="wizard-terms">Search terms <span class="wizard-field-hint">(one per line)</span></label>
      <textarea id="wizard-terms" rows="7" placeholder="backend engineer&#10;platform engineer&#10;site reliability engineer&#10;SRE&#10;cloud engineer&#10;devops"></textarea>
      <div class="modal-actions" style="margin-top:16px">
        <button class="btn" style="background:var(--slate);color:var(--text-muted)" onclick="wizardBack()">Back</button>
        <button class="btn" style="background:${COLORS.accent};color:white" onclick="wizardSaveCompanies()">Save &amp; Finish</button>
      </div>
    </div>

    <!-- Step 5: Done -->
    <div class="wizard-step" id="wstep-5">
      <h2>You are all set!</h2>
      <p class="modal-sub">Your profile is configured. Here is what happens next:</p>
      <ul class="wizard-list">
        <li>The worker scrapes 50+ company boards every 30 minutes</li>
        <li>Each new listing is scored against your resume</li>
        <li>Matches appear in the Pending tab for your review</li>
      </ul>
      <p class="wizard-note">The first batch of jobs usually appears within a few minutes.</p>
      <div class="modal-actions" style="margin-top:24px">
        <button class="btn" style="background:${COLORS.accent};color:white;padding:10px 20px" onclick="wizardDone()">Go to dashboard</button>
      </div>
    </div>
  </div>
</div>
`;
}

function renderModals() {
  return `
${renderOnboardingWizard()}
<!-- Job description modal -->
<div class="modal-overlay" id="jd-modal">
  <div class="modal" style="max-width:720px">
    <h2 id="jd-modal-title">Job Description</h2>
    <div class="modal-sub" id="jd-modal-sub"></div>
    <div id="jd-modal-body" style="white-space:pre-wrap;font-size:13px;line-height:1.6;max-height:60vh;overflow-y:auto;margin-top:12px;padding:12px;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;color:var(--text-primary)"></div>
    <div class="modal-actions">
      <button class="btn" style="background:var(--slate);color:var(--text-muted)" onclick="document.getElementById('jd-modal').style.display='none'">Close</button>
    </div>
  </div>
</div>

<!-- Company notes modal -->
<div class="modal-overlay" id="company-notes-modal">
  <div class="modal">
    <h2>Company Notes</h2>
    <div class="modal-sub" id="company-notes-sub"></div>
    <label for="company-tags-input">Tags <span style="font-size:11px;color:${COLORS.muted}">(comma-separated, e.g. "recently funded, network connection")</span></label>
    <input id="company-tags-input" type="text" placeholder="e.g. recently funded, network connection" autocomplete="off" />
    <label for="company-notes-input" style="margin-top:12px">Notes</label>
    <textarea id="company-notes-input" rows="4" placeholder="Freeform notes about this company..." style="width:100%;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);padding:8px;font-size:13px;resize:vertical"></textarea>
    <div class="modal-actions">
      <button class="btn" style="background:${COLORS.slateDark};color:${COLORS.muted}" onclick="closeCompanyNotes()">Cancel</button>
      <button class="btn" style="background:${COLORS.accent};color:white" onclick="saveCompanyNotes()">Save</button>
    </div>
  </div>
</div>

`;
}

module.exports = { renderModals };
