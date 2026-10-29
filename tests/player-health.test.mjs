import test from 'node:test';
import assert from 'node:assert/strict';
import {playerHealth} from '../shared/player-health.ts';

const duel = { id: 'loss', challenger_id: 1, target_id: 2, challenger_delta: -1, target_delta: 1, settled_at: 'done' };
const round = (gw, points, extra = {}) => ({ gw, finished: true, teams: [{ entryId: 1, captainPoints: points, captainPickRate: 50 }], ...extra });

test('one life minus two settles at zero and later gains cannot revive the eliminated player', () => {
  assert.deepEqual(playerHealth([round(9, 2, {duelResults:[duel]}), round(10, 15)], 1), { hp: 0, eliminated: true, eliminatedGw: 9 });
});
test('regular and duel life settle together without premature elimination between the two changes', () => {
  assert.equal(playerHealth([round(9, 2, {duelResults:[{...duel,challenger_delta:1}]})], 1).hp, 1);
  assert.equal(playerHealth([round(9, 2, {finished:false,duelResults:[duel]})], 1).eliminated, false);
});
test('a deleted duel or an earlier score correction re-derives elimination from valid history', () => {
  const history = [round(8, 10), round(9, 2, {duelResults:[duel]}), round(10, 15)];
  assert.equal(playerHealth(history, 1).eliminated, true);
  assert.deepEqual(playerHealth(history, 1, new Set(['loss'])), {hp:2,eliminated:false,eliminatedGw:null});
});
