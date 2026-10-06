import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';

globalThis.window = { location: { search: '?touch=0' }, addEventListener() {}, matchMedia: () => ({ matches: false }) };
globalThis.Phaser = { Scene: class {}, Physics: { Arcade: { Sprite: class {} } },
    Events: { EventEmitter },
    BlendModes: { ADD: 1 }, Math: { Clamp: (value, min, max) => Math.max(min, Math.min(max, value)) } };
const { default: Race } = await import('../js/scenes/RaceScene.js');

class Image {
    constructor(x, y, texture, frame = '__BASE') {
        Object.assign(this, { x, y, texture: { key: texture }, frame: { name: frame },
            scaleX: 1, scaleY: 1, rotation: 0, visible: true, alpha: 1, children: [] });
    }
    setDisplaySize(width, height) { this.displayWidth = width; this.displayHeight = height; return this; }
    setRotation(rotation) { this.rotation = rotation; return this; }
    setOrigin() { return this; }
    setBlendMode() { return this; }
    setDepth(depth) { this.depth = depth; return this; }
    setVisible(visible) { this.visible = visible; return this; }
    setPosition(x, y) { this.x = x; this.y = y; return this; }
    setScale(x, y = x) { this.scaleX = x; this.scaleY = y; return this; }
    setAlpha(alpha) { this.alpha = alpha; return this; }
    setTexture(key, name) { this.texture = { key }; this.frame = { name }; return this; }
    setTint(tint) { this.tint = tint; return this; }
    setFlip() { return this; }
    add(children) { this.children.push(...(Array.isArray(children) ? children : [children])); return this; }
    addAt(child, index) { this.children.splice(index, 0, child); return this; }
    setEmitterAngle(direction) { this.direction = direction; return this; }
    explode(count, x, y) { this.lastExplosion = { count, x, y }; return this; }
}

function scene() {
    const race = new Race();
    race.created = [];
    const add = (x, y, texture) => { const image = new Image(x, y, texture); race.created.push(image); return image; };
    race.add = { image: add, rectangle: add, container: add, text: add,
        particles(x, y, key, config) { const emitter = add(x, y, key); emitter.config = config; return emitter; } };
    race.physics = { add: { existing() {}, staticGroup() { return { add() {} }; } } };
    const keys = new Set();
    const context = new Proxy({}, { get: (_, method) => method.startsWith('create')
        ? () => ({ addColorStop() {} }) : () => {} });
    race.textures = { exists: key => keys.has(key), createCanvas(key) {
        keys.add(key); return { getContext: () => context, refresh() {} };
    } };
    race.map = { tileWidth: 64, tileHeight: 64 };
    race.boostLayer = new Image();
    race.car = new Image(0, 0, 'carro');
    race.boosts = [];
    race.car.activateTrackBoost = time => race.boosts.push(time);
    race.cameras = { main: { worldView: { x: 0, y: 0, right: 8000, bottom: 5504 }, shake() {} } };
    race.createBoostSensors();
    return race;
}

test('all eight boost pads use the new art and keep their original dimensions', () => {
    const race = scene();
    assert.equal(race.boostLayer.visible, false);
    assert.equal(race.boostData.length, 8);
    assert.equal(race.boostFX.pads.length, 8);
    for (const boost of race.boostData) {
        assert.equal(boost.plate.texture.key, 'placaboost');
        assert.equal(boost.plate.displayWidth, 64);
        assert.equal(boost.plate.displayHeight, 96);
        assert.equal(boost.halfX, 32);
        assert.equal(boost.halfY, 48);
        assert.equal(boost.plate.rotation, boost.rotation);
    }
});

test('boost numbering follows the clockwise route from the starting line', () => {
    const race = scene();
    assert.deepEqual(race.boostData.map(boost => boost.number), [1, 2, 3, 4, 5, 6, 7, 8]);
    const expected = [[70, 54], [46, 54], [32, 38], [7.5, 20], [22, 24], [48, 15], [65, 44], [88, 49]];
    race.boostData.forEach((boost, index) => {
        assert.equal(boost.x, expected[index][0] * 64 + 32);
        assert.equal(boost.y, expected[index][1] * 64 + 32);
        assert.equal(boost.sensor.boostNumber, index + 1);
        assert.equal(boost.numberLabel.texture.key, String(index + 1));
    });
    assert.equal(race.boostData[4].rotation, Math.PI, 'Plate 5 points down');
    assert.equal(race.boostData[6].rotation, Math.PI / 2, 'Plate 7 points right');
    assert.equal(race.boostData[7].rotation, Math.PI, 'Plate 8 points down');
});

test('plates 7 and 8 and their hit margin stay on asphalt away from the curb and collision walls', () => {
    const raw = JSON.parse(readFileSync(new URL('../assets/images/tilemaps/pista.json', import.meta.url)));
    const track = raw.layers.find(layer => layer.name === 'Pista');
    const walls = raw.layers.find(layer => layer.name === 'colisoes pista').objects;
    const race = scene();
    for (const boost of race.boostData.slice(6)) {
        const halfWidth = boost.rotation === Math.PI / 2 ? 48 : 32;
        const halfHeight = boost.rotation === Math.PI / 2 ? 32 : 48;
        const left = boost.x - halfWidth - boost.radius;
        const right = boost.x + halfWidth + boost.radius;
        const top = boost.y - halfHeight - boost.radius;
        const bottom = boost.y + halfHeight + boost.radius;
        for (let y = top; y <= bottom; y += 8) for (let x = left; x <= right; x += 8) {
            assert.ok(track.data[Math.floor(y / 64) * track.width + Math.floor(x / 64)],
                `Plate ${boost.number} must stay entirely on the track`);
        }
        for (const wall of walls) {
            if (wall.polygon || wall.polyline || wall.rotation) continue;
            const overlaps = left < wall.x + wall.width && right > wall.x
                && top < wall.y + wall.height && bottom > wall.y;
            assert.equal(overlaps, false, `Plate ${boost.number} must not touch a collision wall`);
        }
    }
});

test('crossing pad edges and corners triggers once within cooldown in every orientation', () => {
    for (const index of [0, 2, 5, 7]) {
        const race = scene();
        const boost = race.boostData[index];
        const setLocal = (x, y) => {
            race.car.x = boost.x + x * Math.cos(boost.rotation) - y * Math.sin(boost.rotation);
            race.car.y = boost.y + x * Math.sin(boost.rotation) + y * Math.cos(boost.rotation);
        };
        setLocal(boost.halfX + 12, boost.halfY + 12);
        race.checkBoostPlates(1000);
        assert.equal(race.boosts.length, 0, 'Outside the rounded corner');
        setLocal(boost.halfX + 8, boost.halfY + 8);
        race.checkBoostPlates(1001);
        race.checkBoostPlates(1100);
        assert.deepEqual(race.boosts, [1001]);
        assert.equal(boost.sensor.boostCooldownUntil, 1551);
        assert.equal(race.boostFX.burst.lastExplosion.count, 22);
        assert.equal(race.boostFX.sparks.lastExplosion.count, 16);
        race.checkBoostPlates(1552);
        assert.deepEqual(race.boosts, [1001, 1552]);
    }
});

test('repeated activations reuse waves, trails and emitters without creating objects or resizing plates', () => {
    const race = scene();
    const count = race.created.length;
    for (let activation = 0; activation < 20; activation++) {
        const time = 1000 + activation * 600;
        const boost = race.boostData[activation % race.boostData.length];
        race.car.setPosition(boost.x, boost.y).setRotation(boost.rotation);
        race.activateBoostPlate(boost, time);
        for (let elapsed = 0; elapsed < 550; elapsed += 16) race.boostFX.update(time + elapsed);
        assert.equal(boost.plate.displayWidth, 64);
        assert.equal(boost.plate.displayHeight, 96);
    }
    assert.equal(race.created.length, count);
    assert.equal(race.boostFX.waves.length, 4);
    assert.equal(race.boostFX.ghosts.length, 8);
    race.boostFX.update(20000);
    assert.ok(race.boostFX.waves.every(wave => !wave.image.visible));
    assert.ok(race.boostFX.ghosts.every(ghost => !ghost.image.visible));
    assert.equal(race.boostFX.burst.config.maxAliveParticles, 48);
    assert.equal(race.boostFX.sparks.config.maxAliveParticles, 40);
});

test('pad illumination is culled outside the world camera', () => {
    const race = scene();
    race.cameras.main.worldView = { x: -500, y: -500, right: 0, bottom: 0 };
    race.boostFX.update(1000);
    for (const pad of race.boostFX.pads) {
        assert.equal(pad.aura.visible, false);
        assert.equal(pad.flash.visible, false);
        assert.equal(pad.scan.visible, false);
    }
});
