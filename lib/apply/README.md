# apply/

Shared helpers for the reviewed application workflow. The legacy platform
fillers have been removed; active form filling lives in
`lib/ats-appliers/` and is driven through `lib/auto-applier.js`.

Consumers:
- `scripts/apply-cli.js`
- `scripts/ai-assist.js`
- `lib/auto-applier.js` (uses `shared.js` for keyword constants)

Browser primitives, page checks, preflight, and ATS-specific fill behavior live
in `lib/ats-appliers/`.
