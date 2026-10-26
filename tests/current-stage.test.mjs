import assert from 'node:assert/strict';
import test from 'node:test';
import { currentStageAt } from '../app/current-stage.ts';
import { fallbackGwDeadlines } from '../app/current-trial.ts';

test('chapter opens at the preceding final DDL, independently of the displayed gameweek', () => {
  assert.equal(currentStageAt(Date.parse('2026-08-01T00:00:00Z')), 1);
  for (const [gw, next] of [[8, 2], [20, 3], [30, 4], [34, 5]]) {
    const deadline = Date.parse(fallbackGwDeadlines.find((event) => event.gw === gw).deadlineTime);
    assert.equal(currentStageAt(deadline - 1), next - 1);
    assert.equal(currentStageAt(deadline), next);
  }
  assert.equal(currentStageAt(Date.parse('2026-10-26T00:00:00Z')), 2);
});

test('official corrected deadlines override the built-in schedule', () => {
  const revised = fallbackGwDeadlines.map((event) => event.gw === 8
    ? { ...event, deadlineTime: '2026-10-27T00:00:00Z' } : event);
  assert.equal(currentStageAt(Date.parse('2026-10-26T00:00:00Z'), revised), 1);
  assert.equal(currentStageAt(Date.parse('2026-10-27T00:00:00Z'), revised), 2);
});
