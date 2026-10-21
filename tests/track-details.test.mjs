import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildTrackReflectors } from '../js/fx/TrackDetails.js';
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
