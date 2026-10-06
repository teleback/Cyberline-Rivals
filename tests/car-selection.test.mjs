// Run with Node 22+: node tests/car-selection.test.mjs
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { test } from 'node:test';

class Shape extends EventEmitter {
    constructor(x, y, value, style = {}) { super(); Object.assign(this, { x, y, value, style }); }
    setOrigin() { return this; }
    setInteractive() { this.interactive = true; return this; }
    disableInteractive() { this.interactive = false; return this; }
    setDepth() { return this; }
    setPadding() { return this; }
    setBackgroundColor() { return this; }
    setShadow() { return this; }
    setColor() { return this; }
    setStrokeStyle() { return this; }
    setFillStyle() { return this; }
    setText(value) { this.value = value; return this; }
    setAlpha(alpha) { this.alpha = alpha; return this; }
    setScale(scale) { this.scaleX = this.scaleY = scale; return this; }
    setPosition(x, y) { this.x = x; this.y = y; return this; }
}
const pixels = new Uint8ClampedArray(6 * 10 * 4);
for (let y = 1; y <= 8; y++) for (let x = 1; x <= 4; x++) pixels[(y * 6 + x) * 4 + 3] = 255;
globalThis.document = { createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData: () => ({ data: pixels }) }) }) };
globalThis.localStorage = { getItem: () => null };
globalThis.window = { addEventListener() {} };
const pad = { connected: true, id: 'test', axes: [0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false })) };
Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => [pad] }, configurable: true });
globalThis.Phaser = { Scene: class {}, Geom: { Rectangle: class { static Contains() {} } },
    Physics: { Arcade: { Sprite: class {} } }, Events: { EventEmitter },
    Math: { Clamp: (value, min, max) => Math.max(min, Math.min(max, value)) } };
const { CAR_SKINS, loadCarSkins, prepareCarSkins, getCarSkin } = await import('../js/objects/CarSkins.js');
const { default: CarSelection } = await import('../js/scenes/CarSelectionScene.js');
// Race imports the touch module; provide the browser environment it reads.
Object.assign(window, { location: { search: '?touch=0' }, matchMedia: () => ({ matches: false }) });
const { default: Race } = await import('../js/scenes/RaceScene.js');

function textures() {
    const keys = new Set(CAR_SKINS.map(car => car.source));
    const draws = [];
    return {
        draws,
        exists: key => keys.has(key),
        get: () => ({ getSourceImage: () => ({ width: 6, height: 10 }) }),
        createCanvas(key, width, height) {
            keys.add(key);
            const texture = { key, width, height, refreshed: false };
            draws.push(texture);
            return { getContext: () => ({ drawImage: (...args) => { texture.draw = args; } }),
                refresh: () => { texture.refreshed = true; } };
        },
    };
}
function setup(width = 800) {
    const scene = new CarSelection();
    const graphics = new Proxy({}, { get: () => () => graphics });
    scene.scale = { width, height: 450 };
    scene.textures = textures();
    scene.events = new EventEmitter();
    scene.input = Object.assign(new EventEmitter(), { keyboard: new EventEmitter() });
    scene.cameras = { main: { setBackgroundColor() {}, flash() {}, fadeOut() {} } };
    scene.tweenQueue = [];
    scene.delayed = [];
    scene.tweens = { add: config => { scene.tweenQueue.push(config); return config; } };
    scene.time = { now: 0, delayedCall: (_delay, callback) => scene.delayed.push(callback) };
    scene.texts = [];
    scene.add = {
        graphics: () => graphics,
        image: (x, y, key) => new Shape(x, y, key),
        rectangle: (x, y) => new Shape(x, y),
        ellipse: (x, y) => new Shape(x, y),
        text: (x, y, value, style) => { const text = new Shape(x, y, value, style); scene.texts.push(text); return text; },
    };
    scene.scene = { start: (name, data) => { scene.destination = name; scene.data = data; } };
    scene.create({ playerNick: 'LoboNeon', playerId: 'player', roomId: 4 });
    return scene;
}
function finishTransition(scene) {
    const running = scene.tweenQueue.filter(config => config.onComplete);
    scene.tweenQueue = scene.tweenQueue.filter(config => !config.onComplete);
    for (const config of running) {
        for (const key of ['x', 'y', 'scaleX', 'scaleY', 'alpha']) config.targets[key] = config[key];
        config.onComplete();
    }
}

test('four skins load real assets and normalize generated frames to preserve collision geometry', () => {
    const requests = [];
    loadCarSkins({ textures: { exists: () => false }, load: { image: (...args) => requests.push(args) } });
    assert.equal(requests.length, 4);
    for (const [, path] of requests) assert.ok(existsSync(path), `Asset disponível: ${path}`);
    assert.equal(new Set(CAR_SKINS.map(car => car.texture)).size, 4);
    const manager = textures();
    prepareCarSkins({ textures: manager });
    assert.equal(manager.draws.length, 3);
    for (const texture of manager.draws) {
        assert.equal(texture.width, 102);
        assert.equal(texture.height, 166);
        assert.equal(texture.refreshed, true);
        const [, left, top, width, height, x, y, drawWidth, drawHeight] = texture.draw;
        assert.deepEqual([left, top, width, height], [1, 1, 4, 8]);
        assert.deepEqual([x, y, drawWidth, drawHeight], [20, 21, 60, 119]);
    }
    prepareCarSkins({ textures: manager });
    assert.equal(manager.draws.length, 3);
    assert.equal(getCarSkin('blue').texture, 'car-blue-v2');
    assert.equal(getCarSkin('unknown').texture, 'carro');
});

test('carousel wraps both ways, queues rapid navigation and hides offscreen input', () => {
    const scene = setup();
    assert.equal(scene.selected, 0);
    assert.equal(scene.previews.filter(item => item.sprite.interactive).length, 3);
    scene.moveSelection(-1);
    assert.equal(scene.selected, 3);
    scene.moveSelection(-1);
    assert.equal(scene.pendingDirection, -1);
    finishTransition(scene);
    assert.equal(scene.selected, 2);
    finishTransition(scene);
    assert.equal(scene.transitioning, false);
    assert.equal(scene.previews[2].sprite.x, scene.centerX);
    assert.equal(scene.previews[2].sprite.alpha, 1);
    assert.equal(scene.previews[0].sprite.interactive, false);
    scene.moveSelection(1); finishTransition(scene);
    scene.moveSelection(1); finishTransition(scene);
    assert.equal(scene.selected, 0);
});

test('swiping and tapping side previews select cars; vertical gestures do not', () => {
    const scene = setup();
    scene.input.emit('pointerdown', { id: 1, x: 400, y: 220 });
    scene.input.emit('pointerup', { id: 1, x: 320, y: 223 });
    assert.equal(scene.selected, 1);
    finishTransition(scene);
    scene.input.emit('pointerdown', { id: 1, x: 400, y: 220 });
    scene.input.emit('pointerup', { id: 1, x: 390, y: 300 });
    assert.equal(scene.selected, 1);
    scene.previews[2].sprite.emit('pointerup', { x: 500, downX: 500, y: 220, downY: 220 });
    assert.equal(scene.selected, 2);
});

test('gamepad requires a fresh confirm press and selected texture data survives the scene transition', () => {
    const scene = setup();
    pad.buttons[0].pressed = true;
    scene.update(500);
    assert.equal(scene.confirmed, false);
    pad.buttons[0].pressed = false;
    pad.axes[0] = 1;
    scene.update(501);
    finishTransition(scene);
    assert.equal(scene.selected, 1);
    pad.axes[0] = 0;
    pad.buttons[0].pressed = true;
    scene.update(502);
    assert.equal(scene.confirmed, true);
    scene.confirmSelection();
    assert.equal(scene.delayed.length, 1);
    scene.delayed.shift()();
    assert.equal(scene.destination, 'Preloader');
    assert.deepEqual(scene.data, { carSkin: 'pink', carTint: 0xffffff, playerNick: 'LoboNeon', playerId: 'player', roomId: 4 });
    scene.events.emit('shutdown');
    assert.equal(scene.input.listenerCount('pointerdown'), 0);
    assert.equal(scene.input.keyboard.listenerCount('keydown-RIGHT'), 0);
    pad.buttons[0].pressed = false;
});

test('keyboard switches cars and arcade labels fit compact and desktop layouts', () => {
    for (const width of [480, 800]) {
        const scene = setup(width);
        scene.input.keyboard.emit('keydown-RIGHT');
        finishTransition(scene);
        assert.equal(scene.selected, 1);
        for (const text of scene.texts) {
            const size = parseFloat(text.style.fontSize);
            const textWidth = text.value.length * size * (text.style.fontFamily.includes('Cyber Arcade') ? 1 : 0.61);
            assert.ok(text.x - textWidth / 2 >= 0 && text.x + textWidth / 2 <= width, text.value);
        }
    }
});

test('multiplayer updates the rival to the selected sprite while retaining its native colors', () => {
    const sprite = Object.assign(new Shape(), {
        texture: { key: 'carro' },
        setTexture(key) { this.texture.key = key; },
        setTint(tint) { this.tint = tint; },
    });
    const remote = { sprite, label: { setText() {} }, lastMessageTs: 0,
        lastPacketAt: performance.now(), arrivalJitter: 0, stateBuffer: [], tint: 0xffffff };
    const race = Object.create(Race.prototype);
    Object.assign(race, { playerId: 'local', remotePlayers: { rival: remote },
        pendingClockProbes: new Map(), networkSendInterval: 33, raceTimerStarted: true,
        updateLobbyStatus() {}, tryCoordinateStart() {}, tryResolvePodium() {} });
    race.receiveRemotePlayer({ id: 'rival', online: true, skin: 'green', tint: 0xffffff });
    assert.equal(sprite.texture.key, 'car-green-v2');
    assert.equal(sprite.tint, 0xffffff);
    race.receiveRemotePlayer({ id: 'rival', online: true, skin: 'blue', tint: 0xffffff });
    assert.equal(sprite.texture.key, 'car-blue-v2');
});
