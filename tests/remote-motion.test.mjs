import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pushRemoteMotion, sampleRemoteMotion, resetRemoteMotion } from '../js/objects/RemoteMotion.js';

const remotePlayer = () => ({ stateBuffer: [], interpolationDelay: 80 });
const motion = (source, received = source + 40, extra = {}) => ({
    x: source * 0.6, y: 0, angle: 0, vx: 600, vy: 0,
    motionTime: source, time: received, ...extra,
});

test('wall-clock presence cannot poison subsequent monotonic movement timestamps', () => {
    const remote = remotePlayer();
    pushRemoteMotion(remote, { x: 0, y: 0, angle: 0, time: 100, timestamp: 1800000000000 });
    assert.equal(remote.motionClockKind, 'timestamp');
    assert.equal(pushRemoteMotion(remote, motion(2500, 150)), true);
    assert.equal(remote.motionClockKind, 'motion');
    assert.equal(remote.stateBuffer.length, 1);
    assert.equal(remote.stateBuffer[0].time, 2500);
    pushRemoteMotion(remote, motion(2533, 183));
    const pose = sampleRemoteMotion(remote, 250);
    assert.ok(pose.x >= 1500 && pose.x <= 1540);
});

test('batched packets retain sender spacing and do not multiply clock correction', () => {
    const remote = remotePlayer();
    pushRemoteMotion(remote, motion(1000, 1500));
    for (const source of [1033, 1066, 1099]) pushRemoteMotion(remote, motion(source, 1520));
    assert.deepEqual(remote.stateBuffer.map(state => state.time), [1000, 1033, 1066, 1099]);
    assert.equal(remote.motionTimeOffset, 487, 'later packets in the batch consume no extra correction time');
    assert.equal(remote.motionTargetOffset, 421);
    const pose = sampleRemoteMotion(remote, 1520);
    assert.ok(Number.isFinite(pose.x));
});

test('a high-latency first packet converges to current movement instead of fixing the delay forever', () => {
    const remote = remotePlayer();
    pushRemoteMotion(remote, motion(0, 600));
    sampleRemoteMotion(remote, 600);
    let source = 600, previous = 0, pose;
    for (let now = 640; now <= 1500; now += 10) {
        if (now >= source + 40) {
            pushRemoteMotion(remote, motion(source, now));
            source += 30;
        }
        pose = sampleRemoteMotion(remote, now);
        assert.ok(pose.x >= previous, 'clock correction must not reverse forward movement');
        previous = pose.x;
    }
    assert.ok(remote.motionTimeOffset <= 40 + 1e-6);
    const expected = (1500 - 40 - remote.interpolationDelay) * 0.6;
    assert.ok(Math.abs(pose.x - expected) < 30, `${pose.x} vs ${expected}`);
});

test('variable network delay and reordered batches keep a forward-moving rival continuous', () => {
    const remote = remotePlayer();
    const delays = [40, 60, 150, 45, 110, 30, 180, 50];
    const packets = Array.from({ length: 100 }, (_, index) =>
        motion(index * 33, index * 33 + delays[index % delays.length]))
        .sort((a, b) => a.time - b.time);
    let previous = null, nextPacket = 0;
    for (let now = 0; now < 3500; now += 1000 / 60) {
        while (nextPacket < packets.length && packets[nextPacket].time <= now) {
            pushRemoteMotion(remote, packets[nextPacket++]);
        }
        const pose = sampleRemoteMotion(remote, now);
        if (!pose) continue;
        if (previous !== null) {
            assert.ok(pose.x >= previous - 1e-8, 'delayed packets must not pull the car backwards');
            assert.ok(pose.x - previous < 25, 'a received batch must not teleport the car');
        }
        assert.ok([pose.x, pose.y, pose.angle].every(Number.isFinite));
        previous = pose.x;
    }
});

test('very old initial states are rebased when a live snapshot exposes a clock discontinuity', () => {
    const remote = remotePlayer();
    pushRemoteMotion(remote, motion(0, 10000));
    sampleRemoteMotion(remote, 10000);
    pushRemoteMotion(remote, motion(10000, 10040));
    assert.equal(remote.motionTimeOffset, 40);
    assert.equal(remote.stateBuffer.length, 1);
    assert.equal(remote.motionRenderAt, undefined);
    assert.ok(sampleRemoteMotion(remote, 10140).x > 5000);
});

test('suspension longer than the presence timeout resumes without a future timeline or stale samples', () => {
    for (const resumedSource of [200, 5000]) {
        const remote = remotePlayer();
        pushRemoteMotion(remote, motion(0));
        pushRemoteMotion(remote, motion(100));
        sampleRemoteMotion(remote, 200);
        pushRemoteMotion(remote, motion(resumedSource, 5500));
        assert.equal(remote.stateBuffer.length, 1);
        assert.equal(remote.motionRenderAt, undefined);
        const pose = sampleRemoteMotion(remote, 5600);
        assert.ok(Math.abs(pose.x - (resumedSource + 20) * 0.6) < 1);
    }
});

test('out-of-order states cannot rewind movement, and equal source times update the latest pose', () => {
    const remote = remotePlayer();
    pushRemoteMotion(remote, motion(100));
    pushRemoteMotion(remote, motion(133));
    assert.equal(pushRemoteMotion(remote, motion(110, 180)), false);
    assert.equal(pushRemoteMotion(remote, motion(133, 180, { x: 55, vx: 0 })), true);
    assert.deepEqual(remote.stateBuffer.map(state => state.time), [100, 133]);
    assert.equal(remote.stateBuffer[1].x, 55);
    assert.equal(remote.stateBuffer[1].vx, 0);
});

test('invalid position and clock fields are rejected and invalid velocities cannot contaminate prediction', () => {
    const remote = remotePlayer();
    for (const field of ['x', 'y', 'angle', 'time']) {
        assert.equal(pushRemoteMotion(remote, motion(0, 40, { [field]: NaN })), false);
        assert.equal(pushRemoteMotion(remote, motion(0, 40, { [field]: Infinity })), false);
    }
    assert.equal(remote.stateBuffer.length, 0);
    assert.equal(sampleRemoteMotion(remote, 40), null);
    pushRemoteMotion(remote, motion(0, 40, { vx: Infinity, vy: NaN, angularVelocity: Infinity }));
    assert.deepEqual(sampleRemoteMotion(remote, 500), { x: 0, y: 0, angle: 0 });
    assert.equal(sampleRemoteMotion(remote, NaN), null);
});

test('missing sender clocks use arrival time and changing clock types starts a fresh timeline', () => {
    const remote = remotePlayer();
    const arrival = { x: 0, y: 0, angle: 0, time: 10 };
    pushRemoteMotion(remote, arrival);
    assert.equal(remote.motionClockKind, 'arrival');
    assert.equal(remote.motionTimeOffset, 0);
    pushRemoteMotion(remote, { ...arrival, time: 40, timestamp: 100000 });
    assert.equal(remote.motionClockKind, 'timestamp');
    assert.equal(remote.stateBuffer.length, 1);
    resetRemoteMotion(remote);
    assert.equal(sampleRemoteMotion(remote, 50), null);
    assert.equal(remote.motionClockKind, undefined);
    assert.equal(remote.motionPose, undefined);
    pushRemoteMotion(remote, motion(0, 100));
    assert.equal(sampleRemoteMotion(remote, 100).x, 0);
});

test('packet loss predicts for at most 100 ms and then holds the same endpoint', () => {
    const remote = remotePlayer();
    pushRemoteMotion(remote, motion(0, 40));
    const endpoint = sampleRemoteMotion(remote, 1000);
    assert.equal(endpoint.x, 60);
    assert.deepEqual(sampleRemoteMotion(remote, 5000), endpoint);
});

test('braking samples interpolate between their positions without velocity overshoot', () => {
    const remote = remotePlayer();
    pushRemoteMotion(remote, motion(0, 40, { x: 0, vx: 1400 }));
    pushRemoteMotion(remote, motion(100, 140, { x: 20, vx: 0 }));
    for (let now = 120; now <= 220; now += 5) {
        const pose = sampleRemoteMotion(remote, now);
        assert.ok(pose.x >= 0 && pose.x <= 20);
    }
    assert.ok(Math.abs(sampleRemoteMotion(remote, 500).x - 20) < 0.1);
});

test('turning across ±π follows the short arc and delay changes never rewind the render cursor', () => {
    const remote = remotePlayer();
    pushRemoteMotion(remote, motion(0, 40, { angle: Math.PI - 0.1 }));
    pushRemoteMotion(remote, motion(100, 140, { angle: -Math.PI + 0.1 }));
    const pose = sampleRemoteMotion(remote, 170);
    assert.ok(Math.abs(pose.angle - Math.PI) < 1e-10);
    const renderAt = remote.motionRenderAt;
    remote.interpolationDelay = 180;
    sampleRemoteMotion(remote, 180);
    assert.ok(remote.motionRenderAt >= renderAt);
});

test('correction smoothing gives the same elapsed-time response at 30, 60 and 120 FPS', () => {
    const responses = [];
    for (const fps of [30, 60, 120]) {
        const remote = remotePlayer();
        pushRemoteMotion(remote, motion(0, 40, { x: 0, vx: 0 }));
        sampleRemoteMotion(remote, 200);
        pushRemoteMotion(remote, motion(100, 201, { x: 100, vx: 0 }));
        // Start after the interpolation interval so this measures only the
        // correction response to a fixed collision/prediction correction.
        remote.motionPose = { x: 0, y: 0, angle: 0 };
        remote.motionFrameAt = 400;
        for (let frame = 1; frame <= fps / 10; frame++) sampleRemoteMotion(remote, 400 + frame * 1000 / fps);
        responses.push(remote.motionPose.x);
    }
    assert.ok(Math.max(...responses) - Math.min(...responses) < 1e-9);
    assert.ok(Math.abs(responses[0] - 100 * (1 - Math.exp(-100 / 35))) < 1e-9);
});

test('state history stays bounded even when rendering stops while packets keep arriving', () => {
    const remote = remotePlayer();
    for (let index = 0; index < 200; index++) pushRemoteMotion(remote, motion(index * 33));
    assert.equal(remote.stateBuffer.length, 64);
    assert.equal(remote.stateBuffer[0].time, 136 * 33);
});
