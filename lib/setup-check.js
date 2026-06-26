'use strict';

const fs   = require('fs');
const path = require('path');

const WIZARD_HINT = '  Open a Claude Code session and run /setup — Claude will ask the questions and write the files.\n  Or run the standalone wizard: node scripts/setup-wizard.js\n';

/**
 * Returns true if the data directory has the minimum required files and they
 * have been customized from the blank example templates.
 *
 * Returns false and prints actionable instructions when setup is incomplete.
 */
function checkSetup(repoRoot) {
  const dataDir = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(repoRoot, 'data');

  const required = [
    { file: path.join(dataDir, 'companies.js'), label: 'data/companies.js' },
    { file: path.join(dataDir, 'context.md'),   label: 'data/context.md'   },
    { file: path.join(dataDir, 'resume.md'),     label: 'data/resume.md'    },
  ];

  const missing = required.filter((r) => !fs.existsSync(r.file));
  if (missing.length > 0) {
    console.error('\nSetup required — missing profile files:');
    for (const r of missing) console.error(`  ${r.label}`);
    console.error('');
    console.error(WIZARD_HINT);
    return false;
  }

  // Detect unconfigured context.md (still the blank template)
  try {
    const ctx = fs.readFileSync(path.join(dataDir, 'context.md'), 'utf8').trim();
    if (ctx === '' || ctx.startsWith('# [Your Name]')) {
      console.error('\nSetup required — data/context.md has not been filled in.');
      console.error('');
      console.error(WIZARD_HINT);
      return false;
    }
  } catch { /* file unreadable — missing check above covers this */ }

  // Detect unconfigured resume.md
  try {
    const resume = fs.readFileSync(path.join(dataDir, 'resume.md'), 'utf8').trim();
    if (resume === '' || resume.startsWith('# [Your Name]')) {
      console.error('\nSetup required — data/resume.md has not been filled in.');
      console.error('');
      console.error(WIZARD_HINT);
      return false;
    }
  } catch {}

  return true;
}

module.exports = { checkSetup };
