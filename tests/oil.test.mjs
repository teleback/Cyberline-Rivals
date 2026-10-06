import assert from 'node:assert/strict';
import { test } from 'node:test';
import { neonOilPixels } from '../js/fx/OilFX.js';

globalThis.window = { location: { search: '?touch=0' }, addEventListener() {}, matchMedia: () => ({ matches: false }) };
globalThis.Phaser = { Physics: { Arcade: { Sprite: class {} } } };
const { default: Car, OIL_SETTINGS } = await import('../js/objects/Car.js');

function carWithVelocity(x, y) {
    const velocity = { x, y, length() { return Math.hypot(this.x, this.y); },
        scale(factor) { this.x *= factor; this.y *= factor; return this; } };
    const car = Object.create(Car.prototype);
    Object.assign(car, { body: { velocity }, _oilSpeedCap: null,
        oilEntryRetention: OIL_SETTINGS.entryRetention,
        oilSpeedRetention: OIL_SETTINGS.speedRetention,
        oilMinDecel: OIL_SETTINGS.minDecel, oilMinSpeed: OIL_SETTINGS.minSpeed });
    return car;
}

test('neon palette preserves every transparent hole and alpha value of the oil silhouette', () => {
    const width = 5, height = 5;
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let y = 1; y < 4; y++) for (let x = 1; x < 4; x++) {
        const offset = (y * width + x) * 4;
        pixels.set([20, 20, 20, 255], offset);
    }
    pixels[(2 * width + 2) * 4 + 3] = 0; // Hole in the center of the oil.
    pixels[(width + 1) * 4 + 3] = 90; // Soft antialiased edge.
    const before = pixels.slice();
    neonOilPixels(pixels, width, height);
    for (let offset = 0; offset < pixels.length; offset += 4) {
        assert.equal(pixels[offset + 3], before[offset + 3]);
        if (!before[offset + 3]) {
            assert.deepEqual(pixels.slice(offset, offset + 4), before.slice(offset, offset + 4));
        } else {
            assert.ok(pixels[offset + 2] > pixels[offset]);
            assert.ok(pixels[offset] > pixels[offset + 1] * 2);
            assert.ok(pixels[offset + 2] >= 155);
        }
    }
});

test('entering oil immediately removes 35 percent of speed without changing direction', () => {
    const car = carWithVelocity(300, -400);
    car.applyOilDeceleration(0);
    assert.ok(Math.abs(car.body.velocity.length() - 325) < 1e-9);
    assert.equal(car.body.velocity.x / car.body.velocity.y, -0.75);
    car.applyOilDeceleration(0);
    assert.ok(Math.abs(car.body.velocity.length() - 325) < 1e-9,
        'Entry slowdown happens once, not on every frame');
});

test('oil slows normal and turbo speeds at comparable rates across frame rates', () => {
    for (const speed of [390, 650]) {
        const run = fps => {
            const car = carWithVelocity(speed, 0);
            for (let frame = 0; frame < fps / 2; frame++) car.applyOilDeceleration(1 / fps);
            return car.body.velocity.length();
        };
        const slow = run(30), fast = run(60);
        assert.ok(slow >= OIL_SETTINGS.minSpeed && fast >= OIL_SETTINGS.minSpeed);
        assert.ok(fast < speed * 0.65);
        assert.ok(Math.abs(slow - fast) < 2);
    }
});

test('oil keeps a moving car able to leave and never accelerates a stationary or slow car', () => {
    const moving = carWithVelocity(-500, 0);
    for (let frame = 0; frame < 300; frame++) moving.applyOilDeceleration(1 / 60);
    assert.equal(moving.body.velocity.length(), OIL_SETTINGS.minSpeed);
    assert.ok(moving.body.velocity.x < 0);
    for (const speed of [0, 25, 60]) {
        const car = carWithVelocity(0, speed);
        car.applyOilDeceleration(1 / 60);
        assert.equal(car.body.velocity.length(), speed);
    }
});
