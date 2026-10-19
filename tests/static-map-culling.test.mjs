import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cacheStaticLayer } from '../js/objects/StaticMapCulling.js';

globalThis.Phaser = { Tilemaps: { Components: { CullBounds: (_, camera) => camera.bounds } } };

function setup() {
    const tile = { x: 20, y: 10, index: 1, visible: true, alpha: 1 };
    const output = [];
    let scans = 0;
    const layer = { layer: { data: [[tile]], orientation: 0 }, skipCull: false,
        scrollFactorX: 1, scrollFactorY: 1,
        cullCallback(data, camera, tiles) {
            scans++;
            tiles.length = 0;
            if (tile.visible && tile.alpha > 0 && tile.x >= camera.bounds.left && tile.x < camera.bounds.right
                && tile.y >= camera.bounds.top && tile.y < camera.bounds.bottom) tiles.push(tile);
            return tiles;
        } };
    const invalidate = cacheStaticLayer(layer);
    const camera = { bounds: { left: 18, top: 8, right: 24, bottom: 14 } };
    return { layer, tile, output, camera, invalidate, scans: () => scans,
        cull: (order = 0) => layer.cullCallback(layer.layer, camera, output, order) };
}

test('static tile selections reuse their array between camera tile boundaries', () => {
    const { cull, tile, output, scans, layer } = setup();
    assert.equal(cull(), output);
    assert.deepEqual(output, [tile]);
    for (let frame = 0; frame < 120; frame++) assert.equal(cull(), output);
    assert.equal(scans(), 1);
    assert.equal(layer.tilesDrawn, 1);
});

test('moving to another tile range, zooming or changing draw order refreshes the selection', () => {
    const { cull, camera, output, scans } = setup();
    cull();
    camera.bounds.left++;
    cull();
    camera.bounds.right++;
    cull();
    cull(1);
    assert.equal(scans(), 4);
    camera.bounds = { left: 30, top: 30, right: 40, bottom: 40 };
    cull();
    assert.deepEqual(output, []);
    assert.equal(scans(), 4, 'Distant artwork should not scan empty tiles');
    camera.bounds = { left: 19, top: 9, right: 23, bottom: 13 };
    cull();
    assert.equal(output.length, 1, 'Returning to a layer restores its tiles');
});

test('tile edits can invalidate the selection and nonstandard layers retain native culling', () => {
    const { cull, tile, output, invalidate, scans, layer } = setup();
    cull();
    tile.alpha = 0;
    invalidate();
    cull();
    assert.deepEqual(output, []);
    assert.equal(scans(), 2);
    for (const [field, value] of [['skipCull', true], ['scrollFactorX', 0.5], ['scrollFactorY', 0.5]]) {
        layer[field] = value;
        const before = scans();
        cull(); cull();
        assert.equal(scans(), before + 2);
        layer[field] = field === 'skipCull' ? false : 1;
    }
});
