# apply/

Submit-only helpers for the interactive `/apply` flow. Each module exports `submitXxx(page, job, applicant, answers, tmpResume)` and operates on a page the caller has already launched and navigated. Answers are passed in, not derived: the caller (Claude, via `scripts/apply-cli.js`) reads each form question at runtime and generates the answer per field.

Consumers:
- `scripts/apply-cli.js` (the `/apply` skill)
- `scripts/ai-assist.js`
- `lib/auto-applier.js` (uses `shared.js` for keyword constants)
- `lib/dashboard-routes.js`

Browser primitives, page checks, and preflight live in `lib/ats-appliers/` and are imported from there.

If you want the fully autonomous batch flow with rule-based answers, see `lib/ats-appliers/` instead.
