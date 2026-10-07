import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';

globalThis.window = {
    location: { search: '?touch=0' }, addEventListener() {},
    matchMedia: () => ({ matches: false }),
};
globalThis.Phaser = {
    Scene: class {}, Physics: { Arcade: { Sprite: class {} } },
    Events: { EventEmitter }, BlendModes: { ADD: 1 },
    Math: { Clamp: (value, min, max) => Math.max(min, Math.min(max, value)) },
};
const { default: Race } = await import('../js/scenes/RaceScene.js');

function label() {
    return {
        setText(value) { this.value = value; return this; },
        setVisible(value) { this.visible = value; return this; },
        setAlpha(value) { this.alpha = value; return this; },
        setScale() { return this; }, setFontSize() { return this; }, setColor() { return this; },
    };
}

function lapScene(overrides = {}) {
    const race = new Race();
    const resets = [];
    Object.assign(race, {
        currentLap: 1, totalLaps: 3, checkpointIndex: 4, checkpointCount: 4,
        lapArmed: true, previousCarX: 1030, finishLineX: 1000,
        finishLineYMin: 3300, finishLineYMax: 3600, raceFinished: false,
        car: { x: 1002, y: 3488, body: { velocity: { x: -100 } } },
        brickCount: 17, brickCollectibles: { resetForLap: lap => resets.push(lap) },
        completedLaps: 0,
        lapLabel: label(), tweens: { add() {} }, checkpointMessages: [],
        updateCheckpointHud(message) { this.checkpointMessages.push(message); },
        finishCalls: 0,
        finishRace() { this.finishCalls++; this.raceFinished = true; },
        ...overrides,
    });
    return { race, resets };
}

test('only completing a valid nonfinal lap restores bricks and retains the race count', () => {
    for (const currentLap of [1, 2]) {
        const { race, resets } = lapScene({ currentLap });
        race.updateLapSystem();
        assert.deepEqual(resets, [currentLap + 1]);
        assert.equal(race.currentLap, currentLap + 1);
        assert.equal(race.checkpointIndex, 0);
        assert.equal(race.brickCount, 17);
        assert.equal(race.finishCalls, 0);

        // Remaining over the finish line must not restore the pickups twice.
        race.updateLapSystem();
        assert.deepEqual(resets, [currentLap + 1]);
        assert.equal(race.completedLaps, 1);
    }
});

test('crossing without every checkpoint cannot restore collected bricks', () => {
    for (const checkpointIndex of [0, 3]) {
        const { race, resets } = lapScene({ checkpointIndex });
        race.updateLapSystem();
        assert.deepEqual(resets, []);
        assert.equal(race.currentLap, 1);
        assert.equal(race.checkpointIndex, checkpointIndex);
        assert.equal(race.brickCount, 17);
        assert.equal(race.completedLaps, 0);
        assert.match(race.checkpointMessages[0], /VOLTA BLOQUEADA/);

        // A checkpoint update while parked on the finish line is no new lap.
        race.checkpointIndex = race.checkpointCount;
        race.updateLapSystem();
        assert.deepEqual(resets, []);
    }
});

test('invalid finish-line crossings cannot restore collected bricks', () => {
    const invalidCrossings = [
        { lapArmed: false },
        { previousCarX: 990 },
        { previousCarX: 1004 },
        { car: { x: 1005, y: 3488, body: { velocity: { x: -100 } } } },
        { car: { x: 1002, y: 3488, body: { velocity: { x: -20 } } } },
        { car: { x: 1002, y: 3488, body: { velocity: { x: 100 } } } },
        { car: { x: 1002, y: 3299, body: { velocity: { x: -100 } } } },
        { car: { x: 1002, y: 3601, body: { velocity: { x: -100 } } } },
        { raceFinished: true },
    ];
    for (const crossing of invalidCrossings) {
        const { race, resets } = lapScene(crossing);
        race.updateLapSystem();
        assert.deepEqual(resets, []);
        assert.equal(race.currentLap, 1);
        assert.equal(race.brickCount, 17);
        assert.equal(race.completedLaps, 0);
        assert.equal(race.finishCalls, 0);
    }
});

test('the final lap finishes the race without restoring pickups', () => {
    const { race, resets } = lapScene({ currentLap: 3 });
    race.updateLapSystem();
    race.updateLapSystem();
    assert.deepEqual(resets, []);
    assert.equal(race.finishCalls, 1);
    assert.equal(race.raceFinished, true);
    assert.equal(race.brickCount, 17);
    assert.equal(race.completedLaps, 1);
});

test('waiting view receives the personal time and all earned tijolinhos', () => {
    const race = new Race();
    let calls = 0;
    Object.assign(race, {
        brickCount: 17, completedLaps: 3, raceFinished: true, finishPlace: null,
        finishElapsedMs: 180000,
        raceResults: { showWaiting() {
            calls++;
            assert.equal(race.formatRaceTime(race.finishElapsedMs), '03:00.00');
            assert.deepEqual(race.computeFinalScore(), {
                collected: 17, laps: 30, finish: 20, victory: 0, total: 67,
            });
        } },
    });
    race.showWaitingForOpponent();
    assert.equal(calls, 1);
});

function podiumScene({ elapsed = 160000, opponentElapsed = 170000, pending = false,
    opponentRound = 'round-1' } = {}) {
    const race = new Race();
    const calls = { podium: [], results: [], publications: 0, timers: [] };
    Object.assign(race, {
        playerId: 'a', playerNick: 'LOCAL', carSkin: 'pink', carTint: 0xffffff,
        raceFinished: true, podiumShown: false, raceRoundId: 'round-1',
        brickCount: 17, completedLaps: 3, finishElapsedMs: elapsed,
        remotePlayers: { b: { id: 'b', nick: 'RIVAL', skin: 'blue', tint: 0xabcdef,
            roundId: opponentRound, completedLaps: 3, finished: true, finishElapsedMs: opponentElapsed } },
        brickCollectibles: { hasPendingClaims: () => pending, countFor: id => id === 'a' ? 17 : 9 },
        raceResults: { showPodium: data => calls.podium.push(data), showResults: data => calls.results.push(data) },
        publishNetworkState() { calls.publications++; },
        time: { delayedCall(ms, fn) { calls.timers.push({ ms, fn }); } },
    });
    return { race, calls };
}

test('both podium places contain the actual skins, times, and tijolinho-only rewards', () => {
    const { race, calls } = podiumScene();
    race.tryResolvePodium();
    assert.equal(race.finishPlace, 1);
    assert.equal(race.podiumShown, true);
    assert.equal(race.finalScoreData.total, 117);
    assert.deepEqual(race.raceResultsData.map(driver => ({ id: driver.id, place: driver.place,
        elapsed: driver.elapsed, skin: driver.skin, rewards: driver.rewards })), [
        { id: 'a', place: 1, elapsed: 160000, skin: 'pink',
            rewards: { collected: 17, laps: 30, finish: 20, victory: 50, total: 117 } },
        { id: 'b', place: 2, elapsed: 170000, skin: 'blue',
            rewards: { collected: 9, laps: 30, finish: 20, victory: 0, total: 59 } },
    ]);
    assert.equal(calls.podium.length, 1);
    calls.timers[0].fn();
    assert.equal(calls.results.length, 1);
    race.tryResolvePodium();
    assert.equal(calls.podium.length, 1);
    assert.equal(race.computeFinalScore().total, 117, 'repeated packets never repeat victory rewards');
});

test('second place never gets the victory bonus; equal times use the same ID tiebreak on both peers', () => {
    const { race } = podiumScene({ elapsed: 170000, opponentElapsed: 160000 });
    race.tryResolvePodium();
    assert.equal(race.finishPlace, 2);
    assert.equal(race.finalScoreData.total, 67);
    assert.equal(race.finalScoreData.victory, 0);
    const tie = podiumScene({ elapsed: 160000, opponentElapsed: 160000 }).race;
    tie.tryResolvePodium();
    assert.deepEqual(tie.raceResultsData.map(driver => driver.id), ['a', 'b']);
});

test('podium waits for all pickup confirmations and ignores a finisher from another race', () => {
    for (const options of [{ pending: true }, { opponentRound: 'old-round' }]) {
        const { race, calls } = podiumScene(options);
        race.tryResolvePodium();
        assert.equal(race.podiumShown, false);
        assert.equal(calls.podium.length, 0);
    }
});

test('both clients initialize the same brick round despite their clock offset', () => {
    const rounds = [];
    for (const playerId of ['a', 'b']) {
        const localCoordinator = playerId === 'a';
        const race = new Race();
        Object.assign(race, {
            playerId, roomId: 4, raceTimerStarted: false, raceFinished: false,
            raceStartAt: localCoordinator ? 100000 : 99400, time: { now: 123 },
            multiplayer: { sessionId: localCoordinator ? 'session-a' : 'session-b' },
            getActiveOpponents: () => [{ id: localCoordinator ? 'b' : 'a',
                sessionId: localCoordinator ? 'session-b' : 'session-a',
                startAt: localCoordinator ? 99400 : 100000 }],
            brickCollectibles: { startRace: data => rounds.push(data) },
            updateRaceTimerHud() {}, publishNetworkState() {},
        });
        race.startRaceTimer();
        assert.equal(race.raceTimerStarted, true);
        assert.equal(race.raceStartTime, 123);
    }
    assert.equal(rounds[0].roundId, rounds[1].roundId);
    assert.equal(rounds[0].coordinatorId, 'a');
    assert.deepEqual(rounds[0].participantIds.sort(), rounds[1].participantIds.sort());
});

test('reliable brick and finish messages in the same millisecond are ordered by MQTT sequence', () => {
    const { race } = podiumScene();
    const received = [];
    const remote = race.remotePlayers.b;
    Object.assign(remote, {
        sessionId: 'session-b', lastMessageTs: 1000, lastMessageSeq: 9,
        lastPacketAt: performance.now(), arrivalJitter: 0, stateBuffer: [],
        sprite: { texture: { key: 'car-blue-v2' }, setTint() {}, setScale() {} },
        label: { setText() {} },
    });
    Object.assign(race, { totalLaps: 3, raceTimerStarted: true, networkSendInterval: 33,
        pendingClockProbes: new Map(),
        brickCollectibles: { receiveNetworkState: state => received.push(state.seq) },
        updateLobbyStatus() {}, tryCoordinateStart() {}, tryResolvePodium() {},
    });
    const state = { id: 'b', sessionId: 'session-b', ts: 1000, roundId: 'round-1',
        online: true, completedLaps: 3, lap: 3, finished: true, finishElapsedMs: 170000 };
    race.receiveRemotePlayer({ ...state, seq: 10 });
    race.receiveRemotePlayer({ ...state, seq: 11 });
    race.receiveRemotePlayer({ ...state, seq: 10 });
    assert.deepEqual(received, [10, 11]);
    assert.equal(remote.lastMessageSeq, 11);
    assert.equal(remote.finished, true);
});

test('forced publications include the pickup ledger and reliable delivery, even after finishing', () => {
    const race = new Race(), packets = [];
    const ledger = { roundId: 'race', requests: [[3, 'brick-1-1']] };
    Object.assign(race, {
        multiplayer: { connected: true, playerId: 'a', sessionId: 'session-a',
            publish: (...args) => packets.push(args) },
        car: { x: 1000, y: 2000 }, localCarReady: true, startAlignmentComplete: true,
        raceFinished: true, finishElapsedMs: 160000, raceRoundId: 'race',
        completedLaps: 3, currentLap: 3, pendingNetworkExtra: {}, pendingNetworkRetain: false,
        brickCollectibles: { getNetworkState: () => ledger },
    });
    race.publishNetworkState(true, true);
    assert.equal(packets[0][0].brickState, ledger);
    assert.equal(packets[0][0].roundId, 'race');
    assert.equal(packets[0][0].completedLaps, 3);
    assert.equal(packets[0][0].finished, true);
    assert.deepEqual(packets[0][1], { retain: true, qos: 1 });
});
