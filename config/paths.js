'use strict';

const path = require('path');

const baseDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');
const dbPath = path.join(baseDir, 'jobs.db');
const jobsJsonPath = path.join(baseDir, 'jobs.json');
const publicDir = path.join(__dirname, '..', 'public');
const transcriptsDir = path.join(__dirname, '..', 'transcripts');

module.exports = { baseDir, dbPath, jobsJsonPath, publicDir, transcriptsDir };
