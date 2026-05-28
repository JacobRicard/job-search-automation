'use strict';

const path = require('path');
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const pathsModule = require.resolve('../config/paths');
const originalDataDir = process.env.DATA_DIR;
const originalDbDir = process.env.DB_DIR;

function loadPaths(env) {
  delete require.cache[pathsModule];
  if ('DATA_DIR' in env) process.env.DATA_DIR = env.DATA_DIR;
  else delete process.env.DATA_DIR;
  if ('DB_DIR' in env) process.env.DB_DIR = env.DB_DIR;
  else delete process.env.DB_DIR;
  return require('../config/paths');
}

afterEach(() => {
  delete require.cache[pathsModule];
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalDbDir === undefined) delete process.env.DB_DIR;
  else process.env.DB_DIR = originalDbDir;
});

describe('runtime paths', () => {
  it('keeps profile data in DATA_DIR while DB_DIR overrides only SQLite storage', () => {
    const paths = loadPaths({
      DATA_DIR: '/tmp/job-search-profile',
      DB_DIR: '/tmp/job-search-db',
    });

    assert.equal(paths.baseDir, '/tmp/job-search-profile');
    assert.equal(paths.jobsJsonPath, '/tmp/job-search-profile/jobs.json');
    assert.equal(paths.legacyDbPath, '/tmp/job-search-profile/jobs.db');
    assert.equal(paths.dbDir, '/tmp/job-search-db');
    assert.equal(paths.dbPath, '/tmp/job-search-db/jobs.db');
  });

  it('falls back to the profile directory for local SQLite storage', () => {
    const paths = loadPaths({ DATA_DIR: '/tmp/job-search-profile' });

    assert.equal(paths.baseDir, '/tmp/job-search-profile');
    assert.equal(paths.dbDir, '/tmp/job-search-profile');
    assert.equal(paths.dbPath, path.join('/tmp/job-search-profile', 'jobs.db'));
    assert.equal(paths.legacyDbPath, paths.dbPath);
  });
});
