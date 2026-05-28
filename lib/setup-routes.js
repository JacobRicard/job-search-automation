'use strict';

const fs = require('fs');
const path = require('path');

function updateEnvLine(key, value, envPath) {
  let content = '';
  try { content = fs.readFileSync(envPath, 'utf8'); } catch (e) {}
  const escaped = value.replace(/\\/g, '\\\\');
  const line = `${key}=${escaped}`;
  const regex = new RegExp(`^${key}=.*$`, 'm');
  content = regex.test(content)
    ? content.replace(regex, line)
    : content + (content.endsWith('\n') ? '' : '\n') + line + '\n';
  fs.writeFileSync(envPath, content, 'utf8');
}

function buildContextMd({ titles, stack, salary, location }) {
  const titleLines = (titles || '').split('\n').map(t => t.trim()).filter(Boolean).map(t => `- ${t}`).join('\n') || '- (not specified)';
  const stackLines = (stack || '').split('\n').map(s => s.trim()).filter(Boolean).map(s => `- ${s}`).join('\n') || '- (not specified)';
  const salaryLine = salary ? `- Base floor: $${salary}` : '- (not specified)';
  const locationLine = location ? location : 'Open to remote';
  return `# Working Context\n\n## What I'm looking for\n\n${locationLine}\n\n## Target titles\n\n${titleLines}\n\n## Stack I'm most productive in\n\n${stackLines}\n\n## Compensation\n\n${salaryLine}\n`;
}

function buildCompaniesJs(searchTerms, profileDir) {
  let existing = null;
  if (profileDir) {
    try { existing = require(path.join(profileDir, 'companies.js')); } catch (e) {}
  }
  const terms = (searchTerms || '').split('\n').map(t => t.trim()).filter(Boolean);
  const termsList = terms.length
    ? terms.map(t => `  '${t.replace(/'/g, "\\'")}'`).join(',\n')
    : "  'backend engineer'";
  const toSlugLines = (arr) => (arr || []).filter(s => typeof s === 'string' && s && !s.includes('[object')).map(s => `  '${s}'`).join(',\n');
  const gh  = toSlugLines(existing?.GREENHOUSE_COMPANIES);
  const lv  = toSlugLines(existing?.LEVER_COMPANIES);
  const wk  = toSlugLines(existing?.WORKABLE_COMPANIES);
  const ash = toSlugLines(existing?.ASHBY_COMPANIES);
  const wd  = toSlugLines(existing?.WORKDAY_COMPANIES);
  const wf  = toSlugLines(existing?.WELLFOUND_ROLES);
  const rp  = toSlugLines(existing?.RIPPLING_COMPANIES);
  const maxAge = existing?.MAX_AGE_DAYS ?? 20;
  return `'use strict';\n\nconst MAX_AGE_DAYS = ${maxAge};\n\nconst SEARCH_TERMS = [\n${termsList},\n];\n\nconst GREENHOUSE_COMPANIES = [\n${gh}\n];\n\nconst LEVER_COMPANIES = [\n${lv}\n];\n\nconst WORKABLE_COMPANIES = [\n${wk}\n];\n\nconst ASHBY_COMPANIES = [\n${ash}\n];\n\nconst WORKDAY_COMPANIES = [\n${wd}\n];\n\nconst WELLFOUND_ROLES = [\n${wf}\n];\n\nconst RIPPLING_COMPANIES = [\n${rp}\n];\n\nmodule.exports = {\n  MAX_AGE_DAYS,\n  SEARCH_TERMS,\n  GREENHOUSE_COMPANIES,\n  LEVER_COMPANIES,\n  WORKABLE_COMPANIES,\n  ASHBY_COMPANIES,\n  WORKDAY_COMPANIES,\n  WELLFOUND_ROLES,\n  RIPPLING_COMPANIES,\n};\n`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); } catch (e) { resolve({}); }
    });
    req.on('error', reject);
  });
}

function createSetupHandlers({ profileDir, envPath, log, repoRoot }) {
  const setupLog = log
    ? log.child({ route: 'setup' })
    : require('./logger')('setup');
  const ROOT = repoRoot || path.resolve(__dirname, '..');

  async function handleSetupStatus(req, res) {
    const resumePath = path.join(profileDir, 'resume.md');
    const contextPath = path.join(profileDir, 'context.md');
    const companiesPath = path.join(profileDir, 'companies.js');
    const resumeContent = fs.existsSync(resumePath) ? fs.readFileSync(resumePath, 'utf8') : '';
    const contextContent = fs.existsSync(contextPath) ? fs.readFileSync(contextPath, 'utf8') : '';
    const companiesContent = fs.existsSync(companiesPath) ? fs.readFileSync(companiesPath, 'utf8') : '';
    const currentKey = process.env.GEMINI_API_KEY || '';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ resumeContent, contextContent, companiesContent, hasKey: !!currentKey }));
  }

  async function handleSetupResume(req, res) {
    try {
      const { content, format } = await readBody(req);
      if (format === 'pdf') {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
          setupLog.warn('resume upload rejected: no GEMINI_API_KEY in env');
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'no_key' }));
          return;
        }
        setupLog.info('resume upload received', { base64Length: (content || '').length });
        const https = require('https');
        const { waitForGeminiRateLimit, MODEL } = require('./gemini');
        await waitForGeminiRateLimit();
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const postData = JSON.stringify({
          contents: [{
            parts: [
              { inlineData: { mimeType: 'application/pdf', data: content } },
              { text: 'Extract the complete text content from this resume PDF. Return only the raw text, preserving structure with line breaks. Do not summarize or add commentary.' },
            ],
          }],
          generationConfig: { maxOutputTokens: 4096 },
        });
        const extracted = await new Promise((resolve) => {
          const reqOpts = new URL(url);
          const options = {
            hostname: reqOpts.hostname,
            path: reqOpts.pathname + reqOpts.search,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
          };
          const r = https.request(options, (apiRes) => {
            let body = '';
            apiRes.on('data', d => { body += d; });
            apiRes.on('end', () => {
              try {
                const parsed = JSON.parse(body);
                const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
                let errorMessage = '';
                if (!text) {
                  errorMessage = parsed?.error?.message || parsed?.promptFeedback?.blockReason || '';
                  setupLog.error('resume Gemini returned no text', {
                    status: apiRes.statusCode,
                    geminiError: errorMessage || 'none',
                    bodySnippet: body.slice(0, 500),
                  });
                }
                resolve({ ok: !!text, text, status: apiRes.statusCode, errorMessage });
              } catch (e) {
                setupLog.error('resume Gemini response JSON parse failed', {
                  status: apiRes.statusCode,
                  exception: e.message,
                  bodySnippet: body.slice(0, 500),
                });
                resolve({ ok: false, text: '', status: apiRes.statusCode, errorMessage: 'invalid JSON from Gemini' });
              }
            });
          });
          r.on('error', (err) => {
            setupLog.error('resume Gemini network error', { error: err.message });
            resolve({ ok: false, text: '', status: 0, errorMessage: err.message });
          });
          r.setTimeout(30000, () => {
            setupLog.error('resume Gemini timeout after 30s');
            r.destroy();
            resolve({ ok: false, text: '', status: 0, errorMessage: 'timeout after 30s' });
          });
          r.write(postData);
          r.end();
        });
        if (!extracted.ok) {
          const detail = extracted.errorMessage ? `: ${extracted.errorMessage}` : '';
          setupLog.warn('resume upload failed, returning error to client', { status: extracted.status, detail });
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: `Gemini ${extracted.status}${detail}` }));
          return;
        }
        setupLog.info('resume extracted via Gemini', { textLength: extracted.text.length });
        fs.writeFileSync(path.join(profileDir, 'resume.md'), extracted.text, 'utf8');
      } else if (content && content.trim()) {
        fs.writeFileSync(path.join(profileDir, 'resume.md'), content, 'utf8');
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      setupLog.error('resume handler unhandled exception', { error: e.message, stack: e.stack });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  }

  async function handleSetupProfile(req, res) {
    try {
      const body = await readBody(req);
      const md = buildContextMd(body);
      fs.writeFileSync(path.join(profileDir, 'context.md'), md, 'utf8');
      // Auto-derive search terms from job titles so the Search Terms wizard step is not needed
      const searchTerms = (body.titles || '').split('\n').map(t => t.trim().toLowerCase()).filter(Boolean).join('\n');
      const js = buildCompaniesJs(searchTerms, profileDir);
      fs.writeFileSync(path.join(profileDir, 'companies.js'), js, 'utf8');
      try { delete require.cache[require.resolve(path.join(profileDir, 'companies.js'))]; } catch (e) {}
      setupLog.info('profile saved', { titleCount: searchTerms.split('\n').filter(Boolean).length });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      setupLog.error('profile save failed', { error: e.message, stack: e.stack });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  }

  async function handleExtractProfile(req, res) {
    try {
      const resumePath = path.join(profileDir, 'resume.md');
      const resumeText = fs.existsSync(resumePath) ? fs.readFileSync(resumePath, 'utf8') : '';
      if (!resumeText.trim()) {
        setupLog.warn('extract-profile skipped: no resume.md content');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, titles: '', stack: '' }));
        return;
      }
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        setupLog.warn('extract-profile skipped: no GEMINI_API_KEY');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, titles: '', stack: '' }));
        return;
      }
      const { callGemini } = require('./gemini');
      const prompt = `You are extracting job search preferences from a resume. Given this resume:\n\n${resumeText}\n\nReturn ONLY a JSON object (no markdown fences, no extra text):\n{\n  "titles": ["title1", "title2"],\n  "stack": ["tech1", "tech2"]\n}\n\n- titles: 3-5 realistic target job titles based on the candidate's experience level and background\n- stack: key technologies, languages, and tools mentioned in the resume (up to 10 items)`;
      let result;
      try {
        const raw = await callGemini(prompt, 2, 512);
        const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
        result = JSON.parse(cleaned);
      } catch (e) {
        setupLog.error('extract-profile Gemini call failed', { error: e.message, stack: e.stack });
        result = { titles: [], stack: [] };
      }
      const titles = Array.isArray(result.titles) ? result.titles.join('\n') : '';
      const stack = Array.isArray(result.stack) ? result.stack.join('\n') : '';
      setupLog.info('extract-profile completed', { titleCount: titles.split('\n').filter(Boolean).length, stackCount: stack.split('\n').filter(Boolean).length });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, titles, stack }));
    } catch (e) {
      setupLog.error('extract-profile handler exception', { error: e.message, stack: e.stack });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, titles: '', stack: '' }));
    }
  }

  async function handleSetupCompanies(req, res) {
    try {
      const { searchTerms } = await readBody(req);
      const js = buildCompaniesJs(searchTerms, profileDir);
      fs.writeFileSync(path.join(profileDir, 'companies.js'), js, 'utf8');
      delete require.cache[require.resolve(path.join(profileDir, 'companies.js'))];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  }

  async function handleSetupApiKey(req, res) {
    try {
      const { key } = await readBody(req);
      if (key && key.trim()) {
        const trimmed = key.trim();
        updateEnvLine('GEMINI_API_KEY', trimmed, envPath);
        process.env.GEMINI_API_KEY = trimmed;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  }

  async function handleSetupTestKey(req, res) {
    try {
      const { key } = await readBody(req);
      if (!key || !key.trim()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'No key provided' }));
        return;
      }
      const https = require('https');
      const model = 'gemini-2.0-flash-lite';
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key.trim())}`;
      const postData = JSON.stringify({ contents: [{ parts: [{ text: 'hi' }] }] });
      const result = await new Promise((resolve) => {
        const reqOpts = new URL(url);
        const options = {
          hostname: reqOpts.hostname,
          path: reqOpts.pathname + reqOpts.search,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
        };
        const r = https.request(options, (apiRes) => {
          let body = '';
          apiRes.on('data', d => { body += d; });
          apiRes.on('end', () => resolve({ status: apiRes.statusCode, body }));
        });
        r.on('error', (e) => resolve({ status: 0, error: e.message }));
        r.setTimeout(8000, () => { r.destroy(); resolve({ status: 0, error: 'timeout' }); });
        r.write(postData);
        r.end();
      });
      if (result.status === 200 || result.status === 429) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } else if (result.status === 400 || result.status === 401 || result.status === 403) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Key rejected by Gemini (invalid or expired)' }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: `Gemini returned ${result.status}` }));
      }
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  }

  async function handleSetupRunRefresh(req, res) {
    try {
      const requiredFiles = ['resume.md', 'context.md', 'companies.js'];
      const missing = requiredFiles.filter(f => !fs.existsSync(path.join(profileDir, f)));
      if (missing.length) {
        setupLog.warn('run-refresh kickoff aborted: profile incomplete', { missing });
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: `Profile incomplete, missing: ${missing.join(', ')}` }));
        return;
      }

      const logPaths = require('./log-paths');
      const refreshLogFile = logPaths.daily('refresh');
      fs.mkdirSync(path.dirname(refreshLogFile), { recursive: true });
      const out = fs.openSync(refreshLogFile, 'a');
      const err = fs.openSync(refreshLogFile, 'a');

      const runId = `wizard-${Date.now().toString(36)}`;
      const { spawn } = require('child_process');
      const child = spawn(process.execPath, ['scripts/refresh.js'], {
        cwd: ROOT,
        detached: true,
        stdio: ['ignore', out, err],
        env: { ...process.env, RUN_ID: runId },
      });
      child.on('error', (e) => setupLog.error('refresh spawn error', { error: e.message }));
      child.unref();

      setupLog.info('kickoff refresh', { runId, pid: child.pid, logFile: refreshLogFile });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, runId, pid: child.pid }));
    } catch (e) {
      setupLog.error('run-refresh handler exception', { error: e.message, stack: e.stack });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  }

  return {
    handleSetupStatus,
    handleSetupResume,
    handleSetupProfile,
    handleSetupCompanies,
    handleSetupApiKey,
    handleSetupTestKey,
    handleExtractProfile,
    handleSetupRunRefresh,
  };
}

module.exports = { buildContextMd, buildCompaniesJs, updateEnvLine, createSetupHandlers };
