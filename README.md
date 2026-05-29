# Job Search Automation

A private, local, AI-powered job search engine that runs entirely on your machine. No SaaS, no account, no telemetry.

It scrapes 12+ job boards (Greenhouse, Lever, Ashby, Workable, Workday, Wellfound, Built In, and more, plus optional JobSpy integration for Indeed/LinkedIn/Glassdoor/ZipRecruiter), scores every listing against your resume with Groq's free API, and serves a dashboard at `http://localhost:3131` for review and pipeline tracking.

![Dashboard](docs/screenshots/dashboard.png)

---

## Features

- **Scraping.** Pulls fresh listings from 12+ ATS platforms on a schedule. Optional JobSpy integration adds Indeed, LinkedIn, Glassdoor, and ZipRecruiter.
- **Two-step LLM scoring.** A fast coarse filter (llama-3.1-8b-instant) eliminates clearly irrelevant roles first. Qualifying jobs are then scored 1-10 by llama-3.3-70b-versatile using Groq's JSON mode. Both steps run against your resume and context.
- **Deduplication.** Cross-source dedup at both the scraper level (title+company, preferring primary ATS) and the database level — the same job is never scored or emailed twice.
- **Pipeline tracking.** Manual stage transitions from Pending through Applied, Phone Screen, Interview, Onsite, Offer, Rejected, Closed, and Ghosted.
- **Daily email digest.** Sends a ranked HTML email of new high-scoring jobs via any SMTP provider (Gmail, Outlook, SendGrid, etc.).
- **Rejection email sync.** Watches Gmail or Outlook inbox and auto-flips matching jobs to `rejected`.
- **Market research.** Aggregate JD analysis against your profile: top skills, seniority signals, comp ranges, and emerging high-score patterns.
- **GitHub Actions.** Daily scheduled pipeline run with all credentials as Actions secrets.

Final "applied" status is always set by you. The scraper never marks anything as applied.

---

## Quickstart

The only requirement is **Docker Desktop** (Compose v2).

```bash
git clone https://github.com/YOUR_USERNAME/job-search-automation.git
cd job-search-automation
cp .env.example .env
# Edit .env — at minimum set GROQ_API_KEY
docker compose up -d
```

Open **http://localhost:3131**. A setup wizard walks you through adding your resume, context, and job targets in the browser.

> **Free Groq key:** https://console.groq.com — No credit card required. The free tier supports ~14,400 requests/day at high throughput.

---

## Screenshots

> Add your own screenshots here after deployment. Place images in `docs/screenshots/` and reference them below.

| Dashboard | Applied | Analytics |
|-----------|---------|-----------|
| *(your screenshot)* | *(your screenshot)* | *(your screenshot)* |

---

## Environment Variables

Copy `.env.example` to `.env` and fill in the values you need. Every credential and configurable value is documented here — nothing is hardcoded in the source.

### LLM — Groq (required)

| Variable | Default | Purpose |
|----------|---------|---------|
| `GROQ_API_KEY` | | **Required.** Free key from https://console.groq.com |
| `GROQ_RATE_DELAY_MS` | `500` | Delay between Groq requests (ms). Raise if you see 429s. |

### LLM — Gemini (optional)

Only needed for company discovery (`npm run discover`) and market research. Not required for scoring.

| Variable | Default | Purpose |
|----------|---------|---------|
| `GEMINI_API_KEY` | | Free key from https://aistudio.google.com/apikey |
| `GEMINI_RATE_DELAY_MS` | `4000` | Delay between Gemini requests (ms). |

### Email digest

| Variable | Default | Purpose |
|----------|---------|---------|
| `SMTP_HOST` | | SMTP server hostname (e.g. `smtp.gmail.com`) |
| `SMTP_PORT` | `587` | SMTP port |
| `SMTP_SECURE` | `false` | `true` for SSL/port 465; `false` for STARTTLS |
| `SMTP_USER` | | SMTP auth username |
| `SMTP_PASS` | | SMTP auth password or app password |
| `SMTP_FROM` | `SMTP_USER` | Sender address |
| `DIGEST_TO` | | Recipient address |
| `DIGEST_MIN_SCORE` | `6` | Minimum score to include (1-10) |
| `DIGEST_MAX_JOBS` | `25` | Max jobs per digest |
| `DIGEST_LOOKBACK_HOURS` | `26` | How many hours back to look for new jobs |

### Rejection email sync

| Variable | Default | Purpose |
|----------|---------|---------|
| `GMAIL_EMAIL` | | Gmail address for rejection sync |
| `GMAIL_APP_PASSWORD` | | Gmail app-specific password |
| `IMAP_PROVIDER` | `gmail` | `gmail` or `outlook` |
| `IMAP_EMAIL` | | Email address (overrides `GMAIL_EMAIL`) |
| `IMAP_APP_PASSWORD` | | Password (overrides `GMAIL_APP_PASSWORD`) |
| `IMAP_HOST` | *(from provider)* | Override IMAP hostname |
| `IMAP_PORT` | `993` | IMAP port |
| `IMAP_MAILBOX` | *(from provider)* | Override main mailbox name |
| `IMAP_TRASH_MAILBOX` | *(from provider)* | Override trash mailbox name |
| `REJECTION_EMAIL_SYNC_DISABLED` | | Set `true` to disable the poller |
| `REJECTION_EMAIL_POLL_INTERVAL_MS` | `300000` | Poll interval (ms) |
| `REJECTION_EMAIL_INITIAL_DELAY_MS` | `10000` | Startup delay (ms) |

### JobSpy

| Variable | Default | Purpose |
|----------|---------|---------|
| `JOBSPY_ENABLED` | `false` | Set `true` to enable JobSpy scraping |
| `JOBSPY_CONFIG_PATH` | `DATA_DIR/jobspy-config.json` | Path to config file |
| `JOBSPY_LOCATIONS` | | Comma-separated locations; overrides config `location`, runs one call per term×location |

### Pipeline

| Variable | Default | Purpose |
|----------|---------|---------|
| `DATA_DIR` | `./data` | Profile data directory |
| `DB_DIR` | `DATA_DIR` | SQLite directory (Docker uses `/app/db`) |
| `DASHBOARD_PORT` | `3131` | Dashboard HTTP port |
| `DASHBOARD_HOST` | `localhost` | Dashboard bind host |
| `TZ` | `UTC` | Timezone for logs and dates |
| `AUTO_ARCHIVE_THRESHOLD` | `4` | Auto-archive jobs scoring at or below this |
| `LOCATION_FILTER` | | Comma-separated cities to allow (empty = all) |
| `LOCATION_BLOCKLIST` | | Comma-separated cities to block |
| `BUILTIN_SUBDOMAIN` | `www` | Built In region (`seattle`, `nyc`, etc.) |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |
| `LOG_RETENTION_DAYS` | `30` | Days to keep log files |
| `REFRESH_INTERVAL_MINUTES` | `30` | Docker worker refresh cadence |

---

## Profile Configuration

Your personal data lives in `data/` (gitignored). Copy the examples to get started:

```bash
cp -r data.example/. data/
./scripts/setup.sh
```

Edit these files to match you:

| File | Purpose |
|------|---------|
| `data/companies.js` | Companies to scrape per ATS platform |
| `data/context.md` | Your career goals, preferences, and dealbreakers. Also used by the coarse filter to eliminate irrelevant roles. |
| `data/resume.md` | Your resume in Markdown |
| `data/jobspy-config.json` | JobSpy search parameters (optional) |

---

## Groq Setup

1. Go to https://console.groq.com and sign in (no credit card required).
2. Create an API key under **API Keys**.
3. Add it to your `.env`: `GROQ_API_KEY=gsk_...`

The pipeline uses two models:
- **llama-3.1-8b-instant** — fast coarse filter (eliminates irrelevant roles)
- **llama-3.3-70b-versatile** — full scoring with JSON-structured output

Both are free on Groq's free tier.

---

## JobSpy Setup

JobSpy scrapes Indeed, LinkedIn, Glassdoor, and ZipRecruiter directly.

1. Install the Python package:
   ```bash
   pip install python-jobspy
   ```
   Or it will be installed automatically with `pip install -r requirements.txt`.

2. Copy the example config:
   ```bash
   cp data.example/jobspy-config.json data/jobspy-config.json
   ```

3. Edit `data/jobspy-config.json`:
   ```json
   {
     "search_term": ["software engineer", "site reliability engineer"],
     "location": "San Francisco, CA",
     "site_name": ["indeed", "linkedin", "glassdoor", "zip_recruiter"],
     "results_wanted": 20,
     "hours_old": 72,
     "country_indeed": "USA",
     "is_remote": false,
     "job_type": "fulltime",
     "linkedin_fetch_description": false,
     "request_delay_ms": 3000
   }
   ```

   | Field | Options | Notes |
   |-------|---------|-------|
   | `search_term` | string or array of strings | Each term gets its own scrape pass |
   | `site_name` | `indeed`, `linkedin`, `glassdoor`, `zip_recruiter` | Include any subset |
   | `job_type` | `fulltime`, `parttime`, `internship`, `contract` | Optional |
   | `is_remote` | `true` / `false` | Optional |
   | `request_delay_ms` | integer | Sleep between scrape calls (rate-limit courtesy pause) |
   | `linkedin_fetch_description` | `true` / `false` | Fetches full descriptions; slower, may hit LinkedIn limits |

4. Enable in `.env`:
   ```
   JOBSPY_ENABLED=true
   ```

### Multiple locations via env var

To scrape the same search terms across multiple cities, set `JOBSPY_LOCATIONS` in `.env` as a comma-separated list. This overrides the `"location"` field in the config and runs one `scrape_jobs()` call per `search_term` × `location` combination:

```
JOBSPY_LOCATIONS=San Francisco CA,Seattle WA,Austin TX
```

Results from all combinations are merged and deduplicated by URL before output. If `JOBSPY_LOCATIONS` is not set, the `"location"` field in the config file is used.

> **LinkedIn rate limiting.** LinkedIn aggressively rate-limits scrapers. If you see empty results or errors, increase `request_delay_ms` to `5000`+, set `linkedin_fetch_description` to `false`, and reduce `results_wanted`. If problems persist, remove `linkedin` from `site_name`. With multiple search terms and locations, each combination adds an extra scrape call — keep the total combination count low for LinkedIn.

---

## Email Digest Setup

The daily digest sends a ranked HTML email of new high-scoring jobs.

### Gmail

1. Enable 2-Step Verification on your Google account.
2. Generate an app password at https://myaccount.google.com/apppasswords.
3. Set in `.env`:
   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=you@gmail.com
   SMTP_PASS=xxxx xxxx xxxx xxxx
   SMTP_FROM=you@gmail.com
   DIGEST_TO=you@gmail.com
   ```

### Outlook / Microsoft 365

1. Enable 2-Step Verification on your Microsoft account.
2. Generate an app password at https://account.microsoft.com/security.
3. Set in `.env`:
   ```
   SMTP_HOST=smtp-mail.outlook.com
   SMTP_PORT=587
   SMTP_USER=you@outlook.com
   SMTP_PASS=your-app-password
   SMTP_FROM=you@outlook.com
   DIGEST_TO=you@outlook.com
   ```

Test the digest manually at any time:
```bash
npm run digest
```

---

## GitHub Actions Setup

Run the full pipeline daily in the cloud with GitHub Actions.

### Step 1 — Fork the repository

Fork `jakemercure28/job-search-automation` to your GitHub account and clone your fork locally.

### Step 2 — Encode your profile files as secrets

Each profile file is base64-encoded and stored as a GitHub secret.

```bash
# macOS
base64 -i data/companies.js | tr -d '\n' | pbcopy   # paste as DATA_COMPANIES_JS
base64 -i data/context.md   | tr -d '\n' | pbcopy   # paste as DATA_CONTEXT_MD
base64 -i data/resume.md    | tr -d '\n' | pbcopy   # paste as DATA_RESUME_MD

# Linux
base64 -w 0 data/companies.js   # copy output as DATA_COMPANIES_JS
base64 -w 0 data/context.md     # copy output as DATA_CONTEXT_MD
base64 -w 0 data/resume.md      # copy output as DATA_RESUME_MD
```

### Step 3 — Add GitHub Actions secrets

Go to your fork on GitHub: **Settings > Secrets and variables > Actions > New repository secret**.

Add these secrets:

| Secret | Required | Description |
|--------|----------|-------------|
| `GROQ_API_KEY` | Yes | Your Groq API key |
| `DATA_COMPANIES_JS` | Yes | Base64 of `data/companies.js` |
| `DATA_CONTEXT_MD` | Yes | Base64 of `data/context.md` |
| `DATA_RESUME_MD` | Yes | Base64 of `data/resume.md` |
| `SMTP_HOST` | For digest | SMTP server |
| `SMTP_USER` | For digest | SMTP username |
| `SMTP_PASS` | For digest | SMTP password or app password |
| `SMTP_FROM` | For digest | Sender address |
| `DIGEST_TO` | For digest | Recipient address |
| `GMAIL_EMAIL` | For rejection sync | Gmail address |
| `GMAIL_APP_PASSWORD` | For rejection sync | Gmail app password |
| `TZ` | No | Your timezone (e.g. `America/Los_Angeles`) |

### Step 4 — Enable Actions and customize the schedule

Go to **Actions** in your fork and enable workflows if prompted.

Edit `.github/workflows/daily.yml` to change the schedule:
```yaml
on:
  schedule:
    - cron: '0 9 * * *'  # 9:00 AM UTC daily
```
Use https://crontab.guru to build your schedule.

### Step 5 — Test manually

Trigger a run from **Actions > Daily Job Search > Run workflow**.

---

## Outlook / Microsoft 365 IMAP Setup

To sync rejection emails from Outlook instead of Gmail:

1. Generate an app password at https://account.microsoft.com/security (requires 2FA enabled).
2. Set in `.env`:
   ```
   IMAP_PROVIDER=outlook
   IMAP_EMAIL=you@outlook.com
   IMAP_APP_PASSWORD=your-app-password
   ```

The provider defaults map to:
- **Gmail**: host `imap.gmail.com`, mailbox `[Gmail]/All Mail`, trash `[Gmail]/Trash`
- **Outlook**: host `outlook.office365.com`, mailbox `Inbox`, trash `Deleted Items`

Override any of these with `IMAP_HOST`, `IMAP_MAILBOX`, and `IMAP_TRASH_MAILBOX`.

> **Enterprise Microsoft 365:** Accounts managed by an organization typically block basic auth (app passwords) and require OAuth2. OAuth2 is not currently supported. Check with your IT admin or use a personal Outlook account.

---

## Updating

```bash
docker compose down
git pull
docker compose up -d --build
```

Your editable profile files live in `./data` and survive restarts and rebuilds. The SQLite database lives in the Docker named volume `job-search-automation_job_search_db`.
