const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const repoRoot = path.join(__dirname, '..');

test('Codex app-questions skill keeps the voice-check gate from the Claude command', () => {
  const claudeCommand = fs.readFileSync(path.join(repoRoot, '.claude/commands/app-questions.md'), 'utf8');
  const codexSkill = fs.readFileSync(path.join(repoRoot, '.codex/skills/app-questions/skill.md'), 'utf8');

  const requiredPhrases = [
    '## Step 4: Voice-check all answers',
    'node scripts/check-voice.js "ANSWER_TEXT"',
    'If Sapling score >= 50% AI',
    'If HuggingFace score >= 30% AI',
    'Include voice check results',
  ];

  for (const phrase of requiredPhrases) {
    assert.match(claudeCommand, new RegExp(escapeRegExp(phrase)));
    assert.match(codexSkill, new RegExp(escapeRegExp(phrase)));
  }
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
