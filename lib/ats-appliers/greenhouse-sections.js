'use strict';

const { sleep, DELAYS } = require('./utils');
const log = require('../logger')('auto-apply');
const {
  GREENHOUSE_SCHOOL_INPUT_SELECTOR,
  inspectGreenhouseEducationTarget,
  chooseGreenhouseComboboxOption,
} = require('./greenhouse-fields');

async function fillGreenhouseEEO(page, applicant) {
  const fieldMap = [
    { labelKeys: ['gender identity'],    optKey: applicant.eeoGenderIdentity || 'decline to answer' },
    { labelKeys: ['gender'],             optKey: applicant.eeoGender || 'decline to self-identify' },
    { labelKeys: ['pronoun'],            optKey: applicant.eeoPronouns || 'decline to answer' },
    { labelKeys: ['sexual orientation'], optKey: applicant.eeoOrientation || 'decline to answer' },
    { labelKeys: ['hispanic', 'latino'], optKey: applicant.eeoHispanic || 'decline to answer' },
    { labelKeys: ['race', 'ethnicity'],  optKey: applicant.eeoRace || 'decline to answer' },
    { labelKeys: ['veteran'],            optKey: applicant.eeoVeteran || 'decline to answer' },
    { labelKeys: ['disability'],         optKey: applicant.eeoDisability || "don't wish to answer" },
  ];

  const selects = await page.$$('select');
  for (const sel of selects) {
    const labelText = await sel.evaluate((el) => {
      const label = document.querySelector(`label[for="${el.id}"]`) || el.closest('label');
      return label ? label.innerText.toLowerCase() : '';
    });
    if (!labelText) continue;

    const rule = fieldMap.find(entry => entry.labelKeys.some(key => labelText.includes(key)));
    if (!rule) continue;

    await sel.evaluate((el, optKey) => {
      const match = Array.from(el.options).find(option => option.text.toLowerCase().includes(optKey.toLowerCase()));
      if (!match) return false;
      el.value = match.value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }, rule.optKey);
  }
}

async function fillGreenhouseEducation(page, applicant) {
  if (!applicant.school) return null;

  let schoolReview = await inspectGreenhouseEducationTarget(page);
  if (!schoolReview.target) {
    const addBtn = await page.$('button[aria-label*="education" i], button[data-action*="education" i]');
    if (addBtn) {
      await addBtn.click();
      await sleep(DELAYS.DOM_UPDATE);
      schoolReview = await inspectGreenhouseEducationTarget(page);
    }
  }

  const target = schoolReview.target;
  if (!target) {
    log.warn('Greenhouse education target not found', { company: applicant.currentCompany || null });
    return { targetBefore: null, targetAfterFill: null, filledSchool: false };
  }

  const schoolInputs = await page.$$(GREENHOUSE_SCHOOL_INPUT_SELECTOR);
  const schoolInput = schoolInputs[target.domIndex];
  if (!schoolInput) {
    return { targetBefore: target, targetAfterFill: null, filledSchool: false };
  }

  const selected = await chooseGreenhouseComboboxOption(page, target.fieldName, schoolInput, applicant.school);
  await sleep(DELAYS.INPUT_SETTLE);

  const rowHandle = await schoolInput.evaluateHandle((input) => (
    input.closest('[data-qa*="education" i]')
      || input.closest('[class*="education"]')
      || input.closest('[id*="education"]')
      || input.closest('[class*="field"], [class*="form-group"], [role="group"], fieldset')
      || input.parentElement
  ));
  const row = rowHandle.asElement();
  const scopedRoot = row || page;

  const degreeSelect = await scopedRoot.$('select[id*="degree"], select[name*="degree"]');
  if (degreeSelect) {
    await degreeSelect.evaluate((sel) => {
      const option = Array.from(sel.options).find((candidate) => candidate.textContent.toLowerCase().includes('bachelor'));
      if (!option) return false;
      sel.value = option.value;
      sel.dispatchEvent(new Event('input', { bubbles: true }));
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }).catch(() => false);
  }

  const disciplineInput = await scopedRoot.$('input[id*="discipline"], input[name*="discipline"], input[placeholder*="field of study" i]');
  if (disciplineInput && applicant.fieldOfStudy) {
    await disciplineInput.click({ clickCount: 3 });
    await disciplineInput.type(applicant.fieldOfStudy, { delay: 30 });
  }

  const yearInput = await scopedRoot.$('input[id*="grad"], input[name*="grad"], select[id*="grad"]');
  if (yearInput && applicant.gradYear) {
    const tag = await yearInput.evaluate((el) => el.tagName.toLowerCase());
    if (tag === 'select') await yearInput.select(String(applicant.gradYear)).catch(() => {});
    else {
      await yearInput.click({ clickCount: 3 });
      await yearInput.type(String(applicant.gradYear), { delay: 30 });
    }
  }

  const afterFillReview = await inspectGreenhouseEducationTarget(page);
  const afterFillTarget = afterFillReview.target;
  log.info('Greenhouse education fill review', {
    targetFieldName: target.fieldName,
    targetLabel: target.label,
    rowIndex: target.rowIndex,
    required: target.required,
    selectedBefore: target.selectedValue || null,
    selectedAfter: afterFillTarget?.selectedValue || null,
    hasSingleValueNode: Boolean(afterFillTarget?.hasSingleValueNode),
    filledSchool: selected,
  });

  if (row) await row.dispose().catch(() => {});
  await rowHandle.dispose().catch(() => {});
  return {
    targetBefore: target,
    targetAfterFill: afterFillTarget,
    filledSchool: selected,
  };
}

module.exports = {
  fillGreenhouseEEO,
  fillGreenhouseEducation,
};
