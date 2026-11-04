import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import TrackDetails, { buildTrackReflectors } from '../js/fx/TrackDetails.js';
import { wallShapes } from '../js/objects/TrackCollisions.js';

test('opposite curbs share evenly spaced fixtures despite different collision starts', () => {
    const horizontal = buildTrackReflectors([
        { type: 'rect', x: 0, y: 100, width: 1000, height: 16 },
        { type: 'rect', x: 12, y: 400, width: 980, height: 16 },
    ]);
    const top = horizontal.filter(mark => mark.y === 108);
    const bottom = horizontal.filter(mark => mark.y === 408);
    assert.ok(top.length >= 7);
    assert.deepEqual(top.map(mark => [mark.x, mark.color]), bottom.map(mark => [mark.x, mark.color]));
    for (let i = 1; i < top.length; i++) assert.equal(top[i].x - top[i - 1].x, 128);
    assert.ok(horizontal.every(mark => mark.angle === 0));

    const vertical = buildTrackReflectors([
        { type: 'rect', x: 100, y: 0, width: 16, height: 1000 },
        { type: 'rect', x: 400, y: 12, width: 16, height: 980 },
    ]);
    assert.deepEqual(vertical.filter(mark => mark.x === 108).map(mark => [mark.y, mark.color]),
        vertical.filter(mark => mark.x === 408).map(mark => [mark.y, mark.color]));
    assert.ok(vertical.every(mark => mark.angle === Math.PI / 2));
});

test('duplicated curve contacts and collision order do not stack or move fixtures', () => {
    const shapes = [{ type: 'rect', x: 0, y: 0, width: 512, height: 16 }];
    for (let i = 0; i < 50; i++) {
        const a = i / 50 * Math.PI / 2, b = (i + 1) / 50 * Math.PI / 2;
        shapes.push({ type: 'segment', ax: 512 + Math.sin(a) * 300, ay: 308 - Math.cos(a) * 300,
            bx: 512 + Math.sin(b) * 300, by: 308 - Math.cos(b) * 300 });
    }
    const marks = buildTrackReflectors(shapes);
    assert.ok(marks.length >= 7, 'The curve must retain lights after removing duplicate contacts');
    assert.deepEqual(buildTrackReflectors([...shapes, ...shapes].reverse()), marks);
    for (let i = 0; i < marks.length; i++) for (let j = i + 1; j < marks.length; j++) {
        assert.ok(Math.hypot(marks[i].x - marks[j].x, marks[i].y - marks[j].y) >= 100,
            'Neighboring fixture bodies and their cores must remain separate');
    }
});

test('the full circuit has no overlapping reflectors, including rect and curve joins', () => {
    const raw = JSON.parse(readFileSync(new URL('../assets/images/tilemaps/pista.json', import.meta.url)));
    const shapes = raw.layers.filter(layer => ['colisao', 'colisoes pista'].includes(layer.name))
        .flatMap(layer => wallShapes(layer.objects));
    const marks = buildTrackReflectors(shapes);
    assert.ok(marks.length > 300, 'Keep lighting throughout the circuit');
    assert.deepEqual(buildTrackReflectors([...shapes].reverse()), marks);
    for (let i = 0; i < marks.length; i++) for (let j = i + 1; j < marks.length; j++) {
        const distance = Math.hypot(marks[i].x - marks[j].x, marks[i].y - marks[j].y);
        assert.ok(distance >= 100, `Overlapping curb lights at ${marks[i].x},${marks[i].y}`);
    }
});

function cachedTrack(shapes, view) {
    globalThis.Phaser = { Textures: { WrapMode: { CLAMP_TO_EDGE: 'clamp' } } };
    const textures = new Map(), children = new Set();
    const metrics = { baked: 0, released: 0, peakPixels: 0, visibilityWrites: 0 };
    const events = new EventEmitter();
    const container = { setDepth(depth) { this.depth = depth; return this; },
        add(image) { children.add(image); }, destroy() { for (const child of children) child.destroy(); } };
    const context = { scale() {}, save() {}, restore() {}, translate() {}, rotate() {}, fillRect() {},
        createRadialGradient: () => ({ addColorStop() {} }) };
    const scene = { events, cameras: { main: { worldView: view } }, textures: {
        exists: key => textures.has(key),
        createCanvas(key, width, height) {
            assert.ok(!textures.has(key), 'Cached blocks must not be uploaded again');
            const texture = { width, height, getContext: () => context, refresh() {},
                setWrap(wrap) { this.wrap = wrap; } };
            textures.set(key, texture);
            metrics.baked++;
            metrics.peakPixels = Math.max(metrics.peakPixels,
                [...textures.values()].reduce((pixels, item) => pixels + item.width * item.height, 0));
            return texture;
        },
        remove(key) {
            assert.ok(textures.delete(key));
            metrics.released++;
        },
    }, add: { container: () => container, image(x, y, key) {
        return { x, y, key, setOrigin() { return this; }, setScale(scale) { this.scale = scale; return this; },
            setVisible(visible) { this.visible = visible; metrics.visibilityWrites++; return this; },
            destroy() { this.destroyed = true; children.delete(this); } };
    } } };
    return { details: new TrackDetails(scene, shapes), scene, textures, children, metrics };
}

test('reflectors bake only near the camera, keep world dimensions and remain visible across block edges', () => {
    // A fixture centered at x=512 paints into both neighboring blocks.
    const shapes = [{ type: 'segment', ax: 500, ay: 510, bx: 524, by: 510 }];
    const fixture = cachedTrack(shapes, { x: 400, y: 400, right: 600, bottom: 600 });
    const { details, textures, metrics } = fixture;
    assert.equal(details.cache.size, 4);
    assert.deepEqual(details.worldObjects, [details.container], 'Future blocks must remain inside the UI-excluded container');
    assert.equal(details.container.depth, 470);
    for (const entry of details.cache.values()) {
        const texture = textures.get(entry.textureKey);
        assert.equal(texture.width * entry.image.scale, 512);
        assert.equal(texture.height * entry.image.scale, 512);
        assert.equal(texture.wrap, 'clamp');
    }
    const baked = metrics.baked, writes = metrics.visibilityWrites;
    for (let frame = 0; frame < 120; frame++) details.update();
    assert.equal(metrics.baked, baked);
    assert.equal(metrics.visibilityWrites, writes, 'Steady movement within cached bounds must not revisit every sprite');
    // Simulate the camera moving/zooming after scene update, before rendering.
    for (const view of [
        { x: 464, y: 400, right: 664, bottom: 600 },
        { x: 336, y: 336, right: 664, bottom: 664 },
    ]) {
        for (const [key, chunk] of details.chunks) {
            if (chunk.cx * 512 >= view.right || (chunk.cx + 1) * 512 <= view.x
                || chunk.cy * 512 >= view.bottom || (chunk.cy + 1) * 512 <= view.y) continue;
            assert.equal(details.cache.get(key)?.image.visible, true, 'Newly revealed edges must already be drawable');
        }
    }
});

test('reflector cache stays bounded through full laps, reuses nearby blocks and releases textures on shutdown', () => {
    const raw = JSON.parse(readFileSync(new URL('../assets/images/tilemaps/pista.json', import.meta.url)));
    const shapes = raw.layers.filter(layer => ['colisao', 'colisoes pista'].includes(layer.name))
        .flatMap(layer => wallShapes(layer.objects));
    const fixture = cachedTrack(shapes, { x: 4400, y: 3000, right: 5800, bottom: 3800 });
    const { details, scene, textures, children, metrics } = fixture;
    assert.ok(details.chunks.size > 100, 'Exercise the complete circuit');
    assert.ok(metrics.baked < 24, 'Entering the race must not bake the entire circuit');
    for (let lap = 0; lap < 2; lap++) {
        for (const y of [500, 1500, 2500, 3500, 4500]) {
            for (const x of [0, 1200, 2400, 3600, 4800, 6000]) {
                scene.cameras.main.worldView = { x, y, right: x + 1500, bottom: y + 850 };
                details.update();
                assert.ok(details.cache.size <= 24);
                assert.equal(textures.size, details.cache.size);
                assert.equal(children.size, details.cache.size);
                const baked = metrics.baked;
                details.update();
                assert.equal(metrics.baked, baked, 'A repeated viewport must reuse existing textures');
                for (const [key, chunk] of details.chunks) {
                    if (chunk.cx * 512 >= x + 1500 || (chunk.cx + 1) * 512 <= x
                        || chunk.cy * 512 >= y + 850 || (chunk.cy + 1) * 512 <= y) continue;
                    assert.equal(details.cache.get(key)?.image.visible, true);
                }
            }
        }
    }
    assert.ok(metrics.released > 0);
    assert.ok(metrics.peakPixels <= 24 * 256 * 256, 'Evict before allocating so region changes keep the 6MiB pixel budget');
    scene.events.emit('shutdown');
    assert.equal(textures.size, 0);
    assert.equal(children.size, 0);
    assert.equal(details.cache.size, 0);
});
