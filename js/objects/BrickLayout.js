import { createRaceRoute } from './RaceProgress.js';

export const BRICK_LAYOUT_SETTINGS = Object.freeze({
    trails: 18,
    bricksPerTrail: 4,
    spacing: 104,
    laneOffset: 44,
    footprint: 30,
    wallClearance: 58,
    avoidClearance: 24,
    startClearance: 320,
});

function objectLayer(map, name) {
    return map.getObjectLayer?.(name)?.objects
        ?? map.layers?.find(layer => layer.name === name)?.objects ?? [];
}

function asphaltAt(map, x, y) {
    const tileWidth = map.tileWidth ?? map.tilewidth ?? 64;
    const tileHeight = map.tileHeight ?? map.tileheight ?? 64;
    const tx = Math.floor(x / tileWidth), ty = Math.floor(y / tileHeight);
    if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return false;
    if (map.getTileAt) return (map.getTileAt(tx, ty, false, 'Pista')?.index ?? -1) > 0;
    const layer = map.layers?.find(layer => layer.name === 'Pista');
    if (!layer) return false;
    const tile = Array.isArray(layer.data[ty]) ? layer.data[ty][tx] : layer.data[ty * layer.width + tx];
    return (typeof tile === 'object' ? tile?.index : tile) > 0;
}

// Distance to the edge of a circle or a rectangle centered on the supplied
// position. Hazard rotations are radians, matching Phaser GameObjects.
function shapeDistance(point, shape) {
    const dx = point.x - shape.x, dy = point.y - shape.y;
    if (shape.width === undefined && shape.height === undefined) {
        return Math.hypot(dx, dy) - (shape.radius ?? 0);
    }
    const rotation = shape.rotation ?? 0;
    const cos = Math.cos(rotation), sin = Math.sin(rotation);
    const x = Math.abs(dx * cos + dy * sin);
    const y = Math.abs(-dx * sin + dy * cos);
    return Math.hypot(Math.max(0, x - shape.width / 2), Math.max(0, y - shape.height / 2));
}

function wallShapes(map) {
    // Mirror Race.createWallsFromLayer, including its 14px circular walls
    // and minimum thickness for nearly-flat rectangles.
    return ['colisao', 'colisoes pista'].flatMap(name => objectLayer(map, name)).map(wall => {
        const width = wall.width ?? 0, height = wall.height ?? 0;
        if (width < 2 && height < 2) return { x: wall.x, y: wall.y, radius: 14 };
        return {
            x: wall.x + width / 2, y: wall.y + height / 2,
            width: Math.max(4, width), height: Math.max(4, height),
        };
    });
}

function routePoint(route, distance, laneOffset) {
    const segment = route.segments.find(part => distance <= part.offset + part.length)
        ?? route.segments.at(-1);
    const t = Math.max(0, Math.min(1, (distance - segment.offset) / segment.length));
    return {
        x: segment.start.x + segment.dx * t - segment.dy / segment.length * laneOffset,
        y: segment.start.y + segment.dy * t + segment.dx / segment.length * laneOffset,
        distance,
    };
}

/**
 * Place short, repeatable trails around the clockwise course. Accepts a
 * Phaser Tilemap or the raw Tiled JSON. `avoid` contains centered rectangles
 * ({x,y,width,height,rotation?}) or circles ({x,y,radius}); callers may expand
 * their hazard bounds for driving clearance. Another 24px protects the art.
 * Only valid positions are returned: a blocked trail is omitted rather than
 * putting a pickup inside a wall or hazard. No randomness or Phaser state.
 */
export function createBrickLayout(map, { avoid = [] } = {}) {
    const settings = BRICK_LAYOUT_SETTINGS;
    const tileWidth = map.tileWidth ?? map.tilewidth ?? 64;
    const tileHeight = map.tileHeight ?? map.tileheight ?? 64;
    const scale = Math.min(tileWidth, tileHeight) / 64;
    const route = createRaceRoute(tileWidth, tileHeight);
    const walls = wallShapes(map);
    const start = route.segments[0].start;
    const startGrid = { x: start.x, y: start.y, width: 600 * scale, height: 400 * scale };
    const safe = point => {
        for (const dx of [-settings.footprint, 0, settings.footprint]) {
            for (const dy of [-settings.footprint, 0, settings.footprint]) {
                if (!asphaltAt(map, point.x + dx * scale, point.y + dy * scale)) return false;
            }
        }
        if (shapeDistance(point, startGrid) < settings.footprint * scale) return false;
        if (walls.some(wall => shapeDistance(point, wall) < settings.wallClearance * scale)) return false;
        return !avoid.some(shape => shapeDistance(point, shape) < settings.avoidClearance * scale);
    };

    const layout = [];
    const sectorLength = route.total / settings.trails;
    const shifts = [0, 104, -104, 208, -208, 312, -312, 416, -416];
    for (let trail = 0; trail < settings.trails; trail++) {
        const anchor = (trail + 0.5) * sectorLength;
        // Alternate gentle lane choices; each complete trail follows one
        // lane, so collecting four never demands zigzagging across the road.
        const lane = [0, -settings.laneOffset, settings.laneOffset][trail % 3];
        const lanes = [...new Set([lane, 0, -settings.laneOffset, settings.laneOffset])];
        let positions;
        for (const shift of shifts) {
            for (const offset of lanes) {
                const candidate = Array.from({ length: settings.bricksPerTrail }, (_, index) => {
                    const distance = anchor + shift * scale
                        + (index - (settings.bricksPerTrail - 1) / 2) * settings.spacing * scale;
                    return routePoint(route, distance, offset * scale);
                });
                if (candidate.some(point => point.distance < settings.startClearance * scale
                    || point.distance > route.total - settings.startClearance * scale)) continue;
                if (!candidate.every(safe)) continue;
                if (layout.some(previous => candidate.some(point => Math.hypot(point.x - previous.x,
                    point.y - previous.y) < settings.spacing * scale * 0.6))) continue;
                positions = candidate;
                break;
            }
            if (positions) break;
        }
        positions?.forEach((point, index) => layout.push({
            ...point, id: `brick-${trail + 1}-${index + 1}`, trail,
        }));
    }
    return layout.sort((a, b) => a.distance - b.distance);
}
