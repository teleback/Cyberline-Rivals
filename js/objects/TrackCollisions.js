// Limites contínuos para o meio-fio. Os pontos próximos do Tiled viram
// segmentos arredondados, evitando prender o carro entre círculos vizinhos.
const SKIN = 0.3;
const CELL = 192;

export function wallShapes(objects) {
    const shapes = [];
    const points = [];
    for (const object of objects) {
        const w = object.width || 0, h = object.height || 0;
        if (w < 2 && h < 2) {
            const point = { x: object.x, y: object.y };
            shapes.push({ type: 'circle', ...point, radius: 14 });
            points.push(point);
        } else {
            const width = Math.max(w, 4), height = Math.max(h, 4);
            shapes.push({ type: 'rect', x: object.x + w / 2 - width / 2,
                y: object.y + h / 2 - height / 2, width, height });
        }
    }
    // A ordem dos objetos no Tiled não é a ordem do contorno. Une também
    // as pontas próximas de trechos desenhados em momentos diferentes.
    for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
            const a = points[i], b = points[j];
            const gap = Math.hypot(a.x - b.x, a.y - b.y);
            if (gap > 0.5 && gap <= 45) shapes.push({ type: 'segment',
                ax: a.x, ay: a.y, bx: b.x, by: b.y, radius: 14 });
        }
    }
    return shapes;
}

function bounds(shape) {
    if (shape.type === 'finish-line') return [shape.x, shape.yMin, shape.x, shape.yMax];
    if (shape.type === 'rect') return [shape.x, shape.y, shape.x + shape.width, shape.y + shape.height];
    if (shape.type === 'circle') return [shape.x - shape.radius, shape.y - shape.radius,
        shape.x + shape.radius, shape.y + shape.radius];
    return [Math.min(shape.ax, shape.bx) - shape.radius, Math.min(shape.ay, shape.by) - shape.radius,
        Math.max(shape.ax, shape.bx) + shape.radius, Math.max(shape.ay, shape.by) + shape.radius];
}

export class CollisionIndex {
    constructor(shapes) {
        this.cells = new Map();
        for (const shape of shapes) {
            const [left, top, right, bottom] = bounds(shape);
            for (let y = Math.floor(top / CELL); y <= Math.floor(bottom / CELL); y++) {
                for (let x = Math.floor(left / CELL); x <= Math.floor(right / CELL); x++) {
                    const key = `${x},${y}`;
                    if (!this.cells.has(key)) this.cells.set(key, []);
                    this.cells.get(key).push(shape);
                }
            }
        }
    }
    query(x, y, radius, result = new Set()) {
        result.clear();
        for (let cy = Math.floor((y - radius) / CELL); cy <= Math.floor((y + radius) / CELL); cy++) {
            for (let cx = Math.floor((x - radius) / CELL); cx <= Math.floor((x + radius) / CELL); cx++) {
                for (const shape of this.cells.get(`${cx},${cy}`) || []) result.add(shape);
            }
        }
        return result;
    }
}

export function contactAt(shape, x, y, radius, start) {
    if (shape.type === 'finish-line') {
        // Cars spawn centered on the line. Block their centers from
        // crossing back to the right, while letting each lap pass left.
        if (!start || start.x > shape.x || x <= shape.x) return null;
        const crossingY = start.y + (y - start.y) * (shape.x - start.x) / (x - start.x);
        if (crossingY + radius < shape.yMin || crossingY - radius > shape.yMax) return null;
        return { nx: -1, ny: 0, depth: x - shape.x };
    }
    let px, py, extra = shape.radius || 0;
    if (shape.type === 'rect') {
        px = Math.max(shape.x, Math.min(shape.x + shape.width, x));
        py = Math.max(shape.y, Math.min(shape.y + shape.height, y));
        if (x === px && y === py) {
            const edges = [
                { d: x - shape.x, nx: -1, ny: 0 },
                { d: shape.x + shape.width - x, nx: 1, ny: 0 },
                { d: y - shape.y, nx: 0, ny: -1 },
                { d: shape.y + shape.height - y, nx: 0, ny: 1 },
            ];
            const edge = edges.reduce((a, b) => a.d < b.d ? a : b);
            return { nx: edge.nx, ny: edge.ny, depth: radius + edge.d };
        }
    } else if (shape.type === 'segment') {
        const dx = shape.bx - shape.ax, dy = shape.by - shape.ay;
        const t = Math.max(0, Math.min(1, ((x - shape.ax) * dx + (y - shape.ay) * dy) / (dx * dx + dy * dy)));
        px = shape.ax + t * dx; py = shape.ay + t * dy;
    } else { px = shape.x; py = shape.y; }
    const dx = x - px, dy = y - py, distance = Math.hypot(dx, dy);
    const depth = radius + extra - distance;
    if (depth <= 0) return null;
    return { nx: distance > 0.001 ? dx / distance : 1,
        ny: distance > 0.001 ? dy / distance : 0, depth };
}

export function resolveTravel(index, start, end, velocity, radius, steering = 0, ignoredShapes = null, rotation = null) {
    const travelX = end.x - start.x, travelY = end.y - start.y;
    const steps = Math.max(1, Math.ceil(Math.hypot(travelX, travelY) / 8));
    let x = start.x, y = start.y, vx = velocity.x, vy = velocity.y;
    let moveX = travelX / steps, moveY = travelY / steps, normal = null;
    const hits = new Map();
    const candidates = new Set();
    // Três círculos sobrepostos acompanham a carroceria ao girar. O círculo
    // central do Arcade continua sendo usado pelos sensores de óleo/coleta.
    const reach = Number.isFinite(rotation) ? 24 : 0;
    const dx = Math.sin(rotation || 0) * reach, dy = -Math.cos(rotation || 0) * reach;
    const probes = reach ? [{ x: 0, y: 0 }, { x: dx, y: dy }, { x: -dx, y: -dy }] : [{ x: 0, y: 0 }];
    for (let step = 0; step < steps; step++) {
        x += moveX; y += moveY;
        for (let iteration = 0; iteration < 8; iteration++) {
            let deepest = null, surface = null, probe = probes[0];
            for (const shape of index.query(x, y, radius + reach + SKIN, candidates)) {
                if (ignoredShapes?.has(shape)) continue;
                for (const offset of shape.type === 'finish-line' ? [probes[0]] : probes) {
                    const contact = contactAt(shape, x + offset.x, y + offset.y, radius, start);
                    if (contact && (!deepest || contact.depth > deepest.depth)) {
                        deepest = contact; surface = shape; probe = offset;
                    }
                }
            }
            if (!deepest) break;
            const { nx, ny, depth } = deepest;
            x += nx * (depth + SKIN); y += ny * (depth + SKIN);
            const wall = !surface.obstacle && !surface.player && surface.type !== 'finish-line';
            normal = { x: nx, y: ny, barrel: !!surface.obstacle, rebound: wall || !!surface.obstacle };
            const incoming = vx * nx + vy * ny;
            if (incoming < 0) {
                const speed = Math.hypot(vx, vy);
                // Raspadas continuam deslizando; uma batida de frente afasta
                // o carro da parede, com recuo limitado mesmo durante o turbo.
                const frontal = -incoming / Math.max(1, speed);
                const restitution = wall ? 0.14 + 0.24 * frontal * frontal
                    : surface.obstacle ? 0.25 + 0.22 * frontal * frontal : 0.12;
                const rebound = surface.type === 'finish-line' ? 0
                    : Math.min(wall ? 180 : surface.obstacle ? 165 : 65, -incoming * restitution);
                vx += nx * (rebound - incoming); vy += ny * (rebound - incoming);
                if (surface.obstacle && -incoming > 45) {
                    const tx = -ny, ty = nx, along = vx * tx + vy * ty;
                    if (Math.abs(along) < speed * 0.3) {
                        const side = Math.abs(steering) > 0.1 ? -Math.sign(steering) : Math.sign(along) || 1;
                        const slide = side * speed * 0.18 - along;
                        vx += tx * slide; vy += ty * slide;
                    }
                }
                const before = hits.get(surface);
                if (!before || before.speed < -incoming) hits.set(surface, { shape: surface,
                    speed: -incoming, x: x + probe.x - nx * radius, y: y + probe.y - ny * radius,
                    nx, ny });
            }
            const intoMove = moveX * nx + moveY * ny;
            if (intoMove < 0) { moveX -= nx * intoMove; moveY -= ny * intoMove; }
        }
    }
    return { x, y, vx, vy, normal, hits: [...hits.values()] };
}

export default class TrackCollisions {
    constructor(scene, walls) {
        this.scene = scene;
        const barrels = scene.obstacles.getChildren().map(obstacle => ({ type: 'circle',
            x: obstacle.body.center.x, y: obstacle.body.center.y,
            radius: obstacle.body.radius, obstacle }));
        const finish = Number.isFinite(scene.finishLineX)
            && Number.isFinite(scene.finishLineYMin) && Number.isFinite(scene.finishLineYMax)
            ? [{ type: 'finish-line', x: scene.finishLineX,
                yMin: scene.finishLineYMin, yMax: scene.finishLineYMax }] : [];
        this.index = new CollisionIndex([...walls, ...barrels, ...finish]);
        this.previous = { x: scene.car.body.center.x, y: scene.car.body.center.y };
        this.step = () => this.update();
        // Arcade clears scene.physics.world before user shutdown handlers run.
        const world = scene.physics.world;
        world.on('worldstep', this.step);
        scene.events.once('shutdown', () => world.off('worldstep', this.step));
    }
    update() {
        const { car } = this.scene;
        const body = car.body;
        const end = { x: body.center.x, y: body.center.y };
        if (!car.controlsEnabled) {
            this.previous = end;
            return;
        }
        const now = this.scene.time.now;
        const result = resolveTravel(this.index, this.previous, end, body.velocity,
            body.radius, car.handling.steering, null, car.rotation);
        body.position.x += result.x - end.x;
        body.position.y += result.y - end.y;
        body.updateCenter();
        body.velocity.set(result.vx, result.vy);
        body.speed = Math.hypot(result.vx, result.vy);
        this.previous = { x: result.x, y: result.y };
        // Uma raspada fraca durante a recuperação não substitui a normal
        // que sustenta o recuo da primeira batida.
        if (result.normal && !(car.contact?.rebound && now < car.contact.until && !result.hits.length)) car.contact = { ...result.normal,
            until: now + (result.normal.rebound || result.normal.barrel ? 260 : 160) };
        const largest = result.hits.reduce((a, b) => !a || b.speed > a.speed ? b : a, null);
        if (largest) this.scene.onCrash(largest.speed, largest);
        for (const hit of result.hits) {
            if (hit.shape.obstacle) {
                this.scene.onObstacleHit(hit.shape.obstacle, hit.speed);
            }
        }
        // O contato curto sustenta o recuo sob aceleração. O barril continua
        // sólido em todos os passos, inclusive numa segunda batida imediata.
    }
}
