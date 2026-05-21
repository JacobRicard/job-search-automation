'use strict';

const COMMAND_GROUPS = [
  {
    id: 'daily',
    title: 'Daily workflow',
    description: 'Normal refresh commands for keeping the active profile up to date.',
    commands: [
      {
        command: 'npm run daily',
        description: 'Runs the same full active-profile refresh as npm run refresh.',
        when: 'Use this for scheduled refreshes that should share the same Node orchestration path as manual refreshes.',
        flags: [
          '--skip-discover',
          '--skip-descriptions',
          '--skip-closed-check',
          '--skip-market-research',
          '--skip-rejection-sync',
          '--skip-slug-check',
        ],
      },
      {
        command: 'npm run refresh',
        description: 'Runs the full active-profile refresh flow.',
        when: 'Use this when you want the current profile refreshed manually with the same flow cron uses.',
        flags: [
          '--skip-discover',
          '--skip-descriptions',
          '--skip-closed-check',
          '--skip-market-research',
          '--skip-rejection-sync',
          '--skip-slug-check',
        ],
      },
    ],
  },
  {
    id: 'dashboard',
    title: 'Dashboard',
    description: 'Start and use the local dashboard server.',
    commands: [
      {
        command: 'npm start',
        description: 'Starts the dashboard HTTP server.',
        when: 'Use this when you want to inspect jobs, move pipeline stages, view analytics, or use the web help page.',
        flags: [],
      },
    ],
  },
  {
    id: 'scraping-scoring',
    title: 'Scraping and scoring',
    description: 'Lower-level pipeline pieces for collecting, importing, and scoring jobs.',
    commands: [
      {
        command: 'npm run scrape',
        description: 'Collects jobs from configured sources and writes the active profile jobs JSON file.',
        when: 'Use this when you only need to refresh scraped listings before deciding whether to import them.',
        flags: [],
      },
      {
        command: 'npm run pipeline',
        description: 'Imports the active jobs JSON file, dedupes records, scores jobs, and classifies application complexity.',
        when: 'Use this after scraping, or after manually editing the active jobs JSON file.',
        flags: [],
      },
      {
        command: 'npm run score',
        description: 'Runs the standalone scorer against JSON job input.',
        when: 'Use this for direct scoring experiments outside the normal database pipeline.',
        flags: [],
      },
      {
        command: 'npm run retry-unscored',
        description: 'Retries scoring for jobs that are still missing scores.',
        when: 'Use this after transient AI failures or when you want to chip away at unscored jobs without a full pipeline run.',
        flags: ['--limit=<n>'],
      },
    ],
  },
  {
    id: 'resume',
    title: 'Resume',
    description: 'Base resume generation.',
    commands: [
      {
        command: 'npm run resume',
        description: 'Regenerates the base resume PDF from the active profile resume markdown.',
        when: 'Use this after editing the base resume markdown or stylesheet.',
        flags: [],
      },
    ],
  },
  {
    id: 'maintenance',
    title: 'Maintenance',
    description: 'Occasional support commands for inbox sync, validation, and tests.',
    commands: [
      {
        command: 'npm run sync-rejections',
        description: 'Runs a one-shot Gmail rejection email sync.',
        when: 'Use this to update applied jobs from rejection emails without waiting for the dashboard poller.',
        flags: ['--dry-run', '--classify-only', '--replay', '--skip-trash', '--lookback-days=<n>', '--max-messages=<n>', '--mailbox=<name>', '--match=<text>'],
      },
      {
        command: 'npm run validate-slugs',
        description: 'Checks configured ATS company slugs.',
        when: 'Use this when scraper coverage looks suspicious or after editing company slug lists.',
        flags: ['--ats <name>', '--broken-only'],
      },
      {
        command: 'npm run validate-slugs:broken',
        description: 'Checks configured ATS company slugs and prints only broken entries.',
        when: 'Use this for a quieter health check focused on fixes you need to make.',
        flags: [],
      },
      {
        command: 'npm test',
        description: 'Runs the Node test suite.',
        when: 'Use this before committing changes.',
        flags: [],
      },
    ],
  },
];

function cloneGroups(groups) {
  return groups.map((group) => ({
    ...group,
    commands: group.commands.map((command) => ({ ...command, flags: [...command.flags] })),
  }));
}

function searchableText(value) {
  if (Array.isArray(value)) return value.join(' ');
  return value == null ? '' : String(value);
}

function commandMatches(command, needle) {
  return [
    command.command,
    command.description,
    command.when,
    command.flags,
  ].some((value) => searchableText(value).toLowerCase().includes(needle));
}

function groupMatches(group, needle) {
  return [
    group.id,
    group.title,
    group.description,
  ].some((value) => searchableText(value).toLowerCase().includes(needle));
}

function getCommandGroups() {
  return cloneGroups(COMMAND_GROUPS);
}

function filterCommandGroups(query) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return getCommandGroups();

  const exactGroupMatches = COMMAND_GROUPS.filter((group) => {
    return group.id.toLowerCase() === needle || group.title.toLowerCase() === needle;
  });
  if (exactGroupMatches.length) return cloneGroups(exactGroupMatches);

  return COMMAND_GROUPS
    .map((group) => {
      if (groupMatches(group, needle)) {
        return {
          ...group,
          commands: group.commands.map((command) => ({ ...command, flags: [...command.flags] })),
        };
      }

      const commands = group.commands
        .filter((command) => commandMatches(command, needle))
        .map((command) => ({ ...command, flags: [...command.flags] }));
      return commands.length ? { ...group, commands } : null;
    })
    .filter(Boolean);
}

function flattenCommands(groups = COMMAND_GROUPS) {
  return groups.flatMap((group) => group.commands.map((command) => ({
    group: group.id,
    groupTitle: group.title,
    ...command,
    flags: [...command.flags],
  })));
}

module.exports = {
  filterCommandGroups,
  flattenCommands,
  getCommandGroups,
};
