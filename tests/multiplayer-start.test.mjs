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
const { default: MQTTClient } = await import('../js/MQTTClient.js');

function sprite(x, y) {
    const car = {
        x, y, rotation: -Math.PI / 2, controlsEnabled: false,
        setPosition(x, y) { Object.assign(this, { x, y }); return this; },
        setRotation(rotation) { this.rotation = rotation; return this; },
        setAngle(angle) { this.rotation = angle * Math.PI / 180; return this; },
    };
    car.body = {
        resets: 0, velocity: { x: 0, y: 0 },
        reset(x, y) { this.resets++; car.setPosition(x, y); this.setVelocity(0, 0); },
        setVelocity(x, y) { Object.assign(this.velocity, { x, y }); },
    };
    return car;
}

function setup(playerId, opponentId) {
    const race = new Race();
    const playerSlot = MQTTClient.slotFor(playerId);
    const publications = [];
    const tweenQueue = [];
    const rounds = [];
    const remote = {
        id: opponentId, sessionId: `session-${opponentId}`, online: true,
        ready: false, lastSeen: Date.now(), startAt: null, clockOffset: 0,
        sprite: sprite(5152, 3488 + (playerSlot === 0 ? 84 : -84)),
        label: { setPosition(x, y) { Object.assign(this, { x, y }); } },
        stateBuffer: [{ x: 100, y: 100, time: 1 }],
        motionPose: { x: 100, y: 100 }, motionTimeOffset: 123,
        motionRenderAt: 44, motionFrameAt: 45,
    };
    Object.assign(race, {
        playerId, playerSlot, roomId: 2,
        multiplayer: { connected: true, sessionId: `session-${playerId}` },
        car: sprite(5152, 3488 + (playerSlot === 0 ? -84 : 84)),
        finishLineX: 5152, startLineY: 3488,
        networkStartX: 5152, networkStartY: 3488 + (playerSlot === 0 ? -84 : 84),
        remotePlayers: { [opponentId]: remote },
        localCarReady: false, startAlignmentComplete: false,
        startAlignmentTween: null, raceStartAt: null, startCountdownStarted: false,
        raceTimerStarted: false, raceFinished: false,
        time: { now: 1000 },
        brickCollectibles: { startRace(round) { rounds.push(round); } },
        tweens: { add(spec) {
            const tween = { playing: true, isPlaying() { return this.playing; },
                finish() {
                    spec.targets.setPosition(spec.x, spec.y);
                    spec.onUpdate();
                    this.playing = false;
                    spec.onComplete();
                } };
            tweenQueue.push(tween);
            return tween;
        } },
        publishNetworkState(force, retain) {
            publications.push({ force, retain, ready: this.localCarReady && this.startAlignmentComplete,
                startAt: this.raceStartAt, x: this.car.x, y: this.car.y });
        },
    });
    return { race, remote, publications, tweenQueue, rounds };
}

function exchange(left, right) {
    for (const [sender, receiver] of [[left, right], [right, left]]) {
        const state = sender.publications.at(-1);
        if (!state) continue;
        receiver.remote.ready = state.ready;
        receiver.remote.startAt = state.startAt;
    }
    left.race.tryCoordinateStart();
    right.race.tryCoordinateStart();
}

test('a ready rival cannot release controls before local grid alignment finishes', () => {
    const { race, remote } = setup('a', 'c');
    race.localCarReady = true;
    remote.ready = true;
    race.raceStartAt = Date.now() + 5000;
    assert.equal(race.hasReadyPair(), false);
    race.beginRace();
    assert.equal(race.car.controlsEnabled, false);
    assert.equal(race.raceTimerStarted, false);
});

test('the already aligned pilot announces readiness immediately without waiting for a heartbeat', () => {
    const { race, publications, tweenQueue } = setup('c', 'a');
    race.localCarReady = true;
    assert.equal(race.alignStartingCars(race.getActiveOpponents()[0]), true);
    assert.equal(tweenQueue.length, 0);
    assert.equal(publications.length, 1);
    assert.deepEqual(publications[0], { force: true, retain: true, ready: true,
        startAt: null, x: 5152, y: 3572 });
    race.alignStartingCars(race.getActiveOpponents()[0]);
    assert.equal(publications.length, 1, 'standing on the grid does not republish every frame');
});

test('equal provisional slots converge to the same side-by-side grid and race round on both clients', () => {
    assert.equal(MQTTClient.slotFor('a'), MQTTClient.slotFor('c'));
    const left = setup('a', 'c');
    const right = setup('c', 'a');
    left.race.onLocalCarReady();
    right.race.onLocalCarReady();
    exchange(left, right);
    assert.equal(left.race.raceStartAt, null, 'coordinator waits for its alignment tween');
    assert.equal(left.race.hasReadyPair(), false);
    assert.equal(left.publications.at(-1).ready, false);

    left.tweenQueue[0].finish();
    exchange(left, right);
    exchange(left, right);
    assert.equal(left.race.hasReadyPair(), true);
    assert.equal(right.race.hasReadyPair(), true);
    assert.equal(left.race.playerSlot, 0);
    assert.equal(right.race.playerSlot, 1);
    assert.equal(left.race.car.x, right.race.car.x);
    assert.equal(right.race.car.y - left.race.car.y, 168);
    assert.equal(left.race.networkStartY, left.race.car.y);
    assert.equal(right.race.networkStartY, right.race.car.y);
    assert.equal(left.remote.sprite.y, right.race.car.y);
    assert.equal(right.remote.sprite.y, left.race.car.y);
    assert.equal(left.race.raceStartAt, right.race.raceStartAt);

    left.race.beginRace();
    right.race.beginRace();
    assert.equal(left.race.car.controlsEnabled, true);
    assert.equal(right.race.car.controlsEnabled, true);
    assert.equal(left.race.raceRoundId, right.race.raceRoundId);
    assert.equal(left.rounds[0].roundId, right.rounds[0].roundId);
    assert.equal(left.rounds[0].coordinatorId, right.rounds[0].coordinatorId);
    assert.deepEqual(left.rounds[0].participantIds.toSorted(), right.rounds[0].participantIds.toSorted());

    left.remote.sprite.setPosition(4000, 3200);
    left.race.beginRace();
    assert.equal(left.remote.sprite.x, 4000, 'a repeated GO cannot teleport a racing opponent');
});

test('switching the rival to its final grid lane discards old motion and resets the collision body', () => {
    const { race, remote } = setup('a', 'c');
    race.placeRemoteOnGrid(remote);
    assert.equal(remote.sprite.x, 5152);
    assert.equal(remote.sprite.y, 3572);
    assert.equal(remote.label.y, 3490);
    assert.equal(remote.sprite.body.resets, 1);
    assert.equal(remote.stateBuffer.length, 0);
    assert.equal(remote.motionPose, undefined);
    assert.equal(remote.motionTimeOffset, undefined);
    assert.equal(remote.motionRenderAt, undefined);
    race.placeRemoteOnGrid(remote);
    assert.equal(remote.sprite.body.resets, 1, 'a parked rival does not reset physics every frame');
});

test('clock correction during the countdown reschedules GO to the updated shared start', () => {
    const { race, remote } = setup('c', 'a');
    race.localCarReady = true;
    race.startAlignmentComplete = true;
    remote.ready = true;
    remote.startAt = Date.now() + 2500;
    race.raceStartAt = remote.startAt;
    race.startCountdownStarted = true;
    race.countdownStartAt = remote.startAt;
    let cancelled = 0, fallbackRemoved = 0, rescheduled = null;
    race.countdown = { cancel() { cancelled++; } };
    race.countdownFallbackTimer = { remove() { fallbackRemoved++; } };
    race.startCountdown = function () { rescheduled = this.raceStartAt; };
    remote.clockOffset = 400;
    race.tryCoordinateStart();
    assert.equal(cancelled, 1);
    assert.equal(fallbackRemoved, 1);
    assert.equal(rescheduled, remote.startAt - 400);
    assert.equal(race.car.controlsEnabled, false);
});

test('realigning during the countdown cancels the old start and allows a new countdown', context => {
    let now = Date.now();
    context.mock.method(Date, 'now', () => now);
    const { race, remote, publications, tweenQueue } = setup('a', 'c');
    let cancellations = 0;
    let countdowns = 0;
    race.localCarReady = true;
    race.startAlignmentComplete = true;
    race.startCountdownStarted = true;
    race.countdown = { cancel() { cancellations++; } };
    race.raceStartAt = now + 1000;
    const oldStartAt = race.raceStartAt;
    remote.ready = true;
    race.startCountdown = () => {
        countdowns++;
        race.startCountdownStarted = true;
    };

    race.tryCoordinateStart();
    assert.equal(cancellations, 1);
    assert.equal(race.startCountdownStarted, false);
    assert.equal(race.countdown, null);
    assert.equal(race.raceStartAt, null);
    assert.equal(race.car.controlsEnabled, false);
    assert.equal(publications.at(-1).startAt, null);
    assert.equal(publications.at(-1).ready, false);

    tweenQueue[0].finish();
    assert.equal(race.hasReadyPair(), true);
    assert.ok(race.raceStartAt > oldStartAt);
    assert.equal(race.raceStartAt, now + 5000);
    now += 2000;
    race.tryCoordinateStart();
    assert.equal(countdowns, 1);
    assert.equal(race.startCountdownStarted, true);
});
