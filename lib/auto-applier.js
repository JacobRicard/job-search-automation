'use strict';

const { detectJobPlatform } = require('./ats-resolver');
const { classifyComplexity } = require('./complexity');
const { applyGreenhouse } = require('./ats-appliers/greenhouse');
const { applyLever } = require('./ats-appliers/lever');
const { applyAshby } = require('./ats-appliers/ashby');
const { pickResume } = require('./apply/shared');
const applicantDefaults = require('../config/applicant');

function detectPlatform(job) {
  const p = detectJobPlatform(job);
  return ['greenhouse', 'ashby', 'lever'].includes(p) ? p : null;
}

async function refreshJobReadiness(db, job) {
  if (!job) return job;
  const needsClassification = !job.apply_complexity || !detectPlatform(job);
  if (!needsClassification) return job;

  await classifyComplexity([job], db);
  return db.prepare('SELECT * FROM jobs WHERE id = ?').get(job.id) || job;
}

function buildApplicantForJob(job, applicant) {
  return {
    ...applicantDefaults,
    ...(applicant || {}),
    resumePath: pickResume(job),
  };
}

function extractPrepReview(prep) {
  const questions = Array.isArray(prep?.questions) ? prep.questions : [];
  const answers = prep?.answers || {};
  const unresolvedFields = questions.filter((field) => !Object.prototype.hasOwnProperty.call(answers, field.name));
  const lowConfidenceLabels = Array.isArray(prep?.voiceChecks?.lowConfidenceFields)
    ? prep.voiceChecks.lowConfidenceFields
    : [];
  const lowConfidenceFields = questions.filter((field) => lowConfidenceLabels.includes(field.label));
  return {
    questions,
    answers,
    unresolvedFields,
    lowConfidenceFields,
  };
}

function formatReviewFields(fields = []) {
  return fields.map((field) => ({
    label: field?.label || field?.name || 'Unknown field',
    name: field?.name || null,
    type: field?.type || null,
    required: Boolean(field?.required),
  }));
}

function formatAnswerValue(value) {
  if (Array.isArray(value)) return value.join(', ');
  if (value == null || value === '') return '—';
  return String(value);
}

function buildReviewPayload(job, prep, review = extractPrepReview(prep)) {
  const questions = Array.isArray(review.questions) ? review.questions : [];
  const answers = review.answers || {};
  const resolvedAnswers = questions
    .filter((field) => Object.prototype.hasOwnProperty.call(answers, field.name))
    .map((field) => ({
      label: field.label,
      name: field.name,
      value: formatAnswerValue(answers[field.name]),
    }));

  return {
    jobId: job?.id || null,
    company: job?.company || null,
    title: job?.title || null,
    score: job?.score ?? null,
    platform: detectPlatform(job),
    applyComplexity: job?.apply_complexity || null,
    prepStatus: prep?.status || null,
    workflow: prep?.workflow || null,
    summary: prep?.summary || null,
    applyUrl: prep?.apply_url || job?.url || null,
    resolvedAnswers,
    unresolvedFields: formatReviewFields(review.unresolvedFields),
    lowConfidenceFields: formatReviewFields(review.lowConfidenceFields),
    submitEligible: prep?.status === 'ready'
      && review.unresolvedFields.length === 0
      && review.lowConfidenceFields.length === 0,
  };
}

async function applyWithPlatform(job, applicant, platform, { mode = 'assist', prep }) {
  const platformOptions = {
    mode,
    answers: prep?.answers || {},
    questions: prep?.questions || [],
    unresolvedFields: prep?.unresolvedFields || [],
    lowConfidenceFields: prep?.lowConfidenceFields || [],
    overrideApplyUrl: prep?.applyUrl || prep?.apply_url || null,
  };

  if (platform === 'greenhouse') return applyGreenhouse(job, applicant, platformOptions);
  if (platform === 'lever') return applyLever(job, applicant, platformOptions);
  if (platform === 'ashby') return applyAshby(job, applicant, platformOptions);
  throw new Error(`Unsupported assisted apply platform: ${platform || 'unknown'}`);
}

module.exports = {
  applyWithPlatform,
  buildApplicantForJob,
  buildReviewPayload,
  detectPlatform,
  formatReviewFields,
  refreshJobReadiness,
};
