// Limites contínuos para o meio-fio. Os pontos próximos do Tiled viram
// segmentos arredondados, evitando prender o carro entre círculos vizinhos.
const SKIN = 0.3;
const CELL = 192;

export function wallShapes(objects) {
    const shapes = [];
    let previous = null;
    for (const object of objects) {
        const w = object.width || 0, h = object.height || 0;
        if (w < 2 && h < 2) {
            const point = { x: object.x, y: object.y };
            shapes.push({ type: 'circle', ...point, radius: 14 });
            if (previous) {
                const gap = Math.hypot(point.x - previous.x, point.y - previous.y);
                if (gap > 0.5 && gap <= 45) {
                    shapes.push({ type: 'segment', ax: previous.x, ay: previous.y,
                        bx: point.x, by: point.y, radius: 14 });
                }
            }
            previous = point;
        } else {
            const width = Math.max(w, 4), height = Math.max(h, 4);
            shapes.push({ type: 'rect', x: object.x + w / 2 - width / 2,
                y: object.y + h / 2 - height / 2, width, height });
        }
    }
    return shapes;
}

function bounds(shape) {
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
    query(x, y, radius) {
        const result = new Set();
        for (let cy = Math.floor((y - radius) / CELL); cy <= Math.floor((y + radius) / CELL); cy++) {
            for (let cx = Math.floor((x - radius) / CELL); cx <= Math.floor((x + radius) / CELL); cx++) {
                for (const shape of this.cells.get(`${cx},${cy}`) || []) result.add(shape);
            }
        }
        return result;
    }
}

export function contactAt(shape, x, y, radius) {
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

export function resolveTravel(index, start, end, velocity, radius, steering = 0) {
    const travelX = end.x - start.x, travelY = end.y - start.y;
    const steps = Math.max(1, Math.ceil(Math.hypot(travelX, travelY) / 8));
    let x = start.x, y = start.y, vx = velocity.x, vy = velocity.y;
    let moveX = travelX / steps, moveY = travelY / steps, normal = null;
    const hits = new Map();
    for (let step = 0; step < steps; step++) {
        x += moveX; y += moveY;
        for (let iteration = 0; iteration < 8; iteration++) {
            let deepest = null, surface = null;
            for (const shape of index.query(x, y, radius + SKIN)) {
                const contact = contactAt(shape, x, y, radius);
                if (contact && (!deepest || contact.depth > deepest.depth)) {
                    deepest = contact; surface = shape;
                }
            }
            if (!deepest) break;
            const { nx, ny, depth } = deepest;
            x += nx * (depth + SKIN); y += ny * (depth + SKIN);
            normal = { x: nx, y: ny, barrel: !!surface.obstacle };
            const incoming = vx * nx + vy * ny;
            if (incoming < 0) {
                const speed = Math.hypot(vx, vy);
                // Conserva a velocidade ao longo da parede. Só o componente
                // contra ela recebe um pequeno recuo, sem multiplicar tudo.
                const rebound = Math.min(70, -incoming * 0.14);
                vx += nx * (rebound - incoming); vy += ny * (rebound - incoming);
                if (surface.obstacle && -incoming > 45) {
                    const tx = -ny, ty = nx, along = vx * tx + vy * ty;
                    if (Math.abs(along) < speed * 0.3) {
                        const side = Math.abs(steering) > 0.1 ? -Math.sign(steering) : Math.sign(along) || 1;
                        const slide = side * speed * 0.42 - along;
                        vx += tx * slide; vy += ty * slide;
                    }
                }
                const before = hits.get(surface);
                if (!before || before.speed < -incoming) hits.set(surface, { shape: surface,
                    speed: -incoming, x: x - nx * radius, y: y - ny * radius });
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
        this.index = new CollisionIndex([...walls, ...barrels]);
        this.previous = { x: scene.car.body.center.x, y: scene.car.body.center.y };
        this.step = () => this.update();
        scene.physics.world.on('worldstep', this.step);
        scene.events.once('shutdown', () => scene.physics.world.off('worldstep', this.step));
    }
    update() {
        const { car } = this.scene;
        const body = car.body;
        const end = { x: body.center.x, y: body.center.y };
        if (!car.controlsEnabled) { this.previous = end; return; }
        const result = resolveTravel(this.index, this.previous, end, body.velocity,
            body.radius, car.handling.steering);
        body.position.x += result.x - end.x;
        body.position.y += result.y - end.y;
        body.updateCenter();
        body.velocity.set(result.vx, result.vy);
        body.speed = Math.hypot(result.vx, result.vy);
        this.previous = { x: result.x, y: result.y };
        if (result.normal) car.contact = { ...result.normal,
            until: this.scene.time.now + (result.normal.barrel ? 260 : 160) };
        const largest = result.hits.reduce((a, b) => !a || b.speed > a.speed ? b : a, null);
        if (largest) this.scene.onCrash(largest.speed, largest);
        for (const hit of result.hits) {
            if (hit.shape.obstacle) this.scene.onObstacleHit(hit.shape.obstacle, hit.speed);
        }
    }
}
