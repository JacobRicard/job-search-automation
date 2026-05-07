'use strict';

const path = require('path');
const { baseDir } = require('../../config/paths');
const { AI_TITLE_KW, AI_DESC_KW } = require('../../config/constants');

function pickResume(job) {
  const isAi = AI_TITLE_KW.test(job.title || '') || AI_DESC_KW.test((job.description || '').slice(0, 1500));
  return path.join(baseDir, isAi ? 'resume-ai.pdf' : 'resume.pdf');
}

module.exports = { pickResume };
