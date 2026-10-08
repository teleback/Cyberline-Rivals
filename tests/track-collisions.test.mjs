import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import TrackCollisions, { CollisionIndex, wallShapes, contactAt, resolveTravel } from '../js/objects/TrackCollisions.js';
import { EventEmitter } from 'node:events';
import { createRaceRoute } from '../js/objects/RaceProgress.js';

test('real Tiled curb points are joined only across short gaps and every original boundary is preserved', () => {
    const map = JSON.parse(readFileSync(new URL('../assets/images/tilemaps/pista.json', import.meta.url)));
    const objects = map.layers.filter(l => ['colisao', 'colisoes pista'].includes(l.name)).flatMap(l => l.objects);
    const shapes = wallShapes(objects);
    const segments = shapes.filter(s => s.type === 'segment');
    assert.ok(segments.length > 500);
    assert.equal(shapes.filter(s => s.type !== 'segment').length, objects.length);
    for (const s of segments) assert.ok(Math.hypot(s.ax - s.bx, s.ay - s.by) <= 45);
    const index = new CollisionIndex(shapes);
    const result = resolveTravel(index, { x: 5152, y: 3488 }, { x: 5100, y: 3488 }, { x: -390, y: 0 }, 24);
    assert.equal(result.hits.length, 0, 'the starting straight remains clear');
    assert.ok(Math.abs(result.x - 5100) < 1e-8);
    for (const segment of createRaceRoute().segments) {
        for (let distance = 0; distance < segment.length; distance += 8) {
            const x = segment.start.x + segment.dx * distance / segment.length;
            const y = segment.start.y + segment.dy * distance / segment.length;
            assert.ok([...index.query(x, y, 24)].every(s => !contactAt(s, x, y, 24)),
                `the route remains open at ${x}, ${y}`);
        }
    }
});

test('glancing against a straight curb preserves tangential motion and separates the car', () => {
    const wall = { type: 'rect', x: 0, y: -1000, width: 10, height: 2000 };
    const result = resolveTravel(new CollisionIndex([wall]), { x: -26, y: 0 }, { x: -20, y: 20 }, { x: 100, y: 250 }, 24);
    assert.ok(result.x < -24);
    assert.equal(result.vy, 250);
    assert.ok(result.vx < 0 && Math.abs(result.vx) < 20);
    assert.equal(contactAt(wall, result.x, result.y, 24), null);
});

test('swept contacts stop a boosted car from tunneling through a thin wall', () => {
    const wall = { type: 'rect', x: 0, y: -200, width: 4, height: 400 };
    const result = resolveTravel(new CollisionIndex([wall]), { x: -100, y: 0 }, { x: 100, y: 0 }, { x: 820, y: 0 }, 24);
    assert.ok(result.x <= -24);
    assert.ok(result.vx < 0 && Math.abs(result.vx) <= 70);
});

test('adjacent curb points form a smooth surface instead of grabbing the car at each joint', () => {
    const shapes = wallShapes(Array.from({ length: 20 }, (_, i) => ({ x: i * 22, y: 0, width: 0, height: 0 })));
    const index = new CollisionIndex(shapes);
    let pose = { x: 30, y: -39 };
    for (let i = 0; i < 80; i++) {
        const result = resolveTravel(index, pose, { x: pose.x + 4, y: pose.y + 2 }, { x: 240, y: 120 }, 24);
        assert.ok(result.vx > 230, 'sliding speed survives each seam');
        assert.ok(result.y <= -38);
        pose = result;
    }
    assert.ok(pose.x > 340);
});

test('front barrel impact redirects the car gently while glancing hits retain their path', () => {
    const barrel = { type: 'circle', x: 0, y: 0, radius: 20, obstacle: {} };
    const index = new CollisionIndex([barrel]);
    for (const steering of [-1, 1]) {
        const result = resolveTravel(index, { x: -60, y: 0 }, { x: -30, y: 0 }, { x: 300, y: 0 }, 24, steering);
        assert.ok(result.x < -44);
        assert.ok(Math.abs(result.vy) > 100);
        assert.equal(Math.sign(result.vy), Math.sign(steering));
        assert.ok(Math.hypot(result.vx, result.vy) < 300);
    }
    const result = resolveTravel(index, { x: -43, y: -15 }, { x: -40, y: -20 }, { x: 30, y: -250 }, 24);
    assert.ok(result.vy < -200);
});

test('backing away from contact is unrestricted and resting overlaps do not repeatedly cause impacts', () => {
    const wall = { type: 'rect', x: 0, y: -100, width: 10, height: 200 };
    const index = new CollisionIndex([wall]);
    const reverse = resolveTravel(index, { x: -24.3, y: 0 }, { x: -40, y: 0 }, { x: -100, y: 0 }, 24);
    assert.equal(reverse.vx, -100);
    assert.equal(reverse.hits.length, 0);
    const resting = resolveTravel(index, { x: -20, y: 0 }, { x: -20, y: 0 }, { x: 0, y: 0 }, 24);
    assert.ok(resting.x < -24);
    assert.equal(resting.hits.length, 0);
});

test('physics-step integration updates body position once and removes its listener on scene exit', () => {
    const world = new EventEmitter(), events = new EventEmitter();
    const body = { position: { x: -30, y: -24 }, center: { x: -6, y: 0 }, radius: 24,
        velocity: { x: 250, y: 0, set(x, y) { this.x = x; this.y = y; } },
        updateCenter() { this.center = { x: this.position.x + 24, y: this.position.y + 24 }; } };
    const hits = [];
    const scene = { car: { body, handling: { steering: 0 }, controlsEnabled: true },
        physics: { world }, events, time: { now: 100 }, obstacles: { getChildren: () => [] },
        onCrash: speed => hits.push(speed) };
    new TrackCollisions(scene, [{ type: 'rect', x: 0, y: -100, width: 10, height: 200 }]);
    world.emit('worldstep');
    assert.ok(body.center.x < -24);
    assert.equal(hits.length, 1);
    assert.ok(scene.car.contact.x < 0);
    events.emit('shutdown');
    assert.equal(world.listenerCount('worldstep'), 0);
});
