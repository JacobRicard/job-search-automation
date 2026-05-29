#!/usr/bin/env node
/**
 * generate-resume.js
 * Generates a resume PDF from a profile's resume.md
 *
 * Flow:
 *   1. Parse resume.md into structured sections
 *   2. Trim oldest bullets until content fits one Letter page
 *   3. Write resume-preview.html and ask for confirmation
 *   4. On approval, render to resume.pdf via Puppeteer
 *
 * Usage: node generate-resume.js
 * Output: data/resume.pdf
 */

'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const puppeteer = require('puppeteer-core');

const CHROME_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const { baseDir: profileDir } = require('../config/paths');
const RESUME_SCALE = parseFloat(process.env.RESUME_SCALE) || 1.0;

// Letter page in CSS pixels at 96 dpi (8.5 × 11 in)
const LETTER_WIDTH_PX  = 816;
const LETTER_HEIGHT_PX = 1056;
// Small tolerance so a near-full page doesn't trigger a false trim
const HEIGHT_TOLERANCE_PX = 4;

// ---------------------------------------------------------------------------
// Profile CSS override
// ---------------------------------------------------------------------------

function loadProfileCss(dir = profileDir) {
  const profileCssPath = path.join(dir, 'resume.css');
  return fs.existsSync(profileCssPath) ? fs.readFileSync(profileCssPath, 'utf8') : '';
}

// ---------------------------------------------------------------------------
// Parse resume.md into structured sections
// ---------------------------------------------------------------------------

function parseResume(md) {
  const lines = md.split('\n');
  const resume = { name: '', contact: '', sections: [] };
  let current = null;
  let i = 0;

  // First non-empty line: # Name
  while (i < lines.length && !lines[i].trim()) i++;
  resume.name = lines[i++].replace(/^#\s*/, '').trim();

  // Second non-empty line: contact
  while (i < lines.length && !lines[i].trim()) i++;
  resume.contact = lines[i++].trim();

  for (; i < lines.length; i++) {
    const line = lines[i];

    // H2 = section header (## Summary, ## Experience, etc.)
    if (/^##\s/.test(line)) {
      current = { title: line.replace(/^##\s*/, '').trim().toUpperCase(), entries: [], type: 'section' };
      resume.sections.push(current);
      continue;
    }

    if (!current) continue;

    // H3 = job header (### Title — Company / Location)
    if (/^###\s/.test(line)) {
      const raw = line.replace(/^###\s*/, '').trim();
      const dashMatch = raw.match(/^(.+?)\s+[—–-]+\s+(.+)$/);
      current.entries.push({
        type: 'job',
        raw,
        title: dashMatch ? dashMatch[1].trim() : raw,
        company: dashMatch ? dashMatch[2].trim() : '',
        date: '',
        subtitle: '',
        bullets: [],
      });
      continue;
    }

    const lastEntry = current.entries[current.entries.length - 1];

    // Sub-role line: **Title** | Date
    const subroleMatch = line.match(/^\*\*(.+?)\*\*\s*\|\s*(.+)$/);
    if (subroleMatch) {
      if (lastEntry && lastEntry.type === 'job') {
        if (!lastEntry.subroles) lastEntry.subroles = [];
        lastEntry.subroles.push({ title: subroleMatch[1].trim(), date: subroleMatch[2].trim(), bullets: [] });
      }
      continue;
    }

    // **Date** line (bold date after job header)
    if (/^\*\*[A-Z][a-z]/.test(line) || /^\*\*[A-Z][a-z0-9 –-]+\*\*$/.test(line)) {
      if (lastEntry && lastEntry.type === 'job') {
        lastEntry.date = line.replace(/\*\*/g, '').trim();
        continue;
      }
    }

    // *subtitle* line (italic)
    if (/^\*[^*]/.test(line) && line.endsWith('*') && !line.startsWith('**')) {
      if (lastEntry && lastEntry.type === 'job') {
        lastEntry.subtitle = line.replace(/^\*|\*$/g, '').trim();
        continue;
      }
    }

    // Bullet point
    if (/^[-*]\s/.test(line)) {
      const text = line.replace(/^[-*]\s/, '').trim();
      if (lastEntry && lastEntry.type === 'job') {
        const subroles = lastEntry.subroles;
        if (subroles && subroles.length > 0) {
          subroles[subroles.length - 1].bullets.push(text);
        } else {
          lastEntry.bullets.push(text);
        }
      } else {
        current.entries.push({ type: 'bullet', text });
      }
      continue;
    }

    // Plain text (Summary paragraph, Skills lines, Education)
    if (line.trim() && line !== '---') {
      if (/^\*\*[A-Za-z/& ]+:\*\*/.test(line)) {
        current.entries.push({ type: 'skill', text: line.trim() });
      } else if (current.entries.length > 0 && current.entries[current.entries.length - 1].type === 'paragraph') {
        current.entries[current.entries.length - 1].text += ' ' + line.trim();
      } else {
        current.entries.push({ type: 'paragraph', text: line.trim() });
      }
    }
  }

  return resume;
}

// ---------------------------------------------------------------------------
// Render inline markdown (bold/italic) to HTML
// ---------------------------------------------------------------------------

function inlineMd(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

// ---------------------------------------------------------------------------
// Build HTML
// Spacing values converted from Word twips (1/20 pt):
//   section headers: 140 before = 7pt, 40 after = 2pt
//   job entries:     90 before = 4.5pt
//   bullet items:    20 after = 1pt
// ---------------------------------------------------------------------------

function buildHtml(resume, profileCss = loadProfileCss()) {
  let html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Times New Roman', Times, serif;
    font-size: 10pt;
    line-height: 1.2;
    color: #000;
    padding: 0.55in 0.70in;
  }

  /* Header */
  .name {
    font-size: 28pt;
    font-weight: bold;
    text-align: center;
    letter-spacing: 0.3px;
  }
  .contact {
    font-size: 9pt;
    text-align: center;
    margin-top: 2px;
    margin-bottom: 4px;
  }

  /* Section headers: 11pt bold all-caps, bottom rule, 7pt before / 2pt after */
  .section-header {
    font-size: 11pt;
    font-weight: bold;
    text-transform: uppercase;
    border-bottom: 1px solid #000;
    padding-bottom: 1px;
    margin-top: 7pt;
    margin-bottom: 2pt;
  }

  /* Job entries: 10.5pt bold title, 4.5pt before */
  .job-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-top: 4.5pt;
  }
  .job-title-company {
    font-size: 10.5pt;
    font-weight: bold;
  }
  .job-date {
    font-size: 10pt;
    white-space: nowrap;
    margin-left: 8px;
    flex-shrink: 0;
  }
  .job-subtitle {
    font-style: italic;
    font-size: 10pt;
    margin-top: 0;
    margin-bottom: 1px;
  }

  /* Bullets: 10pt body, 1pt after each item */
  ul {
    margin-left: 14px;
    margin-top: 1px;
    margin-bottom: 0;
  }
  li {
    font-size: 10pt;
    margin-bottom: 1pt;
    padding-left: 1px;
  }
  li::marker {
    font-size: 7pt;
  }

  /* Summary */
  .summary-text {
    font-size: 10pt;
    margin-top: 1px;
    margin-bottom: 1px;
  }

  /* Skills */
  .skill-line {
    font-size: 10pt;
    margin-bottom: 0.5px;
  }

  /* Education */
  .edu-text {
    font-size: 10pt;
    font-weight: bold;
  }

  /* Sub-role entries within a company block */
  .subrole-header {
    margin-top: 3pt;
  }
  .subrole-title {
    font-style: italic;
    font-weight: bold;
  }

${profileCss}
</style>
</head>
<body>

<div class="name">${inlineMd(resume.name)}</div>
<div class="contact">${inlineMd(resume.contact)}</div>
`;

  for (const section of resume.sections) {
    html += `<div class="section-header">${section.title}</div>\n`;

    for (const entry of section.entries) {
      if (entry.type === 'job') {
        const titlePart = entry.title;
        const companyPart = entry.company;
        html += `<div class="job-header">
  <span class="job-title-company"><span class="job-title">${inlineMd(titlePart)}</span>${companyPart ? `  &nbsp; ${inlineMd(companyPart)}` : ''}</span>
  <span class="job-date">${inlineMd(entry.date)}</span>
</div>\n`;
        if (entry.subtitle) {
          html += `<div class="job-subtitle">${inlineMd(entry.subtitle)}</div>\n`;
        }
        if (entry.bullets.length > 0) {
          html += `<ul>\n`;
          for (const b of entry.bullets) {
            html += `  <li>${inlineMd(b)}</li>\n`;
          }
          html += `</ul>\n`;
        }
        if (entry.subroles && entry.subroles.length > 0) {
          for (const sr of entry.subroles) {
            html += `<div class="job-header subrole-header">
  <span class="job-title-company subrole-title">${inlineMd(sr.title)}</span>
  <span class="job-date">${inlineMd(sr.date)}</span>
</div>\n`;
            if (sr.bullets.length > 0) {
              html += `<ul>\n`;
              for (const b of sr.bullets) {
                html += `  <li>${inlineMd(b)}</li>\n`;
              }
              html += `</ul>\n`;
            }
          }
        }
      } else if (entry.type === 'skill') {
        html += `<div class="skill-line">${inlineMd(entry.text)}</div>\n`;
      } else if (entry.type === 'paragraph') {
        const cls = section.title === 'SUMMARY' ? 'summary-text' : 'edu-text';
        html += `<div class="${cls}">${inlineMd(entry.text)}</div>\n`;
      } else if (entry.type === 'bullet') {
        html += `<ul><li>${inlineMd(entry.text)}</li></ul>\n`;
      }
    }
  }

  html += `</body></html>`;
  return html;
}

// ---------------------------------------------------------------------------
// One-page enforcement
// Protected: Education, Skills, Certifications, Summary, and the two most
// recent job roles. Bullets are trimmed starting from the oldest role.
// ---------------------------------------------------------------------------

const PROTECTED_SECTION_TITLES = new Set([
  'EDUCATION', 'SKILLS', 'TECHNICAL SKILLS', 'CERTIFICATIONS', 'SUMMARY', 'OBJECTIVE',
]);

function findExperienceSection(resume) {
  return resume.sections.find(
    (s) => !PROTECTED_SECTION_TITLES.has(s.title) && s.entries.some((e) => e.type === 'job')
  ) || null;
}

// Remove the last bullet from the oldest trimmable job. Returns true if a
// bullet was removed, false if there is nothing left to trim.
function trimOldestBullet(resume) {
  const expSection = findExperienceSection(resume);
  if (!expSection) return false;

  const jobs = expSection.entries.filter((e) => e.type === 'job');
  // Protect the two most recent roles (first two in the list, newest-first ordering)
  const trimmable = jobs.slice(2);
  if (!trimmable.length) return false;

  // Work from the oldest role (last in array) upward
  for (let i = trimmable.length - 1; i >= 0; i--) {
    const job = trimmable[i];

    // Try subroles (oldest subrole last) before main bullets
    if (job.subroles && job.subroles.length > 0) {
      for (let j = job.subroles.length - 1; j >= 0; j--) {
        if (job.subroles[j].bullets.length > 0) {
          job.subroles[j].bullets.pop();
          return true;
        }
      }
    }

    if (job.bullets.length > 0) {
      job.bullets.pop();
      return true;
    }
  }
  return false;
}

async function measureHeight(page, html) {
  await page.setViewport({ width: LETTER_WIDTH_PX, height: LETTER_HEIGHT_PX });
  await page.setContent(html, { waitUntil: 'networkidle0' });
  return await page.evaluate(() =>
    Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)
  );
}

// Mutates resume in place until it fits one page. Returns the final HTML.
async function enforceOnePage(page, resume, profileCss) {
  const MAX_TRIMS = 60;
  let trims = 0;

  for (;;) {
    const html = buildHtml(resume, profileCss);
    const height = await measureHeight(page, html);

    if (height <= LETTER_HEIGHT_PX + HEIGHT_TOLERANCE_PX) {
      return html;
    }

    if (trims >= MAX_TRIMS) {
      console.warn(`Warning: content still overflows after ${MAX_TRIMS} bullet trims — saving as-is.`);
      return html;
    }

    const trimmed = trimOldestBullet(resume);
    trims++;
    if (!trims % 5) {
      console.log(`  Trimming to fit one page... (${trims} bullet${trims !== 1 ? 's' : ''} removed, height=${height}px)`);
    }
    if (!trimmed) {
      console.warn('Warning: nothing left to trim — content may exceed one page.');
      return html;
    }
  }
}

// ---------------------------------------------------------------------------
// Review gate
// ---------------------------------------------------------------------------

function promptConfirm(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

// ---------------------------------------------------------------------------
// PDF writer (shared)
// ---------------------------------------------------------------------------

async function writeResumePdf({ html, outputPath, scale = RESUME_SCALE, chromePath = CHROME_PATH } = {}) {
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.pdf({
      path: outputPath,
      format: 'Letter',
      printBackground: false,
      scale,
    });
    await page.close();
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// Public API (used by other scripts that import this module)
// ---------------------------------------------------------------------------

function renderResumeMarkdownToHtml(markdown, { profileDir: dir = profileDir } = {}) {
  return buildHtml(parseResume(markdown), loadProfileCss(dir));
}

// ---------------------------------------------------------------------------
// Standalone entry point
// ---------------------------------------------------------------------------

async function main() {
  const RESUME_PATH  = path.join(profileDir, 'resume.md');
  const PREVIEW_PATH = path.join(profileDir, 'resume-preview.html');
  const OUTPUT_PATH  = path.join(profileDir, 'resume.pdf');

  const profileCss = loadProfileCss(profileDir);
  const md = fs.readFileSync(RESUME_PATH, 'utf8');
  const resume = parseResume(md);

  // --- Step 1: enforce one page ---
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  let html;
  try {
    const page = await browser.newPage();
    html = await enforceOnePage(page, resume, profileCss);
    await page.close();
  } finally {
    await browser.close();
  }

  // --- Step 2: write preview and confirm ---
  fs.writeFileSync(PREVIEW_PATH, html);
  console.log(`\nPreview: ${PREVIEW_PATH}`);
  console.log('Open this file in a browser to review the layout before saving.\n');

  const confirmed = await promptConfirm('Save as PDF? [y/N] ');
  if (!confirmed) {
    console.log('Cancelled. No PDF saved. Preview remains at: ' + PREVIEW_PATH);
    return;
  }

  // --- Step 3: render to PDF ---
  await writeResumePdf({ html, outputPath: OUTPUT_PATH, scale: RESUME_SCALE });
  console.log(`PDF saved: ${OUTPUT_PATH}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Error generating resume:', err.message);
    process.exit(1);
  });
}

module.exports = {
  buildHtml,
  loadProfileCss,
  parseResume,
  renderResumeMarkdownToHtml,
  writeResumePdf,
};
