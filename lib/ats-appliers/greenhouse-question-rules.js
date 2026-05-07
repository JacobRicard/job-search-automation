'use strict';

// Pattern-matched answers for common Greenhouse application questions.
// Identity fields (linkedin, github, location) are filled from the applicant config.
const SIMPLE_GREENHOUSE_QUESTION_RULES = [
  { pattern: /u\.s\. work authorization/i, answer: (applicant) => applicant.usWorkAuthorized || 'Yes' },
  { pattern: /authorized to work|legally authorized|work authorization/i, answer: (applicant) => applicant.usWorkAuthorized || 'Yes' },
  { pattern: /visa sponsorship|require sponsorship/i, answer: (applicant) => applicant.requiresSponsorship || 'No' },
  { pattern: /pending or future government filing|dependent on a pending or future government|support any immigration or employment authorization/i, answer: (applicant) => applicant.requiresSponsorship || 'No' },
  { pattern: /u\.s\. citizens are eligible|u\.s\. citizen|only u\.s\. citizens/i, answer: (applicant) => applicant.usCitizen || null },
  { pattern: /country/i, answer: (applicant) => applicant.country || 'United States' },
  { pattern: /current location|location/i, answer: (applicant) => applicant.location || applicant.country || 'United States' },
  { pattern: /reside in the united states|currently reside in the united states|do you currently reside in the united states/i, answer: (applicant) => applicant.residesInUs || 'Yes' },
  { pattern: /greater seattle area|seattle area/i, answer: (applicant) => /seattle/i.test(applicant.location || '') ? 'Yes' : 'No' },
  { pattern: /linkedin/i, answer: (applicant) => applicant.linkedin || null },
  { pattern: /github/i, answer: (applicant) => applicant.github || null },
  { pattern: /portfolio|website/i, answer: (applicant) => applicant.github || applicant.linkedin || null },
  { pattern: /current company|current employer|company/i, answer: (applicant) => applicant.currentCompany || null },
  { pattern: /how did you hear/i, answer: (applicant) => applicant.heardAbout || 'LinkedIn' },
  { pattern: /background check/i, answer: (applicant) => applicant.backgroundCheckConsent || 'Yes' },
  { pattern: /experience.*aws|aws cloud infrastructure/i, answer: (applicant) => applicant.awsExperience || 'Yes' },
  { pattern: /experience.*kubernetes|working with kubernetes/i, answer: (applicant) => applicant.kubernetesExperience || 'Yes' },
  { pattern: /clearance eligibility|security clearance/i, answer: (applicant) => applicant.clearanceEligible || 'No' },
  { pattern: /what clearance level have you held/i, answer: (applicant) => applicant.previousClearance || 'None' },
  { pattern: /export controls/i, answer: (applicant) => applicant.exportControlsEligible || applicant.usWorkAuthorized || 'Yes' },
  { pattern: /history with .*|ever been employed by/i, answer: (applicant) => applicant.workedAtEmployerBefore || 'No' },
  { pattern: /conflict of interest/i, answer: (applicant) => applicant.hasConflictOfInterest || 'No' },
];

function answerForGreenhouseQuestion(label, applicant) {
  const text = String(label || '').trim();
  const rule = SIMPLE_GREENHOUSE_QUESTION_RULES.find(({ pattern }) => pattern.test(text));
  if (!rule) return null;
  return typeof rule.answer === 'function' ? rule.answer(applicant) : rule.answer;
}

function resolveGreenhouseQuestionAnswer(label, applicant, draftedAnswers, fieldName) {
  if (fieldName && draftedAnswers && Object.prototype.hasOwnProperty.call(draftedAnswers, fieldName)) {
    return draftedAnswers[fieldName];
  }
  return answerForGreenhouseQuestion(label, applicant);
}

module.exports = {
  SIMPLE_GREENHOUSE_QUESTION_RULES,
  answerForGreenhouseQuestion,
  resolveGreenhouseQuestionAnswer,
};
