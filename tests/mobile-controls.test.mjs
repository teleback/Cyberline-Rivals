// Run with Node 22+: node --test tests/mobile-controls.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';

class Element {
    style = {};
    hidden = false;
    offsetWidth = 120;
    listeners = new Map();
    classes = new Set();
    classList = {
        add: (...names) => names.forEach(name => this.classes.add(name)),
        remove: (...names) => names.forEach(name => this.classes.delete(name)),
        toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name),
    };
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
    captured = new Set();
    setPointerCapture(id) { this.captured.add(id); }
    hasPointerCapture(id) { return this.captured.has(id); }
    releasePointerCapture(id) { this.captured.delete(id); }
    getBoundingClientRect() { return { left: 0, top: 0, right: 440, bottom: 450 }; }
    querySelector(selector) { return elements[selector]; }
}

const elements = Object.fromEntries(
    ['.tc-zone', '.tc-stick', '.tc-knob', '.tc-turbo', '.tc-accelerate', '.tc-brake'].map(name => [name, new Element()])
);
let joystickCenter = { x: 100, y: 100 };
elements['.tc-stick'].getBoundingClientRect = () => {
    const size = elements['.tc-stick'].offsetWidth;
    return { left: joystickCenter.x - size / 2, top: joystickCenter.y - size / 2,
        width: size, height: size, right: joystickCenter.x + size / 2, bottom: joystickCenter.y + size / 2 };
};
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
const { createHandlingState } = await import('../js/objects/CarHandling.js');
const zone = elements['.tc-zone'];
const turbo = elements['.tc-turbo'];
const accelerate = elements['.tc-accelerate'];
const brake = elements['.tc-brake'];
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
        handling: createHandlingState(),
        cursors: Object.fromEntries(['left', 'right', 'up', 'down'].map(key => [key, { isDown: false }])),
        scene: { physics: { velocityFromRotation: (_angle, speed, target) => {
            if (target) Object.assign(target, { x: 0, y: -speed });
            return { x: 0, y: -speed };
        } } },
        rotation: 0,
        body: {
            speed: 390,
            maxVelocity: { x: 390 },
            velocity: { x: 0, y: -390, dot: () => 390,
                length() { return Math.hypot(this.x, this.y); } },
            acceleration: { set() {} },
        },
        turboSpool: 0,
        acceleration: 500,
        maxDriveSpeed: 390,
        updateTurbo() {},
        setAngularVelocity(value) { this.angularVelocity = value; },
        setVelocity(x, y) { Object.assign(this.body.velocity, { x, y }); },
    });
    return car;
}

test('touches outside the fixed circle are ignored and small centered movements stay neutral', () => {
    for (const [x, y] of [[1, 449], [439, 1], [100, 100]]) {
        gesture(0, 0, x, y);
        assert.equal(readTouch().steering, 0);
        assert.equal(readTouch().up, false);
        assert.equal(readTouch().down, false);
    }
    gesture(8, 8);
    assert.equal(readTouch().steering, 0);
});

test('joystick points in all screen directions and accelerates without braking', () => {
    for (const [x, y, heading] of [[0, -48, 0], [48, 0, Math.PI / 2],
        [0, 48, Math.PI], [-48, 0, -Math.PI / 2], [48, -48, Math.PI / 4]]) {
        gesture(x, y);
        assert.ok(Math.abs(readTouch().heading - heading) < 1e-9);
        assert.equal(readTouch().up, true);
        assert.equal(readTouch().down, false);
    }
});

test('heading follows changes during one gesture and centering clears the target', () => {
    gesture(0, -48);
    zone.emit('pointermove', { clientX: 148, clientY: 100 });
    assert.equal(readTouch().heading, Math.PI / 2);
    zone.emit('pointermove', { clientX: 100, clientY: 148 });
    assert.equal(readTouch().heading, Math.PI);
    zone.emit('pointermove', { clientX: 52, clientY: 100 });
    assert.equal(readTouch().heading, -Math.PI / 2);
    zone.emit('pointermove', { clientX: 100, clientY: 100 });
    assert.equal(readTouch().heading, null);
    assert.equal(readTouch().up, false);
});

test('radial neutral zone filters jitter and long drags preserve the fixed center', () => {
    gesture(8, 0);
    assert.equal(readTouch().heading, null);
    zone.emit('pointermove', { clientX: 113, clientY: 100 });
    assert.equal(readTouch().heading, Math.PI / 2);
    zone.emit('pointermove', { clientX: 109, clientY: 100 });
    assert.equal(readTouch().up, true);
    zone.emit('pointermove', { clientX: 107, clientY: 100 });
    assert.equal(readTouch().heading, null);
    zone.emit('pointermove', { clientX: 400, clientY: 100 });
    assert.equal(readTouch().heading, Math.PI / 2);
    zone.emit('pointermove', { clientX: 100, clientY: 100 });
    assert.equal(readTouch().heading, null);
});

test('multitouch turbo works with steering, and deliberate braking takes priority', () => {
    gesture(30, -30);
    turbo.emit('pointerdown', { pointerId: 2 });
    assert.equal(readTouch().turbo, true);
    zone.emit('pointerup', { pointerId: 3 });
    assert.ok(readTouch().steering > 0);
    zone.emit('pointermove', { clientY: 145 });
    assert.equal(readTouch().down, false);
    brake.emit('pointerdown', { pointerId: 3 });
    assert.equal(readTouch().down, true);
    assert.equal(readTouch().up, false);
    turbo.emit('pointerup', { pointerId: 2 });
    brake.emit('pointerup', { pointerId: 3 });
    assert.equal(readTouch().turbo, false);
});

test('extra fingers cannot steal the joystick and releases outside the touch zone clear capture', () => {
    gesture(30, -30);
    const before = readTouch();
    zone.emit('pointerdown', { pointerId: 3, clientX: 400, clientY: 300 });
    zone.emit('pointermove', { pointerId: 3, clientX: 200, clientY: 100 });
    assert.deepEqual(readTouch(), before);
    turbo.emit('pointerdown', { pointerId: 2 });
    assert.ok(zone.hasPointerCapture(1));
    assert.ok(turbo.hasPointerCapture(2));
    window.emit('pointerup', { pointerId: 1 });
    assert.equal(zone.hasPointerCapture(1), false);
    assert.equal(readTouch().steering, 0);
    assert.equal(readTouch().turbo, true);
    window.emit('pointercancel', { pointerId: 2 });
    assert.equal(turbo.hasPointerCapture(2), false);
    assert.equal(readTouch().turbo, false);
});

test('hidden controls reject new gestures and visual brake feedback resets on release', () => {
    gesture(0, 45);
    brake.emit('pointerdown', { pointerId: 2 });
    assert.ok(elements['.tc-stick'].classes.has('tc-braking'));
    hideTouchControls();
    assert.equal(elements['.tc-stick'].classes.has('tc-braking'), false);
    zone.emit('pointerdown');
    zone.emit('pointermove', { clientX: 200, clientY: 40 });
    turbo.emit('pointerdown', { pointerId: 2 });
    assert.equal(readTouch().up, false);
    assert.equal(readTouch().turbo, false);
    showTouchControls();
});

test('car uses screen heading, stops turning on release and allows keyboard override', () => {
    gesture(48, 0);
    const car = makeCar();
    car.rotation = Math.PI / 2;
    car.update(0, 1000 / 60);
    assert.equal(car.angularVelocity, 0, 'holding right does not keep spinning once facing right');
    car.rotation = Math.PI;
    car.update(0, 1000 / 60);
    assert.ok(car.angularVelocity < 0, 'right target turns left when the car faces down');
    zone.emit('pointerup');
    car.update(0, 1000 / 60);
    assert.ok(car.angularVelocity === 0);
    gesture(48, 0);
    car.rotation = 0;
    car.body.velocity.x = 0;
    car.body.velocity.y = -390;
    car.cursors.right.isDown = true;
    car.update(0, 1000 / 60);
    assert.ok(car.angularVelocity > 0, 'keyboard takes priority over the touch target');
    zone.emit('pointerup');
});

test('separate pedals allow steering, braking and reverse gestures independently', () => {
    gesture(30, 0);
    accelerate.emit('pointerdown', { pointerId: 2 });
    assert.equal(readTouch().up, true);
    zone.emit('pointerup');
    assert.equal(readTouch().up, true, 'releasing steering does not release the accelerator pedal');
    brake.emit('pointerdown', { pointerId: 3 });
    assert.equal(readTouch().down, true);
    assert.equal(readTouch().up, false);
    assert.ok(elements['.tc-stick'].classes.has('tc-braking'));
    brake.emit('pointerup', { pointerId: 3 });
    assert.equal(readTouch().up, true);
    accelerate.emit('pointerup', { pointerId: 2 });
    assert.equal(readTouch().up, false);
});

test('the same thumb can slide from acceleration to brake without lifting or leaving a stuck pedal', () => {
    accelerate.getBoundingClientRect = () => ({ left: 700, top: 340, right: 780, bottom: 420 });
    brake.getBoundingClientRect = () => ({ left: 610, top: 340, right: 690, bottom: 420 });
    turbo.getBoundingClientRect = () => ({ left: 700, top: 280, right: 780, bottom: 330 });
    accelerate.emit('pointerdown', { pointerId: 2, clientX: 740, clientY: 380 });
    accelerate.emit('pointermove', { pointerId: 2, clientX: 650, clientY: 380 });
    assert.equal(readTouch().up, false);
    assert.equal(readTouch().down, true);
    assert.equal(accelerate.hasPointerCapture(2), false);
    assert.equal(brake.hasPointerCapture(2), true);
    brake.emit('pointermove', { pointerId: 2, clientX: 740, clientY: 300 });
    assert.equal(readTouch().down, false);
    assert.equal(readTouch().turbo, true);
    window.emit('pointerup', { pointerId: 2 });
    assert.equal(readTouch().turbo, false);
    assert.equal(readTouch().up, false);
});

test('app interruption releases every pedal, including a held reverse button', () => {
    accelerate.emit('pointerdown', { pointerId: 2 });
    brake.emit('pointerdown', { pointerId: 3 });
    window.emit('blur');
    assert.equal(readTouch().up, false);
    assert.equal(readTouch().down, false);
    assert.equal(accelerate.hasPointerCapture(2), false);
    assert.equal(brake.hasPointerCapture(3), false);
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
