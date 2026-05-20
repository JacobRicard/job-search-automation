# Job Search Pipeline

An end-to-end automation pipeline for a technical job search. Scrapes 11 ATS platforms, scores each listing with an LLM against your resume and context files, generates manual application prep and tailored resumes, and serves a local dashboard for human review and pipeline tracking. IMAP integration syncs rejection emails back into the DB automatically.

Designed for a single applicant (or a small group sharing one machine), not as a SaaS. The point is to get the benefits of a structured pipeline without spinning up infrastructure for it.

## Screenshots

### Dashboard — scored, ranked, filterable job listings
![Dashboard](docs/screenshots/dashboard.png)

### Applied pipeline — track stage progression
![Applied pipeline](docs/screenshots/applied.png)

### Analytics — pipeline funnel + score calibration
![Analytics](docs/screenshots/analytics.png)

### Market Research — LLM gap analysis against your resume
![Market Research](docs/screenshots/market-research.png)

### Interviewing, rejected, and activity log views
<p float="left">
  <img src="docs/screenshots/interviewing.png" width="32%" alt="Interviewing" />
  <img src="docs/screenshots/rejected.png" width="32%" alt="Rejected" />
  <img src="docs/screenshots/activity-log.png" width="32%" alt="Activity log" />
</p>


## Architecture

```
                       +----------------+
  cron / launchd  ---> |  refresh.js    |
                       +----------------+
                               |
               +---------------+---------------+
               v                               v
      +-----------------+            +-----------------+
      |   scraper.js    |            |  per-profile    |
      | (11 platforms)  |            |  env            |
      +--------+--------+            +--------+--------+
               |                              |
               v                              v
        jobs.json (tmp)                pipeline.js
                                              |
                              +---------------+-------------------+
                              v               v                   v
                      dedupe & insert    scorer.js         classifyComplexity
                      into SQLite        (Gemini)          (simple vs complex)
                              |               |                   |
                              +---------------+-------------------+
                                              |
                                              v
                                   +----------------------+
                                   |      jobs.db         |
                                   |  (per-profile)       |
                                   +----------+-----------+
                                              |
                                              v
                                   +----------------------+
                                   |    dashboard.js      |  <---- you (localhost)
                                   | (server-rendered)    |
                                   +----------+-----------+
                                              |
                           +------------------+--------------------+
                           v                                       v
                 +------------------+                 +---------------------+
                 | tailored-resume  |                 | application-prep    |
                 | (per-job MD /    |                 | (manual answers,    |
                 |  HTML / PDF)     |                 |  bookmarklet, JSON) |
                 |                  |                 |                     |
                 +------------------+                 +---------------------+
                           |                                       |
                           +-----------------+---------------------+
                                             |
                                             v
                                  +----------------------+
                                  |   rejection email    |
                                  |   sync via IMAP      |
                                  +----------------------+
```

## Tech stack

- **Node.js 18+** (CommonJS), zero build step
- **better-sqlite3** for per-profile job storage
- **puppeteer-core + puppeteer-extra-plugin-stealth** for ATS inspection and resume PDF rendering
- **Google Gemini Flash** for scoring, complexity classification, application prep, and tailored resumes
- **imapflow** for inbox rejection sync
- **Server-rendered HTML** dashboard with vanilla client-side JS

## Features

### Multi-source scraping

Pulls from Greenhouse, Lever, Ashby, Workable, Workday, Wellfound, Built In, Rippling, RemoteOK, Jobicy, Arbeitnow, and WeWorkRemotely. Company slugs configured per profile, global boards filtered by search terms. Respectful rate limits and User-Agent.

### LLM scoring with post-processing

Gemini scores each job 1-10 along five dimensions (stack match, seniority, comp, company stage, desirability). Scores are post-processed deterministically to cap mis-rated roles (for example, roles requiring 8+ YOE cap at 3 regardless of prompt output).

### Application complexity classifier

Each scored job is tagged `simple` or `complex` so you can triage apply effort. The active workflow is manual: generate prep, generate a tailored resume, open the job URL, review everything, and submit yourself.

### Tailored resumes

For any job, generate a job-specific resume from the active profile's `resume.md`, optional resume variants, `context.md`, and `career-detail.md`. Artifacts are stored under `JOB_PROFILE_DIR/tailored-resumes/<job-id>/` as Markdown, HTML, PDF, and metadata JSON.

### Voice-aware LLM drafting

All answers generated for applications pass through a voice check (`lib/voice-check.js`) that flags em dashes, corporate buzzwords, and AI-flavored sentence structure. Flagged answers can be rewritten by the LLM with the issues highlighted.

### Dashboard

Server-rendered HTML (no framework, no build step) on `localhost:3131`. Filter tabs, pipeline tracking (Applied → Phone Screen → Interview → Onsite → Offer / Rejected), market research analytics, company notes, and interview prep notes attached to each job.

Dashboard views:

- **All** — active jobs that are not archived, rejected, closed, or ghosted.
- **Not Applied** — the main triage queue for jobs that still need a decision.
- **Applied** — submitted applications that are still active.
- **Interviewing** — phone screen, interview, onsite, and offer stages.
- **Rejected / Closed / Ghosted / Archived** — terminal or hidden-state queues.
- **Stats** — funnel, score calibration, recent events, rejection timing, and apply receipt summaries.
- **Apply Receipts** — auto-apply or assisted-apply attempt log with status, platform, mode, failure class, score, age, screenshots, and resume artifacts.
- **Event Log** — audit trail from stage, outreach, and archive changes.
- **Market Research** — aggregate JD analysis against the active profile, including seniority, location, top skills, strategy score, and emerging high-score signals.

Job card actions:

- Change pipeline stage: pending, applied, phone screen, interview, onsite, offer, closed, rejected, or ghosted.
- Inspect LLM reasoning, saved job description, salary/ATS/company badges, apply screenshots, and company-level tags.
- Generate manual application prep, copy generated answers, run the bookmarklet payload, and generate or open a tailored resume.
- Toggle outreach tracking and archive jobs without deleting their records.

Search and filters:

- The URL stores `filter`, `sort`, `level`, `q`, `minScore`, and `page`, so dashboard views are linkable.
- Search matches title, company, location, description, reasoning, rejection reasoning, status, stage, apply complexity, and platform.
- Sort by score or date; rejected jobs default to date sort.
- The My Level filter applies seniority matching based on title and description.
- Job-list views paginate at 25 jobs per page.

### Rejection email sync

Every 5 minutes, the dashboard IMAPs your Gmail, pattern-matches rejection emails against known applied jobs, and flips their stage to `rejected` with the rejection reason parsed out.

### Multi-profile support

Multiple applicants on one machine (a couple, say) can run isolated pipelines by pointing `JOB_PROFILE_DIR` and `JOB_DB_PATH` at different directories. The refresh flow runs the active profile from the environment.

## Design decisions

A few things worth flagging:

- **No framework, no build step.** The dashboard is server-rendered HTML with a single CSS file. This is a personal tool, not a product. Adding Next.js buys nothing.
- **SQLite over any server DB.** The pipeline runs on one machine. A single-file DB is zero-config, backs up with `cp`, and handles the workload trivially.
- **File-based context over vector DB.** LLM calls read `resume.md`, `context.md`, and `career-detail.md` directly. A vector DB would add complexity for a corpus that fits in a prompt.
- **Env-var profile isolation.** `JOB_PROFILE_DIR` and `JOB_DB_PATH` keep profiles apart. No code branching, no per-profile if-statements.
- **Events table for audit trail.** Every pipeline state change is logged, which makes rejection analysis (days-to-rejection, posting age on apply) tractable.

More detail in `.context.example/decisions/`.

## Setup

```bash
git clone https://github.com/jakemercure28/job-search-automation.git
cd job-search-automation

# 1. Dependencies (Node 18+ required, see `.nvmrc` if using nvm)
npm install

# 2. Config
cp .env.example .env
# then fill in:
#   - GEMINI_API_KEY (https://aistudio.google.com/apikey)
#   - APPLICANT_* fields for your identity
#   - GMAIL_EMAIL / GMAIL_APP_PASSWORD (optional; for rejection sync)

# 3. Profile scaffolding
cp -r profiles/example profiles/your-name
# edit profiles/your-name/resume.md, context.md, career-detail.md, companies.js

# 4. Context scaffolding (for LLM grounding)
cp -r .context.example .context
# edit .context/people/applicant.md, voice.md as appropriate

# 5. Point .env at your profile (update these two lines in .env;
#    do not add a second copy, the last occurrence wins under `set -a`):
#   JOB_PROFILE_DIR=profiles/your-name
#   JOB_DB_PATH=profiles/your-name/jobs.db

# 6. First run
npm run daily
npm start            # dashboard on http://localhost:3131
```

### Try it with demo data (no API key required)

If you just want to see the dashboard populated without scraping or scoring:

```bash
cp .env.example .env
cp -r profiles/example profiles/demo
# set JOB_PROFILE_DIR=profiles/demo and JOB_DB_PATH=profiles/demo/jobs.db in .env
node scripts/seed-demo.js
npm start
# open http://localhost:3131
```

The seed script populates 20 fake jobs, pipeline stages, and a pre-computed market-research snapshot so every view in the screenshots above renders end-to-end.

## Common commands

```bash
npm run help               # command reference with use cases and flags
npm run help -- apply      # filter commands by group, command, flag, or text
npm run help -- --json     # machine-readable command reference
```

## Dashboard route reference

The dashboard is a single local Node HTTP process. It serves HTML, JSON, generated artifacts, health checks, and mutations from the same server.

Read routes:

| Route | Purpose |
| --- | --- |
| `GET /` | Main dashboard. Query params include `filter`, `sort`, `level`, `q`, `minScore`, and `page`. |
| `GET /help` | In-dashboard system guide and route/feature documentation. |
| `GET /resume` | Streams the active profile resume PDF. `variant=ai` or `variant=devops` streams configured variants. |
| `GET /company-notes?company=<name>` | Reads normalized company tags and notes. |
| `GET /job-description?id=<job-id>` | Returns title, company, URL, and saved full JD text. |
| `GET /job-apply-images?id=<job-id>` | Reports whether pre-apply and post-apply screenshots exist. |
| `GET /job-apply-image?id=<job-id>&phase=pre\|post` | Streams one apply screenshot. |
| `GET /job-application-prep?id=<job-id>` | Renders generated manual application prep. |
| `GET /job-application-data?id=<job-id>` | Returns the application prep JSON payload used by copy actions and bookmarklets. |
| `GET /job-bookmarklet.js?id=<job-id>` | Returns a job-specific browser autofill script. |
| `GET /tailored-resume?id=<job-id>&type=pdf\|html\|md` | Streams generated tailored resume artifacts. |
| `GET /auto-apply-attempt?id=<attempt-id>` | Returns one apply receipt. |
| `GET /auto-apply-artifact?attemptId=<attempt-id>&type=resume\|pre\|post` | Streams a receipt artifact. |
| `GET /api/tracker?period=7d\|30d\|90d\|all` | Returns tracker rows for market and activity charts. |
| `GET /api/insights` | Returns daily digest, activity counts, scraper health, and daily applied chart rows. |
| `GET /healthz` | SQLite-backed health probe. |
| `GET /metrics` | Prometheus text metrics. |
| `GET /public/*` | Static dashboard CSS, JS, and bookmarklet assets. |

Write routes:

| Route | Purpose |
| --- | --- |
| `POST /pipeline` | Changes job stage/status and writes an event row. |
| `POST /mark-outreach` | Toggles `reached_out_at` for a job. |
| `POST /archive` | Archives a job without deleting it. |
| `POST /company-notes` | Saves company tags and notes. |
| `POST /job-application-prep` | Generates or refreshes application prep for a job. |
| `POST /tailored-resume` | Generates a tailored resume for a job. |
| `POST /market-research` | Regenerates market research cache and redirects back to the dashboard view. |
| `POST /dismiss-slug-banner` | Dismisses the current broken-slug warning banner. |

## Application workflow in the dashboard

The active workflow keeps final submission under human control:

1. Open a high-score job from **Not Applied** or **All**.
2. Use **Manual Apply Prep** to generate questions, answers, voice checks, and a job-specific JSON payload.
3. Use **Tailor Resume** when the application should get a job-specific resume; generated artifacts are stored under the active profile.
4. Open the job posting and use the bookmarklet or copy modal to fill supported application fields.
5. Review in the browser, submit manually, then move the dashboard stage to **Applied**.

Apply receipts and screenshots are kept for diagnostics and auditability. They are especially useful for supported ATS flows such as Greenhouse, Lever, and Ashby.

## Operations and diagnostics

- `GET /healthz` returns a simple JSON health check backed by SQLite.
- `GET /metrics` exposes Prometheus-format counters, durations, and gauges for HTTP traffic and job state.
- The dashboard starts an in-process rejection email poller when Gmail credentials are configured.
- Slug health warnings come from `slug-health.json`; dismissing a banner records the current slug-health timestamp.
- JD quality context comes from `jd-health.json`.
- The Help page at `/help` is the most complete local operator guide and includes runtime paths for the active profile.

## Scheduling

### Refresh pipeline (recommended)

`scripts/refresh-if-dashboard.sh` runs the full active-profile pipeline — discover companies → scrape → score → retry unscored → check descriptions → auto-ghost stale applications → check closed jobs → market research → rejection email sync → slug validation → context update — but only when the dashboard is already running on its port. Safe to fire frequently; it skips silently when you're not using the dashboard.

Add to crontab (`crontab -e`):

```
*/30 * * * * /path/to/job-search/scripts/refresh-if-dashboard.sh
```

Output is appended to `logs/refresh/YYYYMMDD.log` (created automatically).

### Daily refresh (optional, runs regardless of dashboard)

If you want a guaranteed morning refresh even when the dashboard is closed:

```
7 8 * * *   cd /path/to/job-search && npm run refresh >> /tmp/job-search.log 2>&1
```

### macOS: keep the dashboard alive across reboots

Create a launchd LaunchAgent pointing at `scripts/start-dashboard.sh` with `KeepAlive` enabled. The dashboard will start on login and restart if it crashes, making the cron guard above useful 24/7.

## Extending

**New ATS platform:** add a `scrapers/<name>.js` module that exports `scrape<Name>()` and returns an array of job objects matching the schema in existing scrapers. Wire it into `scraper.js`.

**New filter tab:** add to `FILTER_DEFS` in `lib/html/helpers.js`, add a corresponding query in `filterQueries` in `lib/dashboard-routes.js`.

**Assisted apply internals:** `lib/ats-appliers/*` and `lib/auto-applier.js` are preserved as dormant infrastructure for future reviewed or semi-automatic workflows. They are not part of the active daily pipeline or dashboard actions.

**Scoring calibration:** edit the prompt in `scorer.js`. Deterministic caps live in `scoreJob()`; use those for "never over-score this pattern" rules the LLM keeps rationalizing past.

## Disclaimer

This is a personal project. Scrapers hit public job-board endpoints and respect typical rate-limit and User-Agent conventions. Before running at scale, review each site's Terms of Service. The active workflow keeps final application submission under human control.

Use responsibly. Not a guarantee of interviews, offers, or anything else.
