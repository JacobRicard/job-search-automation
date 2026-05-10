---
description: Load context files at the start of a job-search session. Use when asked to "load context", "read context", "get up to speed", or at the start of any job-search or career-related session.
allowed-tools: Read, Bash
---

## Step 1: Find the active profile

Read `.env` to find `JOB_PROFILE_DIR`. Default: `profiles/example`.
Use an ignored-file-aware listing command such as `rg --files -u {JOB_PROFILE_DIR}` or `find {JOB_PROFILE_DIR} -type f` so gitignored profile files are not missed.

## Step 2: Read context files

Read the following files in full and internalize them before responding:

1. `.context/people/jake.md` — Jake's background, skills, working style
2. `.context/people/jake-voice.md` — writing rules (critical for anything in Jake's voice)
3. `.context/projects/job-search.md` — pipeline architecture and features
4. `.context/reference/dashboard-files.md` — file map for what to edit
5. `.context/decisions/architecture.md` — why things are built this way

## Step 3: Read active profile source files

Read every human-readable source/context file under `{JOB_PROFILE_DIR}` recursively, especially:

6. `{JOB_PROFILE_DIR}/context.md` — full career context, preferences, deal breakers
7. `{JOB_PROFILE_DIR}/career-detail.md` — deep project documentation and honest career narrative
8. `{JOB_PROFILE_DIR}/resume*.md` — current resume variants
9. `{JOB_PROFILE_DIR}/experience/*.md` — per-company experience details
10. `{JOB_PROFILE_DIR}/companies.js` — target company lists
11. `{JOB_PROFILE_DIR}/auto-apply-config.js` — auto-apply defaults
12. `{JOB_PROFILE_DIR}/dud-slugs.md` — known invalid ATS slugs
13. `{JOB_PROFILE_DIR}/auto-apply-overrides/*.json` — saved application question answers
14. `{JOB_PROFILE_DIR}/tailored-resumes/**/metadata.json` and `resume.md` — tailored resume context

Do not read binary or generated runtime artifacts as session context unless explicitly asked:

- `*.pdf`
- `*.db`, `*.db-shm`, `*.db-wal`
- `*.zip`
- `.DS_Store`
- `jobs.json`
- `market-research-cache.json`

Confirm with one short line: what session context is loaded and you're ready.
