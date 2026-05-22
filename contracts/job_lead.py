#!/usr/bin/env python3
"""Strict Pydantic contract for scraper output."""

from __future__ import annotations

import json
import sys
from datetime import datetime
from typing import Any
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, StrictStr, ValidationError, field_validator


class JobLead(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    title: StrictStr
    company: StrictStr
    description: StrictStr
    direct_apply_url: StrictStr
    ats_platform_name: StrictStr
    scraped_timestamp: datetime
    location: StrictStr = ""

    @field_validator("title", "company", "description", "direct_apply_url", "ats_platform_name")
    @classmethod
    def non_blank(cls, value: str) -> str:
        if not value or not value.strip():
            raise ValueError("must be a non-empty string")
        return value.strip()

    @field_validator("direct_apply_url")
    @classmethod
    def http_url(cls, value: str) -> str:
        parsed = urlparse(value)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("must be an absolute http(s) URL")
        return value


def normalize_leads(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        raise TypeError("expected a JSON array of JobLead objects")
    return [JobLead.model_validate(item).model_dump(mode="json") for item in raw]


def main() -> int:
    try:
        raw = json.load(sys.stdin)
        normalized = normalize_leads(raw)
    except (json.JSONDecodeError, TypeError, ValidationError, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        return 1

    json.dump(normalized, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
