import { resolveTravel } from './TrackCollisions.js';

// Cada cliente resolve somente o próprio carro. O rival continua seguindo
// o buffer da rede, sem receber teletransportes ou impulsos duplicados.
export function resolvePlayerTravel(start, end, velocity, rotation, radius, rival, previousRival) {
    const dx = Math.sin(rival.rotation) * 24, dy = -Math.cos(rival.rotation) * 24;
    const shape = { type: 'segment', ax: rival.x - dx, ay: rival.y - dy,
        bx: rival.x + dx, by: rival.y + dy, radius: rival.radius, player: true };
    const travelX = rival.x - previousRival.x, travelY = rival.y - previousRival.y;
    // Um salto de reconexão não deve varrer a pista inteira empurrando carros.
    const continuous = Math.hypot(travelX, travelY) < 160;
    const relativeStart = continuous ? { x: start.x + travelX, y: start.y + travelY } : start;
    const result = resolveTravel({ query: () => [shape] }, relativeStart, end,
        { x: velocity.x - rival.vx, y: velocity.y - rival.vy }, radius, 0, null, rotation);
    if (!result.normal) return { ...result, vx: velocity.x, vy: velocity.y };
    result.vx += rival.vx;
    result.vy += rival.vy;
    // Uma pequena perda de energia dá peso ao toque, preservando raspadas.
    if (result.hits.some(hit => hit.speed > 65)) { result.vx *= 0.94; result.vy *= 0.94; }
    const speed = Math.hypot(result.vx, result.vy);
    const limit = Math.max(Math.hypot(velocity.x, velocity.y), Math.hypot(rival.vx, rival.vy)) + 65;
    if (speed > limit) { result.vx *= limit / speed; result.vy *= limit / speed; }
    return result;
}

export default class PlayerCollisions {
    constructor(scene) {
        this.scene = scene;
        this.previous = { ...scene.car.body.center };
        const world = scene.physics.world;
        this.step = () => this.update();
        world.on('worldstep', this.step);
        scene.events.once('shutdown', () => world.off('worldstep', this.step));
    }

    update() {
        const scene = this.scene, car = scene.car, body = car.body;
        const now = scene.time.now;
        for (const remote of Object.values(scene.remotePlayers)) {
            const center = remote.sprite.body.center || remote.sprite;
            const previous = remote.collisionPose || center;
            remote.collisionPose = { x: center.x, y: center.y };
            if (!remote.collider?.active || !remote.online || remote.finished || !car.controlsEnabled) continue;
            const end = { x: body.center.x, y: body.center.y };
            // Rejeição barata antes de testar as cápsulas dos dois carros.
            if (Math.hypot(end.x - center.x, end.y - center.y)
                > 110 + Math.hypot(end.x - this.previous.x, end.y - this.previous.y)
                + Math.hypot(center.x - previous.x, center.y - previous.y)) continue;
            const result = resolvePlayerTravel(this.previous, end, body.velocity, car.rotation, body.radius,
                { ...center, rotation: remote.sprite.rotation, radius: 24, vx: remote.vx || 0, vy: remote.vy || 0 }, previous);
            if (!result.normal) continue;
            // O empurrão de outro carro também respeita muros e chegada.
            const safe = resolveTravel(scene.trackCollisions.index, end, result,
                { x: result.vx, y: result.vy }, body.radius, car.handling.steering,
                null, car.rotation);
            body.position.x += safe.x - end.x;
            body.position.y += safe.y - end.y;
            body.updateCenter();
            body.velocity.set(safe.vx, safe.vy);
            body.speed = Math.hypot(safe.vx, safe.vy);
            if (safe.normal) car.contact = { ...safe.normal, until: now + 220 };
            const hit = result.hits.reduce((best, next) => !best || next.speed > best.speed ? next : best, null);
            if (hit && now >= (remote.impactAfter || 0)) {
                remote.impactAfter = now + 380;
                scene.onCrash(hit.speed, { ...hit, kind: 'car' });
            }
            scene.trackCollisions.previous = { x: body.center.x, y: body.center.y };
        }
        this.previous = { x: body.center.x, y: body.center.y };
    }
}
