import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BRICK_REWARD_RULES, computeBrickRewards } from '../js/objects/RaceRewards.js';

test('earned bricks include only pickups and a 40-brick bonus for the winner', () => {
    assert.deepEqual(BRICK_REWARD_RULES, { lap: 0, finish: 0, victory: 40 });
    assert.deepEqual(computeBrickRewards({ collected: 7, laps: 2 }),
        { collected: 7, laps: 0, finish: 0, victory: 0, total: 7 });
    assert.equal(computeBrickRewards({ collected: 7, laps: 3, finished: true, place: 1 }).total, 47);
    assert.equal(computeBrickRewards({ collected: 7, laps: 3, finished: true, place: 2 }).total, 7);
    assert.equal(computeBrickRewards({ collected: 7, laps: 3, finished: true }).total, 7);
    assert.equal(computeBrickRewards({ place: 1 }).total, 0);
});

test('completing laps and finishing without pickups grants no credit to the runner-up', () => {
    for (const laps of [0, 1, 2, 3]) {
        for (const finished of [false, true]) {
            assert.equal(computeBrickRewards({ laps, finished, place: 2 }).total, 0);
        }
    }
    assert.equal(computeBrickRewards({ laps: 3, finished: true, place: 1 }).total, 40);
});

test('currency uses nonnegative whole bricks and can configure race reward rates', () => {
    assert.deepEqual(computeBrickRewards({ collected: -1, laps: NaN }),
        { collected: 0, laps: 0, finish: 0, victory: 0, total: 0 });
    assert.equal(computeBrickRewards({ collected: 3.7, laps: 2.5 }).total, 3);
    assert.equal(computeBrickRewards({ collected: 3, laps: 2, finished: true, place: 1 },
        { lap: 0, finish: 0, victory: 25 }).total, 28);
});
