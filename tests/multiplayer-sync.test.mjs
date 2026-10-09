import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test, mock } from 'node:test';

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

function image(x, y, key) {
    const sprite = { x, y, rotation: 0, texture: { key },
        setPosition(x, y) { Object.assign(this, { x, y }); return this; },
        setRotation(value) { this.rotation = value; return this; },
        setTexture(key) { this.texture.key = key; return this; },
        setTint() { return this; }, setDepth() { return this; },
        setVisible() { return this; }, setScale() { return this; },
        destroy() { this.destroyed = true; },
    };
    sprite.body = {
        setCircle() {}, setImmovable() {}, setAllowGravity() {},
        updateFromGameObject() {},
        reset(x, y) { sprite.setPosition(x, y); },
    };
    return sprite;
}
function label() {
    return { setText(text) { this.text = text; return this; },
        setPosition(x, y) { Object.assign(this, { x, y }); return this; },
        setOrigin() { return this; }, setDepth() { return this; },
        setVisible() { return this; }, destroy() { this.destroyed = true; } };
}
function scene() {
    const race = new Race();
    Object.assign(race, {
        playerId: 'a', multiplayer: { connected: true }, playerSlot: 0,
        finishLineX: 5152, startLineY: 3488, totalLaps: 3,
        raceTimerStarted: false, raceFinished: false, raceRoundId: null,
        remotePlayers: {}, networkSendInterval: 33,
        pendingClockProbes: new Map(), clockOffsets: new Map(), networkRoundTrips: new Map(),
        physics: { add: { image, collider: () => ({ active: false, destroy() { this.destroyed = true; } }) } },
        add: { text: label }, car: image(5152, 3404, 'car-pink-v2'),
        updateLobbyStatus() {}, tryCoordinateStart() {}, tryResolvePodium() {},
        publishNetworkState() {},
    });
    return race;
}
const presence = { id: 'b', sessionId: 'session-b', online: true, nick: 'RIVAL', skin: 'blue' };
function packet(seq, motionTime, x = 5152, extra = {}) {
    return { ...presence, seq, ts: 1700000000000 + motionTime, motionTime,
        x, y: 3572, rotation: -Math.PI / 2, vx: -600, vy: 0,
        ready: true, startAt: 1700000005000, roundId: 'round-1',
        finished: false, lap: 1, checkpointIndex: 0, ...extra };
}

test('presence and grid snapshots never poison the monotonic movement clock', () => {
    let now = 1000;
    mock.method(performance, 'now', () => now);
    const race = scene();
    race.receiveRemotePlayer({ ...presence, seq: 1, ts: 1700000000000 });
    const remote = race.remotePlayers.b;
    assert.equal(remote.stateBuffer.length, 0);
    race.receiveRemotePlayer(packet(2, 40));
    assert.equal(remote.stateBuffer.length, 0);
    assert.equal(remote.sprite.x, race.finishLineX);
    assert.equal(remote.sprite.y, 3572);

    race.raceTimerStarted = true;
    race.raceRoundId = 'round-1';
    now = 1100;
    race.receiveRemotePlayer(packet(3, 140, 5092));
    now = 1200;
    race.receiveRemotePlayer(packet(4, 240, 5032));
    race.updateRemotePlayers();
    assert.ok(remote.sprite.x < race.finishLineX - 50, 'rival starts moving immediately after GO');
    assert.ok(remote.sprite.x > 5000);
    mock.restoreAll();
});

test('reconnection presence preserves ready, start, round, laps and movement history', () => {
    const race = scene();
    race.receiveRemotePlayer(packet(1, 100));
    race.raceTimerStarted = true;
    race.raceRoundId = 'round-1';
    race.receiveRemotePlayer(packet(2, 200, 5000, { lap: 2, checkpointIndex: 3, completedLaps: 1 }));
    const remote = race.remotePlayers.b;
    const buffer = [...remote.stateBuffer];
    race.receiveRemotePlayer({ ...presence, seq: 3, ts: 1700000000300 });
    assert.equal(remote.ready, true);
    assert.equal(remote.startAt, 1700000005000);
    assert.equal(remote.roundId, 'round-1');
    assert.equal(remote.lap, 2);
    assert.equal(remote.checkpointIndex, 3);
    assert.equal(remote.completedLaps, 1);
    assert.deepEqual(remote.stateBuffer, buffer);
});

test('packet loss and explicit departure preserve the race sprite and resume it without respawning', () => {
    let wall = 1700000000000, monotonic = 1000;
    mock.method(Date, 'now', () => wall);
    mock.method(performance, 'now', () => monotonic);
    const race = scene();
    race.receiveRemotePlayer(packet(1, 100));
    race.raceTimerStarted = true;
    race.raceRoundId = 'round-1';
    race.receiveRemotePlayer(packet(2, 200, 4900));
    race.updateRemotePlayers();
    const remote = race.remotePlayers.b, sprite = remote.sprite, collider = remote.collider;
    const before = { x: sprite.x, y: sprite.y };
    wall += 6000;
    monotonic += 6000;
    race.updateRemotePlayers();
    assert.equal(race.remotePlayers.b, remote);
    assert.equal(remote.online, false);
    assert.equal(collider.active, false);
    assert.equal(sprite.destroyed, undefined);
    assert.deepEqual({ x: sprite.x, y: sprite.y }, before);

    race.receiveRemotePlayer(packet(3, 6200, 4600));
    assert.equal(remote.sprite, sprite);
    assert.equal(remote.online, true);
    assert.equal(collider.active, true);
    race.updateRemotePlayers();
    assert.ok(sprite.x < 4900, 'recovery uses the current race pose');
    assert.notEqual(sprite.x, race.finishLineX);

    race.receiveRemotePlayer({ ...presence, seq: 4, ts: wall, online: false });
    assert.equal(remote.online, false);
    assert.equal(sprite.destroyed, undefined);
    race.receiveRemotePlayer(packet(5, 6233, 4580));
    assert.equal(remote.online, true);
    assert.equal(remote.sprite, sprite);
    mock.restoreAll();
});

test('the lobby releases departed slots, while a racing session cannot be replaced by late sessions', () => {
    const lobby = scene();
    lobby.receiveRemotePlayer(packet(1, 100));
    const departed = lobby.remotePlayers.b;
    lobby.removeRemotePlayer('b');
    assert.equal(lobby.remotePlayers.b, undefined);
    assert.equal(departed.sprite.destroyed, true);
    assert.equal(departed.collider.destroyed, true);

    const race = scene();
    race.receiveRemotePlayer(packet(1, 100));
    race.raceTimerStarted = true;
    race.raceRoundId = 'round-1';
    race.receiveRemotePlayer(packet(2, 200, 5000));
    const remote = race.remotePlayers.b;
    race.receiveRemotePlayer(packet(10, 300, 1000, { sessionId: 'new-session' }));
    race.receiveRemotePlayer(packet(1, 100, 5152));
    assert.equal(remote.sessionId, 'session-b');
    assert.equal(remote.lastMessageSeq, 2);
    assert.equal(remote.stateBuffer.at(-1).x, 5000);
});

test('a lobby session replacement cannot flip back when its old packets arrive late', () => {
    const race = scene();
    race.receiveRemotePlayer(packet(1, 100));
    race.receiveRemotePlayer(packet(2, 200, 5152, { sessionId: 'new-session' }));
    race.receiveRemotePlayer(packet(20, 300));
    assert.equal(race.remotePlayers.b.sessionId, 'new-session');
    assert.equal(race.remotePlayers.b.lastMessageSeq, 2);
});

test('a retained departure from an unseen older session cannot remove a live lobby rival', () => {
    const race = scene();
    race.receiveRemotePlayer(packet(1, 100));
    const remote = race.remotePlayers.b;
    race.receiveRemotePlayer({ ...presence, sessionId: 'older-session', online: false });
    assert.equal(race.remotePlayers.b, remote);
    assert.equal(remote.online, true);
    assert.equal(remote.sessionId, 'session-b');
});

test('invalid poses and packets from another round never enter the race movement buffer', () => {
    const race = scene();
    race.receiveRemotePlayer(packet(1, 100));
    race.raceTimerStarted = true;
    race.raceRoundId = 'round-1';
    race.receiveRemotePlayer(packet(2, 200, 5000));
    const remote = race.remotePlayers.b;
    for (const [index, extra] of [{ x: null }, { x: NaN }, { y: Infinity }, { rotation: null },
        { roundId: 'old-round' }].entries()) {
        race.receiveRemotePlayer(packet(index + 3, 300 + index * 33, 1, extra));
    }
    assert.equal(remote.stateBuffer.length, 1);
    assert.equal(remote.stateBuffer[0].x, 5000);
    assert.equal(remote.roundId, 'round-1');
});

test('an unrelated round cannot erase a confirmed finish or reactivate its collider', () => {
    const race = scene();
    race.receiveRemotePlayer(packet(1, 100));
    race.raceTimerStarted = true;
    race.raceRoundId = 'round-1';
    race.receiveRemotePlayer(packet(2, 200, 5000, {
        finished: true, finishElapsedMs: 120000, completedLaps: 3,
    }));
    const remote = race.remotePlayers.b;
    race.receiveRemotePlayer(packet(100, 300, 1, {
        roundId: 'old-round', finished: false, finishElapsedMs: null, completedLaps: 0,
    }));
    assert.equal(remote.roundId, 'round-1');
    assert.equal(remote.finished, true);
    assert.equal(remote.finishElapsedMs, 120000);
    assert.equal(remote.completedLaps, 3);
    assert.equal(remote.collider.active, false);
    assert.equal(remote.lastMessageSeq, 2);
});
