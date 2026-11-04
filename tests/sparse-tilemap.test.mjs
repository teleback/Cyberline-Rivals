import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { createBrickLayout } from '../js/objects/BrickLayout.js';
import { applySceneryLayout } from '../js/objects/SceneryLayout.js';
import { cacheStaticLayer } from '../js/objects/StaticMapCulling.js';
import { collectNightSources } from '../js/fx/NightLighting.js';

// Exercise the parser shipped to players without starting the Phaser browser
// runtime. Only the Tile mixin barrel is narrowed: its three used exports are
// loaded unchanged, while unrelated render mixins need browser device probes.
const source = readFileSync(new URL('../js/phaser.min.js', import.meta.url), 'utf8');
const tableStart = source.indexOf('var t={') + 'var t='.length;
const tableEnd = source.lastIndexOf('},e={};function i(') + 1;
assert.ok(tableStart >= 'var t='.length && tableEnd > tableStart,
    'Update the test loader if the bundled Phaser module wrapper changes');
const factories = runInNewContext(`(${source.slice(tableStart, tableEnd)})`,
    { console: { warn() {} } }, { filename: 'phaser-parser-modules.js' });
const modules = new Map();
function bundledRequire(id) {
    if (modules.has(id)) return modules.get(id).exports;
    if (id === 31401) return {
        AlphaSingle: bundledRequire(88509), Flip: bundledRequire(54434), Visible: bundledRequire(59715),
    };
    assert.equal(typeof factories[id], 'function', `Missing Phaser module ${id}`);
    const module = { exports: {} };
    modules.set(id, module);
    factories[id](module, module.exports, bundledRequire);
    return module.exports;
}
const parse = bundledRequire(46594);
const getTileAt = bundledRequire(7423);
const runCull = bundledRequire(32483);
const raw = JSON.parse(readFileSync(new URL('../assets/images/tilemaps/pista.json', import.meta.url)));
const definitions = JSON.parse(readFileSync(new URL('../assets/images/lighting/sources.json', import.meta.url)));
const sparse = parse('pista', raw, true);

function isolateLayer(entries, id) {
    return entries.flatMap(entry => {
        if (!entry.layers) return entry.id === id ? [entry] : [];
        const layers = isolateLayer(entry.layers, id);
        return layers.length ? [{ ...entry, layers }] : [];
    });
}

// Parse the default representation one layer at a time, then replace native
// empty Tiles with a shared sentinel. Keep every actual occupied Tile intact.
// This compares the real parser branches without retaining 870,350 empty
// objects in the regression suite just to reproduce the old memory usage.
const empty = { index: -1 };
let defaultEmptyCount = 0;
const nativeLayers = Array.from(sparse.layers, layer => {
    const parsed = parse('pista', { ...raw, layers: isolateLayer(raw.layers, layer.id) });
    assert.equal(parsed.layers.length, 1);
    const native = parsed.layers[0];
    for (const row of native.data) for (let x = 0; x < row.length; x++) {
        if (row[x].index !== -1) continue;
        defaultEmptyCount++;
        row[x] = empty;
    }
    return native;
});

const layerFields = ['id', 'name', 'x', 'y', 'width', 'height', 'tileWidth', 'tileHeight',
    'alpha', 'visible', 'properties'];
const tileFields = ['index', 'x', 'y', 'pixelX', 'pixelY', 'width', 'height',
    'baseWidth', 'baseHeight', 'rotation', 'flipX', 'flipY', 'alpha', 'visible', 'properties'];
const fields = (object, names) => Object.fromEntries(names.map(name => [name, object[name]]));
const occupied = layer => Array.from(layer.data).flatMap(row =>
    Array.from(row).filter(tile => tile && tile.index >= 0).map(tile => fields(tile, tileFields)));

function displayLayer(data) {
    const layer = {
        layer: data, x: data.x, y: data.y, alpha: data.alpha, visible: data.visible,
        scaleX: 1, scaleY: 1, skipCull: false, scrollFactorX: 1, scrollFactorY: 1,
        setPosition(x, y) { this.x = x; this.y = y; return this; },
        setScale(x, y) { this.scaleX = x; this.scaleY = y; return this; },
        cullCallback(data, camera, output, order) {
            output.length = 0;
            return runCull(data, camera.bounds, order, output);
        },
    };
    data.tilemapLayer = layer;
    return applySceneryLayout(layer);
}

test('sparse parsing removes 870,350 empty Tiles and preserves all real map artwork and transforms', () => {
    assert.equal(sparse.layers.length, 84);
    assert.equal(defaultEmptyCount, 870350);
    let emptyCount = 0, occupiedCount = 0;
    sparse.layers.forEach((layer, index) => {
        assert.deepEqual(fields(layer, layerFields), fields(nativeLayers[index], layerFields));
        assert.deepEqual(occupied(layer), occupied(nativeLayers[index]));
        for (const row of layer.data) for (const tile of row) {
            if (tile === null) emptyCount++;
            else occupiedCount++;
        }
    });
    assert.equal(emptyCount, defaultEmptyCount);
    assert.equal(occupiedCount, 11164);
    const road = sparse.layers.find(layer => layer.name === 'Pista');
    assert.equal(getTileAt(0, 0, false, road), null);
    assert.equal(getTileAt(80, 54, false, road)?.index,
        getTileAt(80, 54, false, nativeLayers.find(layer => layer.name === 'Pista'))?.index);
});

test('sparse map preserves collectible layout, fitted scenery and every night light source', () => {
    const mapWith = layers => ({ ...sparse, layers,
        getObjectLayer: name => sparse.objects.find(layer => layer.name === name) });
    const sparseBricks = createBrickLayout(mapWith(sparse.layers));
    assert.ok(sparseBricks.length > 40);
    assert.deepEqual(sparseBricks, createBrickLayout(mapWith(nativeLayers)));

    const sparseDisplays = Array.from(sparse.layers, displayLayer);
    const nativeDisplays = nativeLayers.map(displayLayer);
    assert.deepEqual(sparseDisplays.map(layer => [layer.x, layer.y, layer.scaleX, layer.scaleY]),
        nativeDisplays.map(layer => [layer.x, layer.y, layer.scaleX, layer.scaleY]));
    const lights = collectNightSources(sparse, sparseDisplays, definitions);
    assert.ok(lights.patches.length > 300);
    assert.ok(lights.lights.length > 50);
    assert.deepEqual(lights, collectNightSources(sparse, nativeDisplays, definitions));
});

test('cached culling of sparse real map tiles preserves native selection in every render order', () => {
    const previousPhaser = globalThis.Phaser;
    globalThis.Phaser = { Tilemaps: { Components: { CullBounds: (_, camera) => camera.bounds } } };
    try {
        sparse.layers.forEach((data, index) => {
            const sparseLayer = displayLayer(data), nativeLayer = displayLayer(nativeLayers[index]);
            cacheStaticLayer(sparseLayer);
            const output = [];
            for (const bounds of [
                { left: 0, top: 0, right: 125, bottom: 86 },
                { left: 72, top: 47, right: 90, bottom: 60 },
                { left: 0, top: 0, right: 8, bottom: 8 },
            ]) for (let order = 0; order < 4; order++) {
                const expected = nativeLayer.cullCallback(nativeLayer.layer, { bounds }, [], order);
                const actual = sparseLayer.cullCallback(data, { bounds }, output, order);
                const signature = tiles => Array.from(tiles, tile => [tile.index, tile.x, tile.y]);
                assert.deepEqual(signature(actual), signature(expected), `${data.name}, order ${order}`);
                assert.equal(sparseLayer.cullCallback(data, { bounds }, output, order), output,
                    'repeated frames can reuse the same sparse selection');
            }
        });
    } finally {
        globalThis.Phaser = previousPhaser;
    }
});
