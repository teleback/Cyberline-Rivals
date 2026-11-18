import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BRICK_REWARD_RULES, computeBrickRewards, getCollectionMultiplier } from '../js/objects/RaceRewards.js';

test('collected bricks scale to 50 based on the race total and grant a 50-brick victory bonus', () => {
    assert.deepEqual(BRICK_REWARD_RULES, { lap: 0, finish: 0, victory: 50 });
    assert.equal(getCollectionMultiplier(100), 0.5);
    assert.deepEqual(computeBrickRewards({ collected: 7, totalAvailable: 100, laps: 2 }),
        { collected: 4, laps: 0, finish: 0, victory: 0, total: 4 });
    assert.deepEqual(computeBrickRewards({ collected: 50, totalAvailable: 100 }),
        { collected: 25, laps: 0, finish: 0, victory: 0, total: 25 });
    assert.deepEqual(computeBrickRewards({ collected: 100, totalAvailable: 100, laps: 3, finished: true, place: 1 }),
        { collected: 50, laps: 0, finish: 0, victory: 50, total: 100 });
    assert.equal(computeBrickRewards({ collected: 50, totalAvailable: 100, laps: 3, finished: true, place: 2 }).total, 25);
    assert.equal(computeBrickRewards({ collected: 50, totalAvailable: 100, laps: 3, finished: true }).total, 25);
    assert.equal(computeBrickRewards({ place: 1 }).total, 0);
});

test('the existing 72 pickups per lap over 3 laps give proportional rewards capped at 50', () => {
    const totalAvailable = 72 * 3;
    assert.equal(getCollectionMultiplier(totalAvailable), 50 / totalAvailable);
    for (const [collected, expected] of [[0, 0], [54, 13], [108, 25], [162, 38], [216, 50], [500, 50]]) {
        const winner = computeBrickRewards({ collected, totalAvailable, finished: true, place: 1 });
        const runnerUp = computeBrickRewards({ collected, totalAvailable, finished: true, place: 2 });
        assert.equal(winner.collected, expected);
        assert.equal(winner.victory, 50);
        assert.equal(winner.total, expected + 50);
        assert.equal(runnerUp.collected, expected);
        assert.equal(runnerUp.victory, 0);
        assert.equal(runnerUp.total, expected);
    }
    assert.equal(getCollectionMultiplier(0), 0);
    assert.equal(computeBrickRewards({ collected: 30, totalAvailable: 0 }).collected, 0);
});

test('completing laps and finishing without pickups grants no credit to the runner-up', () => {
    for (const laps of [0, 1, 2, 3]) {
        for (const finished of [false, true]) {
            assert.equal(computeBrickRewards({ laps, finished, place: 2 }).total, 0);
        }
    }
    assert.equal(computeBrickRewards({ laps: 3, finished: true, place: 1 }).total, 50);
});

test('currency uses nonnegative whole bricks and can configure race reward rates', () => {
    assert.deepEqual(computeBrickRewards({ collected: -1, totalAvailable: 100, laps: NaN }),
        { collected: 0, laps: 0, finish: 0, victory: 0, total: 0 });
    assert.equal(computeBrickRewards({ collected: 3.7, totalAvailable: 4, laps: 2.5 }).total, 38);
    assert.equal(computeBrickRewards({ collected: 2, totalAvailable: 4, laps: 2, finished: true, place: 1 },
        { lap: 0, finish: 0, victory: 25 }).total, 50);
});


test('victory bonus does not depend on collections and is paid only to first place', () => {
    assert.deepEqual(computeBrickRewards({ collected: 0, totalAvailable: 216, finished: true, place: 1 }),
        { collected: 0, laps: 0, finish: 0, victory: 50, total: 50 });
    assert.equal(computeBrickRewards({ collected: 108, totalAvailable: 216, finished: true, place: 1 }).total, 75);
    assert.equal(computeBrickRewards({ collected: 216, totalAvailable: 216, finished: true, place: 1 }).total, 100);
    assert.equal(computeBrickRewards({ collected: 9999, totalAvailable: 216, finished: true, place: 2 }).total, 50);
});
