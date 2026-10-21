const PADDING = 2;

// Repeat each tile's own edge pixels in a private border. Linear filtering
// can then sample outside a tile without picking up adjacent atlas artwork.
export function extrudeTilePixels(source, tileWidth, tileHeight, padding = PADDING) {
    if (source.width % tileWidth || source.height % tileHeight) {
        throw new Error('Tileset dimensions must contain complete tiles.');
    }
    const strideX = tileWidth + padding * 2, strideY = tileHeight + padding * 2;
    const width = source.width / tileWidth * strideX;
    const height = source.height / tileHeight * strideY;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
        const sy = Math.floor(y / strideY) * tileHeight
            + Math.max(0, Math.min(tileHeight - 1, y % strideY - padding));
        for (let x = 0; x < width; x++) {
            const sx = Math.floor(x / strideX) * tileWidth
                + Math.max(0, Math.min(tileWidth - 1, x % strideX - padding));
            const from = (sy * source.width + sx) * 4, to = (y * width + x) * 4;
            data[to] = source.data[from];
            data[to + 1] = source.data[from + 1];
            data[to + 2] = source.data[from + 2];
            data[to + 3] = source.data[from + 3];
        }
    }
    return { width, height, data };
}

export function addSeamlessTileset(scene, map, name, sourceKey) {
    const { tileWidth, tileHeight } = map;
    const key = `${sourceKey}-seamless-${tileWidth}x${tileHeight}`;
    if (!scene.textures.exists(key)) {
        const source = scene.textures.get(sourceKey).getSourceImage();
        const width = source.width / tileWidth * (tileWidth + PADDING * 2);
        const height = source.height / tileHeight * (tileHeight + PADDING * 2);
        const texture = scene.textures.createCanvas(key, width, height);
        const context = texture.getContext();
        context.drawImage(source, 0, 0);
        const pixels = extrudeTilePixels(context.getImageData(0, 0, source.width, source.height), tileWidth, tileHeight);
        const image = context.createImageData(pixels.width, pixels.height);
        image.data.set(pixels.data);
        context.putImageData(image, 0, 0);
        texture.refresh();
    }
    return map.addTilesetImage(name, key, tileWidth, tileHeight, PADDING, PADDING * 2);
}
