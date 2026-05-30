/**
 * scorer.js
 * Uses the Groq API to score a job listing 1-10 against resume.md and context.md.
 * Two-step pipeline:
 *   Step 1 (scoreJobCoarseFilter): llama-3.1-8b-instant — PASS/FAIL relevance gate
 *   Step 2 (scoreJob):             llama-3.3-70b-versatile — full 1-10 score with reasoning
 *
 * Requires: GROQ_API_KEY environment variable
 *
 * Usage (standalone):
 *   echo '[{"title":"...","company":"...","description":"..."}]' | node scorer.js
 *
 * Usage (module):
 *   const { scoreJob, scoreJobCoarseFilter } = require('./scorer');
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { MAX_DESCRIPTION_LENGTH } = require('./config/constants');
const createLogger = require('./lib/logger');
const { baseDir } = require('./config/paths');
const { callGroq, callGroqJson, GROQ_FILTER_MODEL, GROQ_SCORE_MODEL } = require('./lib/groq');

// Returns the right LLM call functions based on env config.
// Prefers Ollama when OLLAMA_HOST is set; falls back to Groq.
function getLLM() {
  if (process.env.OLLAMA_HOST) {
    const { callOllama, callOllamaJson, OLLAMA_FILTER_MODEL, OLLAMA_SCORE_MODEL } = require('./lib/ollama');
    return { callText: callOllama, callJson: callOllamaJson, filterModel: OLLAMA_FILTER_MODEL, scoreModel: OLLAMA_SCORE_MODEL, hasKey: true };
  }
  return { callText: callGroq, callJson: callGroqJson, filterModel: GROQ_FILTER_MODEL, scoreModel: GROQ_SCORE_MODEL, hasKey: !!process.env.GROQ_API_KEY };
}

function readFile(filename) {
  const filePath = path.join(baseDir, filename);
  try {
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch (err) {
    throw new Error(`Cannot read ${filename}: ${err.message}. Make sure it exists at ${filePath}`);
  }
}

let _resume = null, _context = null;

// ---------------------------------------------------------------------------
// Step 1: Coarse relevance filter
// ---------------------------------------------------------------------------

/**
 * Quickly decide if a job is clearly irrelevant using a small, fast model.
 * Returns { pass: boolean }. Fail-open (pass=true) if no API key or on error.
 */
async function scoreJobCoarseFilter(job) {
  const llm = getLLM();
  if (!llm.hasKey) return { pass: true };

  if (!_context) _context = readFile('context.md');

  const descSnippet = (job.description || '').slice(0, 500);
  const prompt = `You are a job relevance filter. Given the user's preferences and dealbreakers below, respond with ONLY the word PASS or FAIL.

Respond FAIL only if the job is clearly irrelevant — wrong field entirely, explicit dealbreaker from the user's context, or completely wrong seniority level. When in doubt, respond PASS.

## User Context (preferences and dealbreakers)
${_context}

## Job
Title: ${job.title}
Company: ${job.company}
Location: ${job.location || 'Not specified'}
Description (first 500 chars): ${descSnippet}

Respond ONLY with PASS or FAIL.`;

  const blocklist = (process.env.TITLE_BLOCKLIST || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  if (blocklist.length) {
    prompt += `\n\nAlso respond FAIL if the job title contains any of these words or phrases: ${blocklist.join(', ')}.`;
  }

  try {
    const text = await llm.callText(prompt, { model: llm.filterModel, maxTokens: 10 });
    const upper = text.toUpperCase().trim();
    if (upper.includes('FAIL')) return { pass: false };
    return { pass: true };
  } catch (e) {
    return { pass: true };
  }
}

// ---------------------------------------------------------------------------
// Step 2: Full scoring
// ---------------------------------------------------------------------------

/**
 * Score a single job listing against the user's resume and context.
 * @returns {Promise<{ score: number, reasoning: string }>}
 */
async function scoreJob(job) {
  const llm = getLLM();
  if (!_resume) _resume = readFile('resume.md');
  if (!_context) _context = readFile('context.md');

  const prompt = `You are evaluating how well a job listing matches a candidate. Respond with a JSON object only.

## Candidate Resume
${_resume}

## Candidate Context (goals, preferences, dealbreakers)
${_context}

## Job Listing
Title: ${job.title}
Company: ${job.company}
Location: ${job.location || 'Not specified'}

Description:
${job.description || 'No description available.'}

---

Score this job 1-10 based on how well it matches the candidate. Consider tech stack fit, seniority, role type, company fit, and the candidate's stated preferences or dealbreakers.

Respond with ONLY valid JSON in this exact format:
{"score": <integer 1-10>, "reasoning": "<2-4 sentences explaining the score>"}`;

  try {
    const json = await llm.callJson(prompt, { model: llm.scoreModel, maxTokens: 400 });
    const score = typeof json.score === 'number'
      ? Math.min(10, Math.max(1, Math.round(json.score)))
      : null;
    const reasoning = typeof json.reasoning === 'string' ? json.reasoning.trim() : '';
    if (score == null) throw new Error('score field missing from JSON response');
    return { score, reasoning };
  } catch (jsonErr) {
    const fallbackPrompt = prompt.replace(
      'Respond with ONLY valid JSON in this exact format:\n{"score": <integer 1-10>, "reasoning": "<2-4 sentences explaining the score>"}',
      'Respond in EXACTLY this format (no other text):\nSCORE: <integer 1-10>\nREASONING: <2-4 sentences explaining the score>'
    );
    const text = await llm.callText(fallbackPrompt, { model: llm.scoreModel, maxTokens: 400 });
    return parseScoreResponse(text);
  }
}

function parseScoreResponse(text) {
  const scoreMatch = text.match(/^SCORE:\s*(\d+)/m);
  const reasoningMatch = text.match(/^REASONING:\s*(.+)/ms);

  const score = scoreMatch ? Math.min(10, Math.max(1, parseInt(scoreMatch[1], 10))) : null;
  const reasoning = reasoningMatch
    ? reasoningMatch[1].trim()
    : (scoreMatch ? text : `Score parse failed. Raw: ${text.slice(0, 200)}`);

  return { score, reasoning };
}

// ---------------------------------------------------------------------------
// Rejection Likelihood Analysis
// ---------------------------------------------------------------------------

async function scoreRejectionLikelihood(job) {
  if (!_resume) _resume = readFile('resume.md');
  if (!_context) _context = readFile('context.md');

  const prompt = `You are a hiring manager reviewing a job application. Given the job listing and candidate profile below, identify the most likely reasons this application would be rejected.

## Candidate Resume
${_resume}

## Candidate Context
${_context}

## Job Listing
Title: ${job.title}
Company: ${job.company}
Location: ${job.location || 'Not specified'}
Description: ${(job.description || '').slice(0, MAX_DESCRIPTION_LENGTH)}

---

Identify the top 2-4 most likely reasons a recruiter or hiring manager would pass on this candidate for this specific role. Be concrete — reference actual gaps between the job requirements and the candidate's profile. Do not give generic advice.

Respond in 2-4 plain sentences. No bullet points, no headers.`;

  return await getLLM().callText(prompt, { model: getLLM().scoreModel, maxTokens: 400 });
}

// ---------------------------------------------------------------------------
// Standalone: score a batch from stdin
// ---------------------------------------------------------------------------

if (require.main === module) {
  const logPaths = require('./lib/log-paths');
  const log = createLogger('scorer', { logFile: logPaths.daily('scorer') });

  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { raw += chunk; });
  process.stdin.on('end', async () => {
    let jobs;
    try {
      jobs = JSON.parse(raw);
    } catch (err) {
      log.error('Could not parse stdin JSON', { error: err.message });
      process.exit(1);
    }

    if (!Array.isArray(jobs)) {
      log.error('Expected a JSON array of jobs on stdin');
      process.exit(1);
    }

    const results = [];
    for (const job of jobs) {
      try {
        const filter = await scoreJobCoarseFilter(job);
        if (!filter.pass) {
          results.push({ ...job, score: 1, reasoning: 'Filtered: irrelevant role' });
          log.info('Filtered (coarse)', { company: job.company, title: job.title });
          continue;
        }
        const { score, reasoning } = await scoreJob(job);
        results.push({ ...job, score, reasoning });
        log.info('Scored', { company: job.company, title: job.title, score });
      } catch (err) {
        log.error('Score failed', { title: job.title, error: err.message });
        results.push({ ...job, score: null, reasoning: `Error: ${err.message}` });
      }
    }

    process.stdout.write(JSON.stringify(results, null, 2));
  });
}

module.exports = { scoreJob, scoreJobCoarseFilter, scoreRejectionLikelihood, parseScoreResponse };
