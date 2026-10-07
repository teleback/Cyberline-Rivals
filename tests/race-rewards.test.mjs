import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BRICK_REWARD_RULES, computeBrickRewards } from '../js/objects/RaceRewards.js';

test('earned bricks combine pickups, completed laps and only applicable finish rewards', () => {
    assert.deepEqual(BRICK_REWARD_RULES, { lap: 10, finish: 20, victory: 50 });
    assert.deepEqual(computeBrickRewards({ collected: 7, laps: 2 }),
        { collected: 7, laps: 20, finish: 0, victory: 0, total: 27 });
    assert.equal(computeBrickRewards({ collected: 7, laps: 3, finished: true, place: 1 }).total, 107);
    assert.equal(computeBrickRewards({ collected: 7, laps: 3, finished: true, place: 2 }).total, 57);
    assert.equal(computeBrickRewards({ collected: 7, laps: 3, finished: true }).total, 57);
    assert.equal(computeBrickRewards({ place: 1 }).total, 0);
});

test('currency uses nonnegative whole bricks and can configure race reward rates', () => {
    assert.deepEqual(computeBrickRewards({ collected: -1, laps: NaN }),
        { collected: 0, laps: 0, finish: 0, victory: 0, total: 0 });
    assert.equal(computeBrickRewards({ collected: 3.7, laps: 2.5 }).total, 23);
    assert.equal(computeBrickRewards({ collected: 3, laps: 2, finished: true, place: 1 },
        { lap: 5, finish: 10, victory: 25 }).total, 48);
});
