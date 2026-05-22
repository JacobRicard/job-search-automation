import unittest
from datetime import datetime

from pydantic import ValidationError

from contracts.job_lead import JobLead


VALID = {
    "title": "Senior Platform Engineer",
    "company": "Acme",
    "description": "Build platforms.",
    "direct_apply_url": "https://job-boards.greenhouse.io/acme/jobs/12345",
    "ats_platform_name": "Greenhouse",
    "scraped_timestamp": "2026-05-21T12:00:00Z",
}


class JobLeadContractTest(unittest.TestCase):
    def test_accepts_valid_lead(self):
        lead = JobLead.model_validate(VALID)
        self.assertEqual(lead.title, "Senior Platform Engineer")
        self.assertIsInstance(lead.scraped_timestamp, datetime)

    def test_rejects_extra_fields(self):
        with self.assertRaises(ValidationError):
            JobLead.model_validate({**VALID, "id": "greenhouse-12345"})

    def test_rejects_blank_strings(self):
        with self.assertRaises(ValidationError):
            JobLead.model_validate({**VALID, "company": " "})

    def test_rejects_invalid_url(self):
        with self.assertRaises(ValidationError):
            JobLead.model_validate({**VALID, "direct_apply_url": "not-a-url"})

    def test_rejects_invalid_timestamp(self):
        with self.assertRaises(ValidationError):
            JobLead.model_validate({**VALID, "scraped_timestamp": "yesterday"})


if __name__ == "__main__":
    unittest.main()
