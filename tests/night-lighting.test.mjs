import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import NightLighting, { collectNightSources } from '../js/fx/NightLighting.js';
import StaticNightLights, { indexLightChunks } from '../js/fx/StaticNightLights.js';
import { carLightPose } from '../js/fx/CarLighting.js';

const raw = JSON.parse(readFileSync(new URL('../assets/images/tilemaps/pista.json', import.meta.url)));
const definitions = JSON.parse(readFileSync(new URL('../assets/images/lighting/sources.json', import.meta.url)));
const map = { tilesets: raw.tilesets.map(set => ({ ...set, total: set.tilecount })) };
function layersFromTiled(entries, prefix = '') {
    return entries.flatMap(layer => {
        if (layer.type === 'group') return layersFromTiled(layer.layers, `${prefix}${layer.name}/`);
        if (layer.type !== 'tilelayer') return [];
        const data = Array.from({ length: layer.height }, (_, y) =>
            Array.from({ length: layer.width }, (_, x) => {
                const gid = layer.data[y * layer.width + x] >>> 0;
                return { index: (gid & 0x0fffffff) || -1, x, y, pixelX: x * 64, pixelY: y * 64,
                    width: 64, height: 64, rotation: 0,
                    flipX: Boolean(gid & 0x80000000), flipY: Boolean(gid & 0x40000000) };
            }));
        return [{ name: prefix + layer.name, x: 0, y: 0, visible: layer.visible,
            alpha: layer.opacity, layer: { data } }];
    });
}
const layers = layersFromTiled(raw.layers);

test('real map lights signs in generic layers, with one halo per connected source', () => {
    const { patches, lights } = collectNightSources(map, layers, definitions);
    assert.ok(patches.length > 300);
    assert.ok(lights.length > 50 && lights.length < patches.length / 2);
    assert.equal(lights.filter(light => light.id.includes('lamp-')).length, 26);
    const generic = layers.filter(layer => layer.name.includes('Camada de Blocos'));
    assert.ok(collectNightSources(map, generic, definitions).lights.length > 0);
    for (const name of ['Chão', 'calçada', 'Pista', 'caminhao', 'carros abandonados', 'containers 3']) {
        const result = collectNightSources(map, layers.filter(layer => layer.name === name), definitions);
        assert.equal(result.lights.length, 0, `Ordinary surfaces stay unlit: ${name}`);
    }
    for (const patch of patches) {
        assert.ok(Number.isFinite(patch.x) && Number.isFinite(patch.y));
        assert.ok(patch.frame >= 0 && patch.frame < 302);
    }
});

test('sampled halo hues match the colored displays and cafe sign', () => {
    const green = definitions.regions['objetos/billboard-green'].color;
    const blue = definitions.regions['objetos/billboard-blue'].color;
    const pink = definitions.regions['objetos/billboard-pink'].color;
    const yellow = definitions.regions['placas/cafe-yellow'].color;
    assert.ok(green[1] > green[0] && green[1] > green[2]);
    assert.ok(blue[2] > blue[0]);
    assert.ok(pink[0] > pink[1] && pink[2] > pink[1]);
    assert.ok(yellow[0] > yellow[2] && yellow[1] > yellow[2]);
});

test('source positions follow flipped artwork and hidden layers emit no light', () => {
    const set = { name: 'test', firstgid: 10, total: 1 };
    const config = { tilesets: { test: { 0: { frame: 0,
        regions: [{ id: 'lens', count: 4, x: 48, y: 16 }] } } },
        regions: { lens: { color: [100, 200, 255], radius: 100 } } };
    const tile = { index: 10, x: 0, y: 0, pixelX: 0, pixelY: 0,
        width: 64, height: 64, flipX: true, flipY: false, rotation: Math.PI / 2 };
    const layer = { x: 100, y: 200, alpha: 1, visible: true, layer: { data: [[tile]] } };
    const result = collectNightSources({ tilesets: [set] }, [layer], config);
    assert.equal(result.lights.length, 1);
    assert.equal(result.lights[0].x, 148);
    assert.equal(result.lights[0].y, 216);
    layer.visible = false;
    assert.deepEqual(collectNightSources({ tilesets: [set] }, [layer], config), { patches: [], lights: [] });
});

test('night wash covers the viewport during turbo zoom and updates both cars', () => {
    const camera = { width: 800, height: 450, zoom: 0.565,
        worldView: { x: 1000, y: 2000, right: 2400, bottom: 2800 } };
    const wash = { setPosition(x, y) { this.x = x; this.y = y; return this; },
        setDisplaySize(width, height) { this.width = width; this.height = height; return this; } };
    let view, localUpdates = 0, remoteUpdates = 0;
    NightLighting.prototype.update.call({ scene: { cameras: { main: camera } }, wash,
        staticLights: { update(value) { view = value; } },
        carLights: new Map([['local', { update() { localUpdates++; } }], ['remote', { update() { remoteUpdates++; } }]]) });
    assert.ok(wash.width * camera.zoom >= camera.width);
    assert.ok(wash.height * camera.zoom >= camera.height);
    assert.equal(view, camera.worldView);
    assert.equal(localUpdates, 1);
    assert.equal(remoteUpdates, 1);
});

test('a light crossing block boundaries is indexed on both sides without losing its halo', () => {
    const light = { x: 510, y: 510, radius: 100, color: [100, 200, 255] };
    const patch = { x: 510, y: 510, frame: 0 };
    const chunks = indexLightChunks({ lights: [light], patches: [patch] });
    for (const key of ['0,0', '1,0', '0,1', '1,1']) {
        assert.deepEqual(chunks.get(key).lights, [light]);
        assert.deepEqual(chunks.get(key).patches, [patch]);
    }
    assert.equal(chunks.size, 4);
});

test('real map light cache reuses blocks and releases distant textures across a full lap', () => {
    const chunks = indexLightChunks(collectNightSources(map, layers, definitions));
    const textures = new Set();
    let baked = 0, released = 0;
    const lighting = Object.create(StaticNightLights.prototype);
    Object.assign(lighting, { chunks, cache: new Map(), scene: { textures: { remove(key) {
        assert.ok(textures.delete(key)); released++;
    } } }, bake(key) {
        assert.ok(!textures.has(key)); textures.add(key); baked++;
        return { textureKey: key, image: { setVisible(visible) { this.visible = visible; }, destroy() {} } };
    } });
    const firstView = { x: 0, y: 500, right: 1400, bottom: 1300 };
    lighting.update(firstView);
    const initialBaked = baked;
    lighting.update(firstView);
    assert.equal(baked, initialBaked, 'Same viewport must not redraw static lights');
    for (const y of [500, 1500, 2500, 3500]) {
        for (const x of [0, 1200, 2400, 3600, 4800, 6000]) {
            const view = { x, y, right: x + 1400, bottom: y + 800 };
            lighting.update(view);
            assert.ok(lighting.cache.size <= 24, 'Light cache must stay bounded');
            for (const entry of lighting.cache.values()) {
                if (entry.image.visible) assert.ok(textures.has(entry.textureKey));
            }
        }
    }
    assert.ok(released > 0, 'Old offscreen textures must be released');
    assert.equal(textures.size, lighting.cache.size);
});

test('headlights stay ahead of the car when turning, scaling and driving in every direction', () => {
    for (const [rotation, dx, dy] of [[0, 0, -48], [-Math.PI / 2, -48, 0],
        [Math.PI / 2, 48, 0], [Math.PI, 0, 48]]) {
        const pose = carLightPose({ x: 100, y: 200, rotation, scaleY: 1 });
        assert.ok(Math.abs(pose.x - (100 + dx)) < 1e-9);
        assert.ok(Math.abs(pose.y - (200 + dy)) < 1e-9);
    }
    assert.equal(carLightPose({ x: 100, y: 200, rotation: 0, scaleY: 0.4 }).y, 180.8);
});
