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
    assert.ok(result.vx < -100 && Math.abs(result.vx) <= 180);
});

test('frontal impacts rebound into the track with a bounded impulse on every side and in corners', () => {
    for (const [nx, ny] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const wall = nx ? { type: 'rect', x: nx < 0 ? 0 : -10, y: -200, width: 10, height: 400 }
            : { type: 'rect', x: -200, y: ny < 0 ? 0 : -10, width: 400, height: 10 };
        for (const speed of [200, 390, 1400]) {
            const result = resolveTravel(new CollisionIndex([wall]),
                { x: nx * 40, y: ny * 40 }, { x: nx * 20, y: ny * 20 },
                { x: -nx * speed, y: -ny * speed }, 24);
            const away = result.vx * nx + result.vy * ny;
            assert.ok(away >= speed * 0.3 || away === 180, 'the impact produces a noticeable rebound');
            assert.ok(away <= 180, 'turbo impacts cannot launch the car across the track');
            assert.equal(result.normal.rebound, true);
            assert.equal(contactAt(wall, result.x, result.y, 24), null);
        }
    }
    const walls = [
        { type: 'rect', x: 0, y: -200, width: 10, height: 400 },
        { type: 'rect', x: -200, y: 0, width: 400, height: 10 },
    ];
    const result = resolveTravel(new CollisionIndex(walls), { x: -40, y: -40 },
        { x: -20, y: -20 }, { x: 275, y: 275 }, 24);
    assert.ok(result.vx < -50 && result.vy < -50);
    assert.ok(walls.every(wall => !contactAt(wall, result.x, result.y, 24)));
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

test('front barrel impact rebounds backwards with a smaller steering deflection while glancing hits retain their path', () => {
    const barrel = { type: 'circle', x: 0, y: 0, radius: 20, obstacle: {} };
    const index = new CollisionIndex([barrel]);
    for (const steering of [-1, 1]) {
        const result = resolveTravel(index, { x: -60, y: 0 }, { x: -30, y: 0 }, { x: 300, y: 0 }, 24, steering);
        assert.ok(result.x < -44);
        assert.ok(result.vx < -130, 'a frontal impact visibly backs away from the barrel');
        assert.ok(Math.abs(result.vy) >= 50 && Math.abs(result.vy) < Math.abs(result.vx));
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

test('curb sections connect by proximity even when their Tiled objects are out of order', () => {
    const shapes = wallShapes([{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 30, y: 0 }]);
    assert.ok(shapes.some(s => s.type === 'segment' && s.ax === 0 && s.bx === 30));
    assert.ok(!shapes.some(s => s.type === 'segment' && Math.max(s.ax, s.bx) === 1000));
});

test('the rotated front and rear bodywork hit walls before the center circle', () => {
    const index = new CollisionIndex([{ type: 'rect', x: 0, y: -200, width: 4, height: 400 }]);
    for (const rotation of [Math.PI / 2, -Math.PI / 2]) {
        const result = resolveTravel(index, { x: -70, y: 0 }, { x: -40, y: 0 },
            { x: 390, y: 0 }, 24, 0, null, rotation);
        assert.ok(result.x <= -48);
        assert.ok(result.vx < 0);
    }
    const side = resolveTravel(index, { x: -70, y: 0 }, { x: -40, y: 0 },
        { x: 390, y: 0 }, 24, 0, null, 0);
    assert.equal(side.hits.length, 0, 'a sideways car uses its width rather than its length');
});

const finishLine = { type: 'finish-line', x: 5152, yMin: 3308, yMax: 3668 };

function liveCollisions({ walls = [], obstacles = [], finish = {} } = {}) {
    const world = new EventEmitter(), events = new EventEmitter();
    const body = { position: { x: -84, y: -24 }, center: { x: -60, y: 0 }, radius: 24,
        velocity: { x: 250, y: 0, set(x, y) { this.x = x; this.y = y; } },
        updateCenter() { this.center = { x: this.position.x + 24, y: this.position.y + 24 }; } };
    const hits = [], obstacleHits = [];
    const scene = { ...finish, car: { body, handling: { steering: 0 }, controlsEnabled: true },
        physics: { world }, events, time: { now: 100 }, obstacles: { getChildren: () => obstacles },
        onCrash: speed => hits.push(speed), onObstacleHit: obstacle => obstacleHits.push(obstacle) };
    const collisions = new TrackCollisions(scene, walls);
    const move = (x, time, vx = 250) => {
        scene.time.now = time;
        body.position.x = x - body.radius;
        body.updateCenter();
        body.velocity.set(vx, 0);
        world.emit('worldstep');
    };
    return { collisions, scene, body, hits, obstacleHits, move };
}

test('repeated wall impacts always keep the car inside the track', () => {
    const wall = { type: 'rect', x: 0, y: -100, width: 10, height: 200 };
    const { collisions, body, move } = liveCollisions({ walls: [wall] });
    for (const time of [100, 116, 400, 799, 800, 1600]) {
        move(80, time, 1400);
        assert.ok(body.center.x < -24, 'walls must remain solid on every physics step');
    }
});

test('the same barrel stays solid on every repeated impact, including immediate turbo hits', () => {
    const barrel = { body: { center: { x: 0, y: 0 }, radius: 20 } };
    for (const speed of [10, 250, 1400]) {
        const { scene, body, hits, obstacleHits, move } = liveCollisions({ obstacles: [barrel] });
        for (const time of [100, 116, 400, 799, 800, 1600]) {
            move(100, time, speed);
            assert.ok(body.center.x < -44, 'the car must never cross the barrel, even during recovery');
            assert.ok(body.velocity.x < 0, 'every frontal impact pushes the car backwards');
            assert.equal(scene.car.contact.barrel, true);
            assert.equal(scene.car.contact.rebound, true);
        }
        assert.equal(hits.length, 6, 'each new impact is resolved');
        assert.equal(obstacleHits.length, 6);
    }
});

test('backing away from a barrel and hitting it again requires no collision cooldown', () => {
    const barrel = { body: { center: { x: 0, y: 0 }, radius: 20 } };
    const { body, hits, move } = liveCollisions({ obstacles: [barrel] });
    move(-20, 100);
    assert.ok(body.center.x < -44);
    move(-90, 116, -100);
    assert.ok(Math.abs(body.center.x + 90) < 1e-8, 'reverse can leave the obstacle freely');
    assert.equal(body.velocity.x, -100);
    assert.equal(hits.length, 1);
    move(-20, 132);
    assert.ok(body.center.x < -44);
    assert.ok(body.velocity.x < 0);
    assert.equal(hits.length, 2, 'the same barrel blocks a second approach immediately');
});

test('a stationary contact separates the body without repeated impact feedback', () => {
    const barrel = { body: { center: { x: 0, y: 0 }, radius: 20 } };
    const { body, hits, move } = liveCollisions({ obstacles: [barrel] });
    move(-20, 100);
    const separated = body.center.x;
    for (const time of [116, 132, 400]) move(separated, time, 0);
    assert.equal(hits.length, 1);
    assert.equal(body.center.x, separated);
});

test('barrels beside a wall remain solid without pushing the car through either surface', () => {
    const barrel = { body: { center: { x: 0, y: 0 }, radius: 20 } };
    const wall = { type: 'rect', x: -120, y: -100, width: 4, height: 200 };
    const { body, move } = liveCollisions({ walls: [wall], obstacles: [barrel] });
    move(200, 100, 1400);
    assert.ok(body.center.x < -44);
    move(-200, 116, -1400);
    assert.ok(body.center.x > -92, 'the wall behind the car also remains solid');
    move(200, 132, 1400);
    assert.ok(body.center.x < -44, 'returning from the wall still hits the barrel');
});

test('the finish line blocks wrong-way travel from the grid and at boosted speed', () => {
    const index = new CollisionIndex([finishLine]);
    for (const startX of [finishLine.x, finishLine.x - 1.5, finishLine.x - 120]) {
        for (const speed of [50, 1400]) {
            const result = resolveTravel(index, { x: startX, y: 3488 },
                { x: finishLine.x + 200, y: 3488 }, { x: speed, y: 0 }, 24);
            assert.ok(result.x <= finishLine.x, 'The car cannot return behind the finish line');
            assert.equal(result.vx, 0);
            assert.equal(result.vy, 0);
            assert.equal(result.hits.length, 1);
        }
    }
});

test('the finish line allows normal starts, completed laps and movement on the returning straight', () => {
    const index = new CollisionIndex([finishLine]);
    for (const [startX, endX, vx] of [
        [finishLine.x, finishLine.x - 100, -390],
        [finishLine.x + 120, finishLine.x - 120, -820],
        [finishLine.x + 120, finishLine.x + 150, 100],
    ]) {
        const result = resolveTravel(index, { x: startX, y: 3488 },
            { x: endX, y: 3488 }, { x: vx, y: 0 }, 24);
        assert.ok(Math.abs(result.x - endX) < 1e-8);
        assert.equal(result.vx, vx);
        assert.equal(result.hits.length, 0);
    }
    // Once a lap crosses in the allowed direction, returning over the
    // same line is blocked immediately, without waiting for Scene.update.
    const lap = resolveTravel(index, { x: finishLine.x + 10, y: 3488 },
        { x: finishLine.x - 10, y: 3488 }, { x: -390, y: 0 }, 24);
    const reverse = resolveTravel(index, lap, { x: finishLine.x + 30, y: 3488 },
        { x: 100, y: 0 }, 24);
    assert.ok(reverse.x <= finishLine.x);
    assert.equal(reverse.vx, 0);
});

test('diagonal attempts stop at the finish line, retain lateral motion and leave other track sections open', () => {
    const index = new CollisionIndex([finishLine]);
    const result = resolveTravel(index, { x: finishLine.x - 40, y: 3404 },
        { x: finishLine.x + 40, y: 3444 }, { x: 240, y: 120 }, 24);
    assert.ok(result.x <= finishLine.x);
    assert.ok(Math.abs(result.y - 3444) < 1e-8);
    assert.equal(result.vx, 0);
    assert.equal(result.vy, 120);
    for (const y of [3404, 3572, finishLine.yMin - 20, finishLine.yMax + 20]) {
        const blocked = resolveTravel(index, { x: finishLine.x - 40, y },
            { x: finishLine.x + 40, y }, { x: 100, y: 0 }, 24);
        assert.ok(blocked.x <= finishLine.x, 'Both lanes and the edges of the car are covered');
    }
    for (const y of [finishLine.yMin - 100, finishLine.yMax + 100]) {
        const clear = resolveTravel(index, { x: finishLine.x - 40, y },
            { x: finishLine.x + 40, y }, { x: 100, y: 0 }, 24);
        assert.ok(Math.abs(clear.x - finishLine.x - 40) < 1e-8);
        assert.equal(clear.vx, 100);
    }
});

test('the live collision system enforces the finish barrier on every physics step', () => {
    const world = new EventEmitter(), events = new EventEmitter();
    const body = { position: { x: finishLine.x - 24, y: 3488 - 24 },
        center: { x: finishLine.x, y: 3488 }, radius: 24,
        velocity: { x: 0, y: 0, set(x, y) { this.x = x; this.y = y; } },
        updateCenter() { this.center = { x: this.position.x + 24, y: this.position.y + 24 }; } };
    const scene = { finishLineX: finishLine.x, finishLineYMin: finishLine.yMin,
        finishLineYMax: finishLine.yMax, car: { body, handling: { steering: 0 }, controlsEnabled: false },
        physics: { world }, events, time: { now: 100 }, obstacles: { getChildren: () => [] }, onCrash() {} };
    const collisions = new TrackCollisions(scene, []);
    world.emit('worldstep');
    assert.equal(body.center.x, finishLine.x, 'The grid stays still before GO');
    scene.car.controlsEnabled = true;
    for (let step = 0; step < 60; step++) {
        body.position.x += 12;
        body.updateCenter();
        body.velocity.set(720, 0);
        world.emit('worldstep');
        assert.ok(body.center.x <= finishLine.x, 'Holding reverse cannot push through the barrier');
        assert.equal(body.velocity.x, 0);
    }
    body.position.x -= 30;
    body.updateCenter();
    body.velocity.set(-180, 0);
    world.emit('worldstep');
    assert.ok(body.center.x < finishLine.x - 30, 'Driving forward releases the car immediately');
    assert.equal(body.velocity.x, -180);
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
    scene.physics.world = null;
    events.emit('shutdown');
    assert.equal(world.listenerCount('worldstep'), 0);
});
