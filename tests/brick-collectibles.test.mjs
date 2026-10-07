import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import BrickCollectibles from '../js/objects/BrickCollectibles.js';

globalThis.Phaser = { BlendModes: { ADD: 1 } };
const map = JSON.parse(readFileSync(new URL('../assets/images/tilemaps/pista.json', import.meta.url)));

class Image {
    constructor(x, y) { Object.assign(this, { x, y, visible: true, children: [] }); }
    setDepth(depth) { this.depth = depth; return this; }
    setDisplaySize(width, height) { this.width = width; this.height = height; return this; }
    setBlendMode() { return this; }
    setAlpha(alpha) { this.alpha = alpha; return this; }
    setVisible(visible) { this.visible = visible; return this; }
    setPosition(x, y) { this.x = x; this.y = y; return this; }
    add(children) { this.children.push(...children); return this; }
    explode(count, x, y) { this.explosion = { count, x, y }; }
}

function setup(overrides = {}) {
    const objects = [], keys = new Set(), sounds = [], publishes = [];
    const image = (x, y) => { const result = new Image(x, y); objects.push(result); return result; };
    const scene = {
        map, currentLap: 1, raceTimerStarted: true, raceFinished: false,
        car: { x: 0, y: 0, controlsEnabled: true, body: { center: { x: 0, y: 0 }, halfWidth: 24 } },
        cameras: { main: { worldView: { x: 0, y: 0, right: 8000, bottom: 5504 } } },
        textures: { exists: key => keys.has(key), createCanvas(key) {
            keys.add(key);
            return { getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} }),
                refresh() {} };
        } },
        add: { image, container: image, particles(x, y, key, config) {
            const emitter = image(x, y); emitter.config = config; return emitter;
        } },
        sound: { mute: false }, scoreTone: (...args) => sounds.push(args),
        publishNetworkState: (...args) => publishes.push(args),
        ...overrides,
    };
    const pickups = new BrickCollectibles(scene);
    const move = (x, y) => {
        scene.car.x = x; scene.car.y = y;
        Object.assign(scene.car.body.center, { x, y });
    };
    return { pickups, scene, move, objects, sounds, publishes };
}

test('a brick adds one tijolinho, disappears, and cannot be farmed by waiting or driving back', () => {
    const { pickups, scene, move, sounds } = setup(), brick = pickups.bricks[0];
    move(brick.x, brick.y);
    pickups.update(1000);
    assert.equal(scene.brickCount, 1);
    assert.equal(brick.sprite.visible, false);
    assert.equal(brick.glow.visible, false);
    assert.equal(pickups.burst.explosion.count, 8);
    pickups.update(9000);
    move(brick.x + 90, brick.y); pickups.update(10000);
    move(brick.x, brick.y); pickups.update(10100);
    assert.equal(scene.brickCount, 1);
    assert.equal(sounds.length, 1);
    pickups.resetForLap(1);
    pickups.update(11000);
    assert.equal(scene.brickCount, 1, 'Same-lap reset cannot restore collected currency');
    pickups.resetForLap(2);
    pickups.update(12000);
    assert.equal(scene.brickCount, 2, 'A new accepted lap restores pickups and retains the race total');
});

function networkPair() {
    const a = setup({ playerId: 'a', multiplayer: { playerId: 'a', connected: true }, totalLaps: 3 });
    const b = setup({ playerId: 'b', multiplayer: { playerId: 'b', connected: true }, totalLaps: 3 });
    const race = { roundId: 'session-a:start-1000', coordinatorId: 'a', participantIds: ['a', 'b'] };
    a.pickups.startRace(race); b.pickups.startRace(race);
    const packet = driver => ({ id: driver.scene.playerId, lap: driver.pickups.lap,
        brickState: JSON.parse(JSON.stringify(driver.pickups.getNetworkState())) });
    return { a, b, packet };
}

test('shared pickups hide for both drivers and a losing simultaneous request earns no tijolinho', () => {
    const { a, b, packet } = networkPair();
    const brickA = a.pickups.bricks[0], brickB = b.pickups.bricks[0];
    for (const [driver, brick] of [[a, brickA], [b, brickB]]) {
        driver.pickups.bricks = [brick];
        driver.move(brick.x, brick.y); driver.pickups.update(1000);
    }
    assert.equal(a.scene.brickCount, 1);
    assert.equal(b.scene.brickCount, 0);
    assert.equal(b.pickups.hasPendingClaims(), true);
    assert.equal(brickB.sprite.visible, false);
    a.pickups.receiveNetworkState(packet(b));
    b.pickups.receiveNetworkState(packet(a));
    assert.equal(b.pickups.hasPendingClaims(), false);
    assert.equal(b.scene.brickCount, 0);
    assert.equal(b.pickups.countFor('a'), 1);
    assert.equal(brickA.collected, true); assert.equal(brickB.collected, true);
    assert.equal(b.sounds.length, 0, 'A losing request has no reward sound');
    for (let frame = 0; frame < 3; frame++) {
        a.pickups.receiveNetworkState(packet(b)); b.pickups.receiveNetworkState(packet(a));
        a.pickups.update(1100 + frame); b.pickups.update(1100 + frame);
    }
    assert.equal(a.scene.brickCount + b.scene.brickCount, 1);
});

test('remote winners receive confirmation effects once, even after finishing or losing a packet', () => {
    const { a, b, packet } = networkPair(), brick = b.pickups.bricks[0];
    b.pickups.bricks = [brick];
    b.move(brick.x, brick.y); b.pickups.update(1000);
    assert.equal(b.scene.brickCount, 0);
    assert.equal(b.sounds.length, 0);
    a.scene.raceFinished = true;
    a.pickups.receiveNetworkState(packet(b));
    assert.equal(a.pickups.bricks[0].collected, true);
    assert.equal(a.pickups.countFor('b'), 1);
    b.scene.raceFinished = true;
    b.pickups.update(1400);
    assert.ok(b.publishes.length >= 2, 'A pending final pickup retries after finishing');
    const confirmations = a.publishes.length;
    a.pickups.receiveNetworkState(packet(b));
    assert.ok(a.publishes.length > confirmations, 'Lost confirmations are answered on retry');
    b.pickups.receiveNetworkState(packet(a));
    b.pickups.receiveNetworkState(packet(a));
    assert.equal(b.scene.brickCount, 1);
    assert.equal(b.sounds.length, 1);
    assert.equal(b.pickups.hasPendingClaims(), false);
    assert.equal(brick.collected, true);
});

test('a lagging driver cannot restore a brick already owned in the next lap', () => {
    const { a, b, packet } = networkPair(), brickA = a.pickups.bricks[0], brickB = b.pickups.bricks[0];
    a.pickups.resetForLap(2);
    a.move(brickA.x, brickA.y); a.pickups.update(1000);
    b.pickups.receiveNetworkState(packet(a));
    assert.equal(brickB.collected, false, 'The lagging driver still sees its own lap generation');
    b.pickups.resetForLap(2);
    assert.equal(brickB.collected, true, 'Entering the same lap retains the opponent award');
    b.move(brickB.x, brickB.y); b.pickups.update(1100);
    assert.equal(b.scene.brickCount, 0);
    b.pickups.resetForLap(3);
    b.pickups.update(1200);
    assert.equal(b.pickups.hasPendingClaims(), true, 'The next valid lap has a fresh pickup');
    a.pickups.receiveNetworkState(packet(b));
    b.pickups.receiveNetworkState(packet(a));
    assert.equal(b.scene.brickCount, 1);
    assert.equal(b.pickups.countFor('a'), 1);
});

test('real multiplayer scenes collect only after a valid shared round and while connected', () => {
    const fixture = setup({ playerId: 'a', multiplayer: { playerId: 'a', connected: true } });
    const brick = fixture.pickups.bricks[0];
    fixture.move(brick.x, brick.y); fixture.pickups.update(1000);
    assert.equal(fixture.scene.brickCount, 0);
    assert.equal(fixture.pickups.getNetworkState(), null);
    fixture.pickups.startRace({ roundId: 'round', coordinatorId: 'a', participantIds: ['a', 'b'] });
    fixture.scene.multiplayer.connected = false;
    fixture.pickups.update(1100);
    assert.equal(fixture.scene.brickCount, 0);
    fixture.scene.multiplayer.connected = true;
    fixture.pickups.update(1200);
    assert.equal(fixture.scene.brickCount, 1);
});

test('the countdown, disabled controls and the finished race grant no currency', () => {
    for (const state of [{ raceTimerStarted: false }, { raceFinished: true }, { controlsEnabled: false }]) {
        const { pickups, scene, move } = setup(), brick = pickups.bricks[0];
        Object.assign(scene, state);
        if ('controlsEnabled' in state) scene.car.controlsEnabled = state.controlsEnabled;
        move(brick.x, brick.y); pickups.update(1000);
        assert.equal(scene.brickCount, 0);
        assert.equal(brick.collected, false);
    }
});

test('swept pickup catches a brick crossed between turbo frames while near misses stay uncollected', () => {
    for (const offset of [0, 43]) {
        const { pickups, scene, move } = setup(), brick = pickups.bricks[0];
        // Isolate this pickup to assert the geometry without its trail neighbors.
        pickups.bricks = [brick];
        move(brick.x - 70, brick.y + offset); pickups.update(1000);
        move(brick.x + 70, brick.y + offset); pickups.update(1067);
        assert.equal(scene.brickCount, offset ? 0 : 1);
    }
});

test('pickup uses the aligned physics body; a teleport does not collect everything along its path', () => {
    const { pickups, scene, move } = setup(), brick = pickups.bricks[0];
    pickups.bricks = [brick];
    move(brick.x - 300, brick.y); pickups.update(1000);
    move(brick.x + 300, brick.y); pickups.update(1067);
    assert.equal(scene.brickCount, 0);
    scene.car.x = brick.x + 100; scene.car.y = brick.y + 100;
    Object.assign(scene.car.body.center, { x: brick.x, y: brick.y });
    pickups.update(1100);
    assert.equal(scene.brickCount, 1);
});

test('offscreen pickup art is culled, reused next lap, and sound honors mute', () => {
    const { pickups, scene, move, objects, sounds } = setup(), brick = pickups.bricks[0];
    const count = objects.length;
    scene.cameras.main.worldView = { x: -800, y: -500, right: -1, bottom: -1 };
    pickups.update(1000);
    assert.ok(pickups.bricks.every(item => !item.sprite.visible && !item.glow.visible));
    scene.sound.mute = true;
    move(brick.x, brick.y); pickups.update(1100);
    assert.equal(scene.brickCount, 1);
    assert.equal(sounds.length, 0);
    pickups.resetForLap(2);
    move(0, 0);
    scene.cameras.main.worldView = { x: 0, y: 0, right: 8000, bottom: 5504 };
    pickups.update(1200);
    assert.equal(brick.sprite.visible, true);
    for (let frame = 0; frame < 120; frame++) pickups.update(1300 + frame * 67);
    assert.equal(objects.length, count);
    assert.equal(pickups.burst.config.maxAliveParticles, 48);
    assert.ok(pickups.worldObjects.includes(pickups.visuals));
    assert.ok(pickups.worldObjects.includes(pickups.burst));
});
