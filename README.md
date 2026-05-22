# Job Search Pipeline

An end-to-end automation pipeline for a technical job search. Scrapes 11 ATS platforms, scores each listing with an LLM against your resume and context files, and serves a local dashboard for manual review and pipeline tracking. IMAP integration syncs rejection emails back into the DB automatically.

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
                                  +----------------------+
                                  |   rejection email    |
                                  |   sync via IMAP      |
                                  +----------------------+
```

## Tech stack

- **Node.js 18+** (CommonJS), zero build step
- **Python 3.10+ / Pydantic 2** for the strict scraper `JobLead` contract
- **better-sqlite3** for per-profile job storage
- **puppeteer-core** for resume PDF rendering
- **Google Gemini Flash** for scoring and complexity classification
- **imapflow** for inbox rejection sync
- **Server-rendered HTML** dashboard with vanilla client-side JS

## Features

### Multi-source scraping

Pulls from Greenhouse, Lever, Ashby, Workable, Workday, Wellfound, Built In, Rippling, RemoteOK, Jobicy, Arbeitnow, and WeWorkRemotely. Company slugs configured per profile, global boards filtered by search terms. Respectful rate limits and User-Agent.

### LLM scoring with post-processing

Gemini scores each job 1-10 along five dimensions (stack match, seniority, comp, company stage, desirability). Scores are post-processed deterministically to cap mis-rated roles (for example, roles requiring 8+ YOE cap at 3 regardless of prompt output).

### Application complexity classifier

Each scored job is tagged `simple` or `complex` so you can estimate manual apply effort. No application is submitted or marked applied by automation.

### Dashboard

Server-rendered HTML (no framework, no build step) on `localhost:3131`. Filter tabs, pipeline tracking (Applied → Phone Screen → Interview → Onsite → Offer / Rejected), market research analytics, company notes, and interview prep notes attached to each job.

Dashboard views:

- **All** — active jobs that are not archived, rejected, closed, or ghosted.
- **Not Applied** — the main triage queue for jobs that still need a decision.
- **Applied** — submitted applications that are still active.
- **Interviewing** — phone screen, interview, onsite, and offer stages.
- **Rejected / Closed / Ghosted / Archived** — terminal or hidden-state queues.
- **Stats** — funnel, score calibration, recent events, and rejection timing.
- **Event Log** — audit trail from stage, outreach, and archive changes.
- **Market Research** — aggregate JD analysis against the active profile, including seniority, location, top skills, strategy score, and emerging high-score signals.

Job card actions:

- Change pipeline stage: pending, applied, phone screen, interview, onsite, offer, closed, rejected, or ghosted.
- Inspect LLM reasoning, saved job description, salary/ATS/company badges, and company-level tags.
- Open the source posting, inspect saved job descriptions, and manually move submitted applications to Applied.
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
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt

# 2. Config
cp .env.example .env
# then fill in:
#   - GEMINI_API_KEY (https://aistudio.google.com/apikey)
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
npm run help -- --json     # machine-readable command reference
npm run test:contracts     # Pydantic JobLead contract tests
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
| `GET /api/tracker?period=7d\|30d\|90d\|all` | Returns tracker rows for market and activity charts. |
| `GET /api/insights` | Returns daily digest, activity counts, scraper health, and daily applied chart rows. |
| `GET /healthz` | SQLite-backed health probe. |
| `GET /metrics` | Prometheus text metrics. |
| `GET /public/*` | Static dashboard CSS and JS assets. |

Write routes:

| Route | Purpose |
| --- | --- |
| `POST /pipeline` | Changes job stage/status and writes an event row. |
| `POST /mark-outreach` | Toggles `reached_out_at` for a job. |
| `POST /archive` | Archives a job without deleting it. |
| `POST /company-notes` | Saves company tags and notes. |
| `POST /market-research` | Regenerates market research cache and redirects back to the dashboard view. |
| `POST /dismiss-slug-banner` | Dismisses the current broken-slug warning banner. |

## Application workflow in the dashboard

The dashboard does not submit applications and does not auto-mark jobs applied:

1. Open a high-score job from **Not Applied** or **All**.
2. Open the job posting from the title link and apply manually outside the app.
3. After you submit, move the dashboard stage to **Applied**.

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

**New ATS platform:** add a `scrapers/<name>.js` module that exports `scrape<Name>()` and returns strict `JobLead` objects with exactly `title`, `company`, `description`, `direct_apply_url`, `ats_platform_name`, and `scraped_timestamp`. Wire it into `scraper.js`; the Pydantic contract rejects extra or malformed fields.

**New filter tab:** add to `FILTER_DEFS` in `lib/html/helpers.js`, add a corresponding query in `filterQueries` in `lib/dashboard-routes.js`.

**Scoring calibration:** edit the prompt in `scorer.js`. Deterministic caps live in `scoreJob()`; use those for "never over-score this pattern" rules the LLM keeps rationalizing past.

## Disclaimer

This is a personal project. Scrapers hit public job-board endpoints and respect typical rate-limit and User-Agent conventions. Before running at scale, review each site's Terms of Service. The active workflow keeps final application submission under human control.

Use responsibly. Not a guarantee of interviews, offers, or anything else.
