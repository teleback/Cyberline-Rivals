import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';

let pad = null;
globalThis.window = { location: { search: '?touch=0' }, addEventListener() {},
    matchMedia: () => ({ matches: false }) };
globalThis.localStorage = { getItem: () => null };
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => [pad] } });

class Vector {
    constructor(x = 0, y = 0) { this.set(x, y); }
    set(x, y = x) { this.x = x; this.y = y; return this; }
    clone() { return new Vector(this.x, this.y); }
    scale(value) { this.x *= value; this.y *= value; return this; }
    add(v) { this.x += v.x; this.y += v.y; return this; }
    dot(v) { return this.x * v.x + this.y * v.y; }
    length() { return Math.hypot(this.x, this.y); }
}
class Sprite extends EventEmitter {
    constructor(scene, x, y) { super(); Object.assign(this, { scene, x, y, rotation: Math.PI / 2 }); }
    setOrigin() { return this; }
    setCollideWorldBounds() { return this; }
    setBounce(value) { this.bounce = value; return this; }
    setDamping(value) { this.damping = value; return this; }
    setDrag(value) { this.drag = value; return this; }
    setMaxVelocity(value) { this.body.maxVelocity = new Vector(value, value); return this; }
    setVelocity(x, y) { this.body.velocity.set(x, y); return this; }
    setAngularVelocity(value) { this.body.angularVelocity = value; return this; }
}
globalThis.Phaser = { Scene: class {}, Physics: { Arcade: { Sprite } },
    Events: { EventEmitter }, Input: { Keyboard: { KeyCodes: { SHIFT: 16 } } } };
const { default: Car } = await import('../js/objects/Car.js');
const { default: Race } = await import('../js/scenes/RaceScene.js');
const { readGamepad } = await import('../js/input/GamepadInput.js');

function setup(speed = 0) {
    const scene = {
        add: { existing() {} },
        physics: { add: { existing(car) {
            car.body = { velocity: new Vector(speed, 0), acceleration: new Vector(),
                setCircle() {}, get speed() { return this.velocity.length(); } };
        } }, velocityFromRotation(angle, magnitude) {
            return new Vector(Math.cos(angle) * magnitude, Math.sin(angle) * magnitude);
        } },
        input: { keyboard: { addKey: () => ({ isDown: false }), createCursorKeys: () =>
            Object.fromEntries(['up', 'down', 'left', 'right'].map(key => [key, { isDown: false }])) } },
    };
    return new Car(scene, 0, 0, 'carro');
}

test('the real car controller uses one physics integrator and freezes every control before GO', () => {
    const car = setup(200);
    assert.equal(car.drag, 0);
    assert.equal(car.damping, false);
    car.cursors.up.isDown = true;
    car.controlsEnabled = false;
    car.body.acceleration.set(500, 500);
    car.update(0, 16);
    assert.equal(car.body.velocity.length(), 0);
    assert.equal(car.body.acceleration.length(), 0);
    assert.equal(car.body.angularVelocity, 0);
    assert.equal(car.networkControls.throttle, false);
    car.controlsEnabled = true;
    car.update(16, 16);
    assert.ok(car.body.velocity.length() > 0);
    assert.equal(car.networkControls.throttle, true);
});

test('braking interrupts turbo without draining more fuel, and reverse cannot activate it', () => {
    const car = setup(250);
    let starts = 0, stops = 0;
    car.on('turbo-start', () => starts++);
    car.on('turbo-stop', () => stops++);
    car.cursors.up.isDown = true;
    car.keyShift.isDown = true;
    car.update(100, 16);
    assert.equal(starts, 1);
    assert.equal(car.isTurboActive, true);
    const fuel = car.turboFuel;
    car.cursors.down.isDown = true;
    car.update(116, 16);
    assert.equal(car.isTurboActive, false);
    assert.equal(stops, 1);
    assert.equal(car.turboFuel, fuel);
    assert.equal(car.networkControls.throttle, false);
    assert.equal(car.networkControls.braking, true);
    car.cursors.down.isDown = false;
    car.setVelocity(-100, 0);
    car.update(132, 16);
    assert.equal(starts, 1);
});

test('a track boost extends the radial speed limit and expiry eases back to normal', () => {
    const car = setup(390);
    car.cursors.up.isDown = true;
    car.activateTrackBoost(100);
    car.update(116, 16);
    assert.ok(car.maxDriveSpeed > car.baseMaxVelocity);
    assert.ok(car.body.speed > 500);
    const before = car.body.speed;
    car.update(1600, 16);
    assert.equal(car.maxDriveSpeed, car.baseMaxVelocity);
    assert.ok(car.body.speed < before && car.body.speed > car.baseMaxVelocity);
});

test('repeated turbo taps and overlapping track boosts cannot stack unlimited speed', () => {
    const car = setup(390);
    car.cursors.up.isDown = true;
    for (let frame = 0; frame < 100; frame++) {
        car.keyShift.isDown = frame % 2 === 0;
        car.activateTrackBoost(frame * 16);
        car.update(frame * 16, 16);
        assert.ok(car.body.speed <= car.baseMaxVelocity * car.turboMaxVelMultiplier
            * car.trackBoostMultiplier + 1e-6);
    }
});

test('wall impact cuts turbo once, blocks immediate reactivation, and ignores light scrapes', () => {
    const car = setup(390);
    car.cursors.up.isDown = true;
    car.keyShift.isDown = true;
    car.update(100, 16);
    const hits = [], shakes = [];
    const race = { car, time: { now: 110 }, carFX: { crash: speed => hits.push(speed) },
        cameras: { main: { shake: (...args) => shakes.push(args) } } };
    car.setVelocity(20, 0);
    const fuel = car.turboFuel;
    Race.prototype.onCrash.call(race);
    assert.equal(car.isTurboActive, false);
    assert.equal(car.turboFuel, fuel - 12);
    Race.prototype.onCrash.call(race);
    assert.equal(car.turboFuel, fuel - 12);
    assert.equal(hits.length, 1);
    assert.ok(shakes[0][1] <= 0.005);
    car.update(126, 16);
    assert.equal(car.isTurboActive, false);
    race.time.now = 900;
    Race.prototype.onCrash.call(race, 20);
    assert.equal(hits.length, 1);
});

test('standard analog steering preserves small movements; D-pad and SNES keep full travel', () => {
    pad = { connected: true, id: 'test', mapping: 'standard', axes: [0.10, 0],
        buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })) };
    assert.equal(readGamepad().steering, 0);
    pad.axes[0] = 0.35;
    assert.ok(readGamepad().steering > 0 && readGamepad().steering < 0.3);
    pad.axes[0] = -1;
    assert.equal(readGamepad().steering, -1);
    pad.axes[0] = 0;
    pad.buttons[15].pressed = true;
    assert.equal(readGamepad().steering, 1);
    pad.buttons[14].pressed = true;
    assert.equal(readGamepad().steering, 0);
    pad.buttons[14].pressed = pad.buttons[15].pressed = false;
    pad.mapping = '';
    pad.axes[0] = 0.75;
    assert.equal(readGamepad().steering, 1);
    pad = null;
});

test('after contact the controller avoids pushing into the curb while reverse remains available', () => {
    const car = setup(0);
    car.contact = { x: -1, y: 0, until: 300 };
    car.cursors.up.isDown = true;
    car.update(100, 16);
    assert.equal(car.body.velocity.x, 0);
    car.cursors.up.isDown = false;
    car.cursors.down.isDown = true;
    for (let i = 0; i < 20; i++) car.update(116 + i * 16, 16);
    assert.ok(car.body.velocity.x < -10);
});

test('short collision recovery preserves a barrel deflection instead of cancelling it with tire grip', () => {
    const car = setup(0);
    car.setVelocity(0, 150);
    car.contact = { x: -1, y: 0, barrel: true, until: 360 };
    car.cursors.up.isDown = true;
    car.update(100, 16);
    assert.equal(car.body.velocity.x, 0);
    assert.ok(car.body.velocity.y > 135 && car.body.velocity.y < 150);
    car.cursors.up.isDown = false;
    car.cursors.down.isDown = true;
    const before = car.body.velocity.y;
    car.update(116, 16);
    assert.ok(car.body.velocity.y < before * 0.85, 'braking restores full grip for maneuvering');
});
