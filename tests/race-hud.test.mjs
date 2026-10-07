import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import RaceHUD from '../js/fx/RaceHUD.js';
import { createRaceRoute, courseDistance, rankDrivers } from '../js/objects/RaceProgress.js';

globalThis.Phaser = { BlendModes: { ADD: 1 } };
export class Shape {
    constructor(type, x, y, value, extra, color) {
        Object.assign(this, { type, x, y, value, alpha: 1, visible: true, originX: type === 'text' ? 0 : 0.5,
            originY: type === 'text' ? 0 : 0.5 });
        if (type === 'text') this.style = extra;
        if (type === 'rectangle') { this.width = value; this.height = extra; this.fillColor = color; }
        if (type === 'circle') { this.radius = value; this.fillColor = extra; }
    }
    setScrollFactor() { return this; }
    setDepth(depth) { this.depth = depth; return this; }
    setOrigin(x, y = x) { this.originX = x; this.originY = y; return this; }
    setStrokeStyle(width, color, alpha = 1) { this.stroke = { width, color, alpha }; return this; }
    setBlendMode() { return this; }
    setAlpha(alpha) { this.alpha = alpha; return this; }
    setVisible(visible) { this.visible = visible; return this; }
    setPosition(x, y) { this.x = x; this.y = y; return this; }
    setDisplaySize(width, height) { this.width = width; this.height = height; return this; }
    setText(value) { this.value = value; return this; }
    setColor(color) { this.style.color = color; return this; }
}

export function setupHUD(width = 800) {
    const objects = [];
    const add = type => (...args) => { const object = new Shape(type, ...args); objects.push(object); return object; };
    const scene = { scale: { width, height: 450 }, map: { tileWidth: 64, tileHeight: 64 },
        totalLaps: 3, checkpointCount: 4, currentLap: 1, checkpointIndex: 0,
        brickCount: 0,
        playerId: 'local', raceTimerStarted: true, raceStartTime: 0, raceFinished: false,
        time: { now: 1000 }, remotePlayers: {},
        car: { x: 4400, y: 3488, speedKmh: 164, turboFuel: 100, turboMax: 100, turboMinToActivate: 18 },
        add: { text: add('text'), image: add('image'), rectangle: add('rectangle'), circle: add('circle') },
        formatRaceTime: () => '00:01.00' };
    const hud = new RaceHUD(scene);
    hud.build(); hud.createMinimap(); hud.update(); hud.updateTimer();
    return { hud, scene, objects };
}

test('HUD uses the arcade font, compact turbo, smaller map and timer above it without the pilot name', () => {
    for (const width of [480, 800]) {
        const { scene, objects } = setupHUD(width);
        assert.equal(scene.playerNickLabel, null);
        assert.ok(scene.miniW < 180 && scene.miniH < 98);
        assert.ok(scene.raceTimerLabel.y < scene.miniY);
        assert.ok(scene.barW < 210 && scene.barH < 20);
        for (const label of objects.filter(object => object.type === 'text')) {
            assert.ok(label.style.fontFamily.includes('Cyber Arcade'));
            const textWidth = String(label.value).length * parseFloat(label.style.fontSize);
            const left = label.x - textWidth * label.originX;
            assert.ok(left >= 0 && left + textWidth <= width, `Label fits: ${label.value}`);
        }
    }
});

test('both drivers appear on the minimap with consistent pink/blue identities and disconnected rivals disappear', () => {
    const { hud, scene } = setupHUD();
    assert.equal(scene.miniMapPlayer.fillColor, 0xff39d4);
    assert.equal(scene.miniMapRival.visible, false);
    scene.remotePlayers.remote = { id: 'remote', sprite: { x: 500, y: 1300 }, online: true,
        lap: 1, checkpointIndex: 2, finished: false };
    hud.updateMinimap();
    assert.equal(scene.miniMapRival.visible, true);
    assert.equal(scene.miniMapRival.fillColor, 0x173f9f);
    for (const marker of [scene.miniMapPlayer, scene.miniMapRival]) {
        assert.ok(marker.x >= scene.miniX && marker.x <= scene.miniX + scene.miniW);
        assert.ok(marker.y >= scene.miniY && marker.y <= scene.miniY + scene.miniH);
    }
    scene.remotePlayers.remote.online = false;
    hud.updateMinimap();
    assert.equal(scene.miniMapRival.visible, false);
    delete scene.remotePlayers.remote;
    hud.updateRanking(2000);
    assert.equal(hud.rows[1].text.value, '2º AGUARDANDO');
});

test('overtaking changes the live leaderboard, while laps and finish times take priority', () => {
    const { hud, scene } = setupHUD();
    scene.remotePlayers.remote = { id: 'remote', sprite: { x: 4600, y: 3488 }, online: true,
        lap: 1, checkpointIndex: 0, finished: false };
    hud.updateRanking(1000);
    assert.equal(hud.rows[0].text.value, '1º VOCÊ');
    scene.remotePlayers.remote.sprite.x = 4200;
    hud.updateRanking(1100);
    assert.equal(hud.rows[0].text.value, '1º RIVAL');
    assert.equal(hud.rows[0].dot.fillColor, scene.miniMapRival.fillColor);
    assert.equal(hud.rows[1].dot.fillColor, scene.miniMapPlayer.fillColor);
    assert.equal(hud.leaderChangedAt, 1100);
    scene.currentLap = 2;
    hud.updateRanking(1200);
    assert.equal(hud.rows[0].text.value, '1º VOCÊ');
    scene.raceFinished = true; scene.finishElapsedMs = 160000;
    scene.remotePlayers.remote.finished = true; scene.remotePlayers.remote.finishElapsedMs = 150000;
    hud.updateRanking(1300);
    assert.equal(hud.rows[0].text.value, '1º RIVAL');
});

test('route follows the mapped track; bends and adjacent track sections have distinct progress', () => {
    const map = JSON.parse(readFileSync(new URL('../assets/images/tilemaps/pista.json', import.meta.url)));
    const layer = map.layers.find(layer => layer.name === 'Pista');
    const route = createRaceRoute();
    let previous = -1;
    route.segments.forEach(segment => {
        const { x, y } = segment.start;
        assert.ok(layer.data[Math.floor(y / 64) * layer.width + Math.floor(x / 64)]);
        const distance = courseDistance(route, { x, y, lap: 1, checkpoints: 4 });
        assert.ok(distance >= previous - 1);
        previous = distance;
    });
    const before = { id: 'before', x: 22.5 * 64, y: 24 * 64, lap: 1, finished: false };
    const after = { id: 'after', x: 37.5 * 64, y: 24 * 64, lap: 1, finished: false };
    assert.equal(rankDrivers(route, [before, after])[0].id, 'after');
    assert.ok(courseDistance(route, { x: 5200, y: 3488, lap: 2, checkpoints: 0 }) < route.total + 100);
});

test('minimap movement creates no new objects and HUD text updates are throttled', () => {
    const { hud, scene, objects } = setupHUD();
    const count = objects.length;
    for (let frame = 0; frame < 120; frame++) {
        scene.time.now = 1010 + frame;
        scene.car.x -= 2;
        hud.updateMinimap(); hud.update(); hud.updateTimer();
    }
    assert.equal(objects.length, count);
    assert.equal(hud.lastUpdate, 1100);
    assert.equal(hud.lastTimer, 1100);
});

test('Tijolinhos count responds immediately with a reusable collection pulse', () => {
    const { hud, scene, objects } = setupHUD(480);
    const objectCount = objects.length;
    assert.equal(scene.brickCountLabel.value, '0');
    assert.equal(hud.brickIcon.value, 'tijolinho');
    assert.equal(hud.brickGain.visible, false);

    scene.time.now = 1010;
    scene.brickCount = 1;
    hud.update();
    assert.equal(scene.brickCountLabel.value, '1');
    assert.equal(hud.brickGain.value, '+1');
    assert.equal(hud.brickGain.visible, true);
    assert.ok(hud.brickFlash.alpha > 0);
    assert.ok(hud.brickIcon.width > 22);
    assert.equal(hud.lastUpdate, 1000, 'collection feedback bypasses the stats throttle');

    scene.time.now = 1020;
    scene.brickCount = 4;
    hud.update();
    assert.equal(scene.brickCountLabel.value, '4');
    assert.equal(hud.brickGain.value, '+3');

    scene.time.now = 1670;
    hud.update();
    assert.equal(hud.brickGain.visible, false);
    assert.equal(hud.brickFlash.alpha, 0);
    assert.equal(hud.brickIcon.width, 22);
    assert.equal(scene.brickCountLabel.style.color, '#ffe6b7');
    assert.equal(objects.length, objectCount);
});

test('HUD includes lap and finish rewards in the tijolinho counter', () => {
    const { hud, scene } = setupHUD();
    scene.brickCount = 4;
    let earned = 14;
    scene.computeFinalScore = () => ({ total: earned });
    hud.updateBricks(1100);
    assert.equal(scene.brickCountLabel.value, '14');
    assert.equal(hud.brickGain.value, '+14');
    earned += 20;
    hud.updateBricks(1200);
    assert.equal(scene.brickCountLabel.value, '34');
    assert.equal(hud.brickGain.value, '+20');
    assert.equal(scene.brickCount, 4, 'reward display preserves the confirmed pickup count');
});
