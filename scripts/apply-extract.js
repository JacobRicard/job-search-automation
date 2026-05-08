#!/usr/bin/env node
/**
 * scripts/apply-extract.js <job-id>
 *
 * Extract custom application questions from a job's apply page.
 * Outputs JSON to stdout. Used by the /apply Claude skill.
 *
 * Usage: node scripts/apply-extract.js greenhouse-123456
 *        node scripts/apply-extract.js ashby-abc123...
 */
'use strict';

const path = require('path');
const fs = require('fs');

// Load environment from .env and profiles/example/.env
function loadEnv() {
  const envFiles = [
    path.join(__dirname, '..', '.env'),
    path.join(__dirname, '..', 'profiles', 'example', '.env'),
  ];
  for (const f of envFiles) {
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  }
}
loadEnv();

const { dbPath } = require('../config/paths');
const Database = require('better-sqlite3');
const { launchBrowser, saveScreenshot, newPage } = require('../lib/ats-appliers/browser');
const { detectApplicationPageIssue, snapshotApplicationPage } = require('../lib/ats-appliers/page-checks');

// System fields we don't need to extract as "questions"
const STANDARD_NAME_PATTERNS = [
  /^_systemfield_/, /^first[_\s]?name$/i, /^last[_\s]?name$/i, /^full[_\s]?name$/i,
  /^name$/i, /^email$/i, /^phone$/i, /^resume$/i, /^cover[_\s]?letter$/i,
  /^linkedin/i, /^github/i, /^portfolio/i, /^website/i, /^location$/i,
];

function isStandardField(name, label) {
  // Custom Greenhouse question IDs (question_XXXXXXXXX) are never standard,
  // even if their label says "LinkedIn" or "Website" — they need explicit answers.
  if (/^question_\d+$/i.test(name)) return false;
  if (/how did you hear/i.test(label)) return false;
  const combined = `${name} ${label}`.toLowerCase();
  if (STANDARD_NAME_PATTERNS.some(p => p.test(name))) return true;
  if (/resume|cv|cover letter|linkedin|github|portfolio|website/i.test(combined)) return true;
  return false;
}

async function extractGreenhouse(job) {
  // Use Greenhouse questions API for structured data
  const url = String(job.url || '');
  const jobIdMatch = url.match(/\/jobs\/(\d+)/) || url.match(/[?&]gh_jid=(\d+)/);
  const jobId = jobIdMatch ? jobIdMatch[1] : job.id.replace('greenhouse-', '');
  const urlMatch = url.match(/greenhouse\.io\/([^/]+)\/jobs\/\d+/);
  const company = urlMatch ? urlMatch[1] : (job.company || '').toLowerCase().replace(/\s+/g, '');
  if (!company || !jobId) return [];

  const apiUrl = `https://boards-api.greenhouse.io/v1/boards/${company}/jobs/${jobId}?questions=true`;
  const res = await fetch(apiUrl);
  if (!res.ok) return [];
  const data = await res.json();
  const questions = data.questions || [];

  const custom = [];
  for (const q of questions) {
    for (const field of (q.fields || [])) {
      if (isStandardField(field.name, q.label || '')) continue;
      custom.push({
        label: q.label || field.name,
        name: field.name,
        type: field.type || 'input_text',
        required: !!q.required,
        options: (field.values || []).map(v => v.label || v.name || String(v)),
      });
    }
  }
  return custom;
}

function buildGreenhouseApplyUrl(job) {
  const match = (job.url || '').match(/greenhouse\.io\/([^/?#]+)\/jobs\/(\d+)/);
  if (!match) return job.url;
  const [, boardToken, jobId] = match;
  return `https://job-boards.greenhouse.io/${boardToken}/jobs/${jobId}`;
}

function applicationFieldExtractor() {
  function normalize(text) {
    return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function cleanText(text) {
    return String(text || '').trim().replace(/\s+/g, ' ');
  }

  function isVisible(node) {
    if (!node) return false;
    const style = window.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function optionTexts(input) {
    if (input.tagName === 'SELECT') {
      return Array.from(input.options || [])
        .map((option) => cleanText(option.text || option.textContent))
        .filter(Boolean);
    }

    const name = input.name || '';
    const selector = input.type === 'radio'
      ? `input[type="radio"][name="${CSS.escape(name)}"]`
      : `input[type="checkbox"][name="${CSS.escape(name)}"]`;
    const choices = name
      ? Array.from(document.querySelectorAll(selector))
      : [input];

    return choices
      .map((choice) => {
        const wrappingLabel = choice.closest('label');
        if (wrappingLabel) return cleanText(wrappingLabel.innerText);
        if (choice.id) {
          const explicit = document.querySelector(`label[for="${CSS.escape(choice.id)}"]`);
          if (explicit) return cleanText(explicit.innerText);
        }
        return cleanText(choice.value);
      })
      .filter(Boolean);
  }

  function buildCardFieldMetadata() {
    const map = new Map();
    const templates = Array.from(document.querySelectorAll('input[type="hidden"][name^="cards["][name$="[baseTemplate]"]'));

    for (const template of templates) {
      const match = String(template.name || '').match(/^cards\[([^\]]+)\]\[baseTemplate\]$/);
      if (!match) continue;
      let parsed;
      try {
        parsed = JSON.parse(template.value || '');
      } catch (_) {
        continue;
      }
      const fields = Array.isArray(parsed.fields) ? parsed.fields : [];
      fields.forEach((field, index) => {
        const name = `cards[${match[1]}][field${index}]`;
        map.set(name, {
          labelText: cleanText(field.text || ''),
          type: String(field.type || ''),
          required: Boolean(field.required),
          options: Array.isArray(field.options)
            ? field.options.map((option) => cleanText(option.text)).filter(Boolean)
            : [],
        });
      });
    }

    return map;
  }

  function nearestField(node) {
    return node.closest(
      '.application-field, .application-question, .application-question-card, .application-eeo, .postings-application-question, fieldset, [class*="field"], [class*="question"]'
    );
  }

  function labelFromGroup(group, input) {
    if (input.id) {
      const explicit = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
      if (explicit) {
        const explicitText = cleanText(explicit.innerText);
        if (explicitText) return explicitText;
      }
    }

    const wrappingLabel = input.closest('label');
    if (wrappingLabel && !['radio', 'checkbox'].includes(String(input.type || '').toLowerCase())) {
      const clone = wrappingLabel.cloneNode(true);
      for (const node of Array.from(clone.querySelectorAll('input, textarea, select, option'))) {
        node.remove();
      }
      const wrappingText = cleanText(clone.innerText);
      if (wrappingText) return wrappingText;
    }

    const scoped = group || nearestField(input) || input.parentElement;
    const legend = scoped?.querySelector('legend');
    if (legend?.innerText) return cleanText(legend.innerText);

    const label = scoped?.querySelector('label');
    if (label?.innerText) {
      const clone = label.cloneNode(true);
      for (const node of Array.from(clone.querySelectorAll('input, textarea, select, option'))) {
        node.remove();
      }
      const labelText = cleanText(clone.innerText);
      if (labelText) return labelText;
    }

    const heading = scoped?.querySelector('h1, h2, h3, h4, [class*="label"], [class*="question"]');
    if (heading?.innerText) {
      const text = cleanText(heading.innerText);
      if (text) return text;
    }

    return cleanText(input.getAttribute('aria-label') || input.getAttribute('placeholder') || input.name || input.id);
  }

  function fieldType(input, metadata) {
    if (metadata?.type) {
      const lower = metadata.type.toLowerCase();
      if (lower === 'multiple-select') return 'multi_select';
      if (lower === 'textarea') return 'textarea';
      if (lower === 'text') return 'text';
      if (lower === 'file-upload') return 'file';
      return lower;
    }

    const tag = input.tagName;
    const type = String(input.type || '').toLowerCase();
    if (tag === 'TEXTAREA') return 'textarea';
    if (tag === 'SELECT') return 'select';
    if (type === 'radio') return 'select';
    if (type === 'checkbox') return 'multi_select';
    return type || 'text';
  }

  function isRequired(input, label, group, metadata) {
    if (metadata) return metadata.required;
    if (input.required) return true;
    if ((input.getAttribute('aria-required') || '').toLowerCase() === 'true') return true;
    const text = cleanText(`${label} ${group?.innerText || ''}`);
    return /[✱*]|\brequired\b/i.test(text);
  }

  function specialLabel(input) {
    const name = String(input.name || '').toLowerCase();
    if (name === 'eeo[gender]') return 'Gender';
    if (name === 'eeo[race]') return 'Race';
    if (name === 'eeo[veteran]') return 'Veteran status';
    if (name === 'eeo[disability]') return 'Disability status';
    return '';
  }

  function addField(results, seen, input, cardMetadata) {
    if (!isVisible(input)) return;
    const type = String(input.type || '').toLowerCase();
    if (['hidden', 'file', 'submit', 'button', 'image', 'reset'].includes(type)) return;
    if ((type === 'radio' || type === 'checkbox') && !input.name) return;

    const group = nearestField(input);
    const name = input.name || input.id || '';
    const dedupeKey = type === 'radio' || type === 'checkbox' ? `${type}:${name}` : `${name}:${input.id}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);

    const labelText = labelFromGroup(group, input);
    const metadata = cardMetadata.get(name);
    const finalLabel = metadata?.labelText || specialLabel(input) || labelText;
    if (!finalLabel || !name) return;

    results.push({
      labelText: finalLabel,
      name,
      type: fieldType(input, metadata),
      required: isRequired(input, finalLabel, group, metadata),
      options: metadata?.options?.length
        ? metadata.options
        : (['radio', 'checkbox'].includes(type) || input.tagName === 'SELECT' ? optionTexts(input) : []),
    });
  }

  const results = [];
  const seen = new Set();
  const cardMetadata = buildCardFieldMetadata();
  const fields = Array.from(document.querySelectorAll('input, textarea, select'));
  for (const field of fields) addField(results, seen, field, cardMetadata);

  return results.filter((field) => normalize(field.labelText) !== 'select');
}

async function extractFromDom(page, job) {
  await new Promise(r => setTimeout(r, 2000));

  // Extract all labeled form fields from the DOM
  const fields = await page.evaluate(applicationFieldExtractor);

  return fields;
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: node scripts/apply-extract.js <job-id>');
    console.error('       node scripts/apply-extract.js --url=https://jobs.ashbyhq.com/company/uuid');
    process.exit(1);
  }

  const db = new Database(dbPath);
  let job;

  const urlArg = arg.startsWith('--url=') ? arg.slice('--url='.length) : null;
  if (urlArg) {
    // Try DB lookup first
    const ashbyMatch = urlArg.match(/jobs\.ashbyhq\.com\/([^/?#]+)\/([0-9a-f-]{36})/i);
    if (!ashbyMatch) {
      console.error('--url only supports Ashby URLs (jobs.ashbyhq.com/<company>/<uuid>)');
      process.exit(1);
    }
    const [, company, uuid] = ashbyMatch;
    job = db.prepare('SELECT * FROM jobs WHERE url LIKE ?').get(`%${uuid}%`);
    if (!job) {
      // Synthetic job object so DOM extraction can still run
      job = { id: `ashby-${uuid}`, company, title: '', url: urlArg, platform: 'ashby' };
      console.error(`Job not in DB — running DOM extraction on: ${urlArg}`);
    }
  } else {
    const jobId = arg;
    job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    if (!job) {
      console.error(`Job not found: ${jobId}`);
      process.exit(1);
    }
  }

  console.error(`Extracting questions for: ${job.company} — ${job.title}`);
  console.error(`Apply URL: ${job.url}`);

  const lowerPlatform = String(job.platform || '').toLowerCase();
  const lowerUrl = String(job.url || '').toLowerCase();
  const platform = lowerPlatform.includes('greenhouse') || lowerUrl.includes('greenhouse')
    ? 'greenhouse'
    : job.id.split('-')[0].toLowerCase();
  let customFields = [];
  let pageIssue = null;
  let shouldFallbackToDom = true;

  if (platform === 'greenhouse') {
    try {
      customFields = await extractGreenhouse(job);
      console.error(`Greenhouse API returned ${customFields.length} custom fields`);
      shouldFallbackToDom = false;
    } catch (e) {
      console.error(`Greenhouse API failed: ${e.message}, falling back to DOM`);
      customFields = null;
    }
  }

  // For Lever, Ashby, or Greenhouse API fallback: use DOM inspection
  if (platform === 'greenhouse' && Array.isArray(customFields) && customFields.length === 0) {
    let browser;
    try {
      browser = await launchBrowser();
      const page = await newPage(browser);
      const applyUrl = buildGreenhouseApplyUrl(job);
      console.error(`Validating Greenhouse page: ${applyUrl}`);
      await page.goto(applyUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise(r => setTimeout(r, 2000));
      const snapshot = await snapshotApplicationPage(page);
      pageIssue = detectApplicationPageIssue('greenhouse', snapshot, {
        sourceUrl: applyUrl,
        jobId: job.id.replace(/^greenhouse-/, ''),
      });
      if (pageIssue) {
        console.error(`Page issue detected: ${pageIssue}`);
      }
    } finally {
      if (browser) await browser.close();
    }
  }

  if (shouldFallbackToDom || customFields === null) {
    let applyUrl = job.url;
    if (platform === 'greenhouse') {
      applyUrl = buildGreenhouseApplyUrl(job);
    } else if (platform === 'lever') {
      const m = job.url.match(/jobs\.lever\.co\/([^/?#]+)\/([0-9a-f-]{36})/i);
      if (m) applyUrl = `https://jobs.lever.co/${m[1]}/${m[2]}/apply`;
    } else if (platform === 'ashby') {
      const m = job.url.match(/jobs\.ashbyhq\.com\/([^/?#]+)\/([0-9a-f-]{36})/i);
      if (m) applyUrl = `https://jobs.ashbyhq.com/${m[1]}/${m[2]}/application`;
    }

    let browser;
    try {
      browser = await launchBrowser();
      const page = await newPage(browser);
      console.error(`Navigating to: ${applyUrl}`);
      await page.goto(applyUrl, { waitUntil: 'networkidle2', timeout: 30000 });

      // Ashby renders client-side; wait for form inputs to mount before inspecting
      if (platform === 'ashby') {
        try {
          await page.waitForSelector('input, textarea, label', { timeout: 10000 });
        } catch (_) { /* continue anyway, snapshot will catch empty state */ }
        await new Promise(r => setTimeout(r, 2000));
      }

      const screenshotFile = await saveScreenshot(page, job.company, 'extract');
      console.error(`Screenshot saved: ${screenshotFile}`);

      const snapshot = await snapshotApplicationPage(page);
      pageIssue = detectApplicationPageIssue(platform, snapshot, {
        sourceUrl: applyUrl,
        jobId: platform === 'greenhouse' ? job.id.replace(/^greenhouse-/, '') : job.id,
      });
      if (pageIssue) {
        console.error(`Page issue detected: ${pageIssue}`);
        customFields = [];
      } else {
        const allFields = await extractFromDom(page, job);
        customFields = allFields.filter(f => !isStandardField(f.name, f.labelText));
        console.error(`DOM extracted ${allFields.length} total fields, ${customFields.length} custom`);
      }
    } finally {
      if (browser) await browser.close();
    }
  }

  // Output structured result
  const result = {
    jobId: job.id,
    company: job.company,
    title: job.title,
    platform,
    applyUrl: job.url,
    customFields,
    pageIssue,
  };

  console.log(JSON.stringify(result, null, 2));
  db.close();
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}

module.exports = {
  applicationFieldExtractor,
  extractFromDom,
  isStandardField,
};
