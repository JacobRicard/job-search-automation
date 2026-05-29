#!/usr/bin/env python3
"""
JobSpy scraper — reads config from DATA_DIR/jobspy-config.json (or JOBSPY_CONFIG_PATH),
calls jobspy.scrape_jobs(), and outputs a JSON array of JobLead-compatible dicts to stdout.
"""

from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime, timezone
from urllib.parse import urlparse

CONFIG_FIELDS = {
    "search_term": str,
    "location": str,
    "site_name": list,
    "results_wanted": int,
    "hours_old": int,
    "country_indeed": str,
    "is_remote": bool,
    "job_type": str,
    "linkedin_fetch_description": bool,
    "request_delay_ms": int,
}

DEFAULTS = {
    "results_wanted": 20,
    "hours_old": 72,
    "country_indeed": "USA",
    "is_remote": False,
    "linkedin_fetch_description": False,
    "request_delay_ms": 3000,
}

PLATFORM_DISPLAY = {
    "indeed": "Indeed",
    "linkedin": "LinkedIn",
    "glassdoor": "Glassdoor",
    "zip_recruiter": "ZipRecruiter",
}


def load_config() -> dict:
    config_path = os.environ.get("JOBSPY_CONFIG_PATH")
    if not config_path:
        data_dir = os.environ.get("DATA_DIR", "data")
        config_path = os.path.join(data_dir, "jobspy-config.json")

    if not os.path.exists(config_path):
        return {}

    with open(config_path, "r", encoding="utf-8") as f:
        return json.load(f)


def is_valid_url(url: str) -> bool:
    if not url or not isinstance(url, str):
        return False
    try:
        parsed = urlparse(url.strip())
        return parsed.scheme in ("http", "https") and bool(parsed.netloc)
    except Exception:
        return False


def to_iso(val) -> str:
    if val is None:
        return ""
    if isinstance(val, datetime):
        if val.tzinfo is None:
            val = val.replace(tzinfo=timezone.utc)
        return val.isoformat()
    return str(val)


def row_to_job_lead(row: dict, scraped_ts: str) -> dict | None:
    title = str(row.get("title") or "").strip()
    company = str(row.get("company") or "").strip()
    job_url = str(row.get("job_url") or "").strip()

    if not title or not company or not is_valid_url(job_url):
        return None

    description = str(row.get("description") or "").strip()
    site = str(row.get("site") or "").strip().lower()
    platform_name = PLATFORM_DISPLAY.get(site, site.capitalize() or "JobSpy")
    location = str(row.get("location") or "").strip()
    posted_at = to_iso(row.get("date_posted"))

    return {
        "title": title,
        "company": company,
        "description": description,
        "direct_apply_url": job_url,
        "ats_platform_name": platform_name,
        "scraped_timestamp": scraped_ts,
        "location": location,
        "posted_at": posted_at,
    }


def main() -> int:
    try:
        from jobspy import scrape_jobs
    except ImportError:
        print("Warning: python-jobspy not installed. Skipping JobSpy scrape.", file=sys.stderr)
        print("Install with: pip install python-jobspy", file=sys.stderr)
        print("[]")
        return 0

    config = load_config()
    if not config:
        print("[]")
        return 0

    # Build kwargs for scrape_jobs, filtering to known params
    kwargs: dict = dict(DEFAULTS)
    for field in ("search_term", "location", "site_name", "results_wanted",
                  "hours_old", "country_indeed", "is_remote", "job_type",
                  "linkedin_fetch_description"):
        if field in config:
            kwargs[field] = config[field]

    # Remove fields that scrape_jobs doesn't accept
    delay_ms = kwargs.pop("request_delay_ms", 3000)

    if "search_term" not in kwargs or not kwargs["search_term"]:
        print("Warning: jobspy-config.json missing 'search_term'", file=sys.stderr)
        print("[]")
        return 0

    try:
        df = scrape_jobs(**kwargs)
    except Exception as exc:
        print(f"Warning: JobSpy scrape failed: {exc}", file=sys.stderr)
        print("[]")
        return 0

    scraped_ts = datetime.now(timezone.utc).isoformat()
    leads = []

    if df is not None and len(df) > 0:
        for _, row in df.iterrows():
            lead = row_to_job_lead(row.to_dict(), scraped_ts)
            if lead:
                leads.append(lead)

    # Configurable delay after scraping (rate-limit courtesy pause)
    if delay_ms > 0:
        time.sleep(delay_ms / 1000)

    json.dump(leads, sys.stdout, indent=2, default=str)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
