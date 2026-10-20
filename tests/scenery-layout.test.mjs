import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { applySceneryLayout } from '../js/objects/SceneryLayout.js';

test('fitting scenery preserves its top-left anchor and native Tiled offsets', () => {
    const layer = { x: 60, y: 8,
        layer: { properties: [{ name: 'sceneryScaleX', value: 0.8 }], data: [[
            { index: -1 }, { index: 71, pixelX: 4672, pixelY: 2816 },
            { index: 72, pixelX: 4736, pixelY: 2816 },
        ]] },
        setPosition(x, y) { this.x = x; this.y = y; return this; },
        setScale(x, y) { this.scaleX = x; this.scaleY = y; return this; } };
    applySceneryLayout(layer);
    assert.equal(layer.x + 4672 * layer.scaleX, 4672 + 60);
    assert.equal(layer.y + 2816 * layer.scaleY, 2816 + 8);
    assert.ok(Math.abs((layer.x + 4736 * layer.scaleX) - (4672 + 60 + 64 * 0.8)) < 1e-8);
});

test('layers without fitting properties keep their transform and empty layers are harmless', () => {
    const unchanged = { layer: { data: [] }, setScale() { assert.fail('Unchanged layer'); } };
    assert.equal(applySceneryLayout(unchanged), unchanged);
    const empty = { layer: { properties: { sceneryScaleX: 0.8 }, data: [] },
        setPosition() { assert.fail('Empty layer'); } };
    assert.equal(applySceneryLayout(empty), empty);
});

test('the scenery review preserves the road, finish, boosts, collision objects and race dimensions', () => {
    const map = JSON.parse(readFileSync(new URL('../assets/images/tilemaps/pista.json', import.meta.url)));
    assert.equal(map.width, 125); assert.equal(map.height, 86);
    assert.equal(map.tilewidth, 64); assert.equal(map.tileheight, 64);
    const track = map.layers.find(layer => layer.name === 'Pista');
    assert.equal(track.data.filter(Boolean).length, 1860);
    assert.equal(map.layers.find(layer => layer.name === 'chegada').data.filter(Boolean).length, 5);
    assert.equal(map.layers.find(layer => layer.name === 'colisoes pista').objects.length, 642);
    assert.equal(map.layers.find(layer => layer.name === 'Cyber placa').data.filter(Boolean).length, 21);
    const ids = new Set();
    const visit = layers => layers.forEach(layer => {
        assert.ok(!ids.has(layer.id)); ids.add(layer.id);
        if (layer.layers) visit(layer.layers);
        if (layer.data) assert.equal(layer.data.length, layer.width * layer.height);
    });
    visit(map.layers);
});
