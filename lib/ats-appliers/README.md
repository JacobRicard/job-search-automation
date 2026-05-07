# ats-appliers/

End to end auto-apply per ATS. Each module exports `applyXxx(job, applicant, ...)` and owns its own browser lifecycle: launch, navigate, fill, submit, wait for confirmation, screenshot, log a receipt. Answers come from rule tables (e.g. `SIMPLE_GREENHOUSE_QUESTION_RULES` in `greenhouse.js`), not from a model at runtime.

Consumers:
- `lib/auto-applier.js` (the batch auto-apply pipeline)
- `scripts/apply-extract.js`

Sibling primitives in this directory:
- `browser.js` puppeteer setup, field helpers, screenshot, resume staging
- `page-checks.js` detect closed/expired/error pages
- `preflight.js` validate applicant config before launching
- `utils.js` shared `sleep` and `DELAYS` constants

If you want the interactive flow where Claude reads each form question and generates an answer at runtime, see `lib/apply/` instead.
