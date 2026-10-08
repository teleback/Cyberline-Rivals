import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HANDLING, MOBILE_HANDLING, createHandlingState, stepHandling } from '../js/objects/CarHandling.js';

function simulation({ speed = 0, rotation = Math.PI / 2, fps = 60, tuning = HANDLING } = {}) {
    const state = createHandlingState();
    const motion = { vx: speed * Math.cos(rotation - Math.PI / 2),
        vy: speed * Math.sin(rotation - Math.PI / 2), rotation,
        maxSpeed: HANDLING.maxSpeed, acceleration: HANDLING.acceleration };
    let x = 0, y = 0, result;
    const tick = (input = {}, dt = 1 / fps) => {
        result = stepHandling(state, motion, { steering: 0, ...input }, dt, tuning);
        Object.assign(motion, { vx: result.vx, vy: result.vy });
        motion.rotation += result.angularVelocity * Math.PI / 180 * Math.min(dt, 0.1);
        x += motion.vx * Math.min(dt, 0.1);
        y += motion.vy * Math.min(dt, 0.1);
        return result;
    };
    return { state, motion, tick, run(seconds, input) {
        for (let i = 0; i < Math.round(seconds * fps); i++) tick(input);
        return result;
    }, get speed() { return Math.hypot(motion.vx, motion.vy); }, get position() { return { x, y }; } };
}

test('standing still never spins and releasing steering immediately stops yaw', () => {
    const car = simulation();
    assert.equal(car.run(1, { steering: 1 }).angularVelocity, 0);
    car.run(1, { throttle: true, steering: 1 });
    assert.ok(car.tick({}).angularVelocity === 0);
});

test('the car reaches the same top speed in every world direction', () => {
    for (const rotation of [0, Math.PI / 4, Math.PI / 2, Math.PI, -Math.PI / 4]) {
        const car = simulation({ rotation });
        car.run(3, { throttle: true });
        assert.ok(Math.abs(car.speed - HANDLING.maxSpeed) < 1e-6);
    }
});

test('straight acceleration is responsive and consistent at 30, 60 and 120 FPS', () => {
    const runs = [30, 60, 120].map(fps => {
        const car = simulation({ fps });
        car.run(0.5, { throttle: true });
        assert.ok(car.speed > 240 && car.speed < 300);
        return car;
    });
    assert.ok(Math.abs(runs[0].speed - runs[2].speed) < 4);
    assert.ok(Math.abs(runs[0].position.x - runs[2].position.x) < 5);
});

test('a short brake stops without accidental reverse; holding it engages bounded reverse', () => {
    const car = simulation({ speed: 390 });
    car.run(0.4, { brake: true, throttle: true });
    assert.ok(car.motion.vx >= 0 && car.speed <= 10, 'brake overrides throttle');
    car.run(0.15, { brake: true });
    assert.equal(car.speed, 0);
    car.run(1, { brake: true });
    assert.ok(car.motion.vx < 0);
    assert.ok(car.speed <= HANDLING.reverseMaxSpeed);
    assert.ok(car.tick({ brake: true, steering: 1 }).angularVelocity < 0,
        'reverse steering follows the direction of the wheels');
    const before = car.speed;
    car.tick({ throttle: true });
    assert.ok(car.speed < before);
});

test('coasting loses speed naturally without a sudden stop', () => {
    const car = simulation({ speed: 390 });
    car.run(1, {});
    assert.ok(car.speed > 180 && car.speed < 240);
    car.run(10, {});
    assert.equal(car.speed, 0);
});

test('ordinary curves maintain traction and drift transitions progressively then recover', () => {
    const normal = simulation({ speed: 320 });
    normal.run(0.8, { steering: 0.65, throttle: true });
    assert.ok(normal.speed > 250);
    assert.ok(normal.tick({ steering: 0.65, throttle: true }).slip < 0.3);
    const drift = simulation({ speed: 390 });
    const entry = drift.tick({ steering: 1, brake: true });
    assert.equal(entry.isDrifting, true);
    assert.ok(drift.state.driftAmount > 0 && drift.state.driftAmount < 0.4);
    drift.run(0.35, { steering: 1, brake: true });
    assert.ok(drift.state.driftAmount > 0.8);
    assert.ok(drift.speed > 120);
    drift.run(0.7, { steering: 0, throttle: true });
    assert.ok(drift.state.driftAmount < 0.01);
    assert.equal(drift.tick({ throttle: true }).isDrifting, false);
});

test('drift hysteresis prevents flicker around its entry threshold', () => {
    const state = createHandlingState();
    const motion = { vx: 180, vy: 0, rotation: Math.PI / 2, maxSpeed: 390, acceleration: 560 };
    stepHandling(state, motion, { steering: 1, brake: true }, 1 / 60);
    assert.equal(state.drifting, true);
    motion.vx = 150;
    stepHandling(state, motion, { steering: 1, brake: true }, 1 / 60);
    assert.equal(state.drifting, true);
    motion.vx = 90;
    stepHandling(state, motion, { steering: 1, brake: true }, 1 / 60);
    assert.equal(state.drifting, false);
});

test('boost expiry sheds excess speed gradually without gaining speed', () => {
    const car = simulation({ speed: 650 });
    car.tick({ throttle: true });
    assert.ok(car.speed > 630 && car.speed < 650);
    car.run(1.5, { throttle: true });
    assert.ok(Math.abs(car.speed - 390) < 1e-6);
});

test('a tab stall cannot create a giant physics impulse', () => {
    const a = simulation(), b = simulation();
    a.tick({ throttle: true }, 0.1);
    b.tick({ throttle: true }, 4);
    assert.equal(a.speed, b.speed);
    assert.deepEqual(a.position, b.position);
});

test('analog steering remains proportional across frame rates', () => {
    const rates = [30, 60, 120].map(fps => {
        const car = simulation({ speed: 390, fps });
        // Fixed pose/velocity isolates the steering response from path integration.
        let result;
        for (let i = 0; i < fps / 10; i++) result = stepHandling(car.state,
            { vx: 390, vy: 0, rotation: Math.PI / 2, maxSpeed: 390, acceleration: 560 },
            { steering: 0.4, throttle: true }, 1 / fps);
        return result.angularVelocity;
    });
    assert.ok(Math.abs(rates[0] - rates[2]) < 1e-9);
    assert.ok(rates[0] > 0 && rates[0] < HANDLING.turnSpeed * 0.4);
});

test('a sustained curve follows a similar path at 30, 60 and 120 FPS', () => {
    const runs = [30, 60, 120].map(fps => {
        const car = simulation({ speed: 320, fps });
        car.run(2, { steering: 0.65, throttle: true });
        return car;
    });
    const a = runs[0].position, b = runs[2].position;
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 10);
    assert.ok(Math.abs(runs[0].motion.rotation - runs[2].motion.rotation) < 0.04);
});

test('mobile curves shed speed smoothly, have firmer grip, and never trigger drift from braking', () => {
    const mobile = simulation({ speed: 390, tuning: MOBILE_HANDLING });
    const desktop = simulation({ speed: 390 });
    mobile.tick({ throttle: true, steering: 1 });
    assert.ok(mobile.speed > 375, 'the corner assist never snaps to a lower speed');
    const m = mobile.run(1, { throttle: true, steering: 1 });
    const d = desktop.run(1, { throttle: true, steering: 1 });
    assert.ok(mobile.speed > 230 && mobile.speed < 280);
    assert.ok(m.slip < d.slip);
    assert.ok(Math.abs(m.angularVelocity) < Math.abs(d.angularVelocity));
    mobile.run(0.25, { brake: true, steering: 1 });
    assert.equal(mobile.state.drifting, false);
    assert.equal(mobile.state.driftAmount, 0);
});

test('mobile reverse engages promptly and low-speed powered steering can free a stopped car', () => {
    const reverse = simulation({ tuning: MOBILE_HANDLING });
    reverse.run(0.15, { brake: true });
    assert.ok(reverse.motion.vx < -15);
    reverse.run(1, { brake: true });
    assert.ok(reverse.speed <= 115);
    const stationary = simulation({ tuning: MOBILE_HANDLING });
    assert.equal(stationary.tick({ steering: 1 }).angularVelocity, 0);
    assert.ok(stationary.tick({ steering: 1, throttle: true }).angularVelocity > 15);
});

test('mobile assisted curves remain consistent across common phone frame rates', () => {
    const runs = [30, 60, 120].map(fps => {
        const car = simulation({ speed: 390, fps, tuning: MOBILE_HANDLING });
        car.run(2, { throttle: true, steering: 0.8 });
        return car;
    });
    const a = runs[0].position, b = runs[2].position;
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 12);
    assert.ok(Math.abs(runs[0].speed - runs[2].speed) < 3);
});


test('mobile heading reaches and holds every direction from arbitrary orientations at 30/60/120 FPS', () => {
    for (const fps of [30, 60, 120]) {
        for (const start of [0, 2.9, -3.1]) {
            const car = simulation({ rotation: start, fps, tuning: MOBILE_HANDLING });
            for (const heading of [Math.PI / 2, Math.PI, -Math.PI / 2, 0, Math.PI / 4]) {
                car.run(1.2, { throttle: true, heading });
                const error = Math.atan2(Math.sin(heading - car.motion.rotation),
                    Math.cos(heading - car.motion.rotation));
                assert.ok(Math.abs(error) < 0.001, `heading ${heading} at ${fps} FPS`);
                const forward = { x: Math.sin(heading), y: -Math.cos(heading) };
                assert.ok(car.motion.vx * forward.x + car.motion.vy * forward.y > 100);
                assert.ok(Math.abs(car.tick({ throttle: true, heading }).angularVelocity) < 0.1);
                assert.ok(car.tick({}).angularVelocity === 0, 'release stops turning');
            }
        }
    }
});

test('heading takes the shortest turn, works at rest and never overshoots', () => {
    const car = simulation({ rotation: Math.PI - 0.1, tuning: MOBILE_HANDLING });
    const heading = -Math.PI + 0.1;
    assert.ok(car.tick({ throttle: true, heading }).angularVelocity > 0);
    for (let i = 0; i < 60; i++) {
        const error = Math.atan2(Math.sin(heading - car.motion.rotation), Math.cos(heading - car.motion.rotation));
        const step = car.tick({ throttle: true, heading }).angularVelocity * Math.PI / 180 / 60;
        assert.ok(Math.abs(step) <= Math.abs(error) + 1e-12);
    }
    assert.equal(car.tick({ throttle: true, heading }, 0).angularVelocity, 0);
});
