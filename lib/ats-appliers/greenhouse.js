'use strict';

const fs = require('fs');
const {
  launchBrowser,
  saveScreenshot,
  getIncompleteRequiredFields,
  newPage,
  stageResume,
  hasDuplicateSubmissionMessage,
  hasAbuseWarningMessage,
  captureAssistPageMeta,
  splitExpectedMissingFields,
} = require('./browser');
const { waitForApplicationConfirmation } = require('../gmail-code');
const { detectApplicationPageIssue, snapshotApplicationPage } = require('./page-checks');
const { fetchGreenhouseCode } = require('../gmail-code');
const { preflightApplicant } = require('./preflight');
const { sleep, DELAYS } = require('./utils');
const { parseGreenhouseUrl: parseGreenhouseUrlShared } = require('../greenhouse-url');
const log = require('../logger')('auto-apply');

const {
  SIMPLE_GREENHOUSE_QUESTION_RULES,
  answerForGreenhouseQuestion,
  resolveGreenhouseQuestionAnswer,
} = require('./greenhouse-question-rules');

const {
  normalizeGreenhouseAnswer,
  greenhouseSelectionMatches,
  greenhouseComboboxSnapshotIsEmpty,
  greenhouseEducationFieldIsPresent,
  selectGreenhouseEducationTarget,
  buildGreenhouseTextSnippet,
  classifyGreenhouseSubmitOutcome,
} = require('./greenhouse-helpers');

const {
  GREENHOUSE_SCHOOL_INPUT_SELECTOR,
  fillGreenhouseCheckboxField,
  fillGreenhouseChoiceField,
  inspectGreenhouseEducationTarget,
  greenhouseFieldIsEmpty,
  chooseGreenhouseComboboxOption,
  greenhouseFieldHasText,
  greenhouseRequiredQuestionIsEmpty,
  collectGreenhouseMissingFields,
  fillGreenhouseField,
  typeInto,
} = require('./greenhouse-fields');

const {
  fillGreenhouseEEO,
  fillGreenhouseEducation,
} = require('./greenhouse-sections');

function parseGreenhouseUrl(url, job) {
  return parseGreenhouseUrlShared(url, job && job.company);
}

async function fetchGreenhouseQuestions(boardToken, jobId) {
  const url = `https://boards-api.greenhouse.io/v1/boards/${boardToken}/jobs/${jobId}?questions=true`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.questions) ? data.questions : [];
  } catch {
    return [];
  }
}

// In assist mode, watch the open page for the Greenhouse security code boxes
// (8 single-char inputs). When detected, fetch the code from Gmail and fill
// it in automatically, then click Submit. Also exits early if the page
// transitions to a success state or if the browser disconnects.
async function watchForSecurityCode(page, job, maxWaitMs = 10 * 60 * 1000) {
  const deadline = Date.now() + maxWaitMs;
  log.info('Assist: watching for security code or success page', { company: job.company, maxWaitMs });

  while (Date.now() < deadline) {
    await sleep(DELAYS.REACT_RENDER);

    try {
      const codeBoxes = await page.$$('input[maxlength="1"]');
      if (codeBoxes.length === 8) {
        log.info('Security code field detected, fetching from Gmail...', { company: job.company });
        const code = await fetchGreenhouseCode(45000);
        if (!code) {
          log.warn('Security code not found in Gmail within 45s', { company: job.company });
          return null;
        }
        log.info('Got security code, entering...', { code, company: job.company });
        for (let i = 0; i < 8; i++) {
          await codeBoxes[i].click();
          await codeBoxes[i].type(code[i], { delay: 60 });
        }
        await sleep(DELAYS.INPUT_SETTLE);
        const submitBtn = await page.$('button[type="submit"]');
        if (submitBtn) await submitBtn.click();
        log.info('Security code submitted', { company: job.company });
        await sleep(DELAYS.SECURITY_CODE);
        const postCodeText = await page.evaluate(() => document.body.innerText).catch(() => '');
        const postCodeSuccess = ['thank you for applying', 'application has been received', 'successfully submitted', 'we have received', 'application has been'];
        if (postCodeSuccess.some(p => postCodeText.toLowerCase().includes(p))) {
          log.info('Success page detected after code submission', { company: job.company });
          return 'SUCCESS_PAGE';
        }
        return code;
      }

      const pageText = await page.evaluate(() => document.body.innerText).catch(() => '');
      const successPhrases = ['thank you for applying', 'application has been received', 'successfully submitted', 'we have received', 'application has been'];
      if (successPhrases.some(p => pageText.toLowerCase().includes(p))) {
        log.info('Success page detected, application submitted', { company: job.company });
        return 'SUCCESS_PAGE';
      }
      const hasCaptcha = await page.evaluate(() =>
        Boolean(document.querySelector('iframe[src*="arkoselabs"], iframe[src*="funcaptcha"], iframe[title*="captcha" i], .g-recaptcha, [data-captcha]'))
      ).catch(() => false);
      if (hasCaptcha) {
        log.info('CAPTCHA detected, waiting for manual solve, then will resume...', { company: job.company });
      }
    } catch (e) {
      if (e.message?.includes('detached') || e.message?.includes('closed') || e.message?.includes('disconnected')) {
        log.info('Browser disconnected, stopping code watcher', { company: job.company });
        return null;
      }
      log.warn('Code watcher poll error', { error: e.message });
    }
  }

  log.warn('Code watcher timed out', { company: job.company, maxWaitMs });
  return null;
}

async function applyGreenhouse(job, applicant, options = {}) {
  const {
    mode = 'submit',
    answers: draftedAnswers = {},
    questions: draftedQuestions = [],
    unresolvedFields = [],
    lowConfidenceFields = [],
    overrideApplyUrl = null,
  } = options;
  const parsed = parseGreenhouseUrl(job.url, job);
  if (!parsed) {
    return { success: false, error: `Cannot parse Greenhouse URL: ${job.url}` };
  }
  const { boardToken, jobId } = parsed;
  const standardApplyUrl = `https://job-boards.greenhouse.io/${boardToken}/jobs/${jobId}`;
  // Custom-domain Greenhouse jobs (e.g. jobs.elastic.co) don't serve the form
  // at the standard job-boards URL. Use the override URL when provided.
  const applyUrl = overrideApplyUrl || standardApplyUrl;

  const pre = preflightApplicant(applicant);
  if (!pre.ok) return { success: false, error: pre.error };
  const { resumeAbsPath } = pre;

  const tmpResume = stageResume(resumeAbsPath);
  let browser;
  let keepBrowserOpen = false;
  try {
    browser = await launchBrowser({ headless: mode !== 'assist' });
    const page = await newPage(browser);
    const filledFields = [];

    log.info('Opening Greenhouse job page', { company: job.company, url: applyUrl });
    await page.goto(applyUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    await sleep(DELAYS.REACT_RENDER);

    let pageIssue = detectApplicationPageIssue('greenhouse', await snapshotApplicationPage(page), {
      sourceUrl: applyUrl,
      jobId,
    });

    // Custom-domain listing pages (e.g. jobs.elastic.co) show a job description,
    // not the form. Click the "Apply for this job" button to reach the actual form.
    if (pageIssue && overrideApplyUrl && !overrideApplyUrl.includes('greenhouse.io')) {
      log.info('Custom domain listing page detected, looking for Apply button', { company: job.company, url: applyUrl });

      try {
        const dismissed = await page.evaluate(() => {
          const selectors = [
            '[id*="ketch"] button[class*="accept"]',
            '[id*="ketch"] button[class*="allow"]',
            'button[data-id="accept"]',
            '#onetrust-accept-btn-handler',
            '.cc-btn.cc-allow',
            '[aria-label*="Accept"][role="button"]',
            '[aria-label*="Accept all"]',
            'button[id*="accept-all"]',
            'button[id*="acceptAll"]',
            'button[id*="cookie"][class*="accept"]',
          ];
          for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el) { el.click(); return sel; }
          }
          return null;
        });
        if (dismissed) {
          log.info('Cookie consent banner dismissed', { selector: dismissed, company: job.company });
          await sleep(DELAYS.PAGE_SETTLE);
        }
      } catch {}

      const applyBtn = await page.evaluateHandle(() => {
        const candidates = [
          ...document.querySelectorAll('a, button'),
        ];
        return candidates.find((el) => /apply(\s+for\s+(this\s+)?job)?/i.test(el.innerText || el.textContent || ''));
      });
      const btnEl = applyBtn.asElement();
      if (btnEl) {
        const href = await btnEl.evaluate((el) => el.href || null).catch(() => null);
        log.info('Clicking Apply button on listing page', { company: job.company, href });
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {}),
          btnEl.evaluate((el) => el.click()).catch(() => btnEl.click()),
        ]);
        await sleep(DELAYS.REACT_RENDER);
        log.info('Navigated to apply form', { company: job.company, url: page.url() });
      } else {
        log.warn('No Apply button found on listing page', { company: job.company });
      }
      await applyBtn.dispose().catch(() => {});

      pageIssue = detectApplicationPageIssue('greenhouse', await snapshotApplicationPage(page), {
        sourceUrl: page.url(),
        jobId,
      });
    }

    if (pageIssue) {
      return { success: false, error: pageIssue };
    }

    await typeInto(page, '#first_name', applicant.firstName);
    filledFields.push('First name');
    await typeInto(page, '#last_name', applicant.lastName);
    filledFields.push('Last name');
    await typeInto(page, '#email', applicant.email);
    filledFields.push('Email');
    await typeInto(page, '#phone', applicant.phone);
    filledFields.push('Phone');

    const linkedinInput = await page.$('input[id*="linkedin"], input[name*="linkedin"], #linkedin');
    if (linkedinInput && applicant.linkedin) {
      await linkedinInput.click({ clickCount: 3 });
      await linkedinInput.type(applicant.linkedin, { delay: 20 });
      filledFields.push('LinkedIn');
    }

    // Upload resume before custom selects. Greenhouse can rerender the form after
    // parsing the resume, which otherwise wipes already-selected dropdown values.
    const resumeInput = await page.$('#resume, input[type="file"][id*="resume"]');
    if (resumeInput) {
      await resumeInput.uploadFile(tmpResume);
      log.info('Resume uploaded');
      await sleep(DELAYS.PAGE_SETTLE);
      filledFields.push('Resume');
    } else {
      return { success: false, error: 'Resume file input not found' };
    }

    const schoolFill = await fillGreenhouseEducation(page, applicant);
    if (schoolFill?.filledSchool) filledFields.push('School');
    await fillGreenhouseEEO(page, applicant);

    const countryInput = await page.$('#country');
    if (countryInput) {
      const countryVal = await page.evaluate(el => el.value, countryInput);
      if (!countryVal) {
        await fillGreenhouseField(page, 'country', 'United States');
        filledFields.push('Country');
      }
    }

    const questions = draftedQuestions.length
      ? draftedQuestions.map((field) => ({ label: field.label, fields: [field] }))
      : await fetchGreenhouseQuestions(boardToken, jobId);
    for (const question of questions) {
      for (const field of (question.fields || [])) {
        const answer = Object.prototype.hasOwnProperty.call(draftedAnswers, field.name) ? draftedAnswers[field.name] : null;
        if (answer == null) continue;
        const filled = await fillGreenhouseField(page, field.name, answer);
        if (filled) {
          filledFields.push(question.label || field.label || field.name);
          break;
        }
      }
    }

    for (const question of questions) {
      for (const field of (question.fields || [])) {
        const answer = Object.prototype.hasOwnProperty.call(draftedAnswers, field.name) ? draftedAnswers[field.name] : null;
        if (answer == null || field.name.endsWith('[]')) continue;

        if (await greenhouseFieldIsEmpty(page, field.name)) {
          await fillGreenhouseField(page, field.name, answer);
        }
      }
    }

    const schoolBeforePresubmit = await inspectGreenhouseEducationTarget(page);
    if (applicant.school && (!schoolBeforePresubmit.target || greenhouseComboboxSnapshotIsEmpty(schoolBeforePresubmit.target))) {
      await fillGreenhouseEducation(page, applicant);
    }

    const submitBtn = await page.$('button[type="submit"]');
    if (!submitBtn) {
      return { success: false, error: 'Submit button not found' };
    }

    const validation = await collectGreenhouseMissingFields(page, applicant, questions);
    const schoolPresubmitTarget = validation.schoolTarget;
    const schoolSelection = {
      targetFieldName: schoolPresubmitTarget?.fieldName || schoolFill?.targetAfterFill?.fieldName || schoolFill?.targetBefore?.fieldName || null,
      targetLabel: schoolPresubmitTarget?.label || schoolFill?.targetAfterFill?.label || schoolFill?.targetBefore?.label || null,
      rowIndex: schoolPresubmitTarget?.rowIndex ?? schoolFill?.targetAfterFill?.rowIndex ?? schoolFill?.targetBefore?.rowIndex ?? null,
      required: Boolean(schoolPresubmitTarget?.required ?? schoolFill?.targetAfterFill?.required ?? schoolFill?.targetBefore?.required),
      selectedAfterFill: schoolFill?.targetAfterFill?.selectedValue || null,
      selectedBeforeSubmit: schoolPresubmitTarget?.selectedValue || null,
      hasSingleValueNodeAfterFill: Boolean(schoolFill?.targetAfterFill?.hasSingleValueNode),
      hasSingleValueNodeBeforeSubmit: Boolean(schoolPresubmitTarget?.hasSingleValueNode),
      schoolClearedAfterFill: Boolean(
        normalizeGreenhouseAnswer(schoolFill?.targetAfterFill?.selectedValue)
        && !normalizeGreenhouseAnswer(schoolPresubmitTarget?.selectedValue)
      ),
    };

    log.info('Greenhouse presubmit education review', schoolSelection);
    if (schoolSelection.schoolClearedAfterFill) {
      log.warn('Greenhouse school selection cleared before submit', schoolSelection);
    }

    if (validation.missing.length) {
      const expectedMissing = [...unresolvedFields, ...lowConfidenceFields];
      const missingSummary = splitExpectedMissingFields(validation.missing, expectedMissing);
      if (!missingSummary.blocking.length && (mode === 'assist' || mode === 'dry-run')) {
        const preScreenshot = await saveScreenshot(page, job, mode === 'assist' ? 'assist-presubmit' : 'presubmit-dry-run');
        const pageMeta = await captureAssistPageMeta(page);
        if (mode === 'assist') {
          keepBrowserOpen = true;
          await browser.disconnect();
          browser = null;
        }
        return {
          success: true,
          status: 'prepared',
          preImagePath: preScreenshot,
          details: {
            applyUrl,
            filledFields,
            unresolvedFields,
            lowConfidenceFields,
            expectedMissingFields: missingSummary.expectedMissing,
            schoolSelection,
            ...pageMeta,
            validationOnly: mode === 'dry-run',
          },
        };
      }
      const incompleteScreenshot = await saveScreenshot(page, job, 'incomplete');
      const incompleteResult = {
        success: false,
        incompleteImagePath: incompleteScreenshot,
        details: {
          applyUrl,
          filledFields,
          unresolvedFields,
          lowConfidenceFields,
          schoolSelection,
          blockingMissingFields: missingSummary.blocking,
          expectedMissingFields: missingSummary.expectedMissing,
          ...(await captureAssistPageMeta(page)),
        },
        error: `Required fields still empty before submit: ${missingSummary.blocking.join(', ')}. Check screenshot: ${incompleteScreenshot}`,
      };
      if (mode === 'assist') {
        keepBrowserOpen = true;
        log.info('Assist mode: keeping browser open, watching for user submit + security code', { missing: missingSummary.blocking });
        const watchResult = await watchForSecurityCode(page, job);
        if (watchResult === 'SUCCESS_PAGE') {
          return { ...incompleteResult, successPageDetected: true };
        }
      }
      return incompleteResult;
    }

    const preScreenshot = await saveScreenshot(page, job, mode === 'assist' ? 'assist-presubmit' : mode === 'dry-run' ? 'presubmit-dry-run' : 'presubmit');
    if (mode === 'assist' || mode === 'dry-run') {
      log.info('Greenhouse guided review ready', {
        company: job.company,
        title: job.title,
        targetFieldName: schoolSelection.targetFieldName,
        rowIndex: schoolSelection.rowIndex,
        mode,
      });
      const pageMeta = await captureAssistPageMeta(page);
      if (mode === 'assist') {
        keepBrowserOpen = true;
        const watchResult = await watchForSecurityCode(page, job);
        await browser.disconnect();
        browser = null;
        return {
          success: true,
          status: 'prepared',
          successPageDetected: watchResult === 'SUCCESS_PAGE',
          preImagePath: preScreenshot,
          details: {
            applyUrl,
            filledFields,
            unresolvedFields,
            lowConfidenceFields,
            validationOnly: false,
            schoolSelection,
            ...pageMeta,
          },
        };
      }

      return {
        success: true,
        status: 'prepared',
        preImagePath: preScreenshot,
        details: {
          applyUrl,
          filledFields,
          unresolvedFields,
          lowConfidenceFields,
          validationOnly: true,
          schoolSelection,
          ...pageMeta,
        },
      };
    }

    const submissionStartedAt = Date.now();
    log.info('Submitting form', { company: job.company });
    await submitBtn.click();
    await sleep(DELAYS.SUBMIT_COMPLETE);

    const codeBoxes = await page.$$('input[maxlength="1"]');
    let usedCode = null;
    if (codeBoxes.length === 8) {
      log.info('Security code required, fetching from Gmail...', { company: job.company });
      const code = await fetchGreenhouseCode(45000);
      if (!code) {
        return {
          success: false,
          preImagePath: preScreenshot,
          error: 'Security code not found in Gmail within 45s',
        };
      }
      usedCode = code;
      log.info('Got security code, entering...', { code });
      for (let i = 0; i < 8; i++) {
        await codeBoxes[i].click();
        await codeBoxes[i].type(code[i], { delay: 60 });
      }
      await sleep(DELAYS.INPUT_SETTLE);
      const submitBtn2 = await page.$('button[type="submit"]');
      await submitBtn2.click();
      await sleep(DELAYS.SECURITY_SUBMIT);
    }

    const postScreenshot = await saveScreenshot(page, job, 'postsubmit');

    const invalidFields = await getIncompleteRequiredFields(page);
    const pageText = await page.evaluate(() => document.body.innerText);
    const successPhrases = ['thank you', 'application received', 'successfully submitted', 'we have received', 'application has been'];
    const isSuccess = successPhrases.some(p => pageText.toLowerCase().includes(p));
    const isDuplicate = hasDuplicateSubmissionMessage(pageText);
    const isAbuseWarning = hasAbuseWarningMessage(pageText);
    const postSubmitMeta = await page.evaluate(() => {
      function snippet(value, limit = 220) {
        const text = String(value || '').replace(/\s+/g, ' ').trim();
        if (!text) return null;
        return text.length <= limit ? text : `${text.slice(0, limit - 3)}...`;
      }

      function isVisible(node) {
        if (!node) return false;
        const style = window.getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }

      const visibleInputs = Array.from(document.querySelectorAll('input, textarea, select')).filter(isVisible).length;
      const visibleSubmit = Array.from(document.querySelectorAll('button[type="submit"], button'))
        .filter(isVisible)
        .some((button) => /submit/i.test(button.innerText || ''));
      return {
        pageTitle: document.title || null,
        textSnippet: snippet(document.body?.innerText || ''),
        stillOnForm: Boolean(document.querySelector('form')) && (visibleInputs > 3 || visibleSubmit),
      };
    });

    const codeBoxesStillThere = (await page.$$('input[maxlength="1"]')).length === 8;
    const errorText = await page.$('text=Incorrect security code, [class*="error"]').catch(() => null);

    if (errorText || codeBoxesStillThere) {
      return {
        success: false,
        preImagePath: preScreenshot,
        postImagePath: postScreenshot,
        error: 'Security code rejected or still showing',
      };
    }

    if (isAbuseWarning) {
      return {
        success: false,
        haltRun: true,
        preImagePath: preScreenshot,
        postImagePath: postScreenshot,
        details: {
          schoolSelection,
          postSubmit: {
            pageUrl: page.url(),
            pageTitle: postSubmitMeta.pageTitle,
            textSnippet: postSubmitMeta.textSnippet,
          },
        },
        error: `Abuse warning detected after submit. Check screenshot: ${postScreenshot}`,
      };
    }

    const submitOutcome = classifyGreenhouseSubmitOutcome({
      pageText,
      pageUrl: page.url(),
      pageTitle: postSubmitMeta.pageTitle,
      textSnippet: postSubmitMeta.textSnippet,
      invalidFields,
      stillOnForm: postSubmitMeta.stillOnForm,
      isSuccess,
      isDuplicate,
      isAbuseWarning,
    });

    if (submitOutcome.outcome === 'validation-failure') {
      return {
        success: false,
        preImagePath: preScreenshot,
        postImagePath: postScreenshot,
        details: {
          schoolSelection,
          postSubmit: submitOutcome.details,
        },
        error: `Required fields still empty after submit: ${submitOutcome.details.invalidFields.join(', ')}. Check screenshot: ${postScreenshot}`,
      };
    }

    if (submitOutcome.outcome === 'confirmation-missing') {
      const { pageUrl, pageTitle, textSnippet } = submitOutcome.details;
      return {
        success: false,
        preImagePath: preScreenshot,
        postImagePath: postScreenshot,
        details: {
          schoolSelection,
          postSubmit: submitOutcome.details,
        },
        error: `No success confirmation found after submit. Page URL: ${pageUrl || 'unknown'}. Title: ${pageTitle || 'unknown'}. Snippet: ${textSnippet || 'n/a'}. Check screenshot: ${postScreenshot}`,
      };
    }

    if (isDuplicate) {
      log.info('Existing application confirmed on Greenhouse', { company: job.company, title: job.title });
    }

    const confirmationEmail = await waitForApplicationConfirmation(job, { startedAt: submissionStartedAt });
    if (!confirmationEmail) {
      return {
        success: false,
        preImagePath: preScreenshot,
        postImagePath: postScreenshot,
        details: {
          schoolSelection,
          postSubmit: submitOutcome.details,
        },
        error: `No application confirmation email found after submit. Check screenshot: ${postScreenshot}`,
      };
    }

    log.info('Applied via Greenhouse', { company: job.company, title: job.title, hadSecurityCode: !!usedCode });
    return {
      success: true,
      securityCode: usedCode,
      preImagePath: preScreenshot,
      postImagePath: postScreenshot,
      details: {
        schoolSelection,
        postSubmit: submitOutcome.details,
      },
    };

  } catch (e) {
    return { success: false, error: e.message };
  } finally {
    if (browser && !keepBrowserOpen) await browser.close();
    try { fs.unlinkSync(tmpResume); } catch {}
  }
}

module.exports = {
  applyGreenhouse,
  answerForGreenhouseQuestion,
  buildGreenhouseTextSnippet,
  classifyGreenhouseSubmitOutcome,
  greenhouseEducationFieldIsPresent,
  greenhouseComboboxSnapshotIsEmpty,
  greenhouseSelectionMatches,
  resolveGreenhouseQuestionAnswer,
  selectGreenhouseEducationTarget,
};
