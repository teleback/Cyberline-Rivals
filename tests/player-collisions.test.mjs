import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import PlayerCollisions, { resolvePlayerTravel } from '../js/objects/PlayerCollisions.js';
import { CollisionIndex, contactAt } from '../js/objects/TrackCollisions.js';

const rival = { x: 0, y: 0, rotation: Math.PI / 2, radius: 24, vx: 0, vy: 0 };
test('car noses collide before their center circles overlap, including at boosted speed', () => {
    for (const speed of [200, 390, 1400]) {
        const result = resolvePlayerTravel({ x: -150, y: 0 }, { x: 100, y: 0 },
            { x: speed, y: 0 }, Math.PI / 2, 24, rival, rival);
        assert.ok(result.x <= -96);
        assert.ok(result.vx < 0 && result.vx >= -65);
        assert.equal(result.hits.length, 1);
        assert.equal(result.hits[0].speed, speed);
    }
});

test('a side scrape slows the car moderately and preserves travel along the rival', () => {
    const result = resolvePlayerTravel({ x: -110, y: -46 }, { x: -60, y: -45 },
        { x: 350, y: 15 }, Math.PI / 2, 24, rival, rival);
    assert.ok(result.vx > 280 && result.vx < 350);
    assert.ok(result.vy < 0);
});

test('matching-speed cars and cars driving apart do not lose speed or repeat feedback', () => {
    for (const vx of [-100, 0, 200]) {
        const other = { ...rival, vx };
        const result = resolvePlayerTravel({ x: -100, y: 0 }, { x: -101, y: 0 },
            { x: vx, y: 0 }, Math.PI / 2, 24, other, other);
        assert.equal(result.vx, vx);
        assert.equal(result.hits.length, 0);
    }
});

test('the swept relative movement catches a fast rival crossing a stopped car', () => {
    const other = { ...rival, x: -160, vx: -1200 };
    const result = resolvePlayerTravel({ x: -120, y: 0 }, { x: -120, y: 0 },
        { x: 0, y: 0 }, Math.PI / 2, 24, other, { x: -20, y: 0 });
    assert.ok(result.x < other.x - 96);
    assert.ok(result.vx < 0 && result.vx >= -1265);
    assert.equal(result.hits.length, 1);
});

test('live player contact cannot push the car through a track wall and listeners are released', () => {
    const world = new EventEmitter(), events = new EventEmitter();
    const wall = { type: 'rect', x: -130, y: -200, width: 10, height: 400 };
    const body = { center: { x: -72, y: 0 }, position: { x: -96, y: -24 }, radius: 24,
        velocity: { x: 0, y: 0, set(x, y) { this.x = x; this.y = y; } },
        updateCenter() { this.center = { x: this.position.x + 24, y: this.position.y + 24 }; } };
    const remote = { sprite: { rotation: 0, body: { center: { x: -30, y: 0 } } },
        online: true, collider: { active: true }, vx: -200, vy: 0 };
    const hits = [], scene = { car: { body, rotation: 0, handling: { steering: 0 }, controlsEnabled: true },
        remotePlayers: { b: remote }, physics: { world }, events, time: { now: 100 },
        trackCollisions: { index: new CollisionIndex([wall]) },
        onCrash: (...args) => hits.push(args) };
    const collisions = new PlayerCollisions(scene);
    world.emit('worldstep');
    assert.equal(contactAt(wall, body.center.x, body.center.y, 24), null);
    assert.equal(hits.length, 1);
    assert.equal(hits[0][1].kind, 'car');
    world.emit('worldstep');
    assert.equal(hits.length, 1, 'sustained contact has a feedback cooldown');
    scene.car.controlsEnabled = false;
    body.velocity.set(0, 0);
    world.emit('worldstep');
    assert.equal(body.velocity.x, 0, 'the grid stays still before GO');
    assert.equal(world.listenerCount('worldstep'), 1);
    events.emit('shutdown');
    assert.equal(world.listenerCount('worldstep'), 0);
    assert.ok(collisions.previous);
});
