import test from 'node:test';
import assert from 'node:assert/strict';
import {playerHealth} from '../shared/player-health.ts';

const duel = { id: 'loss', challenger_id: 1, target_id: 2, challenger_delta: -1, target_delta: 1, settled_at: 'done' };
const round = (gw, points, extra = {}) => ({ gw, finished: true, officialFinalized: true, teams: [{ entryId: 1, captainPoints: points, captainPickRate: 50 }], ...extra });

test('one life minus two settles at zero and later gains cannot revive the eliminated player', () => {
  assert.deepEqual(playerHealth([round(9, 2, {duelResults:[duel]}), round(10, 15)], 1), { hp: 0, eliminated: true, eliminatedGw: 9 });
});
test('regular and duel life settle together without premature elimination between the two changes', () => {
  assert.equal(playerHealth([round(9, 2, {duelResults:[{...duel,challenger_delta:1}]})], 1).hp, 1);
  assert.equal(playerHealth([round(9, 2, {finished:false,duelResults:[duel]})], 1).eliminated, false);
  assert.deepEqual(playerHealth([round(9, 2, {officialFinalized:false,duelResults:[duel]})], 1), {hp:1,eliminated:false,eliminatedGw:null});
});
test('a deleted duel or an earlier score correction re-derives elimination from valid history', () => {
  const history = [round(8, 10), round(9, 2, {duelResults:[duel]}), round(10, 15)];
  assert.equal(playerHealth(history, 1).eliminated, true);
  assert.deepEqual(playerHealth(history, 1, new Set(['loss'])), {hp:2,eliminated:false,eliminatedGw:null});
});
test('GW9–GW20 deducts one life at three or fewer points, only after round confirmation', () => {
  for (const gw of [9, 20]) {
    for (const points of [-1, 0, 2, 3, 4, 9, 10]) {
      const expected = points <= 3 ? 1 : points >= 10 ? 3 : 2;
      assert.equal(playerHealth([round(8, 10), round(gw, points)], 1).hp, expected);
      assert.equal(playerHealth([round(8, 10), round(gw, points, { finished: false })], 1).hp, 2);
      assert.equal(playerHealth([round(8, 10), round(gw, points, { officialFinalized: false })], 1).hp, 2);
    }
  }
});

test('GW12 selected players use only team results, and a revived player follows normal GW13 health', () => {
  const selection = { gw: 12, status: 'success', abyss: [1], ice: [2], abyssScore: 10, iceScore: 3 };
  const previous = [round(8, 10), round(11, 2, { teams: [{ entryId: 1, captainPoints: 2 }, { entryId: 2, captainPoints: 8 }] })];
  const death = round(9, 2);
  for (const points of [-1, 3, 10, 20]) {
    const snapshot = round(12, points, { resurrection: selection, teams: [{ entryId: 1, captainPoints: points }, { entryId: 2, captainPoints: points }] });
    assert.equal(playerHealth([death, snapshot], 1).hp, 1);
    const iceHistory = [round(1, 10, { teams: [{ entryId: 2, captainPoints: 10 }] }), snapshot];
    assert.equal(playerHealth(iceHistory, 2).hp, 1);
    assert.equal(playerHealth([iceHistory[0], { ...snapshot, resurrection: { ...selection, status: 'failed' } }], 2).hp, 3);
  }
  const revive = round(12, 10, { resurrection: selection });
  assert.equal(playerHealth([death, revive, round(13, 2)], 1).hp, 0);
  assert.equal(playerHealth([death, revive, round(13, 10)], 1).hp, 2);
  assert.equal(playerHealth([death, { ...revive, officialFinalized: false }], 1).hp, 0);
  assert.equal(playerHealth([...previous, round(12, 10)], 1).hp, 2);
});
