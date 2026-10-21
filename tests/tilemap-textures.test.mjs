import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extrudeTilePixels } from '../js/objects/TilemapTextures.js';

function pixel(image, x, y) {
    return Array.from(image.data.slice((y * image.width + x) * 4, (y * image.width + x + 1) * 4));
}

test('each tile keeps its art and repeats its own edges and corners, including alpha', () => {
    const source = { width: 4, height: 4, data: new Uint8ClampedArray(4 * 4 * 4) };
    for (let i = 0; i < 16; i++) source.data.set([i * 10, 255 - i, i, i % 3 ? 255 : 0], i * 4);
    const padded = extrudeTilePixels(source, 2, 2, 1);
    assert.equal(padded.width, 8);
    assert.equal(padded.height, 8);
    const expected = [
        [0, 0, 1, 1, 2, 2, 3, 3],
        [0, 0, 1, 1, 2, 2, 3, 3],
        [4, 4, 5, 5, 6, 6, 7, 7],
        [4, 4, 5, 5, 6, 6, 7, 7],
        [8, 8, 9, 9, 10, 10, 11, 11],
        [8, 8, 9, 9, 10, 10, 11, 11],
        [12, 12, 13, 13, 14, 14, 15, 15],
        [12, 12, 13, 13, 14, 14, 15, 15],
    ];
    expected.forEach((row, y) => row.forEach((label, x) => {
        assert.deepEqual(pixel(padded, x, y), Array.from(source.data.slice(label * 4, label * 4 + 4)));
    }));
});

test('an opaque road tile never samples the transparent neighbor across its filtering border', () => {
    const source = { width: 128, height: 64, data: new Uint8ClampedArray(128 * 64 * 4) };
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
        source.data.set([26, 29, 40, 255], (y * 128 + x) * 4);
    }
    const padded = extrudeTilePixels(source, 64, 64);
    for (let y = 0; y < padded.height; y++) {
        assert.deepEqual(pixel(padded, 66, y), [26, 29, 40, 255]);
        assert.deepEqual(pixel(padded, 67, y), [26, 29, 40, 255]);
        assert.equal(pixel(padded, 68, y)[3], 0, 'The neighboring transparent tile must remain transparent');
    }
});
