import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createBrickLayout, BRICK_LAYOUT_SETTINGS } from '../js/objects/BrickLayout.js';
import { createRaceRoute } from '../js/objects/RaceProgress.js';

const map = JSON.parse(readFileSync(new URL('../assets/images/tilemaps/pista.json', import.meta.url)));
const track = map.layers.find(layer => layer.name === 'Pista');
const oilSpots = [[480,928], [2400,928], [1440,1120], [4000,1760], [1952,1888],
    [4896,1888], [480,2144], [2400,2720], [5664,3168], [3616,3488]];
const barrels = [[1248,838], [3424,1018], [4090,1440], [2310,1696], [5242,2528],
    [1030,2656], [570,3104], [3296,3398], [4832,3578]];
const boosts = [[70,54,Math.PI], [46,54,Math.PI], [32,38,Math.PI], [7.5,20,-Math.PI/2],
    [22,24,Math.PI/2], [48,15,0], [65,44,0], [88,49,Math.PI/2]];
// These match the expanded runtime exclusions supplied by the collectible
// controller, including the actual offset and silhouette of each oil sensor.
const hazards = [
    ...oilSpots.map(([x,y], index) => ({ x: x - 1, y: y + (index % 2 ? -1 : 3),
        width: (index % 2 ? 69 : 62) + 100, height: (index % 2 ? 37 : 38) + 100 })),
    ...barrels.map(([x,y]) => ({ x, y, radius: 80 })),
    ...boosts.map(([x,y,direction]) => ({ x: x * 64 + 32, y: y * 64 + 32,
        width: 144, height: 176, rotation: direction + Math.PI / 2 })),
];

function distanceToRectangle(point, shape) {
    const angle = shape.rotation ?? 0;
    const dx = point.x - shape.x, dy = point.y - shape.y;
    const localX = dx * Math.cos(angle) + dy * Math.sin(angle);
    const localY = -dx * Math.sin(angle) + dy * Math.cos(angle);
    const nearestX = Math.max(-shape.width / 2, Math.min(shape.width / 2, localX));
    const nearestY = Math.max(-shape.height / 2, Math.min(shape.height / 2, localY));
    return Math.hypot(localX - nearestX, localY - nearestY);
}

test('72 deterministic pickups form complete short trails covering the whole clockwise lap', () => {
    const layout = createBrickLayout(map, { avoid: hazards });
    assert.equal(layout.length, 72);
    assert.deepEqual(createBrickLayout(map, { avoid: hazards }), layout);
    assert.equal(new Set(layout.map(brick => brick.id)).size, layout.length);
    const route = createRaceRoute();
    const quarters = [0,0,0,0];
    const groups = new Map();
    for (const brick of layout) {
        quarters[Math.min(3, Math.floor(brick.distance / route.total * 4))]++;
        if (!groups.has(brick.trail)) groups.set(brick.trail, []);
        groups.get(brick.trail).push(brick);
    }
    assert.equal(groups.size, BRICK_LAYOUT_SETTINGS.trails);
    assert.ok(quarters.every(count => count >= 12), `Every quarter is rewarded: ${quarters}`);
    for (const bricks of groups.values()) {
        assert.equal(bricks.length, 4);
        for (let index = 1; index < bricks.length; index++) {
            assert.ok(Math.abs(bricks[index].distance - bricks[index - 1].distance - 104) < 1e-8);
            assert.ok(Math.hypot(bricks[index].x - bricks[index - 1].x,
                bricks[index].y - bricks[index - 1].y) < 190, 'A trail can be followed without jumping lanes');
        }
    }
    const distances = layout.map(brick => brick.distance);
    for (let index = 1; index < distances.length; index++) {
        assert.ok(distances[index] > distances[index - 1], 'Pickups follow the course direction');
        assert.ok(distances[index] - distances[index - 1] < 1800, 'No long empty section of track');
    }
    assert.ok(distances[0] >= 320);
    assert.ok(route.total - distances.at(-1) >= 320);
});

test('real-map pickups and their approach stay on asphalt clear of every collision wall and hazard', () => {
    const layout = createBrickLayout(map, { avoid: hazards });
    const walls = ['colisao', 'colisoes pista'].flatMap(name =>
        map.layers.find(layer => layer.name === name).objects);
    for (const brick of layout) {
        for (let dy = -30; dy <= 30; dy += 10) for (let dx = -30; dx <= 30; dx += 10) {
            const tile = track.data[Math.floor((brick.y + dy) / 64) * track.width
                + Math.floor((brick.x + dx) / 64)];
            assert.ok(tile, `${brick.id} has asphalt beneath its entire footprint`);
        }
        for (const wall of walls) {
            const w = wall.width || 0, h = wall.height || 0;
            const distance = w < 2 && h < 2 ? Math.hypot(brick.x - wall.x, brick.y - wall.y) - 14
                : distanceToRectangle(brick, { x: wall.x + w / 2, y: wall.y + h / 2,
                    width: Math.max(4, w), height: Math.max(4, h) });
            assert.ok(distance >= 58, `${brick.id} leaves room to collect without touching wall${wall.id}`);
        }
        for (const hazard of hazards) {
            const distance = hazard.radius === undefined ? distanceToRectangle(brick, hazard)
                : Math.hypot(brick.x - hazard.x, brick.y - hazard.y) - hazard.radius;
            assert.ok(distance >= 24, `${brick.id} clears the expanded oil, barrel and boost bounds`);
        }
        assert.ok(distanceToRectangle(brick, { x: 5152, y: 3488, width: 600, height: 400 }) >= 30,
            'No collectible underneath the starting cars');
    }
});

test('Phaser Tilemap and raw Tiled adapters produce the same multiplayer layout', () => {
    const phaserMap = {
        width: map.width, height: map.height, tileWidth: 64, tileHeight: 64,
        getObjectLayer(name) { return map.layers.find(layer => layer.name === name); },
        getTileAt(x, y, _nonNull, layerName) {
            assert.equal(layerName, 'Pista');
            const index = track.data[y * track.width + x];
            return index ? { index } : null;
        },
    };
    assert.deepEqual(createBrickLayout(phaserMap, { avoid: hazards }), createBrickLayout(map, { avoid: hazards }));
});

test('blocked or missing asphalt never produces an inaccessible collectible', () => {
    const blocked = { x: 4000, y: 2752, radius: 10000 };
    assert.deepEqual(createBrickLayout(map, { avoid: [blocked] }), []);
    assert.deepEqual(createBrickLayout({ ...map, layers: map.layers.filter(layer => layer.name !== 'Pista') }), []);
    const blank = { ...map, layers: map.layers.map(layer => layer.name === 'Pista'
        ? { ...layer, data: layer.data.map(() => 0) } : layer) };
    assert.deepEqual(createBrickLayout(blank), []);
});
