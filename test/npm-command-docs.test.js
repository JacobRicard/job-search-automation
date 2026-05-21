'use strict';

const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { filterCommandGroups, flattenCommands, getCommandGroups } = require('../lib/npm-command-docs');
const { formatCommandHelp } = require('../scripts/npm-help');

const repoRoot = path.join(__dirname, '..');

function parseNpmJson(output) {
  const start = output.indexOf('{');
  assert.notEqual(start, -1, 'npm output should contain JSON');
  return JSON.parse(output.slice(start));
}

describe('npm command docs', () => {
  it('catalogs core commands with descriptions and use cases', () => {
    const groups = getCommandGroups();
    const commands = flattenCommands(groups);

    assert.deepEqual(groups.map((group) => group.id), [
      'daily',
      'dashboard',
      'scraping-scoring',
      'resume',
      'maintenance',
    ]);

    for (const command of [
      'npm run daily',
      'npm run refresh',
      'npm start',
      'npm run scrape',
      'npm run pipeline',
      'npm run resume',
      'npm run sync-rejections',
      'npm test',
    ]) {
      const doc = commands.find((item) => item.command === command);
      assert.ok(doc, `missing ${command}`);
      assert.ok(doc.description.length > 10, `${command} should have a description`);
      assert.ok(doc.when.length > 10, `${command} should have a use case`);
    }
  });

  it('formats text help with commands, descriptions, and flags', () => {
    const output = formatCommandHelp(getCommandGroups());

    assert.match(output, /NPM Commands/);
    assert.match(output, /npm run daily/);
    assert.match(output, /Runs the same full active-profile refresh as npm run refresh/);
    assert.match(output, /npm run resume/);
    assert.match(output, /--limit=<n>/);
  });

  it('filters by group or search text', () => {
    const resumeGroups = filterCommandGroups('resume');
    assert.deepEqual(resumeGroups.map((group) => group.id), ['resume']);
    assert.ok(flattenCommands(resumeGroups).some((item) => item.command === 'npm run resume'));

    const syncGroups = filterCommandGroups('sync-rejections');
    const syncCommands = flattenCommands(syncGroups);
    assert.deepEqual(syncGroups.map((group) => group.id), ['maintenance']);
    assert.deepEqual(syncCommands.map((item) => item.command), ['npm run sync-rejections']);
  });

  it('emits valid JSON through npm run help -- --json', () => {
    const output = execFileSync('npm', ['run', 'help', '--', '--json'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    const payload = parseNpmJson(output);

    assert.equal(payload.filter, '');
    assert.ok(payload.groups.some((group) => group.id === 'daily'));
    assert.ok(flattenCommands(payload.groups).some((item) => item.command === 'npm run refresh'));
  });
});
