#!/usr/bin/env node
'use strict';

/**
 * Interactive first-run wizard that creates the data/ directory and
 * populates the minimum required profile files:
 *
 *   data/context.md       — target roles, stack, compensation, deal breakers
 *   data/resume.md        — plain-text resume template (fill in after)
 *   data/companies.js     — ATS company lists (pre-seeded with search terms)
 *   data/jobspy-config.json — location and search config for Indeed/LinkedIn
 *   data/career-detail.md — deeper notes for outreach and interview prep
 *
 * Usage: node scripts/setup-wizard.js
 */

const fs       = require('fs');
const path     = require('path');
const readline = require('readline');

const { loadDashboardEnv } = require('../lib/env');

const repoRoot  = path.resolve(__dirname, '..');
loadDashboardEnv(repoRoot);

const dataDir   = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(repoRoot, 'data');
const exampleDir = path.join(repoRoot, 'data.example');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ask(rl, prompt, defaultVal = '') {
  return new Promise((resolve) => {
    const suffix = defaultVal ? ` [${defaultVal}]` : '';
    rl.question(`  ${prompt}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultVal);
    });
  });
}

function askList(rl, prompt, hint = 'comma-separated') {
  return new Promise((resolve) => {
    rl.question(`  ${prompt} (${hint}):\n  > `, (answer) => {
      resolve(answer.split(',').map((s) => s.trim()).filter(Boolean));
    });
  });
}

function writeIfMissing(filePath, content, label) {
  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, 'utf8').trim();
    if (existing && !existing.startsWith('# [Your Name]') && !existing.includes('"software engineer"')) {
      console.log(`  (skipped ${path.relative(repoRoot, filePath)} — already customized)`);
      return false;
    }
  }
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`  Wrote ${label}`);
  return true;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Ensure data/ exists
  if (!fs.existsSync(dataDir)) {
    if (fs.existsSync(exampleDir)) {
      fs.cpSync(exampleDir, dataDir, { recursive: true });
      console.log(`\nCreated data/ from data.example/`);
    } else {
      fs.mkdirSync(dataDir, { recursive: true });
      console.log(`\nCreated data/`);
    }
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log(`
==================================================
  Job Search Pipeline — First-Run Setup
==================================================
Answer a few questions to build your profile.
Press Enter to accept the default shown in [brackets].
`);

  // -- Identity ---------------------------------------------------------------
  console.log('--- About you ---\n');
  const name     = await ask(rl, 'Full name');
  const email    = await ask(rl, 'Email');
  const phone    = await ask(rl, 'Phone (optional)', '');
  const linkedin = await ask(rl, 'LinkedIn URL or handle (optional)', '');
  const github   = await ask(rl, 'GitHub handle (optional)', '');

  // -- Location ---------------------------------------------------------------
  console.log('\n--- Location ---\n');
  const homeCity      = await ask(rl, 'Home city / base location', 'Chicago, IL');
  const relocateCities = await ask(rl,
    'Cities you\'d relocate to (empty = home city only)', '');
  const remoteAnswer  = await ask(rl, 'Open to remote-only roles? (yes/no)', 'yes');
  const remoteOk      = remoteAnswer.toLowerCase().startsWith('y');

  // -- Career ----------------------------------------------------------------
  console.log('\n--- Career ---\n');
  const currentRole  = await ask(rl, 'Current role or status',
    'e.g. "AI Intern at Acme" or "Junior, State U"');
  const targetTitles = await askList(rl, 'Target job titles',
    'e.g. AI Engineer, ML Researcher, AI Consultant');
  const stack        = await askList(rl, 'Tech stack you know well',
    'e.g. Python, React, PostgreSQL, LangChain');
  const comp         = await ask(rl, 'Compensation expectation (optional)',
    'e.g. $120k-180k or "market"');
  const dealBreakers = await ask(rl,
    'Deal breakers (optional)', 'e.g. no staffing agencies, no 100% travel');

  // -- ATS companies ---------------------------------------------------------
  console.log('\n--- Target companies (optional — leave blank to configure later) ---\n');
  const ghSlugs  = await askList(rl, 'Greenhouse slugs (boards.greenhouse.io/<slug>)', 'e.g. anthropic, stripe');
  const ashbySlugs = await askList(rl, 'Ashby slugs (jobs.ashbyhq.com/<slug>)', 'e.g. openai, modal');
  const leverSlugs = await askList(rl, 'Lever slugs (jobs.lever.co/<slug>)', 'e.g. mistral, netflix');

  rl.close();

  // ---------------------------------------------------------------------------
  // Build derived values
  // ---------------------------------------------------------------------------

  const searchTerms = targetTitles.length > 0 ? targetTitles : ['software engineer'];

  const allLocations = [homeCity];
  if (relocateCities) {
    for (const loc of relocateCities.split(',').map((s) => s.trim()).filter(Boolean)) {
      if (!allLocations.includes(loc)) allLocations.push(loc);
    }
  }

  // ---------------------------------------------------------------------------
  // Write data/context.md
  // ---------------------------------------------------------------------------

  const contextLines = [
    `# ${name} — Working Context`,
    '',
    '## What I\'m looking for',
    '',
    ...(targetTitles.length ? targetTitles.map((t) => `- ${t}`) : ['- (fill in target titles)']),
    '',
    '## Target titles',
    '',
    targetTitles.join(', ') || '(fill in)',
    '',
    '## Stack I\'m most productive in',
    '',
    stack.join(', ') || '(fill in)',
    '',
    '## Compensation',
    '',
    comp || '(fill in)',
    '',
    '## Location',
    '',
    `Primary: ${homeCity}`,
    relocateCities ? `Open to relocation: ${relocateCities}` : '',
    `Remote: ${remoteOk ? 'Yes' : 'No'}`,
    '',
    '## Deal breakers',
    '',
    dealBreakers || '(fill in)',
    '',
    '## What I bring',
    '',
    currentRole && !currentRole.startsWith('e.g.') ? `Current: ${currentRole}` : '(fill in)',
    '',
    '## Open questions I ask interviewers',
    '',
    '- (fill in)',
    '',
  ].filter((l) => l !== undefined);

  writeIfMissing(
    path.join(dataDir, 'context.md'),
    contextLines.join('\n'),
    'data/context.md'
  );

  // ---------------------------------------------------------------------------
  // Write data/resume.md
  // ---------------------------------------------------------------------------

  const headerParts = [email, phone].filter(Boolean);
  if (linkedin) headerParts.push(linkedin);
  if (github) headerParts.push(`github.com/${github.replace(/^github\.com\//, '')}`);

  const resumeLines = [
    `# ${name}`,
    '',
    `${homeCity} | ${headerParts.join(' | ')}`,
    '',
    '---',
    '',
    '## Summary',
    '',
    '(Fill in — 2-3 sentences on who you are and what you do)',
    '',
    '## Skills',
    '',
    stack.length ? stack.join(', ') : '(fill in)',
    '',
    '## Experience',
    '',
    `### ${!currentRole.startsWith('e.g.') ? currentRole : '[Company] — [Title]'}`,
    '**[Start] – [End], [Location]**',
    '',
    '- (fill in accomplishments)',
    '',
    '## Education',
    '',
    '**[Degree]**, [University], [Expected Graduation]',
    '',
    '- (fill in relevant coursework or activities)',
    '',
  ];

  writeIfMissing(
    path.join(dataDir, 'resume.md'),
    resumeLines.join('\n'),
    'data/resume.md'
  );

  // ---------------------------------------------------------------------------
  // Write data/companies.js
  // ---------------------------------------------------------------------------

  const fmt = (arr) => arr.length
    ? arr.map((s) => `  '${s}',`).join('\n')
    : '  // (add slugs here)';

  const companiesJs = `'use strict';

// Target company list — add company slugs for each ATS platform.
// The scraper fetches job boards for every slug and filters by SEARCH_TERMS.
//
// Find slugs in the public job-board URL:
//   Greenhouse: boards.greenhouse.io/<slug>
//   Lever:      jobs.lever.co/<slug>
//   Ashby:      jobs.ashbyhq.com/<slug>
//   Workable:   apply.workable.com/<slug>
//
// discover-companies.js will automatically suggest and add more companies
// based on SEARCH_TERMS when you run the pipeline.

const MAX_AGE_DAYS = 30;

const SEARCH_TERMS = [
${searchTerms.map((t) => `  '${t}',`).join('\n')}
];

// Greenhouse boards: https://boards.greenhouse.io/<slug>
const GREENHOUSE_COMPANIES = [
${fmt(ghSlugs)}
];

// Lever boards: https://jobs.lever.co/<slug>
const LEVER_COMPANIES = [
${fmt(leverSlugs)}
];

// Workable boards: https://apply.workable.com/<slug>
const WORKABLE_COMPANIES = [
  // e.g. 'huggingface'
];

// Ashby boards: https://jobs.ashbyhq.com/<slug>
const ASHBY_COMPANIES = [
${fmt(ashbySlugs)}
];

// Workday boards — shape: { sub, wd, board, label }
// Use scripts/validate-slugs.js to verify these.
const WORKDAY_COMPANIES = [];

// Wellfound (AngelList) — role slugs, not company slugs
const WELLFOUND_ROLES = [
  // e.g. 'backend-engineer', 'machine-learning-engineer'
];

// Rippling-hosted public boards
const RIPPLING_COMPANIES = [];

module.exports = {
  MAX_AGE_DAYS,
  SEARCH_TERMS,
  GREENHOUSE_COMPANIES,
  LEVER_COMPANIES,
  WORKABLE_COMPANIES,
  ASHBY_COMPANIES,
  WORKDAY_COMPANIES,
  WELLFOUND_ROLES,
  RIPPLING_COMPANIES,
};
`;

  writeIfMissing(
    path.join(dataDir, 'companies.js'),
    companiesJs,
    'data/companies.js'
  );

  // ---------------------------------------------------------------------------
  // Write data/jobspy-config.json
  // ---------------------------------------------------------------------------

  const jobspyConfig = {
    search_term: searchTerms,
    location: allLocations.length === 1 ? allLocations[0] : allLocations,
    site_name: ['indeed', 'linkedin', 'glassdoor', 'zip_recruiter'],
    results_wanted: 25,
    hours_old: 168,
    country_indeed: 'USA',
    linkedin_fetch_description: true,
    request_delay_ms: 3000,
  };

  writeIfMissing(
    path.join(dataDir, 'jobspy-config.json'),
    JSON.stringify(jobspyConfig, null, 2) + '\n',
    'data/jobspy-config.json'
  );

  // ---------------------------------------------------------------------------
  // Write data/career-detail.md (blank template if missing)
  // ---------------------------------------------------------------------------

  const careerDetailPath = path.join(dataDir, 'career-detail.md');
  if (!fs.existsSync(careerDetailPath)) {
    fs.writeFileSync(careerDetailPath, [
      `# ${name} — Career Detail`,
      '',
      'Supplements resume.md with behind-the-scenes detail for outreach,',
      'application answers, and interview prep.',
      '',
      `## ${!currentRole.startsWith('e.g.') ? currentRole : '[Company] — [Title]'}`,
      '',
      '### How I got the role',
      '',
      '(Fill in)',
      '',
      '### What I built',
      '',
      '(Fill in — describe the problem domain and general approach)',
      '',
      '### Differentiator',
      '',
      '(Fill in — what makes this experience unique vs. other candidates?)',
      '',
    ].join('\n'), 'utf8');
    console.log('  Wrote data/career-detail.md');
  }

  // ---------------------------------------------------------------------------
  // Done
  // ---------------------------------------------------------------------------

  console.log(`
==================================================
  Setup complete!
==================================================

Your profile is in data/. A few things to finish:

  1. data/resume.md     — add your full work history and education
  2. data/context.md    — refine deal breakers and what you bring
  3. data/companies.js  — add more company slugs for ATS tracking
  4. data/career-detail.md — notes for interview prep and outreach

Create a .env file (copy .env.example) and set any API keys you have:
  cp .env.example .env

Then run the full pipeline:
  node scripts/refresh.js
`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`\nSetup failed: ${err.message}`);
    process.exit(1);
  });
}
