'use strict';

const { sleep, DELAYS } = require('./utils');
const log = require('../logger')('auto-apply');
const {
  normalizeGreenhouseAnswer,
  selectGreenhouseEducationTarget,
  greenhouseEducationFieldIsPresent,
  greenhouseComboboxSnapshotIsEmpty,
} = require('./greenhouse-helpers');

const GREENHOUSE_SCHOOL_INPUT_SELECTOR = 'input[id*="school"], input[placeholder*="school" i], input[name*="school" i]';

async function fillGreenhouseCheckboxField(page, fieldName, answer) {
  const answers = Array.isArray(answer) ? answer : [answer];

  for (const rawAnswer of answers) {
    const desired = String(rawAnswer || '').trim().toLowerCase();
    const checkboxes = await page.$$(`input[name="${fieldName}"]`);
    for (const checkbox of checkboxes) {
      const text = await checkbox.evaluate(el => {
        const label = el.closest('label') || document.querySelector(`label[for="${el.id}"]`);
        return label ? label.innerText.trim().toLowerCase() : (el.value || '').toLowerCase();
      });
      if (text.includes(desired) || desired.includes(text)) {
        await checkbox.click();
        await checkbox.evaluate(el => el.dispatchEvent(new Event('change', { bubbles: true })));
        break;
      }
    }
  }

  return true;
}

async function fillGreenhouseChoiceField(page, fieldName, answer) {
  const choices = await page.$$(`input[name="${fieldName}"]`);
  const desired = String(answer || '').trim().toLowerCase();

  for (const choice of choices) {
    const labelText = await choice.evaluate((el) => {
      const label = el.closest('label') || document.querySelector(`label[for="${el.id}"]`);
      return label ? label.innerText.trim().toLowerCase() : (el.value || '').toLowerCase();
    });
    if (!labelText) continue;
    if (labelText.includes(desired) || desired.includes(labelText)) {
      await choice.click();
      return true;
    }
  }

  return false;
}

async function inspectGreenhouseEducationTarget(page) {
  const candidates = await page.evaluate((selector) => {
    function normalize(value) {
      return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function isVisible(node) {
      if (!node) return false;
      const style = window.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    function fieldLabel(node) {
      if (node.id) {
        const explicit = document.querySelector(`label[for="${node.id}"]`);
        if (explicit?.innerText) return normalize(explicit.innerText);
      }
      const wrappingLabel = node.closest('label');
      if (wrappingLabel?.innerText) return normalize(wrappingLabel.innerText);
      const group = node.closest('[class*="field"], [class*="form-group"], [role="group"], fieldset');
      const explicit = group?.querySelector('label, legend');
      return normalize(explicit?.innerText || node.getAttribute('aria-label') || node.getAttribute('placeholder') || '');
    }

    function comboboxGroup(node) {
      return node.closest('.select__control')
        || node.closest('[class*="select__control"]')
        || node.closest('.select-shell')
        || node.closest('[class*="select-shell"]')
        || node.closest('[class*="field"], [class*="form-group"], [role="group"], fieldset');
    }

    function educationRow(node) {
      return node.closest('[data-qa*="education" i]')
        || node.closest('[class*="education"]')
        || node.closest('[id*="education"]')
        || comboboxGroup(node)
        || node.parentElement;
    }

    function isRequired(node, label) {
      if (node.required) return true;
      if ((node.getAttribute('aria-required') || '').toLowerCase() === 'true') return true;
      const row = educationRow(node);
      return /[*]|\brequired\b/i.test(`${label} ${row?.innerText || ''}`);
    }

    const inputs = Array.from(document.querySelectorAll(selector));
    return inputs.map((input, domIndex) => {
      const label = fieldLabel(input);
      const row = educationRow(input);
      const group = comboboxGroup(input) || row;
      const renderedValue = normalize(group?.querySelector('[class*="single-value"]')?.innerText);
      const placeholder = normalize(group?.querySelector('[class*="placeholder"]')?.innerText);
      const rowIndexMatch = String(input.id || input.name || '').match(/--(\d+)/);
      return {
        domIndex,
        fieldName: input.id || input.name || null,
        inputId: input.id || null,
        inputName: input.name || null,
        label,
        visible: isVisible(input),
        required: isRequired(input, label),
        selectedValue: renderedValue || null,
        typedValue: normalize(input.value || '') || null,
        hasSingleValueNode: Boolean(renderedValue),
        placeholderText: placeholder || null,
        rowIndex: rowIndexMatch ? Number(rowIndexMatch[1]) : domIndex,
      };
    });
  }, GREENHOUSE_SCHOOL_INPUT_SELECTOR);

  const target = selectGreenhouseEducationTarget(candidates);
  return { candidates, target };
}

async function greenhouseFieldIsEmpty(page, fieldName) {
  return page.evaluate((targetFieldName) => {
    const escapedName = window.CSS && typeof window.CSS.escape === 'function'
      ? window.CSS.escape(targetFieldName)
      : targetFieldName;
    const target = document.getElementById(targetFieldName)
      || document.querySelector(`[name="${escapedName}"]`);
    if (!target) return false;

    const tag = target.tagName.toLowerCase();
    if (tag === 'select') return !(target.value || '').trim();

    const role = target.getAttribute('role') || '';
    const className = String(target.className || '');
    const looksLikeCombobox = role === 'combobox'
      || Boolean(target.getAttribute('aria-controls') || target.getAttribute('aria-owns'))
      || className.includes('select__input');
    if (!looksLikeCombobox) return !(target.value || '').trim();

    const group = target.closest('.select__control')
      || target.closest('[class*="select__control"]')
      || target.closest('.select-shell')
      || target.closest('[class*="select-shell"]')
      || target.closest('[class*="field"], [class*="form-group"], [role="group"]');
    const renderedValue = group?.querySelector('[class*="single-value"]');
    return !(renderedValue?.innerText || '').trim();
  }, fieldName);
}

async function chooseGreenhouseComboboxOption(page, fieldName, input, answer) {
  const desired = normalizeGreenhouseAnswer(answer);

  await input.click({ clickCount: 3 });
  await page.keyboard.press('Backspace').catch(() => {});
  await input.type(String(answer), { delay: 20 });
  await page.waitForFunction((target, desiredAnswer) => {
    function normalize(value) {
      return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    const listboxId = target?.getAttribute('aria-controls') || target?.getAttribute('aria-owns');
    const listbox = listboxId ? document.getElementById(listboxId) : null;
    if (!listbox) return false;
    return Array.from(listbox.querySelectorAll('[role="option"]'))
      .map((node) => normalize(node.innerText))
      .some((value) => value === desiredAnswer || value.includes(desiredAnswer) || desiredAnswer.includes(value));
  }, { timeout: 3000 }, input, desired).catch(() => null);

  const activeMatchesDesired = async () => page.evaluate((target, desiredAnswer) => {
    function normalize(value) {
      return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    if (!target) return false;

    const activeId = target.getAttribute('aria-activedescendant');
    const active = activeId ? document.getElementById(activeId) : null;
    const activeText = normalize(active?.innerText);
    return Boolean(
      activeText
      && (activeText === desiredAnswer || activeText.includes(desiredAnswer) || desiredAnswer.includes(activeText))
    );
  }, input, desired);

  for (let attempts = 0; attempts < 8; attempts += 1) {
    if (await activeMatchesDesired()) break;
    await page.keyboard.press('ArrowDown').catch(() => {});
    await sleep(DELAYS.KEY_PRESS);
  }

  if (await activeMatchesDesired()) {
    await page.keyboard.press('Enter').catch(() => {});
  }

  await page.keyboard.press('Tab').catch(() => {});
  await sleep(DELAYS.INPUT_SETTLE);

  const verifySelection = () => page.evaluate((target, desiredAnswer) => {
    function normalize(value) {
      return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    const group = target?.closest('.select__control')
      || target?.closest('[class*="select__control"]')
      || target?.closest('.select-shell')
      || target?.closest('[class*="select-shell"]')
      || target?.closest('[class*="field"], [class*="form-group"], [role="group"]');
    const renderedValue = normalize(group?.querySelector('[class*="single-value"]')?.innerText);
    return Boolean(
      renderedValue
      && (renderedValue === desiredAnswer
        || renderedValue.startsWith(desiredAnswer)
        || desiredAnswer.startsWith(renderedValue)
        || renderedValue.includes(desiredAnswer))
    );
  }, input, desired);

  if (await verifySelection()) {
    return true;
  }

  await input.click({ clickCount: 3 });
  await page.keyboard.press('Backspace').catch(() => {});
  await input.type(String(answer), { delay: 20 });
  await page.waitForFunction((target, desiredAnswer) => {
    function normalize(value) {
      return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    const listboxId = target?.getAttribute('aria-controls') || target?.getAttribute('aria-owns');
    const listbox = listboxId ? document.getElementById(listboxId) : null;
    if (!listbox) return false;
    return Array.from(listbox.querySelectorAll('[role="option"]'))
      .map((node) => normalize(node.innerText))
      .some((value) => value === desiredAnswer || value.includes(desiredAnswer) || desiredAnswer.includes(value));
  }, { timeout: 3000 }, input, desired).catch(() => null);

  const picked = await page.evaluate((target, desiredAnswer) => {
    function normalize(value) {
      return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    function isVisible(node) {
      if (!node) return false;
      const style = window.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    function collectOptions(root, acc) {
      if (!root) return;
      for (const selector of [
        '[role="option"]',
        '[id*="option"]',
        '[class*="option"]:not([class*="container"])',
        'li[class*="select"]',
        '[class*="dropdown"] li',
        '[class*="listbox"] li',
      ]) {
        for (const item of root.querySelectorAll(selector)) {
          acc.add(item);
        }
      }
    }

    if (!target) return null;

    const optionNodes = new Set();
    const listboxIds = [...new Set([
      target.getAttribute('aria-controls'),
      target.getAttribute('aria-owns'),
    ].filter(Boolean))];
    for (const id of listboxIds) {
      collectOptions(document.getElementById(id), optionNodes);
    }

    const group = target.closest('.select__control')
      || target.closest('[class*="select__control"]')
      || target.closest('.select-shell')
      || target.closest('[class*="select-shell"]')
      || target.closest('[class*="field"], [class*="form-group"], [role="group"]');
    collectOptions(group, optionNodes);

    const visibleOptions = Array.from(optionNodes)
      .filter(isVisible)
      .map((node) => ({ node, text: normalize(node.innerText) }))
      .filter((entry) => entry.text);

    const exact = visibleOptions.find((entry) => entry.text === desiredAnswer);
    const prefix = visibleOptions.find((entry) => entry.text.startsWith(desiredAnswer) || desiredAnswer.startsWith(entry.text));
    const contains = visibleOptions.find((entry) => entry.text.includes(desiredAnswer) || desiredAnswer.includes(entry.text));
    const match = exact || prefix || contains;
    if (!match) return null;

    match.node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    match.node.click();
    return match.text;
  }, input, desired);

  if (!picked) {
    await page.keyboard.press('ArrowDown').catch(() => {});
    await sleep(DELAYS.KEY_CONFIRM);
    await page.keyboard.press('Enter').catch(() => {});
  }

  await page.keyboard.press('Tab').catch(() => {});
  await sleep(DELAYS.INPUT_SETTLE);

  return verifySelection();
}

async function greenhouseFieldHasText(page, selector) {
  return page.evaluate((targetSelector) => {
    const node = document.querySelector(targetSelector);
    return Boolean(node && (node.value || '').trim());
  }, selector);
}

async function greenhouseRequiredQuestionIsEmpty(page, field) {
  if (!field?.required) return false;

  if (field.name.endsWith('[]')) {
    return page.evaluate((fieldName) => {
      const checkboxes = Array.from(document.querySelectorAll(`input[name="${fieldName}"]`));
      return !checkboxes.some((checkbox) => checkbox.checked);
    }, field.name);
  }

  return greenhouseFieldIsEmpty(page, field.name);
}

async function collectGreenhouseMissingFields(page, applicant, questions = []) {
  const missing = [];
  let schoolTarget = null;

  if (!await greenhouseFieldHasText(page, '#first_name')) missing.push('First Name*');
  if (!await greenhouseFieldHasText(page, '#last_name')) missing.push('Last Name*');
  if (!await greenhouseFieldHasText(page, '#email')) missing.push('Email*');
  if (!await greenhouseFieldHasText(page, '#phone')) missing.push('Phone*');
  if (applicant.school) {
    const schoolReview = await inspectGreenhouseEducationTarget(page);
    schoolTarget = schoolReview.target;
    if (greenhouseEducationFieldIsPresent(schoolReview) && (!schoolTarget || greenhouseComboboxSnapshotIsEmpty(schoolTarget))) {
      missing.push(schoolTarget?.label || 'School*');
    }
  }

  for (const question of questions) {
    for (const field of (question.fields || [])) {
      if (await greenhouseRequiredQuestionIsEmpty(page, field)) {
        missing.push(question.label || field.name);
        break;
      }
    }
  }

  return { missing: [...new Set(missing)], schoolTarget };
}

async function fillGreenhouseField(page, fieldName, answer) {
  if (fieldName.endsWith('[]')) {
    return fillGreenhouseCheckboxField(page, fieldName, answer);
  }

  const safeFieldName = String(fieldName).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  let el = await page.$(`[id="${safeFieldName}"]`);
  if (!el) {
    el = await page.$(`[name="${safeFieldName}"]`);
  }
  if (!el) {
    const choiceFilled = await fillGreenhouseChoiceField(page, safeFieldName, answer);
    if (choiceFilled) return true;
  }
  if (!el) return false;

  const tag = await el.evaluate(node => node.tagName.toLowerCase());
  const type = await el.evaluate(node => (node.type || '').toLowerCase());
  const role = await el.evaluate(node => node.getAttribute('role') || '');
  const className = await el.evaluate(node => String(node.className || ''));
  const isCombobox = role === 'combobox'
    || Boolean(await el.evaluate(node => node.getAttribute('aria-controls') || node.getAttribute('aria-owns')))
    || className.includes('select__input');

  if (tag === 'textarea') {
    await el.click({ clickCount: 3 });
    await el.type(String(answer), { delay: 20 });
    return true;
  }

  if (tag === 'select') {
    const selected = await el.evaluate((node, desiredAnswer) => {
      const desired = String(desiredAnswer || '').trim().toLowerCase();
      const option = Array.from(node.options).find((candidate) => {
        const text = candidate.textContent.trim().toLowerCase();
        return text === desired || text.includes(desired) || desired.includes(text);
      });
      if (!option) return false;
      node.value = option.value;
      node.dispatchEvent(new Event('input', { bubbles: true }));
      node.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }, String(answer));
    return selected;
  }

  if (tag === 'input' && type === 'text') {
    if (isCombobox) {
      return chooseGreenhouseComboboxOption(page, safeFieldName, el, answer);
    }
    await el.click({ clickCount: 3 });
    await el.type(String(answer), { delay: 20 });
    return true;
  }

  if (tag === 'input' && type === 'checkbox') {
    const shouldCheck = ['true', 'yes', '1', 'checked', 'agree', 'i agree'].includes(String(answer).trim().toLowerCase());
    if (!shouldCheck) return true;
    const isChecked = await el.evaluate(node => node.checked);
    if (!isChecked) await el.click();
    return true;
  }

  return false;
}

async function typeInto(page, selector, value) {
  const el = await page.$(selector);
  if (!el) { log.warn('Field not found', { selector }); return false; }
  await el.click({ clickCount: 3 });
  await el.type(value, { delay: 30 });
  return true;
}

module.exports = {
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
};
