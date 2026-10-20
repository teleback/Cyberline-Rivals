// Ajustes de tamanho do cenário são feitos uma vez, na criação da camada.
// A âncora fica no primeiro tile ocupado, preservando os offsets do Tiled.
export function applySceneryLayout(layer) {
    const properties = layer.layer.properties || [];
    const value = name => Array.isArray(properties)
        ? properties.find(property => property.name === name)?.value : properties[name];
    const sx = Number(value('sceneryScaleX')) || 1;
    const sy = Number(value('sceneryScaleY')) || 1;
    if (sx === 1 && sy === 1) return layer;
    let x = Infinity, y = Infinity;
    for (const row of layer.layer.data) for (const tile of row) {
        if (!tile || tile.index < 0) continue;
        x = Math.min(x, tile.pixelX); y = Math.min(y, tile.pixelY);
    }
    if (!Number.isFinite(x)) return layer;
    layer.setPosition(layer.x + x * (1 - sx), layer.y + y * (1 - sy)).setScale(sx, sy);
    return layer;
}
