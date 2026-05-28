'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const pathsModule = require.resolve('../config/paths');
const dbModule = require.resolve('../lib/db');
const originalDataDir = process.env.DATA_DIR;
const originalDbDir = process.env.DB_DIR;

function loadDbWithDirs(dataDir, dbDir) {
  delete require.cache[dbModule];
  delete require.cache[pathsModule];
  process.env.DATA_DIR = dataDir;
  process.env.DB_DIR = dbDir;
  return require('../lib/db');
}

afterEach(() => {
  const cachedDb = require.cache[dbModule]?.exports;
  if (cachedDb && typeof cachedDb.closeDb === 'function') cachedDb.closeDb();
  delete require.cache[dbModule];
  delete require.cache[pathsModule];
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalDbDir === undefined) delete process.env.DB_DIR;
  else process.env.DB_DIR = originalDbDir;
});

describe('DB storage preparation', () => {
  it('recognizes valid SQLite headers and rejects corrupt existing DB files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'job-search-db-storage-'));
    const validPath = path.join(dir, 'valid.db');
    const corruptPath = path.join(dir, 'corrupt.db');
    const db = new Database(validPath);
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)');
    db.close();
    fs.writeFileSync(corruptPath, Buffer.alloc(32));

    const storage = loadDbWithDirs(path.join(dir, 'data'), path.join(dir, 'db'));
    assert.equal(storage.hasSqliteHeader(validPath), true);
    assert.equal(storage.hasSqliteHeader(corruptPath), false);
    assert.throws(
      () => storage.assertValidExistingDb(corruptPath),
      /invalid file header/
    );
  });

  it('migrates a valid legacy data/jobs.db into DB_DIR once', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'job-search-db-migrate-'));
    const dataDir = path.join(root, 'data');
    const dbDir = path.join(root, 'db');
    fs.mkdirSync(dataDir, { recursive: true });

    const legacyPath = path.join(dataDir, 'jobs.db');
    const legacyDb = new Database(legacyPath);
    legacyDb.exec('CREATE TABLE migrated (id INTEGER PRIMARY KEY, name TEXT)');
    legacyDb.prepare('INSERT INTO migrated (name) VALUES (?)').run('legacy');
    legacyDb.close();

    const storage = loadDbWithDirs(dataDir, dbDir);
    storage.prepareDbStorage();

    const migratedPath = path.join(dbDir, 'jobs.db');
    assert.equal(storage.hasSqliteHeader(migratedPath), true);
    const migratedDb = new Database(migratedPath, { readonly: true });
    assert.deepEqual(migratedDb.prepare('SELECT name FROM migrated').get(), { name: 'legacy' });
    migratedDb.close();
  });

  it('does not copy a corrupt legacy DB into empty DB_DIR', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'job-search-db-corrupt-'));
    const dataDir = path.join(root, 'data');
    const dbDir = path.join(root, 'db');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'jobs.db'), Buffer.alloc(32));

    const storage = loadDbWithDirs(dataDir, dbDir);
    storage.prepareDbStorage();

    assert.equal(fs.existsSync(path.join(dbDir, 'jobs.db')), false);
  });
});
