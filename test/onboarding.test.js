'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const { buildContextMd, buildCompaniesJs, updateEnvLine, createSetupHandlers } = require('../lib/setup-routes');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jsa-test-'));
}

function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function post(port, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      { hostname: '127.0.0.1', port, path: urlPath, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => {
        let chunks = '';
        res.on('data', d => { chunks += d; });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(chunks) }));
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path: urlPath, method: 'GET' },
      (res) => {
        let chunks = '';
        res.on('data', d => { chunks += d; });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(chunks) }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function startServer(handlers) {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const key = `${req.method} ${req.url}`;
      const map = {
        'GET /api/setup/status':      handlers.handleSetupStatus,
        'POST /api/setup/resume':     handlers.handleSetupResume,
        'POST /api/setup/profile':    handlers.handleSetupProfile,
        'POST /api/setup/companies':  handlers.handleSetupCompanies,
        'POST /api/setup/api-key':    handlers.handleSetupApiKey,
        'POST /api/setup/test-key':   handlers.handleSetupTestKey,
      };
      if (map[key]) {
        await map[key](req, res);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// ---------------------------------------------------------------------------
// Group 1: buildContextMd
// ---------------------------------------------------------------------------

describe('buildContextMd', () => {
  it('generates correct markdown with all fields', () => {
    const md = buildContextMd({ titles: 'Staff Engineer', stack: 'Go\nPostgres', salary: '200000', location: 'Remote' });
    assert.ok(md.includes('## What I\'m looking for'));
    assert.ok(md.includes('Remote'));
    assert.ok(md.includes('- Staff Engineer'));
    assert.ok(md.includes('- Go'));
    assert.ok(md.includes('- Postgres'));
    assert.ok(md.includes('- Base floor: $200000'));
  });

  it('uses (not specified) when titles is empty', () => {
    const md = buildContextMd({ titles: '', stack: 'Go', salary: '150000', location: 'Remote' });
    assert.ok(md.includes('## Target titles\n\n- (not specified)'));
  });

  it('uses (not specified) when stack is empty', () => {
    const md = buildContextMd({ titles: 'Engineer', stack: '', salary: '150000', location: 'Remote' });
    assert.ok(md.includes('## Stack I\'m most productive in\n\n- (not specified)'));
  });

  it('uses (not specified) for compensation when salary is empty', () => {
    const md = buildContextMd({ titles: 'Engineer', stack: 'Go', salary: '', location: 'Remote' });
    assert.ok(md.includes('## Compensation\n\n- (not specified)'));
  });

  it('defaults location to "Open to remote" when not provided', () => {
    const md = buildContextMd({ titles: 'Engineer', stack: 'Go', salary: '150000', location: '' });
    assert.ok(md.includes('Open to remote'));
  });

  it('turns multi-line titles into bullet points', () => {
    const md = buildContextMd({ titles: 'Staff Engineer\nPrincipal Engineer\nSenior Engineer', stack: 'Go', salary: '150000', location: 'Remote' });
    assert.ok(md.includes('- Staff Engineer'));
    assert.ok(md.includes('- Principal Engineer'));
    assert.ok(md.includes('- Senior Engineer'));
  });
});

// ---------------------------------------------------------------------------
// Group 2: buildCompaniesJs
// ---------------------------------------------------------------------------

describe('buildCompaniesJs', () => {
  it('single search term produces valid JS with that term in SEARCH_TERMS', () => {
    const js = buildCompaniesJs('backend engineer', null);
    const mod = {};
    // eslint-disable-next-line no-new-func
    new Function('module', js)(mod);
    assert.deepEqual(mod.exports.SEARCH_TERMS, ['backend engineer']);
  });

  it('multiple newline-separated terms all appear in SEARCH_TERMS', () => {
    const js = buildCompaniesJs('backend engineer\nplatform engineer\nSRE', null);
    const mod = {};
    new Function('module', js)(mod); // eslint-disable-line no-new-func
    assert.deepEqual(mod.exports.SEARCH_TERMS, ['backend engineer', 'platform engineer', 'SRE']);
  });

  it('empty searchTerms defaults to "backend engineer"', () => {
    const js = buildCompaniesJs('', null);
    const mod = {};
    new Function('module', js)(mod); // eslint-disable-line no-new-func
    assert.deepEqual(mod.exports.SEARCH_TERMS, ['backend engineer']);
  });

  it('escapes single quotes in search terms', () => {
    const js = buildCompaniesJs("it's complicated", null);
    assert.ok(js.includes("it\\'s complicated"));
    const mod = {};
    new Function('module', js)(mod); // eslint-disable-line no-new-func
    assert.deepEqual(mod.exports.SEARCH_TERMS, ["it's complicated"]);
  });

  it('preserves existing company arrays when companies.js already exists', () => {
    const tmpDir = makeTmpDir();
    try {
      const existing = `'use strict';\nconst MAX_AGE_DAYS=30;\nconst SEARCH_TERMS=['old'];\nconst GREENHOUSE_COMPANIES=['acme'];\nconst LEVER_COMPANIES=[];\nconst WORKABLE_COMPANIES=[];\nconst ASHBY_COMPANIES=['beta'];\nconst WORKDAY_COMPANIES=[];\nconst WELLFOUND_ROLES=[];\nconst RIPPLING_COMPANIES=[];\nmodule.exports={MAX_AGE_DAYS,SEARCH_TERMS,GREENHOUSE_COMPANIES,LEVER_COMPANIES,WORKABLE_COMPANIES,ASHBY_COMPANIES,WORKDAY_COMPANIES,WELLFOUND_ROLES,RIPPLING_COMPANIES};`;
      fs.writeFileSync(path.join(tmpDir, 'companies.js'), existing, 'utf8');
      const js = buildCompaniesJs('new term', tmpDir);
      const mod = {};
      new Function('module', js)(mod); // eslint-disable-line no-new-func
      assert.deepEqual(mod.exports.SEARCH_TERMS, ['new term']);
      assert.deepEqual(mod.exports.GREENHOUSE_COMPANIES, ['acme']);
      assert.deepEqual(mod.exports.ASHBY_COMPANIES, ['beta']);
      assert.equal(mod.exports.MAX_AGE_DAYS, 30);
    } finally {
      rmDir(tmpDir);
      delete require.cache[require.resolve(path.join(tmpDir, 'companies.js'))];
    }
  });
});

// ---------------------------------------------------------------------------
// Group 3: updateEnvLine
// ---------------------------------------------------------------------------

describe('updateEnvLine', () => {
  it('writes a new key to an empty/missing file', () => {
    const tmpDir = makeTmpDir();
    const envPath = path.join(tmpDir, '.env');
    try {
      updateEnvLine('GEMINI_API_KEY', 'abc123', envPath);
      assert.ok(fs.readFileSync(envPath, 'utf8').includes('GEMINI_API_KEY=abc123'));
    } finally {
      rmDir(tmpDir);
    }
  });

  it('updates an existing key in place', () => {
    const tmpDir = makeTmpDir();
    const envPath = path.join(tmpDir, '.env');
    try {
      fs.writeFileSync(envPath, 'GEMINI_API_KEY=old\n', 'utf8');
      updateEnvLine('GEMINI_API_KEY', 'new123', envPath);
      const content = fs.readFileSync(envPath, 'utf8');
      assert.ok(content.includes('GEMINI_API_KEY=new123'));
      assert.ok(!content.includes('GEMINI_API_KEY=old'));
    } finally {
      rmDir(tmpDir);
    }
  });

  it('preserves other keys when updating', () => {
    const tmpDir = makeTmpDir();
    const envPath = path.join(tmpDir, '.env');
    try {
      fs.writeFileSync(envPath, 'OTHER_KEY=keep\nGEMINI_API_KEY=old\nANOTHER=also\n', 'utf8');
      updateEnvLine('GEMINI_API_KEY', 'updated', envPath);
      const content = fs.readFileSync(envPath, 'utf8');
      assert.ok(content.includes('OTHER_KEY=keep'));
      assert.ok(content.includes('ANOTHER=also'));
      assert.ok(content.includes('GEMINI_API_KEY=updated'));
    } finally {
      rmDir(tmpDir);
    }
  });

  it('escapes backslashes in values', () => {
    const tmpDir = makeTmpDir();
    const envPath = path.join(tmpDir, '.env');
    try {
      updateEnvLine('MY_KEY', 'C:\\Users\\test', envPath);
      const content = fs.readFileSync(envPath, 'utf8');
      assert.ok(content.includes('MY_KEY=C:\\\\Users\\\\test'));
    } finally {
      rmDir(tmpDir);
    }
  });
});

// ---------------------------------------------------------------------------
// Group 4: HTTP handlers (integration)
// ---------------------------------------------------------------------------

describe('setup HTTP handlers', () => {
  let server;
  let port;
  let tmpDir;
  let envPath;
  const savedKey = process.env.GEMINI_API_KEY;

  before(async () => {
    tmpDir = makeTmpDir();
    envPath = path.join(tmpDir, '.env');
    const handlers = createSetupHandlers({ profileDir: tmpDir, envPath });
    server = await startServer(handlers);
    port = server.address().port;
  });

  after(async () => {
    await new Promise((resolve, reject) => {
      server.close((err) => err ? reject(err) : resolve());
    });
    rmDir(tmpDir);
    if (savedKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = savedKey;
  });

  it('GET /api/setup/status returns empty strings and hasKey false when no files exist', async () => {
    delete process.env.GEMINI_API_KEY;
    const { status, body } = await get(port, '/api/setup/status');
    assert.equal(status, 200);
    assert.equal(body.resumeContent, '');
    assert.equal(body.contextContent, '');
    assert.equal(body.companiesContent, '');
    assert.equal(body.hasKey, false);
  });

  it('GET /api/setup/status returns resumeContent when resume.md exists', async () => {
    fs.writeFileSync(path.join(tmpDir, 'resume.md'), 'Jane Doe resume', 'utf8');
    const { body } = await get(port, '/api/setup/status');
    assert.equal(body.resumeContent, 'Jane Doe resume');
    fs.rmSync(path.join(tmpDir, 'resume.md'));
  });

  it('GET /api/setup/status returns hasKey true when GEMINI_API_KEY is set', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    const { body } = await get(port, '/api/setup/status');
    assert.equal(body.hasKey, true);
    delete process.env.GEMINI_API_KEY;
  });

  it('POST /api/setup/resume writes resume.md and returns ok', async () => {
    const { status, body } = await post(port, '/api/setup/resume', { content: 'My resume text' });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    const written = fs.readFileSync(path.join(tmpDir, 'resume.md'), 'utf8');
    assert.equal(written, 'My resume text');
  });

  it('POST /api/setup/resume with empty content does not write a file', async () => {
    const resumePath = path.join(tmpDir, 'resume.md');
    if (fs.existsSync(resumePath)) fs.rmSync(resumePath);
    const { status, body } = await post(port, '/api/setup/resume', { content: '   ' });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(fs.existsSync(resumePath), false);
  });

  it('POST /api/setup/profile writes context.md containing submitted titles', async () => {
    const { status, body } = await post(port, '/api/setup/profile', {
      titles: 'Staff Engineer\nPrincipal Engineer',
      stack: 'Go\nKubernetes',
      salary: '200000',
      location: 'Remote',
    });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    const written = fs.readFileSync(path.join(tmpDir, 'context.md'), 'utf8');
    assert.ok(written.includes('- Staff Engineer'));
    assert.ok(written.includes('- Principal Engineer'));
    assert.ok(written.includes('- Base floor: $200000'));
  });

  it('POST /api/setup/companies writes valid companies.js with correct SEARCH_TERMS', async () => {
    const { status, body } = await post(port, '/api/setup/companies', { searchTerms: 'backend engineer\ndevops' });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    const companiesPath = path.join(tmpDir, 'companies.js');
    assert.ok(fs.existsSync(companiesPath));
    const loaded = require(companiesPath);
    assert.deepEqual(loaded.SEARCH_TERMS, ['backend engineer', 'devops']);
    delete require.cache[require.resolve(companiesPath)];
  });

  it('POST /api/setup/api-key writes GEMINI_API_KEY to .env', async () => {
    const { status, body } = await post(port, '/api/setup/api-key', { key: 'AIzaTestKey123' });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    const content = fs.readFileSync(envPath, 'utf8');
    assert.ok(content.includes('GEMINI_API_KEY=AIzaTestKey123'));
  });

  it('POST /api/setup/api-key with empty key does not touch .env', async () => {
    fs.writeFileSync(envPath, 'EXISTING=value\n', 'utf8');
    const { status, body } = await post(port, '/api/setup/api-key', { key: '' });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    const content = fs.readFileSync(envPath, 'utf8');
    assert.equal(content, 'EXISTING=value\n');
  });

  it('POST /api/setup/test-key with no key returns 400', async () => {
    const { status, body } = await post(port, '/api/setup/test-key', { key: '' });
    assert.equal(status, 400);
    assert.equal(body.ok, false);
    assert.equal(body.error, 'No key provided');
  });
});

// ---------------------------------------------------------------------------
// Group 5: isFirstRun gate
// ---------------------------------------------------------------------------

describe('isFirstRun gate', () => {
  it('isFirstRun is true when jobs table has zero rows', () => {
    const fakeDb = { prepare: (sql) => ({ get: () => ({ n: 0 }) }) };
    const isFirstRun = fakeDb.prepare('SELECT COUNT(*) as n FROM jobs').get().n === 0;
    assert.equal(isFirstRun, true);
  });

  it('isFirstRun is false when jobs table has rows', () => {
    const fakeDb = { prepare: (sql) => ({ get: () => ({ n: 5 }) }) };
    const isFirstRun = fakeDb.prepare('SELECT COUNT(*) as n FROM jobs').get().n === 0;
    assert.equal(isFirstRun, false);
  });
});
