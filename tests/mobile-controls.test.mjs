// Run with Node 22+: node --test tests/mobile-controls.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';

class Element {
    style = {};
    hidden = false;
    offsetWidth = 120;
    listeners = new Map();
    classList = { add() {}, remove() {} };
    addEventListener(name, fn) {
        const listeners = this.listeners.get(name) || [];
        listeners.push(fn);
        this.listeners.set(name, listeners);
    }
    emit(name, values = {}) {
        for (const fn of this.listeners.get(name) || []) {
            fn({ pointerId: 1, clientX: 100, clientY: 100, preventDefault() {}, ...values });
        }
    }
    setPointerCapture() {}
    getBoundingClientRect() { return { left: 0, top: 0, right: 440, bottom: 450 }; }
    querySelector(selector) { return elements[selector]; }
}

const elements = Object.fromEntries(
    ['.tc-zone', '.tc-stick', '.tc-knob', '.tc-turbo'].map(name => [name, new Element()])
);
globalThis.window = Object.assign(new Element(), {
    location: { search: '?touch=1' },
    matchMedia: () => ({ matches: true }),
});
globalThis.document = Object.assign(new Element(), {
    documentElement: new Element(),
    body: { appendChild() {} },
    createElement: () => new Element(),
});
globalThis.localStorage = { getItem: () => null };
Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => [] }, configurable: true });
globalThis.Phaser = {
    Physics: { Arcade: { Sprite: class {} } },
    Math: { Clamp: (value, min, max) => Math.max(min, Math.min(max, value)) },
};

const { showTouchControls, hideTouchControls, readTouch } = await import('../js/input/TouchControls.js');
const { default: Car } = await import('../js/objects/Car.js');
const zone = elements['.tc-zone'];
const turbo = elements['.tc-turbo'];
showTouchControls();

function gesture(x, y, originX = 100, originY = 100) {
    zone.emit('pointerup');
    zone.emit('pointerdown', { clientX: originX, clientY: originY });
    zone.emit('pointermove', { clientX: originX + x, clientY: originY + y });
}

function makeCar() {
    const car = Object.create(Car.prototype);
    Object.assign(car, {
        controlsEnabled: true,
        _touchSteering: 0,
        cursors: Object.fromEntries(['left', 'right', 'up', 'down'].map(key => [key, { isDown: false }])),
        scene: { physics: { velocityFromRotation: (_angle, speed, target) => {
            if (target) Object.assign(target, { x: 0, y: -speed });
            return { x: 0, y: -speed };
        } } },
        rotation: 0,
        body: {
            speed: 390,
            maxVelocity: { x: 390 },
            velocity: { dot: () => 390 },
            acceleration: { set() {} },
        },
        turnSpeed: 230,
        minTurnFactor: 0.35,
        driftMinSpeedFactor: 0.45,
        driftTurnBoost: 1.35,
        turboSpool: 0,
        normalGrip: 0.05,
        acceleration: 500,
        updateTurbo() {},
        applyGrip() {},
        setAngularVelocity(value) { this.angularVelocity = value; },
        setVelocity() {},
    });
    return car;
}

test('edge touches start neutral and small thumb movements stay neutral', () => {
    for (const [x, y] of [[1, 449], [439, 1], [100, 100]]) {
        gesture(0, 0, x, y);
        assert.equal(readTouch().steering, 0);
        assert.equal(readTouch().up, false);
        assert.equal(readTouch().down, false);
    }
    gesture(8, 8);
    assert.equal(readTouch().steering, 0);
});

test('steering is proportional and diagonal turns preserve acceleration', () => {
    gesture(30, -30);
    const gentle = readTouch();
    assert.ok(gentle.steering > 0 && gentle.steering < 0.5);
    assert.equal(gentle.up, true);
    zone.emit('pointermove', { clientX: 300, clientY: 70 });
    assert.equal(readTouch().steering, 1);
    assert.equal(readTouch().up, true);
    gesture(-60, 0);
    assert.equal(readTouch().steering, -1);
});

test('throttle and brake resist jitter; braking requires deliberate movement', () => {
    gesture(0, -30);
    zone.emit('pointermove', { clientY: 79 });
    assert.equal(readTouch().up, true);
    zone.emit('pointermove', { clientY: 90 });
    assert.equal(readTouch().up, false);
    gesture(60, 30);
    assert.equal(readTouch().down, false);
    zone.emit('pointermove', { clientX: 160, clientY: 145 });
    assert.equal(readTouch().down, true);
    zone.emit('pointermove', { clientX: 160, clientY: 133 });
    assert.equal(readTouch().down, true);
    zone.emit('pointermove', { clientX: 160, clientY: 120 });
    assert.equal(readTouch().down, false);
});

test('multitouch turbo works with steering, and deliberate braking takes priority', () => {
    gesture(30, -30);
    turbo.emit('pointerdown', { pointerId: 2 });
    assert.equal(readTouch().turbo, true);
    zone.emit('pointerup', { pointerId: 3 });
    assert.ok(readTouch().steering > 0);
    zone.emit('pointermove', { clientY: 145 });
    assert.equal(readTouch().down, true);
    assert.equal(readTouch().up, false);
    turbo.emit('pointerup', { pointerId: 2 });
    assert.equal(readTouch().turbo, false);
});

test('car smoothly applies analog steering with the same response at 30 and 120 FPS', () => {
    gesture(60, -60);
    const slow = makeCar();
    const fast = makeCar();
    for (let frame = 0; frame < 3; frame++) slow.update(0, 1000 / 30);
    for (let frame = 0; frame < 12; frame++) fast.update(0, 1000 / 120);
    assert.ok(Math.abs(slow.angularVelocity - fast.angularVelocity) < 1e-9);
    assert.ok(fast.angularVelocity > 0 && fast.angularVelocity < 230);
    gesture(30, -60);
    const gentle = makeCar();
    gentle.update(0, 100);
    assert.ok(gentle.angularVelocity < fast.angularVelocity / 2);
    zone.emit('pointerup');
    fast.update(0, 1000 / 60);
    assert.equal(fast.angularVelocity, 0);
    fast.cursors.left.isDown = true;
    fast.update(0, 1000 / 60);
    assert.equal(fast.angularVelocity, -230);
});

test('cancel, capture loss, blur, resize, tab hiding and scene exit reset controls', () => {
    for (const release of [
        () => zone.emit('pointercancel'),
        () => zone.emit('lostpointercapture'),
        () => window.emit('blur'),
        () => window.emit('resize'),
        () => { document.hidden = true; document.emit('visibilitychange'); },
        () => hideTouchControls(),
    ]) {
        showTouchControls();
        gesture(60, -60);
        release();
        assert.equal(readTouch().steering, 0);
        assert.equal(readTouch().up, false);
        assert.equal(readTouch().down, false);
    }
    showTouchControls();
    turbo.emit('pointerdown', { pointerId: 2 });
    window.emit('blur');
    assert.equal(readTouch().turbo, false);
});
