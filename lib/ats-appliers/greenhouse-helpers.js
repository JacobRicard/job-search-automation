'use strict';

function normalizeGreenhouseAnswer(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function greenhouseSelectionMatches(selectedValue, desiredAnswer) {
  const selected = normalizeGreenhouseAnswer(selectedValue);
  const desired = normalizeGreenhouseAnswer(desiredAnswer);
  if (!selected || !desired) return false;
  return selected === desired
    || selected.startsWith(desired)
    || desired.startsWith(selected)
    || selected.includes(desired)
    || desired.includes(selected);
}

function greenhouseComboboxSnapshotIsEmpty(snapshot = {}) {
  if (!snapshot || typeof snapshot !== 'object') return true;
  return !normalizeGreenhouseAnswer(snapshot.selectedValue);
}

function greenhouseEducationFieldIsPresent(review = {}) {
  return Array.isArray(review?.candidates) && review.candidates.length > 0;
}

function selectGreenhouseEducationTarget(candidates = []) {
  if (!Array.isArray(candidates) || !candidates.length) return null;

  const pools = [
    candidates.filter((candidate) => candidate.visible && candidate.required),
    candidates.filter((candidate) => candidate.visible),
    candidates,
  ];

  for (const pool of pools) {
    if (!pool.length) continue;
    return [...pool].sort((left, right) => {
      if (Number(left.rowIndex) !== Number(right.rowIndex)) {
        return Number(left.rowIndex) - Number(right.rowIndex);
      }
      return Number(left.domIndex) - Number(right.domIndex);
    })[0];
  }

  return null;
}

function buildGreenhouseTextSnippet(value, limit = 220) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length <= limit ? text : `${text.slice(0, limit - 3)}...`;
}

function classifyGreenhouseSubmitOutcome(snapshot = {}) {
  const pageText = String(snapshot.pageText || '');
  const pageUrl = snapshot.pageUrl || null;
  const pageTitle = snapshot.pageTitle || null;
  const invalidFields = Array.isArray(snapshot.invalidFields)
    ? snapshot.invalidFields.filter(Boolean)
    : [];
  const details = {
    pageUrl,
    pageTitle,
    textSnippet: buildGreenhouseTextSnippet(snapshot.textSnippet || pageText),
    invalidFields,
    stillOnForm: Boolean(snapshot.stillOnForm),
  };

  if (details.stillOnForm && invalidFields.length) return { outcome: 'validation-failure', details };
  if (snapshot.isAbuseWarning) return { outcome: 'abuse-warning', details };
  if (snapshot.isDuplicate) return { outcome: 'duplicate', details };
  if (snapshot.isSuccess) return { outcome: 'success', details };
  return { outcome: 'confirmation-missing', details };
}

module.exports = {
  normalizeGreenhouseAnswer,
  greenhouseSelectionMatches,
  greenhouseComboboxSnapshotIsEmpty,
  greenhouseEducationFieldIsPresent,
  selectGreenhouseEducationTarget,
  buildGreenhouseTextSnippet,
  classifyGreenhouseSubmitOutcome,
};
