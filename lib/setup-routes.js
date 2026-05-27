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
  const gh  = (existing?.GREENHOUSE_COMPANIES  || []).map(s => `  '${s}'`).join(',\n');
  const lv  = (existing?.LEVER_COMPANIES        || []).map(s => `  '${s}'`).join(',\n');
  const wk  = (existing?.WORKABLE_COMPANIES     || []).map(s => `  '${s}'`).join(',\n');
  const ash = (existing?.ASHBY_COMPANIES        || []).map(s => `  '${s}'`).join(',\n');
  const wd  = (existing?.WORKDAY_COMPANIES      || []).map(s => `  '${s}'`).join(',\n');
  const wf  = (existing?.WELLFOUND_ROLES        || []).map(s => `  '${s}'`).join(',\n');
  const rp  = (existing?.RIPPLING_COMPANIES     || []).map(s => `  '${s}'`).join(',\n');
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

function createSetupHandlers({ profileDir, envPath }) {
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
      const { content } = await readBody(req);
      if (content && content.trim()) {
        fs.writeFileSync(path.join(profileDir, 'resume.md'), content, 'utf8');
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  }

  async function handleSetupProfile(req, res) {
    try {
      const body = await readBody(req);
      const md = buildContextMd(body);
      fs.writeFileSync(path.join(profileDir, 'context.md'), md, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
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

  return {
    handleSetupStatus,
    handleSetupResume,
    handleSetupProfile,
    handleSetupCompanies,
    handleSetupApiKey,
    handleSetupTestKey,
  };
}

module.exports = { buildContextMd, buildCompaniesJs, updateEnvLine, createSetupHandlers };
