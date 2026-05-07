'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { parseScoreResponse } = require('../scorer');

describe('parseScoreResponse', () => {
  it('parses a well-formed response', () => {
    const text = 'SCORE: 7\nREASONING: Strong tech stack fit, location matches, mid-level role.';
    const result = parseScoreResponse(text);
    assert.equal(result.score, 7);
    assert.equal(result.reasoning, 'Strong tech stack fit, location matches, mid-level role.');
  });

  it('captures multi-line REASONING', () => {
    const text = 'SCORE: 8\nREASONING: First sentence.\nSecond sentence.\nThird sentence.';
    const result = parseScoreResponse(text);
    assert.equal(result.score, 8);
    assert.match(result.reasoning, /First sentence\./);
    assert.match(result.reasoning, /Third sentence\./);
  });

  it('clamps scores above 10', () => {
    const result = parseScoreResponse('SCORE: 15\nREASONING: too high');
    assert.equal(result.score, 10);
  });

  it('clamps scores below 1', () => {
    const result = parseScoreResponse('SCORE: 0\nREASONING: too low');
    assert.equal(result.score, 1);
  });

  it('returns null score and parse-fail reasoning when SCORE missing', () => {
    const result = parseScoreResponse('I cannot evaluate this job.');
    assert.equal(result.score, null);
    assert.match(result.reasoning, /Score parse failed/);
  });

  it('returns score and raw text when SCORE present but REASONING missing', () => {
    const text = 'SCORE: 6\n(no reasoning section)';
    const result = parseScoreResponse(text);
    assert.equal(result.score, 6);
    assert.equal(result.reasoning, text);
  });

  it('truncates very long parse-fail reasoning', () => {
    const longText = 'no markers '.repeat(100);
    const result = parseScoreResponse(longText);
    assert.equal(result.score, null);
    assert.ok(result.reasoning.length < 250, 'reasoning should be truncated');
  });

  it('ignores SCORE on a line that is not at the start', () => {
    const result = parseScoreResponse('Some preamble. SCORE: 5\nREASONING: x');
    assert.equal(result.score, null);
  });
});
