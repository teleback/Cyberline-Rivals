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

test('selected streetlamps have matching neon lenses and halos while other lamps stay cool white', () => {
    const sources = collectNightSources(map, layers, definitions);
    const lamps = sources.lights.filter(light => light.id.startsWith('objetos/lamp-'));
    const neon = lamps.filter(light => light.color.join(',') !== definitions.regions[light.id].color.join(','));
    assert.equal(neon.length, 13);
    assert.equal(lamps.length - neon.length, 13);
    assert.equal(new Set(neon.map(light => light.color.join(','))).size, 3);
    const lensFrames = new Set(Object.values(definitions.tilesets.objetos)
        .filter(source => source.regions.some(region => region.id.startsWith('objetos/lamp-')))
        .map(source => source.frame));
    const tinted = sources.patches.filter(patch => patch.tint);
    assert.ok(tinted.length >= neon.length);
    for (const patch of tinted) {
        assert.ok(lensFrames.has(patch.frame), 'Only reviewed streetlamp lenses are recolored');
        assert.ok(neon.some(light => Math.hypot(light.x - patch.x, light.y - patch.y) < 64
            && light.color.join(',') === patch.tint.join(',')), 'Every neon lens follows its local halo');
    }
    const reverse = collectNightSources(map, [...layers].reverse(), definitions).lights;
    for (const light of lamps) {
        const other = reverse.find(other => other.id === light.id && other.x === light.x && other.y === light.y);
        assert.deepEqual(other?.color, light.color, 'Lamp colors do not depend on layer order');
    }
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

test('sign light sources and emissive patches follow fitted scenery scale and position', () => {
    const map = { tilesets: [{ name: 'test', firstgid: 10 }] };
    const definitions = { tilesets: { test: { 0: { frame: 0,
        regions: [{ id: 'sign', count: 4, x: 48, y: 16 }] } } },
        regions: { sign: { color: [100, 200, 255], radius: 100 } } };
    const layer = { x: 100, y: 200, scaleX: 0.8, scaleY: 0.5, visible: true, alpha: 1,
        layer: { data: [[{ index: 10, x: 0, y: 0, pixelX: 64, pixelY: 128,
            width: 64, height: 64, rotation: 0 }]] } };
    const result = collectNightSources(map, [layer], definitions);
    assert.equal(result.patches[0].x, 100 + 96 * 0.8);
    assert.equal(result.patches[0].y, 200 + 160 * 0.5);
    assert.equal(result.patches[0].scaleX, 0.8);
    assert.equal(result.patches[0].scaleY, 0.5);
    assert.ok(Math.abs(result.lights[0].x - (100 + 112 * 0.8)) < 1e-8);
    assert.equal(result.lights[0].y, 200 + 144 * 0.5);
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

test('prewarmed lights stay drawable when the camera moves or zooms after the scene update', () => {
    const lights = [];
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
        lights.push({ x: x * 512 + 256, y: y * 512 + 256, radius: 10 });
    }
    let baked = 0, visibilityWrites = 0;
    const lighting = Object.create(StaticNightLights.prototype);
    Object.assign(lighting, { chunks: indexLightChunks({ lights, patches: [] }), cache: new Map(),
        bake(key) {
            baked++;
            return { textureKey: key, image: { setVisible(visible) {
                visibilityWrites++; this.visible = visible;
            } } };
        } });
    // Scene.update sees the previous frame's bounds. Rendering advances
    // the camera afterwards, without another lighting update in between.
    lighting.update({ x: 512, y: 512, right: 1024, bottom: 1024 });
    for (const view of [
        { x: 528, y: 512, right: 1040, bottom: 1024 },
        { x: 496, y: 512, right: 1008, bottom: 1024 },
        { x: 512, y: 528, right: 1024, bottom: 1040 },
        { x: 496, y: 496, right: 1008, bottom: 1008 },
        { x: 448, y: 448, right: 1088, bottom: 1088 },
    ]) {
        for (const [key, chunk] of lighting.chunks) {
            if (chunk.x >= view.right || chunk.x + 512 <= view.x
                || chunk.y >= view.bottom || chunk.y + 512 <= view.y) continue;
            assert.equal(lighting.cache.get(key)?.image.visible, true,
                `Light block ${key} must already be drawable when the camera reveals it`);
        }
    }
    lighting.update({ x: 512, y: 512, right: 1024, bottom: 1024 });
    assert.equal(baked, 9, 'Moving within the prewarmed area must reuse its textures');
    for (let frame = 0; frame < 120; frame++) {
        const shift = frame / 10;
        lighting.update({ x: 512 + shift, y: 512, right: 1024 + shift, bottom: 1024 });
    }
    assert.equal(visibilityWrites, 9, 'Movement within cached blocks must not revisit every light each frame');
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
