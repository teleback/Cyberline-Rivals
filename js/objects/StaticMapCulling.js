// The race artwork never changes tiles. Reuse Phaser's tile selection until
// its padded tile bounds change, and skip scans of empty parts of a layer.
// Pixel positions, zoom and draw order still come from Phaser every frame.
export function cacheStaticLayer(layer) {
    const original = layer.cullCallback;
    const getBounds = Phaser.Tilemaps.Components.CullBounds;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const row of layer.layer.data) for (const tile of row) {
        if (!tile || tile.index < 0) continue;
        minX = Math.min(minX, tile.x); maxX = Math.max(maxX, tile.x);
        minY = Math.min(minY, tile.y); maxY = Math.max(maxY, tile.y);
    }
    let cachedOutput, left, top, right, bottom, order;
    layer.cullCallback = function(data, camera, output, renderOrder) {
        if (data.orientation !== 0 || layer.skipCull
            || layer.scrollFactorX !== 1 || layer.scrollFactorY !== 1) {
            cachedOutput = null;
            return original.call(this, data, camera, output, renderOrder);
        }
        const bounds = getBounds(data, camera);
        if (cachedOutput === output && left === bounds.left && top === bounds.top
            && right === bounds.right && bottom === bounds.bottom && order === renderOrder) {
            layer.tilesDrawn = output.length;
            return output;
        }
        left = bounds.left; top = bounds.top; right = bounds.right; bottom = bounds.bottom;
        order = renderOrder;
        cachedOutput = output;
        if (right < minX || left > maxX || bottom < minY || top > maxY) {
            output.length = 0;
            layer.tilesDrawn = 0;
            return output;
        }
        return original.call(this, data, camera, output, renderOrder);
    };
    // Call this after changing tile visibility/alpha or replacing existing
    // artwork. Layers that add tiles outside these bounds should use Phaser.
    return () => { cachedOutput = null; };
}
