# ats-appliers/

Browser automation helpers per ATS. Each module exports `applyXxx(job, applicant, ...)` and owns its own browser lifecycle: launch, navigate, fill, screenshot, and assist-mode handoff for user review. Answers are passed in from generated application prep.

Consumers:
- `lib/auto-applier.js` (reviewed assist bridge)
- `scripts/apply-extract.js`

Sibling primitives in this directory:
- `browser.js` puppeteer setup, field helpers, screenshot, resume staging
- `page-checks.js` detect closed/expired/error pages
- `preflight.js` validate applicant config before launching
- `utils.js` shared `sleep` and `DELAYS` constants
