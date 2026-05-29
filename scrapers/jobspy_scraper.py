#!/usr/bin/env python3
"""
JobSpy scraper — reads config from DATA_DIR/jobspy-config.json (or JOBSPY_CONFIG_PATH),
calls jobspy.scrape_jobs() once per search_term x location combination, merges all results,
deduplicates by job_url, and outputs a JSON array of JobLead-compatible dicts to stdout.

search_term may be a string or a list of strings in the config file.
JOBSPY_LOCATIONS env var (comma-separated) overrides the "location" config field.
"""

from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime, timezone
from urllib.parse import urlparse

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


def get_search_terms(config: dict) -> list[str]:
    """Return a list of search terms from config. Accepts string or list of strings."""
    raw = config.get("search_term")
    if not raw:
        return []
    if isinstance(raw, list):
        return [str(t).strip() for t in raw if t and str(t).strip()]
    return [str(raw).strip()]


def get_locations(config: dict) -> list[str | None]:
    """
    Return a list of locations to scrape.
    LOCATION_FILTER env var (comma-separated, same var used by the pipeline allowlist)
    takes precedence over the config "location" field.
    Returns [None] if no location is specified (scrape without location filter).
    """
    env_locations = os.environ.get("LOCATION_FILTER", "").strip()
    if env_locations:
        return [loc.strip() for loc in env_locations.split(",") if loc.strip()]
    config_location = config.get("location")
    if config_location:
        return [str(config_location).strip()]
    return [None]


def build_base_kwargs(config: dict) -> dict:
    """Build scrape_jobs kwargs from config, excluding search_term and location."""
    kwargs: dict = dict(DEFAULTS)
    for field in ("site_name", "results_wanted", "hours_old", "country_indeed",
                  "is_remote", "job_type", "linkedin_fetch_description"):
        if field in config:
            kwargs[field] = config[field]
    return kwargs


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

    search_terms = get_search_terms(config)
    if not search_terms:
        print("Warning: jobspy-config.json missing 'search_term'", file=sys.stderr)
        print("[]")
        return 0

    locations = get_locations(config)
    base_kwargs = build_base_kwargs(config)
    delay_ms = int(config.get("request_delay_ms", DEFAULTS["request_delay_ms"]))

    # Build the full list of (term, location) combinations to run
    combinations = [(term, loc) for term in search_terms for loc in locations]

    scraped_ts = datetime.now(timezone.utc).isoformat()
    seen_urls: set[str] = set()
    leads: list[dict] = []

    for i, (term, loc) in enumerate(combinations):
        kwargs = dict(base_kwargs)
        kwargs["search_term"] = term
        if loc is not None:
            kwargs["location"] = loc

        loc_label = loc or "(no location)"
        try:
            df = scrape_jobs(**kwargs)
        except Exception as exc:
            print(f"Warning: JobSpy scrape failed for '{term}' / '{loc_label}': {exc}", file=sys.stderr)
            df = None

        if df is not None and len(df) > 0:
            for _, row in df.iterrows():
                lead = row_to_job_lead(row.to_dict(), scraped_ts)
                if lead and lead["direct_apply_url"] not in seen_urls:
                    seen_urls.add(lead["direct_apply_url"])
                    leads.append(lead)

        # Sleep between calls but not after the last one
        if delay_ms > 0 and i < len(combinations) - 1:
            time.sleep(delay_ms / 1000)

    json.dump(leads, sys.stdout, indent=2, default=str)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
