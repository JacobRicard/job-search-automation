# Job Search Automation

A private, local, AI-powered job search engine that runs entirely on your machine. No SaaS, no account, no telemetry.

It scrapes 11+ job boards (Greenhouse, Lever, Ashby, Workable, Workday, Wellfound, Built In, and more), scores every listing against your resume with Google's free Gemini API, and serves a dashboard at `http://localhost:3131` for review and pipeline tracking.

![Dashboard](docs/screenshots/dashboard.png)

## Features

- **Scraping.** Pulls fresh listings from 11+ ATS platforms on a schedule.
- **LLM scoring.** Gemini scores each job 1 to 10 across five dimensions (stack match, seniority, comp, company stage, desirability) grounded in your resume. Deterministic post-processing caps mis-rated roles.
- **Pipeline tracking.** Manual stage transitions from Pending through Applied, Phone Screen, Interview, Onsite, Offer, Rejected, Closed, and Ghosted.
- **Market research.** Aggregate JD analysis against your profile: top skills, seniority signals, comp ranges, and emerging high-score patterns.
- **Gmail rejection sync.** Optional. Watches your inbox and auto-flips matching jobs to `rejected` with the parsed reason.

Final "applied" status is always set by you. The scraper never marks anything as applied.

## Quickstart

The only requirement is **Docker Desktop** (Compose v2).

```bash
git clone https://github.com/jakemercure28/job-search-automation.git
cd job-search-automation
cp .env.example .env
docker compose up -d
```

Open **http://localhost:3131**. A setup wizard walks you through adding your Gemini API key, resume, and job targets in the browser.

> **Free Gemini key:** https://aistudio.google.com/apikey. No credit card required. The defaults keep you inside the free tier (500 requests/day).

## Configuration

Everything is in `.env`. Common settings:

| Variable | Default | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | | **Required.** Free key from Google AI Studio. |
| `GEMINI_RATE_DELAY_MS` | `5000` | Throttle between Gemini calls. Lower on a paid key. |
| `LOCATION_FILTER` | | Comma-separated cities to allow. Empty = allow all. |
| `LOCATION_BLOCKLIST` | | Comma-separated cities to drop. |
| `BUILTIN_SUBDOMAIN` | `www` | Built In region (`seattle`, `nyc`, `austin`, etc.). |
| `REFRESH_INTERVAL_MINUTES` | `30` | How often the worker reruns the full pipeline. |
| `GMAIL_EMAIL` / `GMAIL_APP_PASSWORD` | | Optional. Enables rejection email sync. |
| `DASHBOARD_PORT` | `3131` | |

## Updating

```bash
docker compose down
git pull
docker compose up -d --build
```

Your editable profile files live in `./data` and survive restarts and rebuilds.
The SQLite database lives in the Docker named volume `job-search-automation_job_search_db` so it stays on Docker's Linux filesystem instead of a macOS bind mount.
