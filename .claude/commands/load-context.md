---
description: Load context files at the start of a job-search session. Use when asked to "load context", "read context", "get up to speed", or at the start of any job-search or career-related session.
allowed-tools: Read, Bash, Write
---

## Step 0: Check setup

Run:

```bash
node -e "
const fs = require('fs');
const dataDir = process.env.DATA_DIR || 'data';
const needed = ['companies.js','context.md','resume.md'].map(f => dataDir+'/'+f);
const missing = needed.filter(f => !fs.existsSync(f));
const blank = needed.filter(f => {
  try { return fs.readFileSync(f,'utf8').trim().startsWith('# [Your Name]'); } catch { return false; }
});
console.log(JSON.stringify({ missing, blank }));
"
```

**If `missing` or `blank` is non-empty:** do not proceed with the context load. Instead, say:

> "Your profile hasn't been configured yet. I'll ask you a few questions to set it up — takes about 2 minutes."

Then immediately follow the instructions in `/setup` to conduct the setup interview and write the files. When setup is complete, continue from Step 1 below.

---

## Step 1: Find the active profile

Read `.env` to find `DATA_DIR`. Default: `data`.
Use an ignored-file-aware listing command such as `rg --files -u {DATA_DIR}` or `find {DATA_DIR} -type f` so gitignored profile files are not missed.

## Step 2: Read context files

Read the following files in full and internalize them before responding:

1. `.context/people/applicant.md` — applicant background, skills, working style
2. `.context/people/voice.md` — writing rules (critical for anything in the applicant's voice)
3. `.context/projects/job-search.md` — pipeline architecture and features
4. `.context/reference/dashboard-files.md` — file map for what to edit
5. `.context/decisions/architecture.md` — why things are built this way

## Step 3: Read active profile source files

Read every human-readable source/context file under `{DATA_DIR}` recursively, especially:

6. `data/context.md` — full career context, preferences, deal breakers
7. `data/career-detail.md` — deep project documentation and honest career narrative
8. `data/resume*.md` — current resume variants
9. `data/experience/*.md` — per-company experience details
10. `data/companies.js` — target company lists
11. `data/auto-apply-config.js` — auto-apply defaults (if it exists)
12. `data/dud-slugs.md` — known invalid ATS slugs (if it exists)
13. `data/auto-apply-overrides/*.json` — saved application question answers (if they exist)
14. `data/tailored-resumes/**/metadata.json` and `resume.md` — tailored resume context (if they exist)

Do not read binary or generated runtime artifacts as session context unless explicitly asked:

- `*.pdf`
- `*.db`, `*.db-shm`, `*.db-wal`
- `*.zip`
- `.DS_Store`
- `jobs.json`
- `market-research-cache.json`

Confirm with one short line: what session context is loaded and you're ready.
