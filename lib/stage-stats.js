'use strict';

const TRACKED_STAGES = ['phone_screen', 'interview', 'onsite', 'offer'];

function stagePlaceholders() {
  return TRACKED_STAGES.map(() => '?').join(',');
}

function getReachedRows(db) {
  const placeholders = stagePlaceholders();
  return db.prepare(`
    WITH reached AS (
      SELECT job_id, to_value AS stage
      FROM events
      WHERE event_type = 'stage_change'
        AND to_value IN (${placeholders})
      UNION
      SELECT id AS job_id, stage
      FROM jobs
      WHERE stage IN (${placeholders})
      UNION
      SELECT id AS job_id, rejected_from_stage AS stage
      FROM jobs
      WHERE rejected_from_stage IN (${placeholders})
    )
    SELECT job_id, stage FROM reached
  `).all(...TRACKED_STAGES, ...TRACKED_STAGES, ...TRACKED_STAGES);
}

function summarizeReachedRows(rows) {
  const reached = {
    phone_screen: new Set(),
    interview: new Set(),
    onsite: new Set(),
    offer: new Set(),
  };

  for (const row of rows) {
    if (reached[row.stage]) reached[row.stage].add(row.job_id);
  }

  const interviewOrBeyond = new Set([...reached.interview, ...reached.onsite, ...reached.offer]);
  const onsiteOrBeyond = new Set([...reached.onsite, ...reached.offer]);
  const anyAdvanced = new Set([
    ...reached.phone_screen,
    ...reached.interview,
    ...reached.onsite,
    ...reached.offer,
  ]);

  return {
    phoneScreens: reached.phone_screen.size,
    interviews: interviewOrBeyond.size,
    onsites: onsiteOrBeyond.size,
    offers: reached.offer.size,
    funnel: {
      phone_screen: reached.phone_screen.size,
      interview: interviewOrBeyond.size,
      onsite: onsiteOrBeyond.size,
      offer: reached.offer.size,
    },
    advancedJobIds: anyAdvanced,
  };
}

function getHistoricalStageStats(db) {
  return summarizeReachedRows(getReachedRows(db));
}

function getHistoricalAdvancedCountsByScore(db) {
  const rows = db.prepare(`
    WITH reached AS (
      SELECT job_id
      FROM events
      WHERE event_type = 'stage_change'
        AND to_value IN (${stagePlaceholders()})
      UNION
      SELECT id AS job_id
      FROM jobs
      WHERE stage IN (${stagePlaceholders()})
      UNION
      SELECT id AS job_id
      FROM jobs
      WHERE rejected_from_stage IN (${stagePlaceholders()})
    )
    SELECT j.score, COUNT(DISTINCT j.id) AS advanced
    FROM jobs j
    JOIN reached r ON r.job_id = j.id
    WHERE j.score IS NOT NULL AND j.applied_at IS NOT NULL
    GROUP BY j.score
  `).all(...TRACKED_STAGES, ...TRACKED_STAGES, ...TRACKED_STAGES);

  return new Map(rows.map(row => [row.score, row.advanced]));
}

module.exports = {
  getHistoricalStageStats,
  getHistoricalAdvancedCountsByScore,
};
