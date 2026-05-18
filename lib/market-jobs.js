'use strict';

const TERMINAL_MARKET_STATES = ['archived', 'closed', 'rejected', 'ghosted'];

function sqlList(values) {
  return values.map((value) => `'${value}'`).join(',');
}

function liveMarketWhere(alias = '') {
  const prefix = alias ? `${alias}.` : '';
  const terminalStates = sqlList(TERMINAL_MARKET_STATES);
  return `${prefix}status NOT IN (${terminalStates})
    AND COALESCE(${prefix}stage, '') NOT IN (${terminalStates})`;
}

function getLiveMarketResearchJobs(db) {
  return db.prepare(`
    SELECT title, company, description, score, posted_at, location
    FROM jobs
    WHERE ${liveMarketWhere()}
      AND description IS NOT NULL
      AND length(description) > 100
    ORDER BY score DESC, created_at DESC
  `).all();
}

function getAllTimeMarketResearchJobs(db) {
  return db.prepare(`
    SELECT title, company, description, score, posted_at, location
    FROM jobs
    WHERE description IS NOT NULL
      AND length(description) > 100
    ORDER BY score DESC, created_at DESC
  `).all();
}

function countLiveMarketResearchJobs(db) {
  return db.prepare(`
    SELECT COUNT(*) AS n
    FROM jobs
    WHERE ${liveMarketWhere()}
      AND description IS NOT NULL
      AND length(description) > 100
  `).get().n;
}

function countAllTimeMarketResearchJobs(db) {
  return db.prepare(`
    SELECT COUNT(*) AS n
    FROM jobs
    WHERE description IS NOT NULL
      AND length(description) > 100
  `).get().n;
}

function getLiveMarketSeniorityJobs(db) {
  return db.prepare(`
    SELECT title, description, score, status, applied_at, stage, rejected_from_stage
    FROM jobs
    WHERE ${liveMarketWhere()}
    ORDER BY score DESC, created_at DESC
  `).all();
}

function getAllTimeMarketSeniorityJobs(db) {
  return db.prepare(`
    SELECT title, description, score, status, applied_at, stage, rejected_from_stage
    FROM jobs
    WHERE title IS NOT NULL
      AND TRIM(title) != ''
    ORDER BY created_at DESC
  `).all();
}

function countAllTimeAppliedJobs(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM jobs WHERE applied_at IS NOT NULL').get().n;
}

module.exports = {
  TERMINAL_MARKET_STATES,
  liveMarketWhere,
  getLiveMarketResearchJobs,
  getAllTimeMarketResearchJobs,
  countLiveMarketResearchJobs,
  countAllTimeMarketResearchJobs,
  getLiveMarketSeniorityJobs,
  getAllTimeMarketSeniorityJobs,
  countAllTimeAppliedJobs,
};
