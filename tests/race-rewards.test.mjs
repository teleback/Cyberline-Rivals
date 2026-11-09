import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BRICK_REWARD_RULES, computeBrickRewards } from '../js/objects/RaceRewards.js';

test('collected bricks scale to 25 based on the race total and grant a 25-brick victory bonus', () => {
    assert.deepEqual(BRICK_REWARD_RULES, { lap: 0, finish: 0, victory: 25 });
    assert.deepEqual(computeBrickRewards({ collected: 7, totalAvailable: 100, laps: 2 }),
        { collected: 2, laps: 0, finish: 0, victory: 0, total: 2 });
    assert.deepEqual(computeBrickRewards({ collected: 50, totalAvailable: 100 }),
        { collected: 13, laps: 0, finish: 0, victory: 0, total: 13 });
    assert.deepEqual(computeBrickRewards({ collected: 100, totalAvailable: 100, laps: 3, finished: true, place: 1 }),
        { collected: 25, laps: 0, finish: 0, victory: 25, total: 50 });
    assert.equal(computeBrickRewards({ collected: 50, totalAvailable: 100, laps: 3, finished: true, place: 2 }).total, 13);
    assert.equal(computeBrickRewards({ collected: 50, totalAvailable: 100, laps: 3, finished: true }).total, 13);
    assert.equal(computeBrickRewards({ place: 1 }).total, 0);
});

test('completing laps and finishing without pickups grants no credit to the runner-up', () => {
    for (const laps of [0, 1, 2, 3]) {
        for (const finished of [false, true]) {
            assert.equal(computeBrickRewards({ laps, finished, place: 2 }).total, 0);
        }
    }
    assert.equal(computeBrickRewards({ laps: 3, finished: true, place: 1 }).total, 25);
});

test('currency uses nonnegative whole bricks and can configure race reward rates', () => {
    assert.deepEqual(computeBrickRewards({ collected: -1, totalAvailable: 100, laps: NaN }),
        { collected: 0, laps: 0, finish: 0, victory: 0, total: 0 });
    assert.equal(computeBrickRewards({ collected: 3.7, totalAvailable: 4, laps: 2.5 }).total, 19);
    assert.equal(computeBrickRewards({ collected: 2, totalAvailable: 4, laps: 2, finished: true, place: 1 },
        { lap: 0, finish: 0, victory: 25 }).total, 38);
});
