import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import CarFX from '../js/fx/CarFX.js';
import CarLighting from '../js/fx/CarLighting.js';

let touchDevice = false;
globalThis.window = { location: { search: '' }, addEventListener() {},
    matchMedia: () => ({ matches: touchDevice }) };
const { default: TurboFX } = await import('../js/fx/TurboFX.js');

class Vector {
    constructor(x, y) { this.x = x; this.y = y; }
    clone() { return new Vector(this.x, this.y); }
    scale(value) { this.x *= value; this.y *= value; return this; }
}
globalThis.Phaser = { BlendModes: { ADD: 1 }, Math: {
    Vector2: Vector, Clamp: (v, min, max) => Math.max(min, Math.min(max, v)),
    FloatBetween: (a, b) => (a + b) / 2, RadToDeg: a => a * 180 / Math.PI,
    Distance: { Between: (x, y, x2, y2) => Math.hypot(x - x2, y - y2) },
} };
class Image {
    constructor(x, y, key) { Object.assign(this, { x, y, texture: { key }, frame: { name: '__BASE' } }); }
    setPosition(x, y) { this.x = x; this.y = y; return this; }
    setRotation(value) { this.rotation = value; return this; }
    setScale(x, y = x) { this.scaleX = x; this.scaleY = y; return this; }
    setDepth(value) { this.depth = value; return this; }
    setVisible(value) { this.visible = value; return this; }
    setAlpha(value) { this.alpha = value; return this; }
    setDisplaySize(x, y) { this.displayWidth = x; this.displayHeight = y; return this; }
    setOrigin() { return this; }
    setBlendMode() { return this; }
    setFlip() { return this; }
    setTint() { return this; }
    setEmitterAngle() { return this; }
    setScrollFactor() { return this; }
    setParticleLifespan() { return this; }
    destroy() { this.destroyed = true; }
    explode(count) { this.lastExplosion = count; }
}
function setup() {
    const created = [];
    const car = { x: 0, y: 0, rotation: Math.PI / 2, active: true, visible: true,
        controlsEnabled: true, isBraking: false, isDrifting: false, tireSlip: 0,
        scaleX: 1, scaleY: 1, depth: 1000, alpha: 1,
        body: { speed: 200, velocity: new Vector(200, 0) },
        texture: { key: 'carro' }, frame: { name: '__BASE' }, networkControls: { throttle: false } };
    const scene = { textures: { exists: () => true }, time: { now: 0 }, events: new EventEmitter(),
        physics: { velocityFromRotation: (angle, length) => new Vector(Math.cos(angle) * length, Math.sin(angle) * length) },
        add: { image: (x, y, key) => { const image = new Image(x, y, key); created.push(image); return image; },
            particles: (x, y, key, config) => {
                const image = new Image(x, y, key); image.config = config; created.push(image); return image;
            } } };
    return { car, scene, created };
}

test('camera anticipates actual movement with a bounded offset and consistent smoothing', () => {
    const run = fps => {
        const camera = Object.create(TurboFX.prototype);
        Object.assign(camera, { car: { body: { speed: 650, velocity: { x: 650, y: 0 } }, controlsEnabled: true },
            baseZoom: 0.65, lookX: 0, lookY: 0, heatShake: 0,
            cam: { zoom: 0.65, setFollowOffset(x, y) { this.x = x; this.y = y; } } });
        for (let i = 0; i < fps; i++) camera.updateCamera(1 / fps, 0);
        return camera;
    };
    const slow = run(30), fast = run(120);
    assert.ok(Math.abs(slow.cam.x - fast.cam.x) < 1e-8);
    assert.ok(slow.cam.x < 0 && slow.cam.x >= -70, 'negative offset opens space in the travel direction');
    assert.equal(slow.cam.y, 0);
    assert.ok(slow.cam.zoom < 0.65 && slow.cam.zoom > 0.61);
    slow.car.controlsEnabled = false;
    slow.car.body.speed = 0;
    slow.car.body.velocity.x = 0;
    for (let i = 0; i < 120; i++) slow.updateCamera(1 / 60, 0);
    assert.ok(Math.abs(slow.cam.x) < 0.03);
});

test('mobile turbo avoids GPU filters, DOM repaints and trail allocations across repeated activations', () => {
    touchDevice = true;
    let writes = 0;
    globalThis.document = { getElementById: () => ({ style: { setProperty() { writes++; } } }) };
    Phaser.Geom = { Rectangle: class {} };
    const { scene, car, created } = setup();
    Object.assign(car, { on() {}, setTint() {}, clearTint() {}, angle: 0, turboIntensity: 0.8,
        enableFilters() { throw new Error('No mobile car glow filter'); } });
    Object.assign(scene, {
        scale: { width: 800, height: 450 }, renderer: { gl: true },
        cameras: { main: { zoom: 0.65, setFollowOffset() {}, shake() {},
            get filters() { throw new Error('No mobile camera filters'); } } },
        tweens: { add() { throw new Error('Turbo trails must reuse their fixed pool'); } },
    });
    scene.add.rectangle = () => { const image = new Image(); created.push(image); return image; };
    const fx = new TurboFX(scene, car);
    fx.streaks.ops = { rotate: { onChange() {} } };
    const count = created.length;
    assert.equal(fx.filters, null);
    assert.equal(fx.carGlow, null);
    assert.ok(fx.flame.config.maxAliveParticles + fx.sparks.config.maxAliveParticles
        + fx.streaks.config.maxAliveParticles <= 34);
    for (let time = 0; time < 8000; time += 16) {
        if (time % 800 === 0) fx.onStart();
        fx.update(time, 16);
    }
    assert.equal(created.length, count);
    assert.ok(fx.ghosts.some(ghost => ghost.visible));
    assert.equal(writes, 0);
    car.turboIntensity = 0;
    fx.update(8500, 16);
    assert.ok(fx.ghosts.every(ghost => !ghost.visible));
    fx.destroy();
    touchDevice = false;
});

test('pooled tail lights brighten on braking locally and from multiplayer state', () => {
    const { car, scene, created } = setup();
    const lights = new CarLighting(scene, car, () => 'glow', 0x00ffff);
    const count = created.length, idle = lights.tailLights[0].alpha;
    car.isBraking = true;
    lights.update();
    assert.ok(lights.tailLights[0].alpha > idle * 2);
    assert.ok(lights.tailLights[0].x < car.x, 'tail lights are behind the right-facing car');
    delete car.isBraking;
    car.networkControls.braking = true;
    lights.update();
    assert.ok(lights.tailLights[0].alpha > idle * 2);
    assert.equal(created.length, count);
    car.visible = false;
    lights.update();
    assert.ok(lights.worldObjects.every(object => !object.visible));
    lights.destroy();
    assert.ok(lights.worldObjects.every(object => object.destroyed));
});

test('distant car lights sleep and reappear before their beams enter the camera', () => {
    const { car, scene, created } = setup();
    const lights = new CarLighting(scene, car, () => 'glow', 0x00ffff);
    const view = { x: 1000, y: 1000, right: 1800, bottom: 1450 };
    const count = created.length;
    lights.update(view);
    assert.ok(lights.worldObjects.every(object => !object.visible));
    car.x = 850; car.y = 1200;
    lights.update(view);
    assert.ok(lights.worldObjects.every(object => object.visible), 'Beams can enter before the car does');
    assert.equal(created.length, count);
});

test('desktop turbo uses one restrained color pass and reuses its matrix between intensity changes', () => {
    touchDevice = false;
    globalThis.document = { getElementById: () => ({ style: { setProperty() {} } }) };
    Phaser.Geom = { Rectangle: class {} };
    const { car, scene } = setup();
    let filters = 0, matrixChanges = 0;
    const color = { active: false, colorMatrix: {
        saturate(amount) { assert.ok(amount <= 0.18); matrixChanges++; },
        brightness(amount) { assert.ok(amount <= 1.04); matrixChanges++; },
    } };
    Object.assign(car, { on() {}, setTint() {}, clearTint() {}, angle: 0, turboIntensity: 0.8 });
    Object.assign(scene, { scale: { width: 800, height: 450 }, renderer: { gl: true },
        cameras: { main: { zoom: 0.65, setFollowOffset() {}, shake() {}, filters: { internal: {
            addColorMatrix() { filters++; return color; },
            addBlur() { throw new Error('No full-screen blur'); },
            addBarrel() { throw new Error('No camera distortion'); },
            addVignette() { throw new Error('No darkening of upcoming curves'); },
        } } } } });
    scene.add.rectangle = () => new Image();
    const fx = new TurboFX(scene, car);
    fx.streaks.ops = { rotate: { onChange() {} } };
    for (let frame = 0; frame < 120; frame++) fx.update(frame * 16, 16);
    assert.equal(filters, 1);
    assert.equal(matrixChanges, 2);
    assert.equal(color.active, true);
    car.turboIntensity = 0;
    fx.update(2000, 16);
    assert.equal(color.active, false);
    fx.destroy();
});

test('mobile tire effects keep braking feedback with smaller fixed particle and mark pools', () => {
    const { car, scene, created } = setup();
    scene.fx = { lite: true };
    car.isBraking = true;
    const fx = new CarFX(scene, car), count = created.length;
    assert.equal(fx.marks.length, 32);
    assert.ok(fx.smoke.config.maxAliveParticles + fx.dust.config.maxAliveParticles
        + fx.impact.config.maxAliveParticles <= 46);
    for (let frame = 0; frame < 120; frame++) {
        car.x += 20; scene.time.now += 16; fx.update(16);
    }
    assert.equal(fx.smoke.emitting, true);
    assert.ok(fx.marks.some(mark => mark.visible));
    assert.equal(created.length, count);
});

test('tire effects use shared control state, remain pooled, and stop when controls are locked', () => {
    const { car, scene, created } = setup();
    const fx = new CarFX(scene, car);
    fx.previousSpeed = 200;
    fx.update(16);
    assert.equal(fx.smoke.emitting, false);
    car.isBraking = true;
    const count = created.length;
    for (let frame = 0; frame < 100; frame++) {
        car.x += 15;
        scene.time.now += 16;
        fx.update(16);
    }
    assert.equal(fx.smoke.emitting, true);
    assert.equal(fx.dust.emitting, false, 'asphalt braking produces tire smoke instead of dust');
    assert.ok(fx.marks.some(mark => mark.visible));
    assert.equal(created.length, count);
    fx.crash(400);
    assert.ok(fx.impact.lastExplosion <= 16);
    fx.update(16);
    assert.equal(fx.impactFlash.visible, true);
    assert.ok(fx.impactFlash.alpha > 0);
    assert.equal(car.scaleX, 1, 'impact animation does not resize the physics sprite');
    car.controlsEnabled = false;
    fx.update(16);
    assert.equal(fx.smoke.emitting, false);
    scene.time.now += 5000;
    fx.update(16);
    assert.ok(fx.marks.every(mark => !mark.visible));
    scene.events.emit('shutdown');
    assert.ok(created.every(object => object.destroyed));
});
