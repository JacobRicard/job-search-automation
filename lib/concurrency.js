'use strict';

/**
 * Run `fn` over `items` with at most `limit` calls in flight at once.
 * Results are returned in input order. `fn` receives (item, index).
 *
 * A bounded worker pool: `limit` workers pull from a shared cursor until the
 * list is exhausted. Use this when each call is independent I/O (network, LLM)
 * so latency overlaps instead of summing.
 */
async function mapConcurrent(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;
  const workers = Math.max(1, Math.min(limit, items.length));
  async function worker() {
    while (idx < items.length) {
      const current = idx++;
      results[current] = await fn(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}

module.exports = { mapConcurrent };
