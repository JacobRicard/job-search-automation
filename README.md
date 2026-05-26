# Job Search Automation

**A private, local, AI-powered job search engine and dashboard.**

Runs 100% on your machine. Your resume, your applications, your notes, your data — never leave your laptop. No SaaS, no account, no telemetry. Just a Docker container talking to Google's free Gemini API on your behalf.

It scrapes 11+ ATS platforms (Greenhouse, Lever, Ashby, Workable, Workday, Wellfound, Built In, Rippling, RemoteOK, Jobicy, Arbeitnow, WeWorkRemotely), scores every listing with Gemini against your resume, and serves a local dashboard at `http://localhost:3131` for review and pipeline tracking.

## Screenshots

### Dashboard, scored, ranked, filterable job listings
![Dashboard](docs/screenshots/dashboard.png)

### Applied pipeline, track stage progression
![Applied pipeline](docs/screenshots/applied.png)

### Analytics, pipeline funnel and score calibration
![Analytics](docs/screenshots/analytics.png)

### Market Research, LLM gap analysis against your resume
![Market Research](docs/screenshots/market-research.png)

<p float="left">
  <img src="docs/screenshots/interviewing.png" width="32%" alt="Interviewing" />
  <img src="docs/screenshots/rejected.png" width="32%" alt="Rejected" />
  <img src="docs/screenshots/activity-log.png" width="32%" alt="Activity log" />
</p>

## Quickstart (3 minutes)

You need Docker Desktop (or any modern Docker + Compose v2). Nothing else. No Node, no Python, no compilers.

```bash
# 1. Clone
git clone https://github.com/jakemercure28/job-search-automation.git
cd job-search-automation

# 2. Copy the env template
cp .env.example .env

# 3. Get a FREE Gemini API key at https://aistudio.google.com/apikey
#    Paste it into .env as GEMINI_API_KEY=...

# 4. Set up your data directory
./scripts/setup.sh

# 5. Bring it up
docker compose up -d
```

Open **http://localhost:3131**. A setup wizard will guide you through filling in your resume and job targets. The worker container will then scrape, score, and populate the dashboard automatically.

### Tuned for the Gemini Free Tier

Out of the box, this app is paced to stay within Google AI Studio's free tier (500 requests/day, 15 RPM). The default `GEMINI_RATE_DELAY_MS=5000` throttles outbound calls to roughly 12 RPM, leaving headroom under the free quota. **You do not need a paid plan.** If you ever upgrade to a paid key, lower the delay in `.env`.

## What it does

- **Multi-source scraping.** Pulls fresh listings from 11+ ATS platforms on a schedule.
- **LLM scoring.** Gemini scores each job 1-10 along five dimensions (stack match, seniority, comp, company stage, desirability), grounded in your resume and context files. Deterministic post-processing caps mis-rated roles (e.g., roles requiring 8+ YOE cap at 3 regardless of prompt output).
- **Complexity tagging.** Each job is tagged `simple` or `complex` so you can plan your day's manual applies.
- **Pipeline tracking.** Manual stage transitions: Pending → Applied → Phone Screen → Interview → Onsite → Offer / Rejected / Closed / Ghosted.
- **Market research.** Aggregate JD analysis against your profile: top skills, seniority, comp signals, and emerging high-score patterns.
- **Optional Gmail rejection sync.** If you give it Gmail IMAP credentials, it watches your inbox every 5 minutes and auto-flips matching jobs to `rejected` with the parsed reason.

Final application submission is always manual. The pipeline dropdown is the only thing that writes "applied" — scraping and scoring never do.

## Dashboard tour

| View | What's there |
| --- | --- |
| **All** | Active jobs that aren't archived/closed/rejected/ghosted |
| **Not Applied** | The main triage queue |
| **Applied** | Submitted apps still in play |
| **Interviewing** | Phone screen, interview, onsite, offer |
| **Rejected / Closed / Ghosted / Archived** | Terminal or hidden queues |
| **Stats** | Funnel, score calibration, recent events, rejection timing |
| **Event Log** | Audit trail of every stage/outreach/archive change |
| **Market Research** | LLM gap analysis vs your resume |
| **Help** (`/help`) | In-app reference with live runtime paths |

## Configuration

Everything is in `.env`. The defaults work for most people; the file is heavily commented. A few common knobs:

| Variable | Purpose |
| --- | --- |
| `GEMINI_API_KEY` | **Required.** Free key from https://aistudio.google.com/apikey |
| `GEMINI_RATE_DELAY_MS` | Throttle between Gemini calls. Default `5000` (free-tier safe). |
| `LOCATION_FILTER` / `LOCATION_BLOCKLIST` | Comma-separated allow/deny lists for job locations |
| `BUILTIN_SUBDOMAIN` | Region for the Built In scraper (e.g. `seattle`, `nyc`, `austin`, or `www`) |
| `REFRESH_INTERVAL_MINUTES` | How often the worker container runs the full refresh. Default `30`. |
| `GMAIL_EMAIL` / `GMAIL_APP_PASSWORD` | Optional. Enables rejection email sync. Use a Google [app password](https://myaccount.google.com/apppasswords). |
| `DASHBOARD_PORT` | Default `3131` |

## Personalizing your setup

Your personal data lives in `data/`. The repo ships an example at `data.example/` so the app has something to score against, but you need to replace it with your own before the scoring means anything.

Run `./scripts/setup.sh` to copy the example to `data/`, then edit three files:

| File | What to put there |
| --- | --- |
| `data/resume.md` | Your resume in plain text or markdown. Gemini reads this to score job fit. Prose, bullets, tables — any format works. |
| `data/context.md` | Target titles, preferred tech stack, comp range, location preferences, deal breakers. This narrows scoring beyond what the resume alone captures. |
| `data/companies.js` | The companies you want to scrape, grouped by ATS platform. Update `SEARCH_TERMS` at the top to match your target role (e.g. `'product manager'`, `'data engineer'`). For each company, use the slug from its public job-board URL: `boards.greenhouse.io/stripe` → slug `stripe`. |

**Or:** skip the manual editing and use the setup wizard at `localhost:3131` after `docker compose up -d`. It walks you through filling in the same files via the browser.

## Claude Code users

The `.context/` directory and `.claude/` folder contain AI-assistant instructions for slash commands like `/load-context`, `/job-search`, and `/interview-prep`. They are not required to run the app.

If you use Claude Code: copy `.context.example` to `.context`, run `./scripts/setup.sh`, and edit both to match you.

If you don't: ignore `.context/`, `.claude/`, and `CLAUDE.md` entirely. The scraper, scorer, and dashboard run fine without them.

## Stopping and updating

```bash
# Stop everything
docker compose down

# Pull the latest version and restart
git pull
docker compose up -d --build
```

Your data lives in `./data/` (a local SQLite file plus your resume and context). It survives container restarts and rebuilds.

## Backups

All of your data is one folder: `./data/`. Back that folder up however you already back up the rest of your machine.

**Recommended: let your OS do it.** Time Machine (macOS), iCloud Drive, OneDrive, or File History (Windows) will sync `./data/` continuously with zero config.

**Local snapshots.** For timestamped archives on the same machine:

```bash
./scripts/backup.sh                  # writes to ./backups/
./scripts/backup.sh /path/to/dir     # or any directory you choose
```

The script uses SQLite's native `.backup` command, so it's safe to run while the worker container is up. To restore, copy the snapshot DB back to `data/jobs.db` (with the container stopped) or untar the archive.

Daily cron example:

```cron
0 3 * * * cd /path/to/job-search-automation && ./scripts/backup.sh
```

No cloud sync is built into this project by design. Your data, your destination.

## Privacy

All data is local. The only outbound traffic is:
1. Scrapers fetching public ATS endpoints.
2. Gemini API calls to score jobs (just the JD text and your resume context, sent to Google).
3. Optional Gmail IMAP, if you configure it.

Nothing is sent to any third party operated by this project. There is no third party operated by this project.

## Disclaimer

Scrapers hit public job-board endpoints and respect typical rate-limit and User-Agent conventions. Before running at scale, review each site's Terms of Service.

Use responsibly. Not a guarantee of interviews, offers, or anything else.
