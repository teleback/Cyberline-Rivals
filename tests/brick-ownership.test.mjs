import assert from 'node:assert/strict';
import { test } from 'node:test';
import BrickOwnership from '../js/objects/BrickOwnership.js';

const round = { roundId: 'session-a:start-1000', coordinatorId: 'a', participantIds: ['b', 'a'] };
const wire = ownership => ({
    id: ownership.playerId, lap: 3,
    brickState: JSON.parse(JSON.stringify(ownership.getNetworkState())),
});

function pair() {
    const a = new BrickOwnership({ playerId: 'a', brickIds: ['one', 'two'], maxLap: 3 });
    const b = new BrickOwnership({ playerId: 'b', brickIds: ['one', 'two'], maxLap: 3 });
    assert.equal(a.startRace(round), true);
    assert.equal(b.startRace(round), true);
    return { a, b };
}

test('the first claim processed by the coordinator is the only owner of a concurrent pickup', () => {
    for (const winner of ['a', 'b']) {
        const { a, b } = pair();
        b.request(1, 'one');
        assert.equal(b.countFor('b'), 0, 'Requesting a brick never grants client currency');
        if (winner === 'b') a.receiveNetworkState(wire(b));
        a.request(1, 'one');
        a.receiveNetworkState(wire(b));
        b.receiveNetworkState(wire(a));
        assert.equal(a.ownerFor(1, 'one'), winner);
        assert.equal(b.ownerFor(1, 'one'), winner);
        assert.equal(a.countFor('a') + a.countFor('b'), 1);
        assert.equal(b.countFor('a') + b.countFor('b'), 1);
        assert.equal(b.hasPendingClaims(), false, 'The losing claim also receives a final answer');
    }
});

test('lost requests and confirmations recover through retries without duplicate awards', () => {
    const { a, b } = pair();
    b.request(1, 'one');
    const request = wire(b);
    assert.deepEqual(wire(b), request, 'A lost request stays in every later player packet');
    const accepted = a.receiveNetworkState(request);
    assert.equal(accepted.grants.length, 1);
    // The first confirmation is dropped. Even an otherwise unchanged retry
    // requires a fresh reliable confirmation from the coordinator.
    const retry = a.receiveNetworkState(request);
    assert.equal(retry.changed, false);
    assert.equal(retry.shouldPublish, true);
    assert.equal(a.countFor('b'), 1);
    b.receiveNetworkState(wire(a));
    b.receiveNetworkState(wire(a));
    assert.equal(b.countFor('b'), 1);
    assert.equal(b.hasPendingClaims(), false);
    assert.deepEqual(b.getNetworkState().requests, []);
});

test('lap generations share ownership while a new lap grants a fresh independent pickup', () => {
    const { a, b } = pair();
    a.request(1, 'one');
    b.receiveNetworkState(wire(a));
    assert.equal(b.request(1, 'one').changed, false);
    b.request(2, 'one');
    a.receiveNetworkState(wire(b));
    b.receiveNetworkState(wire(a));
    assert.equal(a.ownerFor(1, 'one'), 'a');
    assert.equal(a.ownerFor(2, 'one'), 'b');
    assert.equal(a.countFor('a'), 1);
    assert.equal(a.countFor('b'), 1);
    assert.equal(b.countFor('b'), 1);
});

test('late claims and reordered snapshots retain all earlier lap awards', () => {
    const { a, b } = pair();
    b.request(1, 'one');
    const late = wire(b);
    a.request(2, 'two');
    const olderSnapshot = wire(a);
    a.receiveNetworkState(late);
    b.receiveNetworkState(wire(a));
    b.receiveNetworkState(olderSnapshot);
    assert.equal(b.ownerFor(1, 'one'), 'b');
    assert.equal(b.ownerFor(2, 'two'), 'a');
    assert.equal(b.hasPendingClaims(), false);
    assert.equal(b.countFor('b'), 1);
});

test('only the configured coordinator and race can confirm pickup ownership', () => {
    const { a, b } = pair();
    b.request(1, 'one');
    const legitimate = { ...wire(a), brickState: {
        ...a.getNetworkState(), ownership: [{ lap: 1, brickId: 'one', playerId: 'b' }],
    } };
    for (const invalid of [
        { ...legitimate, id: 'outsider' },
        { ...legitimate, id: 'b' },
        { ...legitimate, brickState: { ...legitimate.brickState, roundId: 'old-race' } },
        { ...legitimate, brickState: { ...legitimate.brickState, coordinatorId: 'b' } },
        { ...legitimate, brickState: { ...legitimate.brickState, version: 999 } },
    ]) {
        assert.equal(b.receiveNetworkState(invalid).changed, false);
        assert.equal(b.countFor('b'), 0);
        assert.equal(b.hasPendingClaims(), true);
    }
    b.receiveNetworkState(legitimate);
    assert.equal(b.countFor('b'), 1);
});

test('a new race clears claims and awards, repeated race setup preserves existing ownership', () => {
    const { a, b } = pair();
    a.request(1, 'one');
    b.receiveNetworkState(wire(a));
    b.request(2, 'two');
    const oldSnapshot = wire(a), oldRequest = wire(b);
    assert.equal(a.startRace(round), true);
    assert.equal(a.countFor('a'), 1);
    const nextRound = { ...round, roundId: 'session-a:start-2000' };
    a.startRace(nextRound);
    b.startRace(nextRound);
    assert.equal(a.countFor('a'), 0);
    assert.equal(b.hasPendingClaims(), false);
    assert.equal(a.receiveNetworkState(oldRequest).changed, false);
    assert.equal(b.receiveNetworkState(oldSnapshot).changed, false);
    b.request(1, 'one');
    a.receiveNetworkState(wire(b));
    b.receiveNetworkState(wire(a));
    assert.equal(b.countFor('b'), 1);
});

test('unstarted ledgers, invalid IDs, future laps and invented bricks cannot grant currency', () => {
    const cold = new BrickOwnership({ playerId: 'a', brickIds: ['one'] });
    assert.equal(cold.request(1, 'one').changed, false);
    assert.equal(cold.getNetworkState(), null);
    assert.equal(cold.startRace({ ...round, coordinatorId: 'b' }), false);
    assert.equal(cold.startRace({ ...round, participantIds: ['b'] }), false);
    const { a, b } = pair();
    for (const [lap, id] of [[0, 'one'], [4, 'one'], [1.5, 'one'], [1, 'invented']]) {
        assert.equal(b.request(lap, id).changed, false);
    }
    const invalid = wire(b);
    invalid.lap = 1;
    invalid.brickState.requests = [
        { lap: 2, brickId: 'one' }, { lap: 1, brickId: 'invented' },
        { lap: 0, brickId: 'one' }, { lap: 1, brickId: 'one', playerId: 'a' },
    ];
    a.receiveNetworkState(invalid);
    assert.equal(a.countFor('b'), 1, 'The sender is the claimant; a forged owner field is ignored');
    assert.equal(a.ownerFor(2, 'one'), null);
    assert.equal(a.countFor('a'), 0);
});

test('the complete three-lap ledger stays compact and round-trips without losing either player awards', () => {
    const ids = Array.from({ length: 72 }, (_, index) => `brick-${index + 1}`);
    const alpha = 'alpha-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', bravo = 'bravo-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
    const a = new BrickOwnership({ playerId: alpha, brickIds: ids });
    const b = new BrickOwnership({ playerId: bravo, brickIds: ids });
    const race = { roundId: 'full-race', coordinatorId: alpha, participantIds: [alpha, bravo] };
    a.startRace(race); b.startRace(race);
    const legacyAwards = [];
    for (let lap = 1; lap <= 3; lap++) {
        ids.forEach((brickId, index) => {
            const owner = index % 2 ? b : a;
            owner.request(lap, brickId);
            legacyAwards.push({ lap, brickId, playerId: owner.playerId });
        });
        a.receiveNetworkState(wire(b));
        b.receiveNetworkState(wire(a));
    }
    const compact = a.getNetworkState();
    const legacy = { ...compact, ownership: legacyAwards };
    assert.ok(JSON.stringify(compact).length < JSON.stringify(legacy).length / 2,
        'Repeated owner identifiers should not overwhelm movement packets');
    assert.equal(a.countFor(alpha), 108); assert.equal(a.countFor(bravo), 108);
    assert.equal(b.countFor(alpha), 108); assert.equal(b.countFor(bravo), 108);
    assert.equal(b.hasPendingClaims(), false);
    // Older senders remain readable while newer senders use grouped arrays.
    const lateJoin = new BrickOwnership({ playerId: bravo, brickIds: ids });
    lateJoin.startRace(race);
    lateJoin.receiveNetworkState({ id: alpha, brickState: legacy });
    assert.equal(lateJoin.countFor(bravo), 108);
});
