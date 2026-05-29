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
      <p class="wizard-note">Setup takes about 3 minutes. You will need a free Groq API key to score jobs.</p>
      <div class="modal-actions" style="margin-top:24px">
        <button class="btn" style="background:${COLORS.accent};color:white;padding:10px 20px" onclick="wizardNext()">Set up my profile &rarr;</button>
      </div>
    </div>

    <!-- Step 1: API Key -->
    <div class="wizard-step" id="wstep-1">
      <h2>Groq API Key</h2>
      <p class="modal-sub">Jobs are scored using Groq's free API — no credit card required. Two-step scoring: a fast filter eliminates irrelevant roles, then a full 1–10 score is generated.</p>
      <label for="wizard-api-key">API Key</label>
      <div style="display:flex;gap:8px;margin-bottom:4px">
        <input id="wizard-api-key" type="password" placeholder="gsk_..." autocomplete="off" style="margin-bottom:0;flex:1" />
        <button class="btn" style="background:var(--slate);color:var(--text-muted);white-space:nowrap" onclick="wizardTestKey()" id="wizard-test-btn">Test</button>
      </div>
      <div id="wizard-key-status" style="font-size:12px;color:var(--text-muted);min-height:18px;margin-bottom:14px"></div>
      <p class="wizard-note">Get a free key at <a href="https://console.groq.com" target="_blank" rel="noopener" style="color:${COLORS.accent}">console.groq.com</a>. Free tier: ~14,400 calls/day.</p>
      <div class="modal-actions" style="margin-top:24px">
        <button class="btn" style="background:var(--slate);color:var(--text-muted)" onclick="wizardBack()">Back</button>
        <button class="btn" style="background:transparent;color:var(--text-muted);border:1px solid var(--border)" onclick="wizardNext()">Skip for now</button>
        <button class="btn" style="background:${COLORS.accent};color:white" onclick="wizardSaveKey()" id="wizard-key-save-btn">Save &amp; Continue</button>
      </div>
    </div>

    <!-- Step 2: Resume -->
    <div class="wizard-step" id="wstep-2">
      <h2>Your Resume</h2>
      <p class="modal-sub">Upload your resume. PDF, plain text, or markdown — any format works.</p>
      <input type="file" id="wizard-resume-file" accept=".pdf,.txt,.md" style="display:none" onchange="wizardResumeFileChanged()" />
      <div id="wizard-resume-upload-area" style="display:flex;align-items:center;gap:12px;margin:16px 0 4px">
        <button class="btn" style="background:var(--slate);color:var(--text-primary);white-space:nowrap" onclick="document.getElementById('wizard-resume-file').click()">Choose file</button>
        <span id="wizard-resume-filename" style="font-size:13px;color:var(--text-muted)">No file chosen</span>
      </div>
      <div id="wizard-resume-status" style="min-height:18px;font-size:12px;color:var(--text-muted);margin-bottom:12px"></div>
      <div class="modal-actions" style="margin-top:16px">
        <button class="btn" style="background:var(--slate);color:var(--text-muted)" onclick="wizardBack()">Back</button>
        <button class="btn" id="wizard-resume-save-btn" style="background:${COLORS.accent};color:white" onclick="wizardSaveResume()">Save &amp; Continue</button>
      </div>
    </div>

    <!-- Step 3: Job Targets -->
    <div class="wizard-step" id="wstep-3">
      <h2>Job Targets</h2>
      <p class="modal-sub">Tell the scorer what you are looking for. Jobs that match these criteria will rank higher.</p>
      <div id="wizard-autofill-status" style="min-height:18px;font-size:12px;color:var(--text-muted);margin-bottom:8px"></div>
      <div class="wizard-field-group">
        <label for="wizard-titles">Target titles <span class="wizard-field-hint">(one per line)</span></label>
        <textarea id="wizard-titles" rows="3" placeholder="Senior Backend Engineer&#10;Platform Engineer&#10;SRE"></textarea>

        <label for="wizard-salary">Base salary floor <span class="wizard-field-hint">(numbers only, optional)</span></label>
        <input id="wizard-salary" type="text" inputmode="numeric" pattern="[0-9]*" placeholder="180000" />

        <label for="wizard-location">Location preference <span class="wizard-field-hint">(optional)</span></label>
        <input id="wizard-location" type="text" placeholder="Remote or Austin, TX" style="margin-bottom:0" />
      </div>
      <div class="modal-actions" style="margin-top:20px">
        <button class="btn" style="background:var(--slate);color:var(--text-muted)" onclick="wizardBack()">Back</button>
        <button class="btn" id="wizard-profile-save-btn" style="background:${COLORS.accent};color:white" onclick="wizardSaveProfile()" disabled>Save &amp; Finish</button>
      </div>
    </div>

    <!-- Step 4: Done -->
    <div class="wizard-step" id="wstep-4">
      <h2>You are all set!</h2>
      <p class="modal-sub">Searching for jobs now. First matches usually appear within a few minutes.</p>
      <div id="wizard-pipeline-status" style="display:flex;align-items:center;gap:10px;margin:20px 0 8px;padding:12px 14px;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;font-size:13px;color:var(--text-muted)">
        <span id="wizard-pipeline-icon" style="font-size:16px">⏳</span>
        <span id="wizard-pipeline-msg">Starting your first job search...</span>
      </div>
      <ul class="wizard-list" style="margin-top:16px">
        <li>Scrapes 50+ company job boards every 30 minutes after this</li>
        <li>Each listing is scored against your resume</li>
        <li>Matches appear in the Pending tab for your review</li>
      </ul>
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
