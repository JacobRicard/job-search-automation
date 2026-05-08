'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('application prep answer guidance', () => {
  it('lets explicit overrides win over heuristic answers', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'job-search-prep-'));
    const previousProfileDir = process.env.JOB_PROFILE_DIR;

    try {
      process.env.JOB_PROFILE_DIR = tmpDir;
      delete require.cache[require.resolve('../config/paths')];
      delete require.cache[require.resolve('../lib/application-overrides')];
      delete require.cache[require.resolve('../lib/application-prep')];

      const { overridePathForJob } = require('../lib/application-overrides');
      const { mergeResolvedAndOverrides } = require('../lib/application-prep');

      fs.mkdirSync(path.dirname(overridePathForJob('job-1')), { recursive: true });
      fs.writeFileSync(overridePathForJob('job-1'), JSON.stringify({
        jobId: 'job-1',
        answers: {
          work_auth: 'No',
        },
      }, null, 2));

      const { answers } = mergeResolvedAndOverrides('job-1', [
        { label: 'Are you legally authorized to work in the United States?', name: 'work_auth', type: 'select', required: true },
      ], {
        work_auth: 'Yes',
      });

      assert.equal(answers.work_auth, 'No');
    } finally {
      if (previousProfileDir == null) delete process.env.JOB_PROFILE_DIR;
      else process.env.JOB_PROFILE_DIR = previousProfileDir;
      delete require.cache[require.resolve('../config/paths')];
      delete require.cache[require.resolve('../lib/application-overrides')];
      delete require.cache[require.resolve('../lib/application-prep')];
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('treats explicit blank overrides as resolved only for optional fields', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'job-search-prep-'));
    const previousProfileDir = process.env.JOB_PROFILE_DIR;

    try {
      process.env.JOB_PROFILE_DIR = tmpDir;
      delete require.cache[require.resolve('../config/paths')];
      delete require.cache[require.resolve('../lib/application-overrides')];
      delete require.cache[require.resolve('../lib/application-prep')];

      const { overridePathForJob } = require('../lib/application-overrides');
      const { mergeResolvedAndOverrides } = require('../lib/application-prep');

      fs.mkdirSync(path.dirname(overridePathForJob('job-blank')), { recursive: true });
      fs.writeFileSync(overridePathForJob('job-blank'), JSON.stringify({
        jobId: 'job-blank',
        answers: {
          optional_note: '',
          required_note: '',
        },
      }, null, 2));

      const { answers, unresolved } = mergeResolvedAndOverrides('job-blank', [
        { label: 'Optional note', name: 'optional_note', type: 'text', required: false },
        { label: 'Required note', name: 'required_note', type: 'text', required: true },
      ], {});

      assert.equal(answers.optional_note, '');
      assert.equal(answers.required_note, '');
      assert.deepEqual(unresolved.map((field) => field.name), ['required_note']);
    } finally {
      if (previousProfileDir == null) delete process.env.JOB_PROFILE_DIR;
      else process.env.JOB_PROFILE_DIR = previousProfileDir;
      delete require.cache[require.resolve('../config/paths')];
      delete require.cache[require.resolve('../lib/application-overrides')];
      delete require.cache[require.resolve('../lib/application-prep')];
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('keeps authorization and sponsorship prompts distinct', () => {
    const { heuristicAnswer } = require('../lib/application-prep');

    assert.equal(heuristicAnswer({
      label: 'Are you legally authorized to work in the United States?',
      options: ['Yes', 'No'],
      type: 'select',
    }, {}), 'Yes');

    assert.equal(heuristicAnswer({
      label: 'Will you now or in the future require employer sponsorship to work in the United States?',
      options: ['Yes', 'No'],
      type: 'select',
    }, {}), 'No');
  });

  it('leaves ambiguous combined work-eligibility prompts unresolved', () => {
    const { splitResolvedFields } = require('../lib/application-prep');
    const field = {
      label: 'Are you legally authorized to work in the United States and will you now or in the future require sponsorship?',
      name: 'combo_auth',
      options: ['Yes', 'No'],
      type: 'select',
      required: true,
    };

    const { resolved, unresolved } = splitResolvedFields([field], {});

    assert.deepEqual(resolved, {});
    assert.equal(unresolved.length, 1);
    assert.equal(unresolved[0].name, 'combo_auth');
  });

  it('treats unanswered optional fields as intentionally blank', () => {
    const { splitResolvedFields } = require('../lib/application-prep');

    const { resolved, unresolved } = splitResolvedFields([{
      label: 'What is your preferred name?',
      name: 'preferred_name',
      options: [],
      type: 'text',
      required: false,
    }], {});

    assert.deepEqual(resolved, { preferred_name: '' });
    assert.deepEqual(unresolved, []);
  });

  it('resolves common Lever administrative fields without manual review', () => {
    const previousCompany = process.env.APPLICANT_CURRENT_COMPANY;
    const previousMailingAddress = process.env.APPLICANT_MAILING_ADDRESS;

    try {
      process.env.APPLICANT_CURRENT_COMPANY = 'EliseAI';
      process.env.APPLICANT_MAILING_ADDRESS = '2130 8th Ave W\nApt 3\nSeattle, WA 98119';
      delete require.cache[require.resolve('../config/applicant')];
      delete require.cache[require.resolve('../lib/application-prep')];
      const { heuristicAnswer } = require('../lib/application-prep');

      assert.equal(heuristicAnswer({
        label: 'Current company ✱',
        options: [],
        required: true,
        type: 'text',
      }, {}), 'EliseAI');

      assert.equal(heuristicAnswer({
        label: 'Twitter URL',
        options: [],
        required: false,
        type: 'text',
      }, {}), '');

      assert.equal(heuristicAnswer({
        label: 'Please confirm you have reviewed and are comfortable with the salary range listed for the position you’ve applied for.✱',
        options: ['Yes', 'No'],
        required: true,
        type: 'select',
      }, {}), 'Yes');

      assert.equal(heuristicAnswer({
        label: 'Are you subject to any post-employment restrictions, such as a non-compete or non-solicitation?✱',
        options: ['Yes', 'No'],
        required: true,
        type: 'select',
      }, {}), 'No');

      assert.equal(heuristicAnswer({
        label: 'To complete your candidate file, could you share your current mailing address?',
        options: [],
        required: true,
        type: 'textarea',
      }, {}), '2130 8th Ave W\nApt 3\nSeattle, WA 98119');

      assert.equal(heuristicAnswer({
        label: 'I agree to provide original, real-time responses during my interview without the use of AI-generated scripts or automated teleprompters.',
        options: ['I agree', 'I do not agree'],
        required: true,
        type: 'select',
      }, {}), 'I agree');
    } finally {
      if (previousCompany == null) delete process.env.APPLICANT_CURRENT_COMPANY;
      else process.env.APPLICANT_CURRENT_COMPANY = previousCompany;
      if (previousMailingAddress == null) delete process.env.APPLICANT_MAILING_ADDRESS;
      else process.env.APPLICANT_MAILING_ADDRESS = previousMailingAddress;
      delete require.cache[require.resolve('../config/applicant')];
      delete require.cache[require.resolve('../lib/application-prep')];
    }
  });
});
