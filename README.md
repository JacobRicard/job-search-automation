# Job Search Automation

**A private, local, AI-powered job search engine that runs entirely on your machine.**

It scrapes 11+ ATS platforms, scores every listing against your resume with Google's free Gemini API, and serves a dashboard at `http://localhost:3131` for review and pipeline tracking. No SaaS, no account, no telemetry. Your resume, applications, and notes never leave your laptop.

Platforms covered: Greenhouse, Lever, Ashby, Workable, Workday, Wellfound, Built In, Rippling, RemoteOK, Jobicy, Arbeitnow, and WeWorkRemotely.

## Screenshots

**Dashboard.** Scored, ranked, filterable listings.
![Dashboard](docs/screenshots/dashboard.png)

**Applied pipeline.** Track stage progression.
![Applied pipeline](docs/screenshots/applied.png)

**Analytics.** Pipeline funnel and score calibration.
![Analytics](docs/screenshots/analytics.png)

**Market research.** LLM gap analysis against your resume.
![Market Research](docs/screenshots/market-research.png)

<p float="left">
  <img src="docs/screenshots/interviewing.png" width="32%" alt="Interviewing" />
  <img src="docs/screenshots/rejected.png" width="32%" alt="Rejected" />
  <img src="docs/screenshots/activity-log.png" width="32%" alt="Activity log" />
</p>

## Quickstart

The only thing you need is **Docker Desktop** (or any modern Docker with Compose v2). No Node, no Python, no compilers.

```bash
# 1. Clone
git clone https://github.com/jakemercure28/job-search-automation.git
cd job-search-automation

# 2. Create your env file
cp .env.example .env

# 3. Bring it up
docker compose up -d
```

Now open **http://localhost:3131**. A setup wizard walks you through everything in the browser: paste in your Gemini API key, drop in your resume, set your target titles, and pick the companies to scrape. The worker then scrapes, scores, and fills the dashboard automatically.

> **Get a free Gemini API key** at https://aistudio.google.com/apikey. No credit card required. The defaults keep you safely inside the free tier (500 requests/day, 15 RPM), so a paid plan is never needed.

That's the whole setup. Everything below is reference.

## What it does

- **Multi-source scraping.** Pulls fresh listings from 11+ ATS platforms on a schedule.
- **LLM scoring.** Gemini scores each job 1 to 10 across five dimensions (stack match, seniority, comp, company stage, desirability), grounded in your resume. Deterministic post-processing caps mis-rated roles, so a job requiring 8+ years of experience caps at 3 regardless of the model's output.
- **Complexity tagging.** Each job is tagged `simple` or `complex` so you can plan your day's manual applies.
- **Pipeline tracking.** Manual stage transitions: Pending, Applied, Phone Screen, Interview, Onsite, Offer, Rejected, Closed, Ghosted.
- **Market research.** Aggregate JD analysis against your profile: top skills, seniority, comp signals, and emerging high-score patterns.
- **Optional Gmail rejection sync.** Give it Gmail IMAP credentials and it watches your inbox every 5 minutes, auto-flipping matching jobs to `rejected` with the parsed reason.

Final application submission is always manual. The pipeline dropdown is the only thing that writes "applied". Scraping and scoring never do.

## Dashboard at a glance

| View | What's there |
| --- | --- |
| **All** | Active jobs that aren't archived, closed, rejected, or ghosted |
| **Not Applied** | The main triage queue |
| **Applied** | Submitted apps still in play |
| **Interviewing** | Phone screen, interview, onsite, offer |
| **Rejected / Closed / Ghosted / Archived** | Terminal or hidden queues |
| **Stats** | Funnel, score calibration, recent events, rejection timing |
| **Event Log** | Audit trail of every stage, outreach, and archive change |
| **Market Research** | LLM gap analysis vs your resume |

## Configuration

Everything lives in `.env`, which is heavily commented. The defaults work for most people. The knobs you're most likely to touch:

| Variable | Purpose |
| --- | --- |
| `GEMINI_API_KEY` | **Required.** Free key from https://aistudio.google.com/apikey |
| `GEMINI_RATE_DELAY_MS` | Throttle between Gemini calls. Default `5000` (free-tier safe). Lower it on a paid key. |
| `LOCATION_FILTER` / `LOCATION_BLOCKLIST` | Comma-separated allow and deny lists for job locations |
| `BUILTIN_SUBDOMAIN` | Region for the Built In scraper (`seattle`, `nyc`, `austin`, or `www`) |
| `REFRESH_INTERVAL_MINUTES` | How often the worker runs the full refresh. Default `30`. |
| `GMAIL_EMAIL` / `GMAIL_APP_PASSWORD` | Optional. Enables rejection email sync. Use a Google [app password](https://myaccount.google.com/apppasswords). |
| `DASHBOARD_PORT` | Default `3131` |

## Manual setup (optional)

Prefer editing files over the browser wizard? Run the setup script to scaffold your data directory, then edit three files:

```bash
./scripts/setup.sh
```

| File | What to put there |
| --- | --- |
| `data/resume.md` | Your resume in plain text or markdown. Gemini reads this to score fit. |
| `data/context.md` | Target titles, preferred stack, comp range, location preferences, deal breakers. |
| `data/companies.js` | Companies to scrape, grouped by ATS platform. Use the slug from each public job-board URL (`boards.greenhouse.io/stripe` becomes `stripe`), and set `SEARCH_TERMS` at the top to your target role. |

Add your `GEMINI_API_KEY` to `.env`, then `docker compose up -d`.

## Updating and stopping

```bash
# Stop everything
docker compose down

# Pull the latest version and restart
git pull
docker compose up -d --build
```

Your data lives in `./data` (a local SQLite file plus your resume and context). It survives restarts and rebuilds.

## Backups

All your data is one folder: `./data`. Back it up however you back up the rest of your machine.

The simplest option is to let your OS do it. Time Machine, iCloud Drive, OneDrive, or File History will sync `./data` continuously with zero config.

For timestamped local snapshots:

```bash
./scripts/backup.sh                  # writes to ./backups/
./scripts/backup.sh /path/to/dir     # or any directory you choose
```

The script uses SQLite's native `.backup`, so it's safe to run while the worker is up. No cloud sync is built in by design. Your data, your destination.

## Claude Code users

This repo ships AI-assistant instructions in `.context/` and `.claude/` for slash commands like `/load-context`, `/job-search`, and `/interview-prep`. They are entirely optional. To use them, copy `.context.example` to `.context` and edit it to match you. The scraper, scorer, and dashboard run fine without any of it.

## Privacy

All data is local. The only outbound traffic is:

1. Scrapers fetching public ATS endpoints.
2. Gemini API calls to score jobs (the JD text and your resume context, sent to Google).
3. Optional Gmail IMAP, if you configure it.

There is no third party operated by this project, so nothing is ever sent to one.

## Disclaimer

Scrapers hit public job-board endpoints and respect typical rate-limit and User-Agent conventions. Before running at scale, review each site's Terms of Service. Use responsibly. This is not a guarantee of interviews, offers, or anything else.
