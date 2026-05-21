'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

async function withStubbedGreenhouse(testFn) {
  const autoApplierPath = require.resolve('../lib/auto-applier');
  const greenhousePath = require.resolve('../lib/ats-appliers/greenhouse');

  const originalAutoApplier = require.cache[autoApplierPath];
  const originalGreenhouse = require.cache[greenhousePath];

  delete require.cache[autoApplierPath];

  const calls = [];
  require.cache[greenhousePath] = {
    exports: {
      applyGreenhouse: async (job, applicant, options) => {
        calls.push({ job, applicant, options });
        return {
          success: true,
          preImagePath: '/tmp/pre.png',
          details: { filledFields: ['Email', 'Phone'] },
        };
      },
    },
  };

  try {
    const autoApplier = require('../lib/auto-applier');
    return await testFn(autoApplier, calls);
  } finally {
    delete require.cache[autoApplierPath];
    if (originalAutoApplier) require.cache[autoApplierPath] = originalAutoApplier;
    else delete require.cache[autoApplierPath];

    if (originalGreenhouse) require.cache[greenhousePath] = originalGreenhouse;
    else delete require.cache[greenhousePath];
  }
}

describe('reviewed assisted apply helpers', () => {
  it('builds review data from prepared answers without mutating job state', async () => {
    await withStubbedGreenhouse(async ({ buildReviewPayload }) => {
      const job = {
        id: 'greenhouse-1',
        company: 'Acme',
        title: 'Platform Engineer',
        url: 'https://boards.greenhouse.io/acme/jobs/1',
        score: 9,
        apply_complexity: 'complex',
      };
      const prep = {
        status: 'ready',
        workflow: 'autofill',
        apply_url: job.url,
        questions: [
          { label: 'Work authorization', name: 'work_auth', type: 'select', required: true },
          { label: 'Portfolio URL', name: 'portfolio', type: 'text', required: true },
          { label: 'Preferred locations', name: 'locations', type: 'checkbox', required: false },
        ],
        answers: {
          work_auth: 'Yes',
          locations: ['Remote', 'New York'],
        },
        voiceChecks: {
          lowConfidenceFields: ['Preferred locations'],
        },
        summary: 'Ready for review',
      };

      const review = buildReviewPayload(job, prep);

      assert.equal(review.jobId, 'greenhouse-1');
      assert.equal(review.platform, 'greenhouse');
      assert.equal(review.applyUrl, job.url);
      assert.equal(review.submitEligible, false);
      assert.deepEqual(review.resolvedAnswers, [
        { label: 'Work authorization', name: 'work_auth', value: 'Yes' },
        { label: 'Preferred locations', name: 'locations', value: 'Remote, New York' },
      ]);
      assert.deepEqual(review.unresolvedFields, [
        { label: 'Portfolio URL', name: 'portfolio', type: 'text', required: true },
      ]);
      assert.deepEqual(review.lowConfidenceFields, [
        { label: 'Preferred locations', name: 'locations', type: 'checkbox', required: false },
      ]);
    });
  });

  it('passes prepared data to the platform applier in assist mode by default', async () => {
    await withStubbedGreenhouse(async ({ applyWithPlatform }, calls) => {
      const result = await applyWithPlatform(
        { id: 'greenhouse-2', url: 'https://boards.greenhouse.io/acme/jobs/2' },
        { email: 'me@example.com', resumePath: '/tmp/resume.pdf' },
        'greenhouse',
        {
          prep: {
            answers: { email: 'me@example.com' },
            questions: [{ label: 'Email', name: 'email' }],
            unresolvedFields: [],
            lowConfidenceFields: [],
            apply_url: 'https://boards.greenhouse.io/acme/jobs/2',
          },
        },
      );

      assert.equal(result.success, true);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].options.mode, 'assist');
      assert.deepEqual(calls[0].options.answers, { email: 'me@example.com' });
      assert.deepEqual(calls[0].options.questions, [{ label: 'Email', name: 'email' }]);
      assert.equal(calls[0].options.overrideApplyUrl, 'https://boards.greenhouse.io/acme/jobs/2');
    });
  });

  it('rejects unsupported assisted apply platforms', async () => {
    await withStubbedGreenhouse(async ({ applyWithPlatform }) => {
      await assert.rejects(
        () => applyWithPlatform({}, {}, 'unknown', { prep: {} }),
        /Unsupported assisted apply platform: unknown/,
      );
    });
  });
});
