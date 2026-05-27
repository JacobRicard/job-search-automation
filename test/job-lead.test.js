'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { deriveJobId, jobLeadToInternal } = require('../lib/job-lead');
const { validateJob } = require('../lib/validate');

const lead = {
  title: 'Senior Platform Engineer',
  company: 'Acme',
  description: 'Build platforms.',
  direct_apply_url: 'https://job-boards.greenhouse.io/acme/jobs/12345?gh_src=test#section',
  ats_platform_name: 'Greenhouse',
  scraped_timestamp: '2026-05-21T12:00:00.000Z',
};

describe('JobLead contract helpers', () => {
  it('validates the JobLead shape', () => {
    assert.deepEqual(validateJob(lead), {
      ...lead,
      direct_apply_url: 'https://job-boards.greenhouse.io/acme/jobs/12345?gh_src=test#section',
      location: '',
      posted_at: '',
    });
  });

  it('preserves a location field when present', () => {
    const out = validateJob({ ...lead, location: 'Seattle, WA' });
    assert.equal(out.location, 'Seattle, WA');
  });

  it('rejects extra scraper fields', () => {
    assert.equal(validateJob({ ...lead, id: 'greenhouse-12345' }), null);
  });

  it('derives stable internal ids from platform URLs', () => {
    assert.equal(deriveJobId(lead), 'greenhouse-12345');
    assert.equal(
      deriveJobId({ ...lead, direct_apply_url: 'https://jobs.ashbyhq.com/acme/6b2ee1c2-509e-4433-9a60-3f79d7dfcd42', ats_platform_name: 'Ashby' }),
      'ashby-6b2ee1c2-509e-4433-9a60-3f79d7dfcd42'
    );
  });

  it('normalizes JobLead records into DB-facing jobs', () => {
    assert.deepEqual(jobLeadToInternal(lead), {
      id: 'greenhouse-12345',
      title: 'Senior Platform Engineer',
      company: 'Acme',
      url: 'https://job-boards.greenhouse.io/acme/jobs/12345?gh_src=test#section',
      platform: 'Greenhouse',
      postedAt: '',
      scrapedAt: '2026-05-21T12:00:00.000Z',
      description: 'Build platforms.',
      location: '',
    });
  });
});
